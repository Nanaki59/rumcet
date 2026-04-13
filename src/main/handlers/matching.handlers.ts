// src/main/handlers/matching.handlers.ts
import { IpcMain, dialog, BrowserWindow, app } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { matchRomsWithFiles, getMissingRoms, getExtraFiles, getGameMatchStatuses } from '../../helpers/matchRoms.js';
import { databaseService } from '../services/database.service.js';
import { sendLogToRenderer } from '../utils/logger.js';

export function registerMatchingHandlers(ipcMain: IpcMain, mainWindow: BrowserWindow) {
  
  // Lancer le matching
  ipcMain.handle('matching:run', async () => {
    const database = databaseService.getDatabase();
    if (!database) {
      throw new Error('Aucune base de données active');
    }

    try {
      sendLogToRenderer(mainWindow, 'info', 'match', '🔍 Début du matching des ROMs...');
      
      const result = await matchRomsWithFiles(database);
      
      sendLogToRenderer(mainWindow, 'info', 'match', '✅ Matching terminé !');
      sendLogToRenderer(mainWindow, 'info', 'match', `📊 Statistiques :`);
      sendLogToRenderer(mainWindow, 'info', 'match', `   - Jeux complets : ${result.stats.completeGames}/${result.stats.totalGames} ✅`);
      sendLogToRenderer(mainWindow, 'info', 'match', `   - Jeux partiels : ${result.stats.partialGames}/${result.stats.totalGames} ⚠️`);
      sendLogToRenderer(mainWindow, 'warning', 'match', `   - Jeux manquants : ${result.stats.missingGames}/${result.stats.totalGames} ❌`);
      sendLogToRenderer(mainWindow, 'info', 'match', `   - ROMs matchées : ${result.stats.matchedRoms}/${result.stats.totalDatRoms}`);
      sendLogToRenderer(mainWindow, 'warning', 'match', `   - ROMs manquantes : ${result.stats.missingRoms}/${result.stats.totalDatRoms}`);
      sendLogToRenderer(mainWindow, 'warning', 'match', `   - Fichiers non matchés : ${result.stats.extraFiles}`);
      
      return result;
    } catch (error) {
      sendLogToRenderer(mainWindow, 'error', 'match', `❌ Erreur lors du matching : ${error}`);
      throw error;
    }
  });

  // Récupérer les ROMs manquantes
  ipcMain.handle('matching:get-missing', async () => {
    const database = databaseService.getDatabase();
    if (!database) {
      throw new Error('Aucune base de données active');
    }

    try {
      return await getMissingRoms(database);
    } catch (error) {
      console.error('Erreur lors de la récupération des ROMs manquantes:', error);
      throw error;
    }
  });

  // Récupérer les statuts de matching par jeu
  ipcMain.handle('matching:get-game-statuses', async () => {
    const database = databaseService.getDatabase();
    if (!database) {
      // Retourner un tableau vide au lieu de lancer une erreur
      return [];
    }

    try {
      return await getGameMatchStatuses(database);
    } catch (error) {
      console.error('Erreur lors de la récupération des statuts des jeux:', error);
      // Retourner un tableau vide en cas d'erreur
      return [];
    }
  });

  // Récupérer les matches d'un jeu spécifique (sans relancer le matching)
  ipcMain.handle('matching:get-matches-for-game', async (_event, gameId: number) => {
    const database = databaseService.getDatabase();
    if (!database) {
      return [];
    }

    try {
      // Récupérer tous les matches pour ce jeu
      // scanned_file_id pointe vers le fichier physique (loose ou archive)
      const matches = await database.all(`
        SELECT
          dr.id as datRomId,
          dr.name as datRomName,
          g.name as gameName,
          g.id as gameId,
          rm.scanned_file_id as scannedFileId,
          sf.file_name as scannedFileName,
          sf.file_path as scannedFilePath,
          rm.archive_content_id as archiveContentId,
          ac.file_name as archiveFileName,
          sf.archive_type as archiveType,
          rm.archive_is_perfect as archiveIsPerfect
        FROM rom_matches rm
        JOIN dat_roms dr ON rm.dat_rom_id = dr.id
        JOIN games g ON dr.game_id = g.id
        JOIN scanned_files sf ON rm.scanned_file_id = sf.id
        LEFT JOIN archive_contents ac ON rm.archive_content_id = ac.id
        WHERE g.id = ?
        ORDER BY dr.name
      `, [gameId]);

      return matches.map((m: any) => ({
        datRomId: m.datRomId,
        datRomName: m.datRomName,
        gameName: m.gameName,
        gameId: m.gameId,
        scannedFileId: m.scannedFileId || undefined,
        scannedFileName: m.scannedFileName || undefined,
        scannedFilePath: m.scannedFilePath || undefined,
        archiveContentId: m.archiveContentId || undefined,
        archiveFileName: m.archiveFileName || undefined,
        archiveType: m.archiveType || undefined,
        archiveIsPerfect: !!m.archiveIsPerfect
      }));
    } catch (error) {
      console.error('Erreur lors de la récupération des matches du jeu:', error);
      return [];
    }
  });

  // Récupérer les fichiers extras
  ipcMain.handle('matching:get-extras', async () => {
    const database = databaseService.getDatabase();
    if (!database) {
      throw new Error('Aucune base de données active');
    }

    try {
      return await getExtraFiles(database);
    } catch (error) {
      console.error('Erreur lors de la récupération des fichiers extras:', error);
      throw error;
    }
  });

  // Récupérer les infos de matching pour une liste de fichiers scannés (vue dossier)
  ipcMain.handle('matching:get-files-match-info', async (_event, fileIds: number[]) => {
    const database = databaseService.getDatabase();
    if (!database || fileIds.length === 0) {
      return {};
    }

    try {
      const placeholders = fileIds.map(() => '?').join(',');

      // Pour les fichiers loose : matches directs (archive_content_id IS NULL)
      const looseMatches = await database.all(`
        SELECT
          rm.scanned_file_id as fileId,
          g.id as gameId,
          g.name as gameName,
          dr.id as datRomId,
          dr.name as datRomName
        FROM rom_matches rm
        JOIN dat_roms dr ON rm.dat_rom_id = dr.id
        JOIN games g ON dr.game_id = g.id
        WHERE rm.scanned_file_id IN (${placeholders})
          AND rm.archive_content_id IS NULL
      `, fileIds);

      // Pour les archives : matches via archive_contents
      const archiveMatches = await database.all(`
        SELECT
          rm.scanned_file_id as fileId,
          g.id as gameId,
          g.name as gameName,
          dr.id as datRomId,
          dr.name as datRomName,
          ac.file_name as contentFileName,
          rm.archive_is_perfect as archiveIsPerfect,
          (SELECT COUNT(*) FROM dat_roms dr2 WHERE dr2.game_id = g.id) as totalGameRoms,
          (SELECT COUNT(DISTINCT rm2.dat_rom_id) FROM rom_matches rm2
           JOIN dat_roms dr3 ON rm2.dat_rom_id = dr3.id
           WHERE rm2.scanned_file_id = rm.scanned_file_id
             AND dr3.game_id = g.id
             AND rm2.archive_content_id IS NOT NULL
          ) as matchedGameRoms
        FROM rom_matches rm
        JOIN dat_roms dr ON rm.dat_rom_id = dr.id
        JOIN games g ON dr.game_id = g.id
        JOIN archive_contents ac ON rm.archive_content_id = ac.id
        WHERE rm.scanned_file_id IN (${placeholders})
          AND rm.archive_content_id IS NOT NULL
      `, fileIds);

      // Construire le résultat par fileId
      const result: Record<number, {
        looseMatches: Array<{ gameId: number; gameName: string; datRomName: string }>;
        archiveGames: Array<{
          gameId: number;
          gameName: string;
          matchedRoms: number;
          totalRoms: number;
          isPerfect: boolean;
        }>;
        matchedContents: Record<string, Array<{ gameId: number; gameName: string }>>;
      }> = {};

      // Initialiser tous les fichiers demandés
      for (const id of fileIds) {
        result[id] = { looseMatches: [], archiveGames: [], matchedContents: {} };
      }

      // Remplir les matches loose
      for (const m of looseMatches) {
        result[m.fileId].looseMatches.push({
          gameId: m.gameId,
          gameName: m.gameName,
          datRomName: m.datRomName
        });
      }

      // Remplir les matches archive (groupés par jeu) + détail par fichier dans l'archive
      const archiveGameSeen = new Map<string, boolean>();
      const contentGameSeen = new Map<string, boolean>();
      for (const m of archiveMatches) {
        const gameKey = `${m.fileId}-${m.gameId}`;
        if (!archiveGameSeen.has(gameKey)) {
          archiveGameSeen.set(gameKey, true);
          result[m.fileId].archiveGames.push({
            gameId: m.gameId,
            gameName: m.gameName,
            matchedRoms: m.matchedGameRoms,
            totalRoms: m.totalGameRoms,
            isPerfect: !!m.archiveIsPerfect
          });
        }
        // Associer chaque fichier de l'archive aux jeux auxquels il correspond
        if (m.contentFileName) {
          const entry = result[m.fileId];
          if (!entry.matchedContents[m.contentFileName]) {
            entry.matchedContents[m.contentFileName] = [];
          }
          const cgKey = `${m.fileId}-${m.contentFileName}-${m.gameId}`;
          if (!contentGameSeen.has(cgKey)) {
            contentGameSeen.set(cgKey, true);
            entry.matchedContents[m.contentFileName].push({
              gameId: m.gameId,
              gameName: m.gameName
            });
          }
        }
      }

      return result;
    } catch (error) {
      console.error('Erreur lors de la récupération des infos de matching fichiers:', error);
      return {};
    }
  });

  // Exporter le rapport de matching
  ipcMain.handle('matching:export-report', async () => {
    const database = databaseService.getDatabase();
    if (!database) {
      throw new Error('Aucune base de données active');
    }

    const defaultPath = app.getPath('documents');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Exporter le rapport de matching',
      defaultPath: path.join(defaultPath, 'matching_report.csv'),
      filters: [
        { name: 'Fichiers CSV', extensions: ['csv'] },
        { name: 'Fichiers texte', extensions: ['txt'] }
      ]
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    try {
      const matches = await database.all(`
        SELECT
          g.id as game_id,
          g.name as game_name,
          dr.name as rom_name,
          dr.crc32 as expected_crc32,
          CASE
            WHEN rm.archive_content_id IS NOT NULL THEN sf.file_name || ' > ' || ac.file_name
            WHEN rm.scanned_file_id IS NOT NULL THEN sf.file_name
            ELSE 'MANQUANT'
          END as found_file,
          CASE WHEN rm.id IS NOT NULL THEN 'matched' ELSE 'missing' END as match_status,
          CASE
            WHEN rm.archive_content_id IS NOT NULL THEN sf.archive_type
            ELSE 'non compressé'
          END as archive_type,
          rm.archive_is_perfect
        FROM dat_roms dr
        JOIN games g ON dr.game_id = g.id
        LEFT JOIN rom_matches rm ON dr.id = rm.dat_rom_id
        LEFT JOIN scanned_files sf ON rm.scanned_file_id = sf.id
        LEFT JOIN archive_contents ac ON rm.archive_content_id = ac.id
        ORDER BY g.name, dr.name
      `);

      let csvContent = 'Jeu,ROM,CRC32 Attendu,Fichier Trouvé,Statut,Type d\'Archive,Archive Parfaite\n';
      for (const match of matches) {
        const archiveType = match.archive_type || 'non compressé';
        const isPerfect = match.archive_is_perfect ? 'Oui' : 'Non';
        csvContent += `"${match.game_name}","${match.rom_name}","${match.expected_crc32 || ''}","${match.found_file}","${match.match_status}","${archiveType}","${isPerfect}"\n`;
      }

      await fs.writeFile(result.filePath, csvContent, 'utf8');
      
      sendLogToRenderer(mainWindow, 'info', 'match', `📄 Rapport exporté : ${result.filePath}`);
      return { success: true, filePath: result.filePath };
    } catch (error) {
      sendLogToRenderer(mainWindow, 'error', 'match', `❌ Erreur lors de l'export : ${error}`);
      throw error;
    }
  });
}
