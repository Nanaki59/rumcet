// src/main/handlers/consolidation.handlers.ts
import { IpcMain, BrowserWindow } from 'electron';
import { consolidateRoms } from '../../helpers/consolidateRoms.js';
import { databaseService } from '../services/database.service.js';
import { sendLogToRenderer } from '../utils/logger.js';

export function registerConsolidationHandlers(ipcMain: IpcMain, mainWindow: BrowserWindow) {

  // Lancer la consolidation
  ipcMain.handle('consolidation:run', async (event) => {
    const database = databaseService.getDatabase();
    if (!database) {
      throw new Error('Aucune base de données active');
    }

    try {
      sendLogToRenderer(mainWindow, 'info', 'match', '🧹 Début de la consolidation des ROMs...');

      const result = await consolidateRoms(database, (progress) => {
        // Le renderer affiche déjà le message via onConsolidationProgress
        event.sender.send('consolidation-progress', progress);
      });

      sendLogToRenderer(mainWindow, 'info', 'match',
        `✅ Consolidation terminée ! ${result.stats.gamesConsolidated} jeux consolidés, ` +
        `${result.stats.archivesCreated} archives créées, ` +
        `${result.stats.unmatchedFilesMoved} fichiers non matchés déplacés`);

      if (result.errors.length > 0) {
        sendLogToRenderer(mainWindow, 'warning', 'match',
          `⚠️ ${result.errors.length} erreur(s) durant la consolidation`);
      }

      return result;
    } catch (error: any) {
      sendLogToRenderer(mainWindow, 'error', 'match', `❌ Erreur consolidation: ${error.message}`);
      throw error;
    }
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
