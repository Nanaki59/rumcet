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
      sendLogToRenderer(mainWindow, 'info', 'match', 'logs.consolidation.start');

      const result = await consolidateRoms(database, (progress) => {
        // Le renderer affiche déjà le message via onConsolidationProgress
        event.sender.send('consolidation-progress', progress);
      });

      sendLogToRenderer(mainWindow, 'info', 'match', 'logs.consolidation.done', {
        games: result.stats.gamesConsolidated,
        archives: result.stats.archivesCreated,
        unmatched: result.stats.unmatchedFilesMoved
      });

      if (result.errors.length > 0) {
        sendLogToRenderer(mainWindow, 'warning', 'match', 'logs.consolidation.errorsCount', { count: result.errors.length });
      }

      return result;
    } catch (error: any) {
      sendLogToRenderer(mainWindow, 'error', 'match', 'logs.consolidation.error', { error: error.message });
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
