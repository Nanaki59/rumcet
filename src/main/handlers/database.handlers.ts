// src/main/handlers/database.handlers.ts
import { IpcMain, dialog, BrowserWindow, app } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { initDatabase, getMetadata, setMetadata, Database } from '../../database/init.js';
import { databaseService } from '../services/database.service.js';
import {
  settingsManager,
  getEffectiveValidatedRomsFolder,
  DB_FOLDER_METADATA_KEYS,
  loadDbFolderSettings,
  resolveEffectiveFolder,
  EMPTY_DB_FOLDER_SETTINGS
} from '../../helpers/settingsManager.js';
import { detectSystemFromDatName } from '../../config/systems.js';

export interface CreateDatabaseResult {
  success: true;
  dbPath: string;
  gamesCount: number;
  romsCount: number;
  datInfo: {
    name: string;
    description: string;
    version: string;
    date: string;
    author: string;
    homepage: string;
    url: string;
  };
}

/**
 * Cœur partagé de « créer la base + charger le DAT primaire » SANS aucune
 * boîte de dialogue. Utilisé par :
 *  - le handler `database:create` (après ses dialogs Enregistrer-sous/confirmation)
 *  - le flux unifié de l'écran de chargement DAT (`dat-download:load`)
 *
 * Si un fichier existe déjà à dbPath, il est écrasé — la confirmation
 * éventuelle est de la responsabilité de l'appelant.
 */
export async function createDatabaseAndLoadDat(datPath: string, dbPath: string): Promise<CreateDatabaseResult> {
  const { parseDatFile, insertGamesFromDat, extractDatHeader } = await import('../../database/insertGamesFromDat.js');

  let clearExisting = false;
  try {
    await fs.access(dbPath);
    clearExisting = true;
  } catch {
    // Le fichier n'existe pas — création propre
  }

  await databaseService.closeDatabase();

  const database = await initDatabase(dbPath, clearExisting);

  // Charger les données du DAT (rôle primaire)
  const parsed = await parseDatFile(datPath);
  const { gamesCount, romsCount } = await insertGamesFromDat(database, parsed, { sourceFilePath: datPath });

  // Sauvegarder les métadonnées (gère Logiqx + MAME brut)
  await setMetadata(database, 'dat_path', datPath);

  const hdr = extractDatHeader(parsed);
  const fallbackName = path.basename(datPath, path.extname(datPath));
  const lh = parsed.datafile?.header?.[0];
  const datName = hdr.name || fallbackName;
  const datDescription = hdr.description || fallbackName;
  const datVersion = hdr.version || 'N/A';
  const datDate = lh?.date?.[0] || 'N/A';
  const datAuthor = lh?.author?.[0] || 'N/A';
  const datHomepage = lh?.homepage?.[0] || 'N/A';
  const datUrl = lh?.url?.[0] || 'N/A';

  await setMetadata(database, 'dat_name', datName);
  await setMetadata(database, 'dat_description', datDescription);
  await setMetadata(database, 'dat_version', datVersion);
  await setMetadata(database, 'dat_date', datDate);
  await setMetadata(database, 'dat_author', datAuthor);
  await setMetadata(database, 'dat_homepage', datHomepage);
  await setMetadata(database, 'dat_url', datUrl);

  // Détection automatique du système depuis le nom du DAT
  const detectedSystem = detectSystemFromDatName(datName);
  await setMetadata(database, 'system_id', detectedSystem?.systemId ?? '');
  await setMetadata(database, 'system_name', detectedSystem?.fullname ?? '');
  // Synchronise le contexte global (utilisé par ex. par ChdHandler pour le dossier temp)
  settingsManager.setActiveSystemId(detectedSystem?.systemId ?? null);

  databaseService.setDatabase(database);
  databaseService.setDatPath(datPath);
  databaseService.setDbPath(dbPath);
  databaseService.setDatLoaded(true);

  return {
    success: true,
    dbPath,
    gamesCount,
    romsCount,
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
}

/** Dossiers d'une base tels que saisis par l'utilisateur (vide = paramètre global). */
export interface DbFolderInput {
  targetFolder: string;
  targetSystemSubfolder: boolean;
  unmatchedFolder?: string;
  incompleteFolder?: string;
  tempFolder?: string;
}

/**
 * Enregistre les dossiers propres à une base dans ses métadonnées et retourne
 * le dossier cible effectif (avant/après). `target_folder` reçoit le chemin effectif
 * (affichage de la sidebar, rétrocompatibilité).
 */
export async function saveDbFolderSettings(
  database: Database,
  input: DbFolderInput
): Promise<{ previousTarget: string; target: string }> {
  const systemId = await getMetadata(database, 'system_id');
  const previousTarget = resolveEffectiveFolder('validatedRomsFolder', await loadDbFolderSettings(database), systemId);

  const setOrClear = async (key: string, value: string | undefined) => {
    const trimmed = (value || '').trim();
    if (trimmed) await setMetadata(database, key, trimmed);
    else await database.run('DELETE FROM metadata WHERE key = ?', [key]);
  };
  await setOrClear('target_folder_base', input.targetFolder);
  await setMetadata(database, 'target_system_subfolder', input.targetSystemSubfolder ? '1' : '0');
  await setOrClear('unmatched_folder', input.unmatchedFolder);
  await setOrClear('incomplete_folder', input.incompleteFolder);
  await setOrClear('temp_folder', input.tempFolder);

  const dbFolders = await loadDbFolderSettings(database);
  // Sans dossier cible saisi, l'ancien `target_folder` ne doit pas masquer le paramètre global
  const target = resolveEffectiveFolder('validatedRomsFolder', { ...dbFolders, targetFolderLegacy: null }, systemId);
  await setOrClear('target_folder', target);
  if (target) await fs.mkdir(target, { recursive: true });

  if (databaseService.getDatabase() === database) {
    await databaseService.refreshFolders();
  }
  return { previousTarget, target };
}

export function registerDatabaseHandlers(ipcMain: IpcMain, mainWindow: BrowserWindow) {
  
  // Créer une base de données et charger les données du DAT (flux avec dialogs).
  // Conservé pour compatibilité (menu / anciens flux) — le cœur est partagé
  // avec le flux unifié via createDatabaseAndLoadDat().
  ipcMain.handle('database:create', async (_event, datPath: string, _clearExisting: boolean = false) => {
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
      }

      return await createDatabaseAndLoadDat(datPath, result.filePath);
    } catch (error) {
      console.error('Error while creating the database: ', error);
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

      // Synchronise le contexte système (utilisé par ChdHandler etc. pour le dossier multi-système)
      const systemIdMeta = await getMetadata(database, 'system_id');
      settingsManager.setActiveSystemId(systemIdMeta || null);

      return {
        success: true,
        dbPath: dbPath,
        datPath: dbInfo.datPath,
        gamesCount: dbInfo.gamesCount,
        romsCount: dbInfo.romsCount,
        hasMatching: dbInfo.hasMatching,
        folders: dbInfo.folders,
        datInfo: dbInfo.datInfo
      };
    } catch (error) {
      console.error('Error while opening the database:', error);
      databaseService.reset();
      throw error;
    }
  });

  // Fermer la base de données
  ipcMain.handle('database:close', async () => {
    const currentDb = databaseService.getDatabase();
    if (currentDb) {
      await databaseService.closeDatabase();
      // Réinitialiser le contexte système actif
      settingsManager.setActiveSystemId(null);
      return true;
    }
    return false;
  });

  // Lire une métadonnée de la base
  ipcMain.handle('database:get-metadata', async (_event, key: string) => {
    const database = databaseService.getDatabase();
    if (!database) return null;
    return getMetadata(database, key);
  });

  // Écrire une métadonnée dans la base
  ipcMain.handle('database:set-metadata', async (_event, key: string, value: string) => {
    const database = databaseService.getDatabase();
    if (!database) throw new Error('Aucune base de données active.');
    await setMetadata(database, key, value);
    // Si on met à jour system_id (typiquement via la modale de sélection manuelle),
    // synchroniser le contexte global pour les composants bas niveau (ChdHandler, etc.)
    if (key === 'system_id') {
      settingsManager.setActiveSystemId(value || null);
    }
    if (DB_FOLDER_METADATA_KEYS.includes(key)) {
      await databaseService.refreshFolders();
    }
  });

  // Dossiers de la base active (valeurs saisies + effectives) et paramètres globaux.
  // Sans base ouverte, seuls les paramètres globaux sont renseignés (écran de chargement DAT).
  ipcMain.handle('database:get-folder-settings', async () => {
    const settings = settingsManager.getAll();
    const database = databaseService.getDatabase();
    const dbFolders = database ? await loadDbFolderSettings(database) : { ...EMPTY_DB_FOLDER_SETTINGS };
    const systemId = database ? await getMetadata(database, 'system_id') : null;
    return {
      dbOpen: !!database,
      systemId,
      // Valeur affichée dans le champ « Dossier cible » : le dossier saisi pour cette
      // base, à défaut le dossier cible courant (bases antérieures), sinon le paramètre global.
      targetFolder: dbFolders.targetFolderBase || dbFolders.targetFolderLegacy || settings.validatedRomsFolder || '',
      targetSystemSubfolder: dbFolders.targetFolderBase
        ? (dbFolders.systemSubfolder ?? !!settings.validatedRomsMultiSystem)
        : (dbFolders.targetFolderLegacy ? false : !!settings.validatedRomsMultiSystem),
      unmatchedFolder: dbFolders.unmatchedFolder || '',
      incompleteFolder: dbFolders.incompleteFolder || '',
      tempFolder: dbFolders.tempFolder || '',
      effectiveTarget: resolveEffectiveFolder('validatedRomsFolder', dbFolders, systemId),
      effectiveUnmatched: resolveEffectiveFolder('unmatchedRomsFolder', dbFolders, systemId),
      globals: {
        validatedRomsFolder: settings.validatedRomsFolder || '',
        validatedRomsMultiSystem: !!settings.validatedRomsMultiSystem,
        unmatchedRomsFolder: settings.unmatchedRomsFolder || '',
        incompleteRomsFolder: settings.incompleteRomsFolder || '',
        tempExtractionFolder: settings.tempExtractionFolder || ''
      }
    };
  });

  // Enregistre les dossiers de la base active ; retourne l'ancien et le nouveau dossier cible effectif
  ipcMain.handle('database:set-folder-settings', async (_event, input: DbFolderInput) => {
    const database = databaseService.getDatabase();
    if (!database) throw new Error('Aucune base de données active.');
    return saveDbFolderSettings(database, input);
  });

  // Retourne le dossier cible effectif (avec sous-dossier système si mode multi-système)
  ipcMain.handle('database:get-effective-validated-folder', async () => {
    const database = databaseService.getDatabase();
    if (!database) return settingsManager.get('validatedRomsFolder');
    return getEffectiveValidatedRomsFolder(database);
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
      const result = await insertGamesFromDat(database, parsed, { sourceFilePath: datPath });

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
      console.error('Error while creating the database:', error);
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
        ) as file_count,
        scan_status
      FROM scanned_folders sf
      WHERE is_root = 1`
    );

    // Vérifier si le matching a déjà été effectué
    const matchesResult: any = await database.get(
      'SELECT COUNT(*) as count FROM rom_matches'
    );
    const hasMatching = matchesResult?.count > 0;

    return {
      datPath: datPath,
      gamesCount: gamesResult?.count || 0,
      romsCount: romsResult?.count || 0,
      hasMatching: hasMatching,
      folders: foldersResult.map(f => ({
        path: f.folder_path,
        fileCount: f.file_count,
        scanStatus: f.scan_status || 'complete'
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
    console.error('Error while retrieving DB info:', error);
    return {
      datPath: null,
      gamesCount: 0,
      romsCount: 0,
      hasMatching: false,
      folders: [],
      datInfo: null
    };
  }
}
