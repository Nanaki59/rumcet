// src/main/handlers/settings.handlers.ts
import { IpcMain, dialog, BrowserWindow } from 'electron';
import { settingsManager } from '../../helpers/settingsManager.js';
import { sendLogToRenderer } from '../utils/logger.js';

export function registerSettingsHandlers(ipcMain: IpcMain, mainWindow: BrowserWindow) {
  
  // Obtenir tous les paramètres
  ipcMain.handle('settings:get-all', async () => {
    return settingsManager.getAll();
  });

  // Mettre à jour les paramètres
  ipcMain.handle('settings:update', async (_event, newSettings: any) => {
    try {
      await settingsManager.updateSettings(newSettings);
      sendLogToRenderer(mainWindow, 'info', 'settings', 'Paramètres mis à jour avec succès');
      return true;
    } catch (error) {
      sendLogToRenderer(mainWindow, 'error', 'settings', `Erreur lors de la mise à jour des paramètres : ${error}`);
      throw error;
    }
  });

  // Réinitialiser les paramètres
  ipcMain.handle('settings:reset', async () => {
    try {
      settingsManager.reset();
      await settingsManager.save();
      sendLogToRenderer(mainWindow, 'info', 'settings', 'Paramètres réinitialisés');
      return settingsManager.getAll();
    } catch (error) {
      sendLogToRenderer(mainWindow, 'error', 'settings', `Erreur lors de la réinitialisation : ${error}`);
      throw error;
    }
  });

  // Sélectionner un dossier pour les paramètres
  ipcMain.handle('settings:select-folder', async (_event, folderType: string) => {
    let title = 'Sélectionner un dossier';
    let defaultPath = '';

    switch (folderType) {
      case 'dat':
        title = 'Sélectionner le dossier par défaut pour les fichiers DAT/XML';
        defaultPath = settingsManager.get('defaultDatFolder');
        break;
      case 'database':
        title = 'Sélectionner le dossier par défaut pour les bases de données';
        defaultPath = settingsManager.get('defaultDatabaseFolder');
        break;
      case 'roms':
        title = 'Sélectionner le dossier par défaut pour les ROMs';
        defaultPath = settingsManager.get('defaultRomsFolder');
        break;
      case 'unmatched':
        title = 'Sélectionner le dossier pour les ROMs non référencées';
        defaultPath = settingsManager.get('unmatchedRomsFolder');
        break;
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      title,
      defaultPath,
      properties: ['openDirectory', 'createDirectory']
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });
}
