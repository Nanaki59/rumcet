// src/main/handlers/database.handlers.ts
import { IpcMain, dialog, BrowserWindow, app } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { initDatabase, getMetadata, setMetadata } from '../../database/init.js';
import { databaseService } from '../services/database.service.js';
import { settingsManager } from '../../helpers/settingsManager.js';

export function registerDatabaseHandlers(ipcMain: IpcMain, mainWindow: BrowserWindow) {
  
  // Créer une base de données
  ipcMain.handle('database:create', async (_event, datPath: string, clearExisting: boolean = false) => {
    const defaultName = path.basename(datPath, path.extname(datPath)) + '.sqlite';
    const defaultFolder = settingsManager.get('defaultDatabaseFolder');

    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Créer la base de données',
      defaultPath: path.join(defaultFolder, defaultName),
      filters: [
        { name: 'Base de données SQLite', extensions: ['sqlite'] },
        { name: 'Base de données générique', extensions: ['db'] }
      ],
      properties: ['createDirectory']
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    try {
      let fileExists = false;
      try {
        await fs.access(result.filePath);
        fileExists = true;
      } catch {
        fileExists = false;
      }

      if (fileExists) {
        const confirmResult = await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: 'Base de données existante',
          message: 'Une base de données existe déjà à cet emplacement.',
          detail: 'Voulez-vous la remplacer ? Toutes les données existantes seront perdues.',
          buttons: ['Remplacer', 'Annuler'],
          defaultId: 1,
          cancelId: 1
        });

        if (confirmResult.response === 1) {
          return null;
        }
        
        clearExisting = true;
      }

      await databaseService.closeDatabase();

      const database = await initDatabase(result.filePath, clearExisting);
      await setMetadata(database, 'dat_path', datPath);

      databaseService.setDatabase(database);
      databaseService.setDatPath(datPath);
      databaseService.setDbPath(result.filePath);
      databaseService.setDatLoaded(false);

      return {
        success: true,
        dbPath: result.filePath,
        gamesCount: 0,
        romsCount: 0
      };
    } catch (error) {
      console.error('Erreur lors de la création de la base: ', error);
      databaseService.reset();
      throw error;
    }
  });

  // Ouvrir une base de données existante
  ipcMain.handle('database:open', async () => {
    const defaultFolder = settingsManager.get('defaultDatabaseFolder');

    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Ouvrir une base de données',
      defaultPath: defaultFolder,
      filters: [
        { name: 'Base de données SQLite', extensions: ['sqlite', 'db'] },
        { name: 'Tous les fichiers', extensions: ['*'] }
      ],
      properties: ['openFile']
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return null;
    }

    try {
      await databaseService.closeDatabase();

      const dbPath = result.filePaths[0];
      const database = await initDatabase(dbPath, false);
      
      databaseService.setDatabase(database);
      databaseService.setDbPath(dbPath);

      const dbInfo = await getDBInfo(database);
      databaseService.setDatPath(dbInfo.datPath);
      databaseService.setDatLoaded(dbInfo.gamesCount > 0);
      
      return {
        success: true,
        dbPath: dbPath,
        datPath: dbInfo.datPath,
        gamesCount: dbInfo.gamesCount,
        romsCount: dbInfo.romsCount,
        folders: dbInfo.folders,
        datInfo: dbInfo.datInfo
      };
    } catch (error) {
      console.error('Erreur lors de l\'ouverture de la base:', error);
      databaseService.reset();
      throw error;
    }
  });

  // Fermer la base de données
  ipcMain.handle('database:close', async () => {
    const currentDb = databaseService.getDatabase();
    if (currentDb) {
      await databaseService.closeDatabase();
      return true;
    }
    return false;
  });

  // Chargement rapide (création + import DAT)
  ipcMain.handle('database:quick-load', async (_event, datPath: string) => {
    const { parseDatFile, insertGamesFromDat } = await import('../../database/insertGamesFromDat.js');
    
    const defaultName = path.basename(datPath, path.extname(datPath));
    const defaultFolder = settingsManager.get('defaultDatabaseFolder');

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Créer la base de données',
      defaultPath: path.join(defaultFolder, `${defaultName}.sqlite`),
      filters: [
        { name: 'SQLite Database', extensions: ['sqlite'] },
        { name: 'Database', extensions: ['db'] }
      ],
      properties: ['createDirectory']
    });

    if (canceled || !filePath) {
      return null;
    }

    try {
      let clearExisting = false;
      try {
        await fs.access(filePath);
        clearExisting = true;
      } catch {
        // File doesn't exist
      }

      await databaseService.closeDatabase();

      const database = await initDatabase(filePath, clearExisting);
      const parsed = await parseDatFile(datPath);
      const result = await insertGamesFromDat(database, parsed);

      await setMetadata(database, 'dat_path', datPath);

      databaseService.setDatabase(database);
      databaseService.setDatPath(datPath);
      databaseService.setDbPath(filePath);
      databaseService.setDatLoaded(true);

      return {
        success: true,
        dbPath: filePath,
        ...result
      };
    } catch (error) {
      console.error('Erreur lors de la création de la base:', error);
      databaseService.reset();
      throw error;
    }
  });
}

// Fonction helper pour récupérer les infos de la DB
async function getDBInfo(database: any) {
  try {
    const datPath = await getMetadata(database, 'dat_path');
    const datName = await getMetadata(database, 'dat_name');
    const datDescription = await getMetadata(database, 'dat_description');
    const datVersion = await getMetadata(database, 'dat_version');
    const datDate = await getMetadata(database, 'dat_date');
    const datAuthor = await getMetadata(database, 'dat_author');
    const datHomepage = await getMetadata(database, 'dat_homepage');
    const datUrl = await getMetadata(database, 'dat_url');
    
    const gamesResult: any = await database.get(
      'SELECT COUNT(*) as count FROM games'
    );
    
    const romsResult: any = await database.get(
      'SELECT COUNT(*) as count FROM dat_roms'
    );
    
    const foldersResult: any[] = await database.all(
      `SELECT 
        folder_path,
        (SELECT COUNT(*) FROM scanned_files WHERE folder_id IN 
          (SELECT id FROM scanned_folders WHERE folder_path LIKE sf.folder_path || '%')
        ) as file_count
      FROM scanned_folders sf
      WHERE is_root = 1`
    );

    return {
      datPath: datPath,
      gamesCount: gamesResult?.count || 0,
      romsCount: romsResult?.count || 0,
      folders: foldersResult.map(f => ({
        path: f.folder_path,
        fileCount: f.file_count
      })),
      datInfo: datName ? {
        name: datName,
        description: datDescription,
        version: datVersion,
        date: datDate,
        author: datAuthor,
        homepage: datHomepage,
        url: datUrl
      } : null
    };
  } catch (error) {
    console.error('Erreur lors de la récupération des infos DB:', error);
    return {
      datPath: null,
      gamesCount: 0,
      romsCount: 0,
      folders: [],
      datInfo: null
    };
  }
}
