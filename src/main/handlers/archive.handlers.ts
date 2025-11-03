// ============================================
// src/main/handlers/archive.handlers.ts
// ============================================

import { IpcMain, BrowserWindow, dialog } from 'electron';
import { archiveManager } from '../../helpers/archives/ArchiveManager.js';
import { settingsManager } from '../../helpers/settingsManager.js';
import { sendLogToRenderer } from '../utils/logger.js';
import path from 'path';
import fs from 'fs/promises';

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
      console.log('🔧 Chemins RAR initialisés:', rarToolPaths);
    }
    
    // 2. Configurer l'ordre de priorité
    if (settings.rarToolPriority && Array.isArray(settings.rarToolPriority)) {
      archiveManager.setRarToolPriority(settings.rarToolPriority);
      console.log('🔧 Priorité RAR initialisée:', settings.rarToolPriority);
    }
    
    sendLogToRenderer(mainWindow, 'info', 'archive', 'Configuration RAR initialisée');
  }
  
  // APPELER L'INITIALISATION IMMÉDIATEMENT
  initializeRarConfiguration().catch(error => {
    console.error('Erreur lors de l\'initialisation RAR:', error);
    sendLogToRenderer(mainWindow, 'error', 'archive', 
      `Erreur initialisation RAR: ${error}`);
  });

  
  // ============================================
  // DÉTECTION AUTOMATIQUE DES OUTILS
  // ============================================
  
  /**
   * Détecte automatiquement l'emplacement de 7-Zip
   */
  async function detect7ZipPath(): Promise<string | null> {
    const possiblePaths = [
      'C:\\Program Files\\7-Zip\\7z.exe',
      'C:\\Program Files (x86)\\7-Zip\\7z.exe',
      '/usr/bin/7z',
      '/usr/local/bin/7z'
    ];
    
    for (const path of possiblePaths) {
      try {
        await fs.access(path);
        return path;
      } catch {
        continue;
      }
    }
    
    return null;
  }
  
  /**
   * Détecte automatiquement l'emplacement de WinRAR
   */
  async function detectWinRarPath(): Promise<string | null> {
    if (process.platform !== 'win32') return null;
    
    const possiblePaths = [
      'C:\\Program Files\\WinRAR\\WinRAR.exe',
      'C:\\Program Files (x86)\\WinRAR\\WinRAR.exe'
    ];
    
    for (const path of possiblePaths) {
      try {
        await fs.access(path);
        return path;
      } catch {
        continue;
      }
    }
    
    return null;
  }
  
  /**
   * Détecte automatiquement l'emplacement de unrar
   */
  async function detectUnrarPath(): Promise<string | null> {
    const possiblePaths = [
      '/usr/bin/unrar',
      '/usr/local/bin/unrar',
      'C:\\Program Files\\UnRAR\\unrar.exe'
    ];
    
    for (const path of possiblePaths) {
      try {
        await fs.access(path);
        return path;
      } catch {
        continue;
      }
    }
    
    return null;
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
      sevenZip: await detect7ZipPath(),
      winrar: await detectWinRarPath(),
      unrar: await detectUnrarPath()
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
      title: 'Sélectionner chdman.exe',
      filters: [
        { name: 'Exécutable', extensions: ['exe'] },
        { name: 'Tous les fichiers', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    
    if (!result.canceled && result.filePaths[0]) {
      archiveManager.setChdmanPath(result.filePaths[0]);
      sendLogToRenderer(mainWindow, 'info', 'archive', `Chemin chdman configuré: ${result.filePaths[0]}`);
      return result.filePaths[0];
    }
    
    return null;
  });
  
  /**
   * Configurer le chemin de 7-Zip
   */
  ipcMain.handle('archive:set-7zip-path', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Sélectionner 7z.exe',
      filters: [
        { name: 'Exécutable', extensions: ['exe'] },
        { name: 'Tous les fichiers', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    
    if (!result.canceled && result.filePaths[0]) {
      archiveManager.setSevenZipPath(result.filePaths[0]);
      sendLogToRenderer(mainWindow, 'info', 'archive', `Chemin 7-Zip configuré: ${result.filePaths[0]}`);
      return result.filePaths[0];
    }
    
    return null;
  });
  
  /**
   * Configurer les chemins des outils RAR
   */
  ipcMain.handle('archive:set-rar-tool-path', async (_event, toolType: 'unrar' | 'sevenZip' | 'winrar') => {
    const titles = {
      unrar: 'Sélectionner unrar',
      sevenZip: 'Sélectionner 7z.exe',
      winrar: 'Sélectionner WinRAR.exe'
    };
    
    const result = await dialog.showOpenDialog(mainWindow, {
      title: titles[toolType],
      filters: [
        { name: 'Exécutable', extensions: ['exe'] },
        { name: 'Tous les fichiers', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    
    if (!result.canceled && result.filePaths[0]) {
      const paths: any = {};
      paths[toolType] = result.filePaths[0];
      
      const handler = (archiveManager as any).getHandlerByFormat('rar');
      if (handler && typeof handler.setToolPaths === 'function') {
        handler.setToolPaths(paths);
      }
      
      sendLogToRenderer(mainWindow, 'info', 'archive', `Chemin ${toolType} configuré: ${result.filePaths[0]}`);
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
      sendLogToRenderer(mainWindow, 'info', 'archive', `Liste du contenu: ${path.basename(archivePath)}`);
      const contents = await archiveManager.listArchive(archivePath);
      return { success: true, contents };
    } catch (error: any) {
      const errorMsg = error.message || String(error);
      sendLogToRenderer(mainWindow, 'error', 'archive', `Échec liste: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  });
  
  /**
   * Extraire une archive
   */
  ipcMain.handle('archive:extract', async (_event, archivePath: string, outputDir: string, files?: string[]) => {
    try {
      sendLogToRenderer(mainWindow, 'info', 'archive', `Extraction: ${path.basename(archivePath)}`);
      await archiveManager.extractArchive(archivePath, outputDir, files);
      sendLogToRenderer(mainWindow, 'info', 'archive', `✅ Extraction réussie`);
      return { success: true };
    } catch (error: any) {
      const errorMsg = error.message || String(error);
      sendLogToRenderer(mainWindow, 'error', 'archive', `Échec extraction: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  });
  
  /**
   * Créer une archive
   */
  ipcMain.handle('archive:create', async (_event, files: string[], outputPath: string, settings?: any) => {
    try {
      sendLogToRenderer(mainWindow, 'info', 'archive', `Création: ${path.basename(outputPath)}`);
      const createdPath = await archiveManager.createArchive(files, outputPath, settings);
      sendLogToRenderer(mainWindow, 'info', 'archive', `✅ Archive créée: ${path.basename(createdPath)}`);
      return { success: true, archivePath: createdPath };
    } catch (error: any) {
      const errorMsg = error.message || String(error);
      sendLogToRenderer(mainWindow, 'error', 'archive', `Échec création: ${errorMsg}`);
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
        sendLogToRenderer(mainWindow, 'info', 'archive', `Conversion CHD: ${path.basename(filePath)}`);
        
        const outputPath = filePath.replace(/\.[^/.]+$/, '.chd');
        await archiveManager.createArchive([filePath], outputPath);
        
        results.push({
          file: filePath,
          success: true,
          message: `Converti en ${path.basename(outputPath)}`
        });
        
        sendLogToRenderer(mainWindow, 'info', 'archive', `✅ CHD créé: ${path.basename(outputPath)}`);
        
      } catch (error: any) {
        const errorMsg = error.message || String(error);
        results.push({
          file: filePath,
          success: false,
          message: errorMsg
        });
        sendLogToRenderer(mainWindow, 'error', 'archive', `Échec: ${errorMsg}`);
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
