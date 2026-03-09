// src/main/handlers/navigation.handlers.ts
import { IpcMain } from 'electron';
import path from 'path';
import { initDatabase } from '../../database/init.js';
import { databaseService } from '../services/database.service.js';

interface FolderFileResult {
  filePath: string;
  fileName: string;
  size: number;
  hashes: {
    crc32: string;
    md5: string;
    sha1: string;
  };
  isArchive: boolean;
  archiveType?: string;
  contents?: Array<{
    fileName: string;
    size: number;
    hashes?: {
      crc32: string;
      md5: string;
      sha1: string;
    };
  }>;
}

export function registerNavigationHandlers(ipcMain: IpcMain) {
  
  // Lister les jeux
  ipcMain.handle('games:list', async (_event, systemId?: number) => {
    let database = databaseService.getDatabase();
    const dbPath = databaseService.getDbPath();
    
    if (!database && dbPath) {
      try {
        database = await initDatabase(dbPath, false);
        databaseService.setDatabase(database);
      } catch (error) {
        console.error('Erreur lors de la réouverture de la base:', error);
        return [];
      }
    }
    
    if (!database) return [];

    try {
      const query = systemId 
        ? 'SELECT * FROM games WHERE system_id = ? ORDER BY name'
        : 'SELECT * FROM games ORDER BY name';

      const games = await database.all(query, systemId ? [systemId] : []);
      return games;
    } catch (error) {
      console.error('Erreur lors de la récupération des jeux:', error);
      return [];
    }
  });

  // Lister les ROMs d'un jeu
  ipcMain.handle('roms:list-by-game', async (_event, gameId: number) => {
    let database = databaseService.getDatabase();
    const dbPath = databaseService.getDbPath();
    
    if (!database && dbPath) {
      try {
        database = await initDatabase(dbPath, false);
        databaseService.setDatabase(database);
      } catch (error) {
        console.error('Erreur lors de la réouverture de la base:', error);
        return [];
      }
    }
    
    if (!database) return [];

    try {
      const roms = await database.all(
        'SELECT * FROM dat_roms WHERE game_id = ? ORDER BY name',
        [gameId]
      );
      return roms;
    } catch (error) {
      console.error('Erreur lors de la récupération des ROMs:', error);
      return [];
    }
  });

  // Mettre à jour la sélection d'un jeu
  ipcMain.handle('games:update-selection', async (_event, gameId: number, isSelected: boolean) => {
    const database = databaseService.getDatabase();
    if (!database) return;

    try {
      await database.run('UPDATE games SET is_selected = ? WHERE id = ?', [isSelected ? 1 : 0, gameId]);
    } catch (error) {
      console.error('Erreur lors de la mise à jour de la sélection:', error);
    }
  });

  // Mettre à jour la sélection de plusieurs jeux
  ipcMain.handle('games:update-selection-bulk', async (_event, gameIds: number[], isSelected: boolean) => {
    const database = databaseService.getDatabase();
    if (!database) return;

    try {
      const placeholders = gameIds.map(() => '?').join(',');
      await database.run(
        `UPDATE games SET is_selected = ? WHERE id IN (${placeholders})`,
        [isSelected ? 1 : 0, ...gameIds]
      );
    } catch (error) {
      console.error('Erreur lors de la mise à jour de la sélection en masse:', error);
    }
  });

  // Lister le contenu d'un dossier
  ipcMain.handle('folder:list-contents', async (_event, folderPath: string, viewMode: 'hierarchical' | 'flat' = 'hierarchical') => {
    let database = databaseService.getDatabase();
    const dbPath = databaseService.getDbPath();
    
    if (!database && dbPath) {
      try {
        database = await initDatabase(dbPath, false);
        databaseService.setDatabase(database);
      } catch (error) {
        console.error('Erreur lors de la réouverture de la base:', error);
        return { folders: [], files: [] };
      }
    }
    
    if (!database) return { folders: [], files: [] };

    try {
      if (viewMode === 'hierarchical') {
        // Vue hiérarchique
        const currentFolder = await database.get<{ id: number }>(
          'SELECT id FROM scanned_folders WHERE folder_path = ?',
          [folderPath]
        );

        if (!currentFolder) {
          return { folders: [], files: [] };
        }

        const subFolders = await database.all<{ folder_path: string, file_count: number }>(
          `SELECT 
            sf.folder_path,
            (SELECT COUNT(*) FROM scanned_files WHERE folder_id IN 
              (SELECT id FROM scanned_folders WHERE folder_path LIKE sf.folder_path || '%')
            ) as file_count
          FROM scanned_folders sf
          WHERE parent_folder_id = ?`,
          [currentFolder.id]
        );

        const files = await database.all(
          `SELECT 
            sf.*,
            COUNT(ac.id) as content_count
          FROM scanned_files sf
          LEFT JOIN archive_contents ac ON sf.id = ac.archive_id
          WHERE sf.folder_id = ?
          GROUP BY sf.id
          ORDER BY sf.file_name`,
          [currentFolder.id]
        );

        const formattedFolders = subFolders.map((f: { folder_path: string; file_count: number }) => ({
          path: f.folder_path,
          name: path.basename(f.folder_path),
          isFolder: true,
          fileCount: f.file_count
        }));

        const formattedFiles = files.map((f: any) => ({
          ...f,
          hashes: f.crc32 ? {
            crc32: f.crc32,
            md5: f.md5,
            sha1: f.sha1
          } : undefined,
          isArchive: f.is_archive === 1,
          archiveType: f.archive_type,
          filePath: f.file_path,
          fileName: f.file_name,
          size: f.size
        }));

        // Si archive, récupérer son contenu
        for (const file of formattedFiles) {
          if (file.isArchive) {
            const contents = await database.all(`
              SELECT * FROM archive_contents 
              WHERE archive_id = ?
              ORDER BY file_name
            `, [file.id]);
            
            file.contents = contents.map((c: any) => ({
              fileName: c.file_name,
              size: c.size,
              hashes: c.crc32 ? {
                crc32: c.crc32,
                md5: c.md5,
                sha1: c.sha1
              } : undefined
            }));
          }
        }

        return {
          folders: formattedFolders,
          files: formattedFiles
        };
      } else {
        // Vue à plat - récupérer tous les fichiers sous ce dossier
        const allFiles = await database.all(`
          SELECT 
            sf.*,
            sfol.folder_path,
            COUNT(ac.id) as content_count
          FROM scanned_files sf
          JOIN scanned_folders sfol ON sf.folder_id = sfol.id
          LEFT JOIN archive_contents ac ON sf.id = ac.archive_id
          WHERE sfol.folder_path LIKE ? || '%'
          GROUP BY sf.id
          ORDER BY sf.file_name
        `, [folderPath]);

        const formattedFiles = allFiles.map((f: any) => ({
          ...f,
          hashes: f.crc32 ? {
            crc32: f.crc32,
            md5: f.md5,
            sha1: f.sha1
          } : undefined,
          isArchive: f.is_archive === 1,
          archiveType: f.archive_type,
          filePath: f.file_path,
          fileName: f.file_name,
          size: f.size
        }));

        // Récupérer le contenu des archives
        for (const file of formattedFiles) {
          if (file.isArchive) {
            const contents = await database.all(`
              SELECT * FROM archive_contents 
              WHERE archive_id = ?
              ORDER BY file_name
            `, [file.id]);
            
            file.contents = contents.map((c: any) => ({
              fileName: c.file_name,
              size: c.size,
              hashes: c.crc32 ? {
                crc32: c.crc32,
                md5: c.md5,
                sha1: c.sha1
              } : undefined
            }));
          }
        }

        return {
          folders: [],
          files: formattedFiles
        };
      }
    } catch (error) {
      console.error('Erreur lors de la récupération du contenu du dossier:', error);
      return { folders: [], files: [] };
    }
  });
}
