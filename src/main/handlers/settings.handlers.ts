// src/main/handlers/settings.handlers.ts
import { IpcMain, dialog, BrowserWindow } from 'electron';
import { settingsManager } from '../../helpers/settingsManager.js';
import { archiveManager } from '../../helpers/archives/ArchiveManager.js';
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
      
      // ============================================
      // RÉAPPLIQUER LES CONFIGURATIONS RAR
      // ============================================
      
      // 1. Mettre à jour les chemins des outils RAR
      const rarToolPaths = {
        sevenZip: newSettings.sevenZipPath || undefined,
        winrar: newSettings.winrarPath || undefined,
        unrar: newSettings.unrarPath || undefined
      };
      
      if (rarToolPaths.sevenZip || rarToolPaths.winrar || rarToolPaths.unrar) {
        archiveManager.setRarToolPaths(rarToolPaths);
        console.log('🔧 Chemins RAR mis à jour:', rarToolPaths);
      }
      
      // 2. Mettre à jour la priorité
      if (newSettings.rarToolPriority && Array.isArray(newSettings.rarToolPriority)) {
        archiveManager.setRarToolPriority(newSettings.rarToolPriority);
        console.log('🔧 Priorité RAR mise à jour:', newSettings.rarToolPriority);
      }
      
      // 3. Mettre à jour les autres chemins d'outils si nécessaire
      if (newSettings.chdmanPath) {
        archiveManager.setChdmanPath(newSettings.chdmanPath);
      }
      
      if (newSettings.sevenZipPath) {
        archiveManager.setSevenZipPath(newSettings.sevenZipPath);
      }

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
    
      // Réinitialiser aussi les configurations dans archiveManager
      const defaultSettings = settingsManager.getAll();
      
      // Réinitialiser les chemins RAR à vide
      archiveManager.setRarToolPaths({});
      
      // Réappliquer la priorité par défaut
      if (defaultSettings.rarToolPriority && Array.isArray(defaultSettings.rarToolPriority)) {
        archiveManager.setRarToolPriority(defaultSettings.rarToolPriority);
        console.log('🔧 Priorité RAR réinitialisée:', defaultSettings.rarToolPriority);
      }

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
      case 'validated':
        title = 'Sélectionner le dossier pour les ROMs validées';
        defaultPath = settingsManager.get('validatedRomsFolder');
        break;
      case 'temp':
        title = 'Sélectionner le dossier temporaire d\'extraction';
        defaultPath = settingsManager.get('tempExtractionFolder');
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
