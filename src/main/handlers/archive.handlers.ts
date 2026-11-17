// ============================================
// src/main/handlers/archive.handlers.ts
// ============================================

import { IpcMain, BrowserWindow, dialog } from 'electron';
import { archiveManager } from '../../helpers/archives/ArchiveManager.js';
import { settingsManager } from '../../helpers/settingsManager.js';
import { sendLogToRenderer } from '../utils/logger.js';
import { t } from '../i18n.js';
import { detectSevenZip, detectRar, detectUnrar } from '../../helpers/toolPaths.js';
import path from 'path';

/**
 * Gestionnaire IPC pour toutes les opérations d'archives
 */
export function registerArchiveHandlers(ipcMain: IpcMain, mainWindow: BrowserWindow) {
  
  // ============================================
  // INITIALISATION DES CONFIGURATIONS RAR
  // ============================================
  
  /**
   * Initialise les configurations RAR depuis les settings
   */
  async function initializeRarConfiguration(): Promise<void> {
    const settings = settingsManager.getAll();
    
    // 1. Configurer les chemins des outils RAR
    const rarToolPaths = {
      sevenZip: settings.sevenZipPath || undefined,
      winrar: settings.winrarPath || undefined,
      unrar: settings.unrarPath || undefined
    };
    
    // Ne configurer que si au moins un chemin existe
    if (rarToolPaths.sevenZip || rarToolPaths.winrar || rarToolPaths.unrar) {
      archiveManager.setRarToolPaths(rarToolPaths);
      console.log('🔧 RAR paths initialized:', rarToolPaths);
    }
    
    // 2. Configurer l'ordre de priorité
    if (settings.rarToolPriority && Array.isArray(settings.rarToolPriority)) {
      archiveManager.setRarToolPriority(settings.rarToolPriority);
      console.log('🔧 RAR priority initialized:', settings.rarToolPriority);
    }

    // 3. Archives 7z : 7-Zip configuré par l'utilisateur, sinon 7za embarqué
    archiveManager.setSevenZipPath(settings.sevenZipPath || '');
    console.log('🔧 7z archives tool:', settings.sevenZipPath || 'bundled 7za');

    sendLogToRenderer(mainWindow, 'info', 'archive', 'logs.archive.rarConfigured');
  }
  
  // APPELER L'INITIALISATION IMMÉDIATEMENT
  initializeRarConfiguration().catch(error => {
    console.error('Error during RAR initialization:', error);
    sendLogToRenderer(mainWindow, 'error', 'archive', 'logs.archive.rarInitError', { error: String(error) });
  });

  
  // ============================================
  // SÉLECTION DES OUTILS
  // ============================================
  
  /**
   * Filtres du dialogue de sélection d'un exécutable : sous Linux/macOS les
   * exécutables n'ont pas d'extension, donc aucun filtre .exe.
   */
  function executableFilters(): Electron.FileFilter[] {
    return process.platform === 'win32'
      ? [
          { name: t('common.filterExecutables'), extensions: ['exe'] },
          { name: t('common.filterAllFiles'), extensions: ['*'] }
        ]
      : [];
  }
  
  // ============================================
  // GESTION DES OUTILS EXTERNES
  // ============================================
  
  /**
   * Vérifier si chdman est disponible
   */
  ipcMain.handle('archive:check-chdman-available', async () => {
    const handler = (archiveManager as any).getHandlerByFormat('chd');
    if (handler && typeof handler.isAvailable === 'function') {
      return await handler.isAvailable();
    }
    return false;
  });
  
  /**
   * Détecter automatiquement tous les outils
   */
  ipcMain.handle('archive:detect-tools', async () => {
    const tools = {
      sevenZip: await detectSevenZip(),
      winrar: await detectRar(),
      unrar: await detectUnrar()
    };
    
    // Appliquer automatiquement les outils détectés
    if (tools.sevenZip) {
      archiveManager.setSevenZipPath(tools.sevenZip);
    }
    
    return tools;
  });
  
  /**
   * Configurer le chemin de chdman
   */
  ipcMain.handle('archive:set-chdman-path', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: t('dialogs.selectChdman'),
      filters: executableFilters(),
      properties: ['openFile']
    });
    
    if (!result.canceled && result.filePaths[0]) {
      archiveManager.setChdmanPath(result.filePaths[0]);
      sendLogToRenderer(mainWindow, 'info', 'archive', 'logs.archive.toolPathSet', { tool: 'chdman', path: result.filePaths[0] });
      return result.filePaths[0];
    }
    
    return null;
  });
  
  /**
   * Configurer le chemin de 7-Zip
   */
  ipcMain.handle('archive:set-7zip-path', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: t('dialogs.select7zip'),
      filters: executableFilters(),
      properties: ['openFile']
    });
    
    if (!result.canceled && result.filePaths[0]) {
      archiveManager.setSevenZipPath(result.filePaths[0]);
      sendLogToRenderer(mainWindow, 'info', 'archive', 'logs.archive.toolPathSet', { tool: '7-Zip', path: result.filePaths[0] });
      return result.filePaths[0];
    }
    
    return null;
  });
  
  /**
   * Configurer les chemins des outils RAR
   */
  ipcMain.handle('archive:set-rar-tool-path', async (_event, toolType: 'unrar' | 'sevenZip' | 'winrar') => {
    const titles = {
      unrar: t('dialogs.selectUnrar'),
      sevenZip: t('dialogs.select7zip'),
      winrar: t('dialogs.selectRar')
    };
    
    const result = await dialog.showOpenDialog(mainWindow, {
      title: titles[toolType],
      filters: executableFilters(),
      properties: ['openFile']
    });
    
    if (!result.canceled && result.filePaths[0]) {
      const paths: any = {};
      paths[toolType] = result.filePaths[0];
      
      const handler = (archiveManager as any).getHandlerByFormat('rar');
      if (handler && typeof handler.setToolPaths === 'function') {
        handler.setToolPaths(paths);
      }
      
      sendLogToRenderer(mainWindow, 'info', 'archive', 'logs.archive.toolPathSet', { tool: toolType, path: result.filePaths[0] });
      return result.filePaths[0];
    }
    
    return null;
  });
  
  // ============================================
  // OPÉRATIONS SUR ARCHIVES
  // ============================================
  
  /**
   * Lister le contenu d'une archive
   */
  ipcMain.handle('archive:list', async (_event, archivePath: string) => {
    try {
      sendLogToRenderer(mainWindow, 'info', 'archive', 'logs.archive.list', { file: path.basename(archivePath) });
      const contents = await archiveManager.listArchive(archivePath);
      return { success: true, contents };
    } catch (error: any) {
      const errorMsg = error.message || String(error);
      sendLogToRenderer(mainWindow, 'error', 'archive', 'logs.archive.listError', { error: errorMsg });
      return { success: false, error: errorMsg };
    }
  });
  
  /**
   * Extraire une archive
   */
  ipcMain.handle('archive:extract', async (_event, archivePath: string, outputDir: string, files?: string[]) => {
    try {
      sendLogToRenderer(mainWindow, 'info', 'archive', 'logs.archive.extract', { file: path.basename(archivePath) });
      await archiveManager.extractArchive(archivePath, outputDir, files);
      sendLogToRenderer(mainWindow, 'info', 'archive', 'logs.archive.extractDone');
      return { success: true };
    } catch (error: any) {
      const errorMsg = error.message || String(error);
      sendLogToRenderer(mainWindow, 'error', 'archive', 'logs.archive.extractError', { error: errorMsg });
      return { success: false, error: errorMsg };
    }
  });
  
  /**
   * Créer une archive
   */
  ipcMain.handle('archive:create', async (_event, files: string[], outputPath: string, settings?: any) => {
    try {
      sendLogToRenderer(mainWindow, 'info', 'archive', 'logs.archive.create', { file: path.basename(outputPath) });
      const createdPath = await archiveManager.createArchive(files, outputPath, settings);
      sendLogToRenderer(mainWindow, 'info', 'archive', 'logs.archive.created', { file: path.basename(createdPath) });
      return { success: true, archivePath: createdPath };
    } catch (error: any) {
      const errorMsg = error.message || String(error);
      sendLogToRenderer(mainWindow, 'error', 'archive', 'logs.archive.createError', { error: errorMsg });
      return { success: false, error: errorMsg };
    }
  });
  
  /**
   * Vérifier si un fichier est une archive supportée
   */
  ipcMain.handle('archive:is-archive', async (_event, filePath: string) => {
    return archiveManager.isArchive(filePath);
  });
  
  /**
   * Obtenir le format d'une archive
   */
  ipcMain.handle('archive:get-format', async (_event, filePath: string) => {
    return archiveManager.getArchiveFormat(filePath);
  });
  
  // ============================================
  // CONVERSIONS SPÉCIFIQUES CHD
  // ============================================
  
  /**
   * Convertir des ROMs en CHD (batch)
   */
  ipcMain.handle('archive:convert-to-chd-batch', async (_event, filePaths: string[]) => {
    const results = [];
    
    for (const filePath of filePaths) {
      try {
        sendLogToRenderer(mainWindow, 'info', 'archive', 'logs.archive.convertChd', { file: path.basename(filePath) });
        
        const outputPath = filePath.replace(/\.[^/.]+$/, '.chd');
        await archiveManager.createArchive([filePath], outputPath);
        
        results.push({
          file: filePath,
          success: true,
          message: `Converti en ${path.basename(outputPath)}`
        });
        
        sendLogToRenderer(mainWindow, 'info', 'archive', 'logs.archive.chdCreated', { file: path.basename(outputPath) });
        
      } catch (error: any) {
        const errorMsg = error.message || String(error);
        results.push({
          file: filePath,
          success: false,
          message: errorMsg
        });
        sendLogToRenderer(mainWindow, 'error', 'archive', 'logs.archive.chdError', { error: errorMsg });
      }
    }
    
    return results;
  });
  
  /**
   * Écouter les événements de progression
   */
  archiveManager.on('progress', (event: any) => {
    mainWindow?.webContents.send('archive-progress', event);
  });
}
