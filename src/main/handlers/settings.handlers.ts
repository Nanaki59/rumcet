// src/main/handlers/settings.handlers.ts
import { IpcMain, dialog, BrowserWindow } from 'electron';
import { settingsManager } from '../../helpers/settingsManager.js';
import { archiveManager } from '../../helpers/archives/ArchiveManager.js';
import { sendLogToRenderer } from '../utils/logger.js';
import { t } from '../i18n.js';

export function registerSettingsHandlers(
  ipcMain: IpcMain,
  mainWindow: BrowserWindow,
  onLanguageChanged?: (language: 'fr' | 'en') => void
) {

  // Obtenir tous les paramètres
  ipcMain.handle('settings:get-all', async () => {
    return settingsManager.getAll();
  });

  // Mettre à jour les paramètres
  ipcMain.handle('settings:update', async (_event, newSettings: any) => {
    try {
      const previousLanguage = settingsManager.get('language');

      await settingsManager.updateSettings(newSettings);

      // Recharger les traductions si la langue a changé
      if (newSettings.language && newSettings.language !== previousLanguage) {
        onLanguageChanged?.(newSettings.language);
      }
      
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
        console.log('🔧 RAR paths updated:', rarToolPaths);
      }
      
      // 2. Mettre à jour la priorité
      if (newSettings.rarToolPriority && Array.isArray(newSettings.rarToolPriority)) {
        archiveManager.setRarToolPriority(newSettings.rarToolPriority);
        console.log('🔧 RAR priority updated:', newSettings.rarToolPriority);
      }
      
      // 3. Mettre à jour les autres chemins d'outils si nécessaire
      if (newSettings.chdmanPath) {
        archiveManager.setChdmanPath(newSettings.chdmanPath);
      }
      
      if (newSettings.sevenZipPath) {
        archiveManager.setSevenZipPath(newSettings.sevenZipPath);
      }

      sendLogToRenderer(mainWindow, 'info', 'settings', 'logs.settings.updated');
      return true;
    } catch (error) {
      sendLogToRenderer(mainWindow, 'error', 'settings', 'logs.settings.updateError', { error: String(error) });
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
        console.log('🔧 RAR priority reset:', defaultSettings.rarToolPriority);
      }

      sendLogToRenderer(mainWindow, 'info', 'settings', 'logs.settings.reset');
      return settingsManager.getAll();
    } catch (error) {
      sendLogToRenderer(mainWindow, 'error', 'settings', 'logs.settings.resetError', { error: String(error) });
      throw error;
    }
  });

  // Sélectionner un dossier pour les paramètres
  ipcMain.handle('settings:select-folder', async (_event, folderType: string) => {
    let title = t('dialogs.selectFolder');
    let defaultPath = '';

    switch (folderType) {
      case 'dat':
        title = t('dialogs.selectFolderDat');
        defaultPath = settingsManager.get('defaultDatFolder');
        break;
      case 'database':
        title = t('dialogs.selectFolderDatabase');
        defaultPath = settingsManager.get('defaultDatabaseFolder');
        break;
      case 'roms':
        title = t('dialogs.selectFolderRoms');
        defaultPath = settingsManager.get('defaultRomsFolder');
        break;
      case 'unmatched':
        title = t('dialogs.selectFolderUnmatched');
        defaultPath = settingsManager.get('unmatchedRomsFolder');
        break;
      case 'validated':
        title = t('dialogs.selectFolderValidated');
        defaultPath = settingsManager.get('validatedRomsFolder');
        break;
      case 'temp':
        title = t('dialogs.selectFolderTemp');
        defaultPath = settingsManager.get('tempExtractionFolder');
        break;
      case 'incomplete':
        title = t('dialogs.selectFolderIncomplete');
        defaultPath = settingsManager.get('incompleteRomsFolder') || '';
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
