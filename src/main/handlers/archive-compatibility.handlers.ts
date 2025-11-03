// src/main/handlers/archive-compatibility.handlers.ts

import { IpcMain } from 'electron';
import { 
  getArchiveCompatibility, 
  isFormatSupported, 
  getRecommendedFormat,
  getAllCompatibleFormats,
  ARCHIVE_COMPATIBILITY 
} from '../../config/archiveCompatibility.js';

/**
 * Gestionnaire IPC pour la compatibilité des formats d'archives
 */
export function registerArchiveCompatibilityHandlers(ipcMain: IpcMain) {
  
  /**
   * Obtenir la configuration de compatibilité pour un système
   */
  ipcMain.handle('archive-compat:get-config', (_event, systemId: string) => {
    return getArchiveCompatibility(systemId);
  });
  
  /**
   * Vérifier si un format est supporté par un système
   */
  ipcMain.handle('archive-compat:check-format', (_event, systemId: string, format: string) => {
    return isFormatSupported(systemId, format);
  });
  
  /**
   * Obtenir le format recommandé pour un système
   */
  ipcMain.handle('archive-compat:get-recommended', (_event, systemId: string) => {
    return getRecommendedFormat(systemId);
  });
  
  /**
   * Obtenir tous les formats compatibles pour un système
   */
  ipcMain.handle('archive-compat:get-all-compatible', (_event, systemId: string) => {
    return getAllCompatibleFormats(systemId);
  });
  
  /**
   * Obtenir la liste complète de tous les systèmes configurés
   */
  ipcMain.handle('archive-compat:get-all-systems', () => {
    return Object.keys(ARCHIVE_COMPATIBILITY);
  });
  
  /**
   * Obtenir une configuration personnalisée (depuis les settings utilisateur)
   * À implémenter avec settingsManager
   */
  ipcMain.handle('archive-compat:get-custom-config', async (_event, systemId: string) => {
    // TODO: Récupérer depuis settingsManager les overrides utilisateur
    // const customConfig = await settingsManager.get(`archiveCompat.${systemId}`);
    // return customConfig || getArchiveCompatibility(systemId);
    return getArchiveCompatibility(systemId);
  });
  
  /**
   * Sauvegarder une configuration personnalisée
   * À implémenter avec settingsManager
   */
  ipcMain.handle('archive-compat:save-custom-config', async (_event, systemId: string, config: any) => {
    // TODO: Sauvegarder dans settingsManager
    // await settingsManager.set(`archiveCompat.${systemId}`, config);
    return true;
  });
  
  /**
   * Réinitialiser la configuration d'un système aux valeurs par défaut
   */
  ipcMain.handle('archive-compat:reset-config', async (_event, systemId: string) => {
    // TODO: Supprimer l'override de settingsManager
    // await settingsManager.delete(`archiveCompat.${systemId}`);
    return getArchiveCompatibility(systemId);
  });
}
