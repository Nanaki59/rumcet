// src/main/handlers/navigation.handlers.ts
import { IpcMain } from 'electron';
import path from 'path';
import { initDatabase } from '../../database/init.js';
import { databaseService } from '../services/database.service.js';
import { resolveDependencies } from '../../helpers/resolveDependencies.js';
import { settingsManager, type ArcadeTargetSetMode } from '../../helpers/settingsManager.js';

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
        console.error('Error while reopening the database:', error);
        return [];
      }
    }
    
    if (!database) return [];

    try {
      // has_chd : pré-calculé via EXISTS pour éviter une requête par jeu côté renderer.
      // rom_count : nombre de ROMs « fichiers » (is_disk = 0). Les CHD ne sont PAS
      //   comptés comme des ROMs (ils sont des disques séparés dans l'archive MAME).
      // disk_count : nombre de disques (CHD, is_disk = 1) liés au jeu.
      // La visibilité d'un jeu dans la liste (masquage des devices vides) se base
      //   côté renderer sur rom_count + disk_count > 0 : un jeu avec seulement un CHD
      //   (disque orphelin) doit rester visible.
      // Agrégation de dat_roms en UNE seule passe (au lieu de 3 sous-requêtes
      // corrélées par jeu, prohibitif sur un DAT MAME de ~48k jeux) puis jointure.
      const baseQuery = `
        SELECT
          g.*,
          CASE WHEN COALESCE(d.disk_count, 0) > 0 THEN 1 ELSE 0 END AS has_chd,
          COALESCE(d.rom_count, 0) AS rom_count,
          COALESCE(d.disk_count, 0) AS disk_count,
          COALESCE(d.total_size, 0) AS total_size
        FROM games g
        LEFT JOIN (
          SELECT game_id,
            SUM(CASE WHEN is_disk = 0 THEN 1 ELSE 0 END) AS rom_count,
            SUM(CASE WHEN is_disk = 1 THEN 1 ELSE 0 END) AS disk_count,
            SUM(COALESCE(size, 0)) AS total_size
          FROM dat_roms
          GROUP BY game_id
        ) d ON d.game_id = g.id
      `;
      const query = systemId
        ? `${baseQuery} WHERE g.system_id = ? ORDER BY g.name`
        : `${baseQuery} ORDER BY g.name`;

      const games = await database.all(query, systemId ? [systemId] : []);
      return games;
    } catch (error) {
      console.error('Error while retrieving games:', error);
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
        console.error('Error while reopening the database:', error);
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
      console.error('Error while retrieving ROMs:', error);
      return [];
    }
  });

  // Lister les machines qui dépendent d'un jeu donné (utile pour un BIOS / device /
  // mechanical : quelles machines l'activent). S'appuie sur game_relationships
  // (parent_game_id = ce jeu). Retourne le nom, la description et le type de relation.
  ipcMain.handle('games:list-dependents', async (_event, gameId: number) => {
    let database = databaseService.getDatabase();
    const dbPath = databaseService.getDbPath();

    if (!database && dbPath) {
      try {
        database = await initDatabase(dbPath, false);
        databaseService.setDatabase(database);
      } catch (error) {
        console.error('Error while reopening the database:', error);
        return [];
      }
    }

    if (!database) return [];

    try {
      const dependents = await database.all(
        `SELECT g.name, g.description, gr.relationship_type
         FROM game_relationships gr
         JOIN games g ON g.id = gr.child_game_id
         WHERE gr.parent_game_id = ?
         ORDER BY g.name`,
        [gameId]
      );
      return dependents;
    } catch (error) {
      console.error('Error while retrieving dependents:', error);
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
      console.error('Error while updating selection:', error);
    }
  });

  // Mettre à jour la sélection de plusieurs jeux.
  // Chunké : SQLite limite le nombre de variables par requête (souvent 999 ou
  // 32766 selon la version compilée). Un « Tout sélectionner » sur un DAT MAME
  // complet (~48k jeux) dépassait la limite → SQLITE_ERROR: too many SQL variables.
  ipcMain.handle('games:update-selection-bulk', async (_event, gameIds: number[], isSelected: boolean) => {
    const database = databaseService.getDatabase();
    if (!database || gameIds.length === 0) return;

    const CHUNK = 900; // marge sous la limite historique de 999
    try {
      await database.run('BEGIN TRANSACTION');
      for (let i = 0; i < gameIds.length; i += CHUNK) {
        const chunk = gameIds.slice(i, i + CHUNK);
        const placeholders = chunk.map(() => '?').join(',');
        await database.run(
          `UPDATE games SET is_selected = ? WHERE id IN (${placeholders})`,
          [isSelected ? 1 : 0, ...chunk]
        );
      }
      await database.run('COMMIT');
    } catch (error) {
      try { await database.run('ROLLBACK'); } catch { /* ignore */ }
      console.error('Error while bulk-updating selection:', error);
    }
  });

  // Résoudre les dépendances arcade selon le mode cible du settings.
  // Retourne un objet sérialisable : { autoIds, reasons: { [autoId]: AutoReason[] } }
  // - autoIds : liste des game IDs auto-sélectionnés (parents, BIOS, devices) en sus
  //             des user-sélectionnés.
  // - reasons : pour chaque ID auto, la liste des raisons (type + nom du demandeur).
  ipcMain.handle('dependencies:resolve', async () => {
    const database = databaseService.getDatabase();
    if (!database) return { autoIds: [], reasons: {} };

    try {
      const targetMode = (settingsManager.get('arcadeTargetSetMode') as ArcadeTargetSetMode) || 'split';
      const { states, autoReasons } = await resolveDependencies(database, targetMode);

      const autoIds: number[] = [];
      const reasons: Record<number, Array<{ type: string; requiredBy: number; requiredByName: string }>> = {};
      for (const [gameId, state] of states.entries()) {
        if (state === 'auto') {
          autoIds.push(gameId);
          reasons[gameId] = autoReasons.get(gameId) || [];
        }
      }
      return { autoIds, reasons, targetMode };
    } catch (error) {
      console.error('Error while resolving dependencies:', error);
      return { autoIds: [], reasons: {} };
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
        console.error('Error while reopening the database:', error);
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
      console.error('Error while retrieving folder contents:', error);
      return { folders: [], files: [] };
    }
  });
}
