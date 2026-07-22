// src/main/handlers/roms.handlers.ts
import { IpcMain, dialog, BrowserWindow, shell } from 'electron';
import { scanFolderWithStructure, saveScanResultsWithStructure } from '../../helpers/scanFolder.js';
import { databaseService } from '../services/database.service.js';
import { settingsManager } from '../../helpers/settingsManager.js';
import { sendLogToRenderer } from '../utils/logger.js';
import fs from 'fs/promises';

export function registerRomsHandlers(ipcMain: IpcMain, mainWindow: BrowserWindow) {
  
  // Sélectionner des dossiers de ROMs
  ipcMain.handle('roms:select-folders', async () => {
    const defaultPath = settingsManager.get('defaultRomsFolder');

    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Sélectionner un ou plusieurs dossiers de ROMs',
      defaultPath: defaultPath,
      properties: ['openDirectory', 'multiSelections']
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths.length === 1 ? result.filePaths[0] : result.filePaths;
  });

  // Ajouter des dossiers de ROMs
  ipcMain.handle('roms:add', async (event, folderPaths: string | string[]) => {
    const folders = Array.isArray(folderPaths) ? folderPaths : [folderPaths];
    let totalFiles = 0;

    try {
      for (const folderPath of folders) {
        sendLogToRenderer(mainWindow, 'info', 'folder', 'logs.folder.scanStart', { path: folderPath });
        
        const structure = await scanFolderWithStructure(folderPath);
        
        // Envoyer la progression
        function sendProgress(struct: any) {
          for (const file of struct.files) {
            event.sender.send('scan-progress', {
              fileName: file.fileName,
              isArchive: file.isArchive,
              archiveType: file.archiveType
            });
            
            if (file.isArchive) {
              sendLogToRenderer(mainWindow, 'info', 'archive', 'logs.archive.found', { file: file.fileName, type: file.archiveType });
            } else {
              sendLogToRenderer(mainWindow, 'info', 'romfile', 'logs.romfile.found', { file: file.fileName });
            }
          }
          
          for (const subFolder of struct.subFolders) {
            sendProgress(subFolder);
          }
        }
        
        sendProgress(structure);

        const database = databaseService.getDatabase();
        if (database && databaseService.isDatLoaded()) {
          const fileCount = await saveScanResultsWithStructure(database, structure);
          totalFiles += fileCount;
          sendLogToRenderer(mainWindow, 'info', 'database', 'logs.database.filesSaved', { count: fileCount, path: folderPath });
        }
      }

      sendLogToRenderer(mainWindow, 'info', 'folder', 'logs.folder.scanDone', { count: totalFiles });
      return { length: totalFiles };
      
    } catch (error) {
      sendLogToRenderer(mainWindow, 'error', 'folder', 'logs.folder.scanError', { error: String(error) });
      throw error;
    }
  });

  // Retirer un fichier de la base (sans toucher au fichier physique)
  ipcMain.handle('roms:remove-file', async (_event, filePath: string) => {
    const database = databaseService.getDatabase();
    if (!database) {
      throw new Error('Aucune base de données active');
    }
    try {
      await database.run('DELETE FROM scanned_files WHERE file_path = ?', [filePath]);
      return { success: true };
    } catch (error) {
      console.error('Error while removing the file:', error);
      throw error;
    }
  });

  // Supprimer physiquement un fichier (corbeille)
  ipcMain.handle('file:delete', async (_event, filePath: string) => {
    try {
      const exists = await fs.access(filePath).then(() => true).catch(() => false);
      if (!exists) throw new Error("Le fichier n'existe pas");
      await shell.trashItem(filePath);
      // Retirer aussi de la base (le fichier physique n'existe plus)
      const database = databaseService.getDatabase();
      if (database) {
        await database.run('DELETE FROM scanned_files WHERE file_path = ?', [filePath]);
      }
      sendLogToRenderer(mainWindow, 'info', 'folder', 'logs.folder.fileTrashed', { path: filePath });
      return true;
    } catch (error) {
      sendLogToRenderer(mainWindow, 'error', 'folder', 'logs.folder.fileDeleteError', { error: String(error) });
      throw error;
    }
  });

  // Supprimer un dossier de ROMs
  ipcMain.handle('roms:remove-folder', async (_event, folderPath: string) => {
    const database = databaseService.getDatabase();
    if (!database) {
      throw new Error('Aucune base de données active');
    }

    try {
      await database.run(
        'DELETE FROM scanned_folders WHERE folder_path = ? OR folder_path LIKE ?',
        [folderPath, `${folderPath}/%`]
      );
      
      return { success: true };
    } catch (error) {
      console.error('Error while deleting the folder:', error);
      throw error;
    }
  });

  // Récupérer les dossiers racines
  ipcMain.handle('folders:get-roots', async () => {
    const database = databaseService.getDatabase();
    if (!database) {
      return [];
    }

    try {
      // Récupérer d'abord tous les dossiers racines
      const roots = await database.all<{ id: number, folder_path: string }>(
        `SELECT id, folder_path FROM scanned_folders WHERE is_root = 1`
      );

      // Pour chaque dossier racine, compter les fichiers correctement
      const rootsWithCount = [];
      for (const root of roots) {
        // Utiliser une requête récursive pour obtenir tous les sous-dossiers
        const fileCount = await database.get<{ count: number }>(
          `WITH RECURSIVE subfolder AS (
            SELECT id, folder_path FROM scanned_folders WHERE id = ?
            UNION ALL
            SELECT sf.id, sf.folder_path 
            FROM scanned_folders sf
            INNER JOIN subfolder s ON sf.parent_folder_id = s.id
          )
          SELECT COUNT(*) as count 
          FROM scanned_files 
          WHERE folder_id IN (SELECT id FROM subfolder)`,
          [root.id]
        );

        rootsWithCount.push({
          path: root.folder_path,
          fileCount: fileCount?.count || 0
        });
      }

      return rootsWithCount;
    } catch (error) {
      console.error('Error while retrieving root folders:', error);
      return [];
    }
  });

  // Supprimer physiquement un dossier (le déplacer vers la corbeille)
  ipcMain.handle('folder:delete', async (_event, folderPath: string) => {
    try {
      // Vérifier que le dossier existe
      const exists = await fs.access(folderPath).then(() => true).catch(() => false);
      
      if (!exists) {
        throw new Error('Le dossier n\'existe pas');
      }
      
      // Utiliser shell.trashItem pour déplacer vers la corbeille (cross-platform)
      await shell.trashItem(folderPath);
      
      sendLogToRenderer(mainWindow, 'info', 'folder', 'logs.folder.folderTrashed', { path: folderPath });
      
      return true;
    } catch (error) {
      sendLogToRenderer(mainWindow, 'error', 'folder', 'logs.folder.deleteError', { error: String(error) });
      throw error;
    }
  });
}
