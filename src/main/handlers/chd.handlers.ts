// ============================================
// src/main/handlers/chd.handlers.ts
// ============================================

import { IpcMain, BrowserWindow, dialog } from 'electron';
import { ChdmanHandler, chdmanEvents } from '../../helpers/chdmanHandler.js';
import { sendLogToRenderer } from '../utils/logger.js';
import path from 'path';

const chdman = new ChdmanHandler();

export function registerChdHandlers(ipcMain: IpcMain, mainWindow: BrowserWindow) {
  
  // Vérifier si chdman est disponible
  ipcMain.handle('chd:check-available', async () => {
    return await chdman.isAvailable();
  });

  // Écouter les événements de progression
  chdmanEvents.on('progress', (progress: number) => {
    // Envoyer la progression au renderer si nécessaire
    mainWindow?.webContents.send('chd-progress', progress);
  });
  
  // Convertir des ROMs en CHD
  ipcMain.handle('chd:convert-batch', async (_event, filePaths: string[]) => {
    const results = [];
    
    for (const filePath of filePaths) {
      try {
        sendLogToRenderer(mainWindow, 'info', 'chd', `Conversion en cours : ${path.basename(filePath)}`);
        
        // Déterminer le type de conversion selon l'extension
        const ext = path.extname(filePath).toLowerCase();
        let result;
        
        if (['.cue', '.gdi', '.toc', '.nrg', '.iso'].includes(ext)) {
          // Conversion CD/DVD
          result = await chdman.createCD({
            inputPath: filePath,
            compression: 'cdlz',
            force: false
          });
        } else {
          // Conversion HD/ROM
          result = await chdman.createHD({
            inputPath: filePath,
            compression: 'cdlz',
            force: false
          });
        }
        
        results.push({
          file: filePath,
          ...result
        });
        
        sendLogToRenderer(mainWindow, 'info', 'chd', result.message);
        
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        results.push({
          file: filePath,
          success: false,
          message: errorMsg
        });
        sendLogToRenderer(mainWindow, 'error', 'chd', `Échec : ${errorMsg}`);
      }
    }
    
    return results;
  });
  
  // Extraire un CHD
  ipcMain.handle('chd:extract', async (_event, chdPath: string, outputPath?: string) => {
    try {
      sendLogToRenderer(mainWindow, 'info', 'chd', `Extraction : ${path.basename(chdPath)}`);
      const result = await chdman.extractCD(chdPath, outputPath);
      sendLogToRenderer(mainWindow, 'info', 'chd', result.message);
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      sendLogToRenderer(mainWindow, 'error', 'chd', errorMsg);
      throw error;
    }
  });
  
  // Obtenir les infos d'un CHD
  ipcMain.handle('chd:info', async (_event, chdPath: string) => {
    try {
      return await chdman.info(chdPath);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      sendLogToRenderer(mainWindow, 'error', 'chd', errorMsg);
      throw error;
    }
  });
  
  // Vérifier un CHD
  ipcMain.handle('chd:verify', async (_event, chdPath: string) => {
    try {
      sendLogToRenderer(mainWindow, 'info', 'chd', `Vérification : ${path.basename(chdPath)}`);
      const result = await chdman.verify(chdPath);
      sendLogToRenderer(mainWindow, 'info', 'chd', result.message);
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      sendLogToRenderer(mainWindow, 'error', 'chd', errorMsg);
      throw error;
    }
  });
  
  // Configurer le chemin de chdman
  ipcMain.handle('chd:set-path', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Sélectionner chdman.exe',
      filters: [
        { name: 'Exécutable', extensions: ['exe'] },
        { name: 'Tous les fichiers', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    
    if (!result.canceled && result.filePaths[0]) {
      // Sauvegarder le chemin dans les settings
      return result.filePaths[0];
    }
    
    return null;
  });
}
