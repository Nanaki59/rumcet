// src/main/handlers/search.handlers.ts
import { IpcMain } from 'electron';
import { databaseService } from '../services/database.service.js';

export function registerSearchHandlers(ipcMain: IpcMain) {
  
  // Recherche globale
  ipcMain.handle('search:global', async (_event, query: string, scope: 'all' | 'games' | 'files' | 'archives' = 'all') => {
    const database = databaseService.getDatabase();
    if (!database) {
      return { games: [], files: [], archives: [] };
    }

    const results = {
      games: [] as any[],
      files: [] as any[],
      archives: [] as any[]
    };

    const searchPattern = `%${query}%`;

    try {
      // Recherche dans les jeux DAT
      if (scope === 'all' || scope === 'games') {
        const games = await database.all(`
          SELECT 
            g.*,
            COUNT(dr.id) as rom_count
          FROM games g
          LEFT JOIN dat_roms dr ON g.id = dr.game_id
          WHERE g.name LIKE ? OR g.description LIKE ?
          GROUP BY g.id
          ORDER BY g.name
          LIMIT 50
        `, [searchPattern, searchPattern]);
        
        results.games = games;
      }

      // Recherche dans les fichiers scannés
      if (scope === 'all' || scope === 'files') {
        const files = await database.all(`
          SELECT 
            sf.*,
            sfol.folder_path,
            sf.is_archive
          FROM scanned_files sf
          JOIN scanned_folders sfol ON sf.folder_id = sfol.id
          WHERE sf.file_name LIKE ?
          ORDER BY sf.file_name
          LIMIT 50
        `, [searchPattern]);
        
        results.files = files;
      }

      // Recherche dans les contenus d'archives
      if (scope === 'all' || scope === 'archives') {
        const archives = await database.all(`
          SELECT 
            ac.*,
            sf.file_name as archive_name,
            sf.file_path as archive_path
          FROM archive_contents ac
          JOIN scanned_files sf ON ac.archive_id = sf.id
          WHERE ac.file_name LIKE ?
          ORDER BY ac.file_name
          LIMIT 50
        `, [searchPattern]);
        
        results.archives = archives;
      }

      return results;
    } catch (error) {
      console.error('Erreur lors de la recherche:', error);
      return results;
    }
  });

  // Recherche dans les ROMs d'un jeu spécifique
  ipcMain.handle('search:game-roms', async (_event, gameId: number, query: string) => {
    const database = databaseService.getDatabase();
    if (!database) {
      return [];
    }

    try {
      const searchPattern = `%${query}%`;
      const roms = await database.all(`
        SELECT * FROM dat_roms 
        WHERE game_id = ? AND name LIKE ?
        ORDER BY name
      `, [gameId, searchPattern]);
      
      return roms;
    } catch (error) {
      console.error('Erreur lors de la recherche des ROMs:', error);
      return [];
    }
  });
}
