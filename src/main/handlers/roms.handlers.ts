// src/main/handlers/roms.handlers.ts
import { IpcMain, dialog, BrowserWindow, shell } from 'electron';
import { scanFolderIncremental, ScanMode, ScanProgress, ScanSignal } from '../../helpers/scanFolder.js';
import { killAllTrackedProcesses } from '../../helpers/archives/processRegistry.js';
import { createProgressThrottle } from '../utils/progressThrottle.js';
import { databaseService } from '../services/database.service.js';
import { settingsManager } from '../../helpers/settingsManager.js';
import { sendLogToRenderer } from '../utils/logger.js';
import fs from 'fs/promises';

/** Scan en cours (un seul à la fois : la modale de scan est bloquante) */
let activeScan: ScanSignal | null = null;

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

  // Ajouter / (re)scanner des dossiers de ROMs.
  // mode 'quick' (défaut) : seuls les fichiers nouveaux ou modifiés sont analysés
  // (sert aussi de reprise d'un scan interrompu) ; 'full' : tout est ré-analysé.
  ipcMain.handle('roms:add', async (event, folderPaths: string | string[], options?: { mode?: ScanMode }) => {
    const folders = Array.isArray(folderPaths) ? folderPaths : [folderPaths];
    const mode: ScanMode = options?.mode === 'full' ? 'full' : 'quick';
    const database = databaseService.getDatabase();
    if (!database || !databaseService.isDatLoaded()) {
      throw new Error('Aucune base de données active');
    }

    const signal: ScanSignal = { cancelRequested: false, abort: new AbortController() };
    activeScan = signal;

    // Progression vers la modale (limitée, le dernier état est toujours transmis)
    const progressThrottle = createProgressThrottle<ScanProgress>(progress => {
      if (!event.sender.isDestroyed()) event.sender.send('scan-progress', progress);
    });

    let totalScanned = 0;
    let totalUnchanged = 0;
    let totalRemoved = 0;
    const partialFolders: string[] = [];

    try {
      for (const folderPath of folders) {
        if (signal.cancelRequested || signal.abort.signal.aborted) {
          break;
        }
        sendLogToRenderer(mainWindow, 'info', 'folder', mode === 'full' ? 'logs.folder.scanStartFull' : 'logs.folder.scanStart', { path: folderPath });

        const result = await scanFolderIncremental(database, folderPath, {
          mode,
          signal,
          onProgress: (progress) => {
            progressThrottle.push(progress);
            // Une ligne de log par fichier analysé (panneau + fichier de log)
            if (progress.status === 'done') {
              if (progress.isArchive) {
                sendLogToRenderer(mainWindow, 'info', 'archive', 'logs.scan.fileArchive', {
                  file: progress.file, type: progress.archiveType || '', count: progress.contentCount ?? 0
                });
              } else {
                sendLogToRenderer(mainWindow, 'info', 'romfile', 'logs.scan.fileLoose', { file: progress.file });
              }
            } else if (progress.status === 'aborted') {
              sendLogToRenderer(mainWindow, 'warning', 'romfile', 'logs.scan.fileAborted', { file: progress.file });
            } else if (progress.status === 'error') {
              sendLogToRenderer(mainWindow, 'error', 'romfile', 'logs.scan.fileError', { file: progress.file, error: progress.error || '' });
            }
          }
        });

        totalScanned += result.filesScanned;
        totalUnchanged += result.filesUnchanged;
        totalRemoved += result.filesRemoved;

        if (result.cancelled) {
          partialFolders.push(folderPath);
          sendLogToRenderer(mainWindow, 'warning', 'folder', 'logs.folder.scanCancelled', {
            path: folderPath, count: result.filesScanned + result.filesUnchanged, total: result.filesTotal
          });
          break;
        }
        sendLogToRenderer(mainWindow, 'info', 'folder', 'logs.scan.summary', {
          path: folderPath, scanned: result.filesScanned, unchanged: result.filesUnchanged, removed: result.filesRemoved
        });
      }

      const cancelled = signal.cancelRequested || signal.abort.signal.aborted;
      const length = totalScanned + totalUnchanged;
      if (!cancelled) {
        sendLogToRenderer(mainWindow, 'info', 'folder', 'logs.folder.scanDone', { count: length });
      }
      return { length, scanned: totalScanned, unchanged: totalUnchanged, removed: totalRemoved, cancelled, partialFolders };

    } catch (error) {
      sendLogToRenderer(mainWindow, 'error', 'folder', 'logs.folder.scanError', { error: String(error) });
      throw error;
    } finally {
      progressThrottle.flush();
      if (activeScan === signal) activeScan = null;
    }
  });

  // Interrompre le scan après le fichier en cours
  ipcMain.handle('roms:cancel-scan', async () => {
    if (activeScan) activeScan.cancelRequested = true;
  });

  // Arrêt forcé : abandonner le fichier en cours et tuer les outils externes (7z, chdman…)
  ipcMain.handle('roms:force-cancel-scan', async () => {
    if (!activeScan) return;
    activeScan.cancelRequested = true;
    activeScan.abort.abort();
    const killed = killAllTrackedProcesses();
    if (killed > 0) console.warn(`⚠️ Forced scan stop: ${killed} external process(es) killed`);
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
      const roots = await database.all<{ id: number, folder_path: string, scan_status: string | null }>(
        `SELECT id, folder_path, scan_status FROM scanned_folders WHERE is_root = 1`
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
          fileCount: fileCount?.count || 0,
          // 'in_progress' = scan interrompu par un arrêt de l'application
          scanStatus: root.scan_status || 'complete'
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
