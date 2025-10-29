// src/main/handlers/matching.handlers.ts
import { IpcMain, dialog, BrowserWindow, app } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { matchRomsWithFiles, getMissingRoms, getExtraFiles } from '../../helpers/matchRoms.js';
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
      sendLogToRenderer(mainWindow, 'info', 'match', 'Début du matching des ROMs...');
      
      const result = await matchRomsWithFiles(database);
      
      sendLogToRenderer(mainWindow, 'info', 'match', `Matching terminé !`);
      sendLogToRenderer(mainWindow, 'info', 'match', `ROMs parfaitement matchées : ${result.stats.perfectMatches}`);
      sendLogToRenderer(mainWindow, 'info', 'match', `Bonnes correspondances : ${result.stats.goodMatches}`);
      sendLogToRenderer(mainWindow, 'info', 'match', `Correspondances partielles : ${result.stats.partialMatches}`);
      sendLogToRenderer(mainWindow, 'warning', 'match', `ROMs manquantes : ${result.stats.missingRoms}`);
      sendLogToRenderer(mainWindow, 'warning', 'match', `Fichiers non matchés : ${result.stats.extraFiles}`);
      
      return result;
    } catch (error) {
      sendLogToRenderer(mainWindow, 'error', 'match', `Erreur lors du matching : ${error}`);
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
          g.name as game_name,
          dr.name as rom_name,
          dr.crc32 as expected_crc32,
          CASE 
            WHEN sf.file_name IS NOT NULL THEN sf.file_name
            WHEN ac.file_name IS NOT NULL THEN sf2.file_name || ' > ' || ac.file_name
            ELSE 'MANQUANT'
          END as found_file,
          rm.match_type,
          rm.match_score
        FROM dat_roms dr
        JOIN games g ON dr.game_id = g.id
        LEFT JOIN rom_matches rm ON dr.id = rm.dat_rom_id
        LEFT JOIN scanned_files sf ON rm.scanned_file_id = sf.id
        LEFT JOIN archive_contents ac ON rm.archive_content_id = ac.id
        LEFT JOIN scanned_files sf2 ON ac.archive_id = sf2.id
        ORDER BY g.name, dr.name
      `);

      let csvContent = 'Jeu,ROM,CRC32 Attendu,Fichier Trouvé,Type de Match,Score\n';
      for (const match of matches) {
        csvContent += `"${match.game_name}","${match.rom_name}","${match.expected_crc32 || ''}","${match.found_file}","${match.match_type || 'none'}","${match.match_score || 0}"\n`;
      }

      await fs.writeFile(result.filePath, csvContent, 'utf8');
      
      sendLogToRenderer(mainWindow, 'info', 'match', `Rapport exporté : ${result.filePath}`);
      return { success: true, filePath: result.filePath };
    } catch (error) {
      sendLogToRenderer(mainWindow, 'error', 'match', `Erreur lors de l'export : ${error}`);
      throw error;
    }
  });
}
