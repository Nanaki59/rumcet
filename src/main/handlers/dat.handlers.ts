// src/main/handlers/dat.handlers.ts
import { IpcMain, dialog, BrowserWindow } from 'electron';
import { parseDatFile, insertGamesFromDat } from '../../database/insertGamesFromDat.js';
import { setMetadata } from '../../database/init.js';
import { databaseService } from '../services/database.service.js';
import { settingsManager } from '../../helpers/settingsManager.js';
import path from 'path';

export function registerDatHandlers(ipcMain: IpcMain, mainWindow: BrowserWindow) {
  
  // Sélectionner un fichier DAT/XML
  ipcMain.handle('dat:select-file', async () => {
    const defaultPath = settingsManager.get('defaultDatFolder');

    const filePath = await dialog.showOpenDialog(mainWindow, {
      title: 'Sélectionner un fichier DAT/XML',
      defaultPath: defaultPath,
      filters: [
        { name: 'Fichiers DAT/XML', extensions: ['dat', 'xml'] },
        { name: 'Tous les fichiers', extensions: ['*'] }
      ],
      properties: ['openFile']
    });

    if (filePath.canceled || !filePath.filePaths || filePath.filePaths.length === 0) {
      return null;
    }

    databaseService.setDatPath(filePath.filePaths[0]);
    return filePath.filePaths[0];
  });

  // Charger un fichier DAT dans la base
  ipcMain.handle('dat:load', async (_event, datPath: string) => {
    try {
      const database = databaseService.getDatabase();
      const dbPath = databaseService.getDbPath();
      
      if (!database || !dbPath) {
        throw new Error('Aucune base de données active.');
      }

      const parsed = await parseDatFile(datPath);
      const { gamesCount, romsCount } = await insertGamesFromDat(database, parsed);

      // Sauvegarder les métadonnées
      await setMetadata(database, 'dat_path', datPath);
    
      // Récupérer les informations du header
      const header = parsed.datafile?.header?.[0];

      const datName = header?.name?.[0] ||
                      path.basename(datPath, path.extname(datPath));
      const datDescription = header?.description?.[0] ||
                      path.basename(datPath, path.extname(datPath));
      const datVersion = header?.version?.[0] || 'N/A';
      const datDate = header?.date?.[0] || 'N/A';
      const datAuthor = header?.author?.[0] || 'N/A';
      const datHomepage = header?.homepage?.[0] || 'N/A';
      const datUrl = header?.url?.[0] || 'N/A';

      await setMetadata(database, 'dat_name', datName);
      await setMetadata(database, 'dat_description', datDescription);
      await setMetadata(database, 'dat_version', datVersion);
      await setMetadata(database, 'dat_date', datDate);
      await setMetadata(database, 'dat_author', datAuthor);
      await setMetadata(database, 'dat_homepage', datHomepage);
      await setMetadata(database, 'dat_url', datUrl);

      databaseService.setDatPath(datPath);
      databaseService.setDatLoaded(true);

      // Logger les informations pour debug
      console.log('DAT Info:', {
        name: datName,
        version: datVersion,
        date: datDate,
        author: datAuthor
      });

      return {
        success: true,
        dbPath: dbPath,
        gamesCount: gamesCount,
        romsCount: romsCount,
        datInfo: {
          name: datName,
          description: datDescription,
          version: datVersion,
          date: datDate,
          author: datAuthor,
          homepage: datHomepage,
          url: datUrl
        }
      };
    } catch (error) {
      console.error('Error loading DAT file:', error);
      throw error;
    }
  });
}
