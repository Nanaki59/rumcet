// src/main/handlers/search.handlers.ts
import { IpcMain } from 'electron';
import { databaseService } from '../services/database.service.js';

type HashType = 'crc32' | 'md5' | 'sha1';

/**
 * Détecte si la requête est un hash, d'après sa longueur hexadécimale :
 * 8 = CRC32, 32 = MD5, 40 = SHA1. Un préfixe "0x" est toléré.
 * Les hashes sont stockés en majuscules (scan) ou tels quels (DAT, souvent
 * en minuscules) : on renvoie les deux casses pour garder l'usage des index.
 */
function detectHash(query: string): { type: HashType; values: [string, string] } | null {
  const hex = query.trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]+$/i.test(hex)) return null;
  const type: HashType | null =
    hex.length === 8 ? 'crc32' : hex.length === 32 ? 'md5' : hex.length === 40 ? 'sha1' : null;
  if (!type) return null;
  return { type, values: [hex.toUpperCase(), hex.toLowerCase()] };
}

export function registerSearchHandlers(ipcMain: IpcMain) {

  // Recherche globale (par nom, ou par hash CRC32 / MD5 / SHA1)
  ipcMain.handle('search:global', async (_event, query: string, scope: 'all' | 'games' | 'files' | 'archives' = 'all') => {
    const database = databaseService.getDatabase();
    if (!database) {
      return { games: [], files: [], archives: [], hashType: null };
    }

    const hash = detectHash(query);
    const results = {
      games: [] as any[],
      files: [] as any[],
      archives: [] as any[],
      hashType: hash?.type ?? null
    };

    const searchPattern = `%${query}%`;
    // La colonne vient de detectHash (valeur fermée), pas de l'utilisateur
    const hashCol = hash?.type;
    const hashValues = hash ? hash.values : [];

    try {
      // Recherche dans les jeux DAT (nom, description, ou hash d'une de leurs ROMs)
      if (scope === 'all' || scope === 'games') {
        const games = await database.all(`
          SELECT
            g.*,
            COUNT(dr.id) as rom_count
            ${hash ? `, (SELECT dr2.name FROM dat_roms dr2 WHERE dr2.game_id = g.id AND dr2.${hashCol} IN (?, ?) LIMIT 1) as hash_rom` : ''}
          FROM games g
          LEFT JOIN dat_roms dr ON g.id = dr.game_id
          WHERE g.name LIKE ? OR g.description LIKE ?
            ${hash ? `OR g.id IN (SELECT game_id FROM dat_roms WHERE ${hashCol} IN (?, ?))` : ''}
          GROUP BY g.id
          ORDER BY ${hash ? 'hash_rom IS NULL, ' : ''}g.name
          LIMIT 50
        `, [...hashValues, searchPattern, searchPattern, ...hashValues]);

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
            ${hash ? `OR sf.${hashCol} IN (?, ?)` : ''}
          ORDER BY ${hash ? `sf.${hashCol} IN (?, ?) DESC, ` : ''}sf.file_name
          LIMIT 50
        `, [searchPattern, ...hashValues, ...hashValues]);

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
            ${hash ? `OR ac.${hashCol} IN (?, ?)` : ''}
          ORDER BY ${hash ? `ac.${hashCol} IN (?, ?) DESC, ` : ''}ac.file_name
          LIMIT 50
        `, [searchPattern, ...hashValues, ...hashValues]);

        results.archives = archives;
      }

      return results;
    } catch (error) {
      console.error('Error during search:', error);
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
      console.error('Error during ROM search:', error);
      return [];
    }
  });
}
