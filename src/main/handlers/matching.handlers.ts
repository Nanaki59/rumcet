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
      const matches = await database.all(`
        SELECT 
          dr.id as datRomId,
          dr.name as datRomName,
          g.name as gameName,
          g.id as gameId,
          sf.id as scannedFileId,
          sf.file_name as scannedFileName,
          sf.file_path as scannedFilePath,
          ac.id as archiveContentId,
          ac.file_name as archiveFileName,
          sf2.archive_type as archiveType,
          rm.match_type as matchType,
          rm.match_score as priorityScore
        FROM dat_roms dr
        JOIN games g ON dr.game_id = g.id
        LEFT JOIN rom_matches rm ON dr.id = rm.dat_rom_id
        LEFT JOIN scanned_files sf ON rm.scanned_file_id = sf.id
        LEFT JOIN archive_contents ac ON rm.archive_content_id = ac.id
        LEFT JOIN scanned_files sf2 ON ac.archive_id = sf2.id
        WHERE g.id = ?
        ORDER BY dr.name
      `, [gameId]);

      return matches.map((m: any) => ({
        datRomId: m.datRomId,
        datRomName: m.datRomName,
        gameName: m.gameName,
        gameId: m.gameId,
        scannedFileId: m.scannedFileId,
        scannedFileName: m.scannedFileName,
        scannedFilePath: m.scannedFilePath,
        archiveContentId: m.archiveContentId,
        archiveFileName: m.archiveFileName,
        archiveType: m.archiveType,
        matchType: m.matchType || 'none',
        matchedBy: [], // On pourrait stocker ça dans la DB si nécessaire
        priorityScore: m.priorityScore || 0
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
            WHEN sf.file_name IS NOT NULL THEN sf.file_name
            WHEN ac.file_name IS NOT NULL THEN sf2.file_name || ' > ' || ac.file_name
            ELSE 'MANQUANT'
          END as found_file,
          rm.match_type,
          rm.match_score as priority_score,
          sf2.archive_type
        FROM dat_roms dr
        JOIN games g ON dr.game_id = g.id
        LEFT JOIN rom_matches rm ON dr.id = rm.dat_rom_id
        LEFT JOIN scanned_files sf ON rm.scanned_file_id = sf.id
        LEFT JOIN archive_contents ac ON rm.archive_content_id = ac.id
        LEFT JOIN scanned_files sf2 ON ac.archive_id = sf2.id
        ORDER BY g.name, dr.name
      `);

      let csvContent = 'Jeu,ROM,CRC32 Attendu,Fichier Trouvé,Type de Match,Priorité,Type d\'Archive\n';
      for (const match of matches) {
        const archiveType = match.archive_type || 'non compressé';
        csvContent += `"${match.game_name}","${match.rom_name}","${match.expected_crc32 || ''}","${match.found_file}","${match.match_type || 'none'}","${match.priority_score || 0}","${archiveType}"\n`;
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
