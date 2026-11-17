// src/main/handlers/consolidation.handlers.ts
import { IpcMain, BrowserWindow } from 'electron';
import { consolidateRoms, ConsolidationProgress } from '../../helpers/consolidateRoms.js';
import { databaseService } from '../services/database.service.js';
import { sendLogToRenderer } from '../utils/logger.js';
import { OperationSignal, createOperationSignal } from '../../helpers/operationSignal.js';
import { killAllTrackedProcesses } from '../../helpers/archives/processRegistry.js';
import { createProgressThrottle } from '../utils/progressThrottle.js';
import { settingsManager } from '../../helpers/settingsManager.js';
import { profileDisplayName } from './profiles.handlers.js';

/** Consolidation en cours (une seule à la fois : la modale de consolidation est bloquante) */
let activeConsolidation: OperationSignal | null = null;

/** Une consolidation est-elle en cours ? (le profil courant ne peut pas changer pendant ce temps) */
export function isConsolidationRunning(): boolean {
  return activeConsolidation !== null;
}

export function registerConsolidationHandlers(ipcMain: IpcMain, mainWindow: BrowserWindow) {

  // Lancer la consolidation
  ipcMain.handle('consolidation:run', async (event) => {
    const database = databaseService.getDatabase();
    if (!database) {
      throw new Error('Aucune base de données active');
    }

    const signal = createOperationSignal();
    activeConsolidation = signal;

    // Progression vers la modale (limitée, le dernier état est toujours transmis)
    const progressThrottle = createProgressThrottle<ConsolidationProgress>(progress => {
      if (!event.sender.isDestroyed()) event.sender.send('consolidation-progress', progress);
    });

    // Logs (panneau + fichier) : étapes hors jeux (préparation, nettoyage) et issue de chaque jeu
    let lastStageKey: string | null = null;
    const logProgress = (progress: ConsolidationProgress) => {
      if (progress.phase !== 'consolidating') {
        if (progress.phase !== 'complete' && progress.key !== lastStageKey) {
          sendLogToRenderer(mainWindow, 'info', 'match', progress.key, progress.params);
        }
        lastStageKey = progress.key;
        return;
      }
      lastStageKey = null;
      if (!progress.currentGame) return;
      const game = progress.currentGame;
      switch (progress.step) {
        case 'done':
          sendLogToRenderer(mainWindow, 'info', 'match', 'logs.consolidation.gameDone', { game, format: progress.chosenFormat || '?' });
          break;
        case 'skipped':
          sendLogToRenderer(mainWindow, 'info', 'match', 'logs.consolidation.gameSkipped', { game });
          break;
        case 'error':
          sendLogToRenderer(mainWindow, 'error', 'match', 'logs.consolidation.gameError', { game, error: progress.error || '' });
          break;
        case 'aborted':
          sendLogToRenderer(mainWindow, 'warning', 'match', 'logs.consolidation.gameAborted', { game });
          break;
      }
    };

    try {
      const { profiles, activeProfileId } = settingsManager.listProfiles();
      const activeProfile = profiles.find(p => p.id === activeProfileId);
      sendLogToRenderer(mainWindow, 'info', 'match', 'logs.consolidation.start', {
        profile: activeProfile ? profileDisplayName(activeProfile) : activeProfileId
      });

      const result = await consolidateRoms(database, (progress) => {
        logProgress(progress);
        progressThrottle.push(progress);
      }, signal);

      if (result.cancelled) {
        sendLogToRenderer(mainWindow, 'warning', 'match', 'logs.consolidation.cancelled', {
          games: result.stats.gamesConsolidated,
          remaining: result.stats.gamesRemaining ?? 0
        });
      } else {
        sendLogToRenderer(mainWindow, 'info', 'match', 'logs.consolidation.done', {
          games: result.stats.gamesConsolidated,
          archives: result.stats.archivesCreated,
          unmatched: result.stats.unmatchedFilesMoved
        });
      }

      if (result.m3u) {
        sendLogToRenderer(mainWindow, 'info', 'match', 'logs.consolidation.m3uFormatOverride', { count: result.m3u.forcedGames });
        if (!result.cancelled) {
          sendLogToRenderer(mainWindow, 'info', 'match', 'logs.consolidation.m3uCreated', { count: result.m3u.created });
          if (result.m3u.skipped > 0) {
            sendLogToRenderer(mainWindow, 'warning', 'match', 'logs.consolidation.m3uSkipped', { count: result.m3u.skipped });
          }
        }
      }

      if (result.errors.length > 0) {
        sendLogToRenderer(mainWindow, 'warning', 'match', 'logs.consolidation.errorsCount', { count: result.errors.length });
      }

      return result;
    } catch (error: any) {
      sendLogToRenderer(mainWindow, 'error', 'match', 'logs.consolidation.error', { error: error.message });
      throw error;
    } finally {
      progressThrottle.flush();
      if (activeConsolidation === signal) activeConsolidation = null;
    }
  });

  // Interrompre la consolidation après le jeu en cours
  ipcMain.handle('consolidation:cancel', async () => {
    if (activeConsolidation) activeConsolidation.cancelRequested = true;
  });

  // Arrêt forcé : abandonner le jeu en cours et tuer les outils externes (7z, chdman…)
  ipcMain.handle('consolidation:force-cancel', async () => {
    if (!activeConsolidation) return;
    activeConsolidation.cancelRequested = true;
    activeConsolidation.abort.abort();
    const killed = killAllTrackedProcesses();
    if (killed > 0) console.warn(`⚠️ Forced consolidation stop: ${killed} external process(es) killed`);
  });

  // Récupérer le log de consolidation
  ipcMain.handle('consolidation:get-log', async () => {
    const database = databaseService.getDatabase();
    if (!database) return [];

    try {
      return await database.all('SELECT * FROM consolidation_log ORDER BY created_at DESC');
    } catch {
      return [];
    }
  });
}
