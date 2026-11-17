/*
 * RUMCET - ROM's Ultimate Manager, Conversion and Editor Tool
 * Copyright (C) 2025 Nanaki59
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// src/main/handlers/romDownload.handlers.ts

import { IpcMain, BrowserWindow } from 'electron';
import { downloadRoms, abortActiveDownloads } from '../../helpers/downloadRoms.js';
import { databaseService } from '../services/database.service.js';
import { sendLogToRenderer } from '../utils/logger.js';
import { createProgressThrottle } from '../utils/progressThrottle.js';
import { OperationSignal, createOperationSignal } from '../../helpers/operationSignal.js';
import { killAllTrackedProcesses } from '../../helpers/archives/processRegistry.js';
import type { RomDownloadProgress, RomDownloadResult } from '../../types/global.js';
import type { Database } from '../../database/init.js';

/** Téléchargement en cours (un seul à la fois : la modale est bloquante) */
let activeDownload: OperationSignal | null = null;

/**
 * Lance le téléchargement + la consolidation des jeux, avec progression vers la
 * modale (limitée) et journalisation (panneau + fichier) depuis le main.
 */
async function runDownload(
  db: Database,
  gameIds: number[],
  mainWindow: BrowserWindow
): Promise<RomDownloadResult> {
  const signal = createOperationSignal();
  activeDownload = signal;

  const progressThrottle = createProgressThrottle<RomDownloadProgress>(progress => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('rom-download-progress', progress);
  });

  // Logs : un message par changement d'étape (pas à chaque pourcentage) et l'issue
  // de la consolidation de chaque jeu
  let lastLogged = '';
  const logProgress = (p: RomDownloadProgress) => {
    if (p.phase === 'complete') return;
    if (p.phase === 'consolidating' && p.currentGame) {
      switch (p.step) {
        case 'done':
          sendLogToRenderer(mainWindow, 'info', 'download', 'logs.consolidation.gameDone', { game: p.currentGame, format: p.chosenFormat || '?' });
          return;
        case 'error':
          sendLogToRenderer(mainWindow, 'error', 'download', 'logs.consolidation.gameError', { game: p.currentGame, error: p.error || '' });
          return;
        case 'aborted':
          sendLogToRenderer(mainWindow, 'warning', 'download', 'logs.consolidation.gameAborted', { game: p.currentGame });
          return;
      }
    }
    const signature = `${p.key}|${JSON.stringify(p.params || {})}`;
    if (signature === lastLogged) return;
    lastLogged = signature;
    sendLogToRenderer(mainWindow, p.phase === 'incomplete' ? 'warning' : 'info', 'download', p.key, p.params);
  };

  try {
    const result = await downloadRoms(
      db,
      gameIds,
      progress => {
        logProgress(progress);
        progressThrottle.push(progress);
      },
      () => signal.cancelRequested,
      signal
    );

    if (result.cancelled) {
      sendLogToRenderer(mainWindow, 'warning', 'download', 'logs.download.cancelled', {
        consolidated: result.stats.consolidated,
        failed: result.stats.failed,
        remaining: result.stats.remaining ?? 0
      });
    } else {
      sendLogToRenderer(mainWindow, result.stats.failed > 0 ? 'warning' : 'info', 'download', 'logs.download.done', {
        consolidated: result.stats.consolidated,
        failed: result.stats.failed
      });
    }
    return result;
  } catch (error: any) {
    sendLogToRenderer(mainWindow, 'error', 'download', 'logs.download.error', { error: error?.message || String(error) });
    throw error;
  } finally {
    progressThrottle.flush();
    if (activeDownload === signal) activeDownload = null;
  }
}

export function registerRomDownloadHandlers(ipcMain: IpcMain, mainWindow: BrowserWindow) {
  // Télécharger des jeux spécifiques par IDs
  ipcMain.handle('rom-download:start', async (_event, gameIds: number[]) => {
    const db = databaseService.getDatabase();
    if (!db) throw new Error('Aucune base de données ouverte');
    return runDownload(db, gameIds, mainWindow);
  });

  // Télécharger toutes les ROMs manquantes
  ipcMain.handle('rom-download:start-all-missing', async () => {
    const db = databaseService.getDatabase();
    if (!db) throw new Error('Aucune base de données ouverte');

    // Récupérer les IDs de jeux manquants ou partiellement matchés (et sélectionnés)
    const missingGames = await db.all<{ id: number }>(`
      SELECT g.id
      FROM games g
      WHERE g.is_selected != 0
      AND (
        -- Jeux sans aucun match
        NOT EXISTS (
          SELECT 1 FROM dat_roms dr
          JOIN rom_matches rm ON rm.dat_rom_id = dr.id
          WHERE dr.game_id = g.id
        )
        OR
        -- Jeux partiellement matchés
        (SELECT COUNT(*) FROM dat_roms dr WHERE dr.game_id = g.id) >
        (SELECT COUNT(DISTINCT dr2.id) FROM dat_roms dr2
         JOIN rom_matches rm2 ON rm2.dat_rom_id = dr2.id
         WHERE dr2.game_id = g.id)
      )
      AND (SELECT COUNT(*) FROM dat_roms dr WHERE dr.game_id = g.id) > 0
      ORDER BY g.name
    `);

    const gameIds = missingGames.map(g => g.id);

    if (gameIds.length === 0) {
      return {
        stats: { totalGames: 0, downloaded: 0, matched: 0, consolidated: 0, failed: 0 },
        results: []
      };
    }

    return runDownload(db, gameIds, mainWindow);
  });

  // Interrompre après le jeu en cours
  ipcMain.handle('rom-download:cancel', async () => {
    if (activeDownload) activeDownload.cancelRequested = true;
  });

  // Arrêt forcé : abandonner le jeu en cours (téléchargements interrompus, outils externes tués)
  ipcMain.handle('rom-download:force-cancel', async () => {
    if (!activeDownload) return;
    activeDownload.cancelRequested = true;
    activeDownload.abort.abort();
    abortActiveDownloads();
    const killed = killAllTrackedProcesses();
    if (killed > 0) console.warn(`⚠️ Forced download stop: ${killed} external process(es) killed`);
  });
}
