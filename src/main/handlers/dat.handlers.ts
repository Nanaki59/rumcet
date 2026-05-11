// src/main/handlers/dat.handlers.ts
import { IpcMain, dialog, BrowserWindow } from 'electron';
import { parseDatFile, insertGamesFromDat } from '../../database/insertGamesFromDat.js';
import { setMetadata, getMetadata, Database } from '../../database/init.js';
import { databaseService } from '../services/database.service.js';
import { settingsManager } from '../../helpers/settingsManager.js';
import { detectSystemFromDatName } from '../../config/systems.js';
import path from 'path';

/**
 * Détecte le système à partir du nom du DAT et persiste system_id + system_name en metadata.
 * Si la détection échoue, system_id est mis à chaîne vide pour signaler "à choisir manuellement".
 */
async function detectAndStoreSystem(database: Database, datName: string): Promise<void> {
  const sys = detectSystemFromDatName(datName);
  if (sys) {
    await setMetadata(database, 'system_id', sys.systemId);
    await setMetadata(database, 'system_name', sys.fullname);
    settingsManager.setActiveSystemId(sys.systemId);
  } else {
    await setMetadata(database, 'system_id', '');
    await setMetadata(database, 'system_name', '');
    settingsManager.setActiveSystemId(null);
  }
}

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

      // Détection automatique du système depuis le nom du DAT
      await detectAndStoreSystem(database, datName);

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

  // Mettre à jour le DAT : snapshot ancien, import nouveau, comparaison
  ipcMain.handle('dat:update', async () => {
    const database = databaseService.getDatabase();
    const dbPath = databaseService.getDbPath();
    if (!database || !dbPath) {
      throw new Error('Aucune base de données active.');
    }

    // 1. Sélectionner le nouveau fichier DAT
    const defaultPath = settingsManager.get('defaultDatFolder');
    const fileResult = await dialog.showOpenDialog(mainWindow, {
      title: 'Sélectionner le nouveau fichier DAT/XML',
      defaultPath,
      filters: [
        { name: 'Fichiers DAT/XML', extensions: ['dat', 'xml'] },
        { name: 'Tous les fichiers', extensions: ['*'] }
      ],
      properties: ['openFile']
    });

    if (fileResult.canceled || !fileResult.filePaths?.length) {
      return null;
    }

    const newDatPath = fileResult.filePaths[0];

    // Récupérer l'ancienne version pour les métadonnées
    const oldVersion = await getMetadata(database, 'dat_version') || 'N/A';
    const oldName = await getMetadata(database, 'dat_name') || 'N/A';

    // 1.bis Vérification de cohérence système : parser le DAT à l'avance pour extraire le nom
    // et comparer le système détecté avec celui actuellement enregistré en metadata.
    const previewParsed = await parseDatFile(newDatPath);
    const previewHeader = previewParsed.datafile?.header?.[0];
    const previewDatName = previewHeader?.name?.[0] || path.basename(newDatPath, path.extname(newDatPath));
    const newDatSystem = detectSystemFromDatName(previewDatName);
    const currentSystemId = (await getMetadata(database, 'system_id')) || '';

    if (currentSystemId && newDatSystem && newDatSystem.systemId !== currentSystemId) {
      const currentSystemName = (await getMetadata(database, 'system_name')) || currentSystemId;
      await dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Incompatibilité de système',
        message: 'Mise à jour du DAT annulée',
        detail:
          `Le DAT sélectionné est de type "${newDatSystem.fullname}" (${newDatSystem.systemId}), ` +
          `incompatible avec la base actuelle "${currentSystemName}" (${currentSystemId}).\n\n` +
          `Aucune modification n'a été effectuée.`,
        buttons: ['OK'],
        defaultId: 0
      });
      return null;
    }

    // 2. Snapshot : copier games + dat_roms dans les tables _previous
    await database.exec(`
      DELETE FROM games_previous;
      DELETE FROM dat_roms_previous;
      INSERT INTO games_previous (id, name, description, category, is_selected)
        SELECT id, name, description, category, is_selected FROM games;
      INSERT INTO dat_roms_previous (id, game_id, name, size, crc32, md5, sha1)
        SELECT id, game_id, name, size, crc32, md5, sha1 FROM dat_roms;
    `);

    // 3. Importer le nouveau DAT (insertGamesFromDat préserve les sélections)
    const parsed = previewParsed;
    const { gamesCount, romsCount } = await insertGamesFromDat(database, parsed);

    // 4. Sauvegarder les nouvelles métadonnées
    const header = parsed.datafile?.header?.[0];
    const datName = header?.name?.[0] || path.basename(newDatPath, path.extname(newDatPath));
    const datDescription = header?.description?.[0] || path.basename(newDatPath, path.extname(newDatPath));
    const datVersion = header?.version?.[0] || 'N/A';
    const datDate = header?.date?.[0] || 'N/A';
    const datAuthor = header?.author?.[0] || 'N/A';
    const datHomepage = header?.homepage?.[0] || 'N/A';
    const datUrl = header?.url?.[0] || 'N/A';

    await setMetadata(database, 'dat_path', newDatPath);
    await setMetadata(database, 'dat_name', datName);
    await setMetadata(database, 'dat_description', datDescription);
    await setMetadata(database, 'dat_version', datVersion);
    await setMetadata(database, 'dat_date', datDate);
    await setMetadata(database, 'dat_author', datAuthor);
    await setMetadata(database, 'dat_homepage', datHomepage);
    await setMetadata(database, 'dat_url', datUrl);
    await setMetadata(database, 'dat_previous_version', oldVersion);
    await setMetadata(database, 'dat_previous_name', oldName);

    // Si l'ancien système n'avait pas été défini (chaîne vide) et que le nouveau DAT
    // a permis une détection, on enregistre. Sinon on conserve la valeur actuelle.
    if (!currentSystemId && newDatSystem) {
      await setMetadata(database, 'system_id', newDatSystem.systemId);
      await setMetadata(database, 'system_name', newDatSystem.fullname);
    }

    databaseService.setDatPath(newDatPath);
    databaseService.setDatLoaded(true);

    // 5. Comparer et définir change_status sur chaque jeu
    // Jeux nouveaux : présents dans games mais pas dans games_previous
    await database.run(`
      UPDATE games SET change_status = 'new'
      WHERE name NOT IN (SELECT name FROM games_previous)
    `);

    // Jeux inchangés : même nom ET mêmes ROMs (noms + checksums identiques)
    // Stratégie : comparer un hash agrégé des ROMs pour chaque jeu
    await database.run(`
      UPDATE games SET change_status = 'unchanged'
      WHERE name IN (SELECT name FROM games_previous)
      AND (
        SELECT GROUP_CONCAT(name || '|' || COALESCE(size,'') || '|' || COALESCE(crc32,'') || '|' || COALESCE(md5,'') || '|' || COALESCE(sha1,''), ';')
        FROM dat_roms WHERE game_id = games.id ORDER BY name
      ) = (
        SELECT GROUP_CONCAT(dr.name || '|' || COALESCE(dr.size,'') || '|' || COALESCE(dr.crc32,'') || '|' || COALESCE(dr.md5,'') || '|' || COALESCE(dr.sha1,''), ';')
        FROM dat_roms_previous dr
        INNER JOIN games_previous gp ON dr.game_id = gp.id
        WHERE gp.name = games.name ORDER BY dr.name
      )
    `);

    // Jeux modifiés : présents dans les deux mais ROMs différentes
    await database.run(`
      UPDATE games SET change_status = 'modified'
      WHERE name IN (SELECT name FROM games_previous)
      AND change_status IS NULL
    `);

    // 5b. Détection des jeux renommés : rapprocher les "nouveaux" des "disparus"
    // en comparant leurs ROMs (noms de fichiers et CRC32).
    // Si ≥ 50 % des ROMs correspondent, le jeu est considéré comme modifié (renommé).
    const newGames = await database.all<{ id: number; name: string }>(`
      SELECT id, name FROM games WHERE change_status = 'new'
    `);
    const disappearedPrev = await database.all<{ id: number; name: string }>(`
      SELECT id, name FROM games_previous
      WHERE name NOT IN (SELECT name FROM games)
    `);

    if (newGames.length > 0 && disappearedPrev.length > 0) {
      // Charger les ROMs (noms + CRC) pour chaque jeu "nouveau" et chaque jeu "disparu"
      const newGameRoms = new Map<number, { names: Set<string>; crcs: Set<string> }>();
      for (const g of newGames) {
        const roms = await database.all<{ name: string; crc32: string | null }>(
          'SELECT name, crc32 FROM dat_roms WHERE game_id = ?', [g.id]
        );
        newGameRoms.set(g.id, {
          names: new Set(roms.map(r => r.name)),
          crcs: new Set(roms.filter(r => r.crc32).map(r => r.crc32!))
        });
      }

      const prevGameRoms = new Map<number, { names: Set<string>; crcs: Set<string> }>();
      for (const g of disappearedPrev) {
        const roms = await database.all<{ name: string; crc32: string | null }>(
          'SELECT name, crc32 FROM dat_roms_previous WHERE game_id = ?', [g.id]
        );
        prevGameRoms.set(g.id, {
          names: new Set(roms.map(r => r.name)),
          crcs: new Set(roms.filter(r => r.crc32).map(r => r.crc32!))
        });
      }

      // Pour chaque jeu "nouveau", chercher le meilleur candidat "disparu"
      const matchedPrevIds = new Set<number>();

      for (const newGame of newGames) {
        const newRoms = newGameRoms.get(newGame.id)!;
        let bestPrev: { id: number; name: string; score: number } | null = null;

        for (const prevGame of disappearedPrev) {
          if (matchedPrevIds.has(prevGame.id)) continue;
          const prevRoms = prevGameRoms.get(prevGame.id)!;

          // Compter les correspondances par nom de fichier et par CRC32
          let nameOverlap = 0;
          for (const n of newRoms.names) { if (prevRoms.names.has(n)) nameOverlap++; }
          let crcOverlap = 0;
          for (const c of newRoms.crcs) { if (prevRoms.crcs.has(c)) crcOverlap++; }

          const maxOverlap = Math.max(nameOverlap, crcOverlap);
          const minRomCount = Math.min(newRoms.names.size, prevRoms.names.size);

          // Seuil : au moins 50 % des ROMs du plus petit ensemble doivent matcher
          if (minRomCount > 0 && maxOverlap >= Math.ceil(minRomCount / 2)) {
            const score = maxOverlap / minRomCount;
            if (!bestPrev || score > bestPrev.score) {
              bestPrev = { id: prevGame.id, name: prevGame.name, score };
            }
          }
        }

        if (bestPrev) {
          matchedPrevIds.add(bestPrev.id);
          // Marquer le jeu "nouveau" comme "modifié" (il a été renommé + éventuellement modifié)
          await database.run('UPDATE games SET change_status = \'modified\' WHERE id = ?', [newGame.id]);
          // Renommer l'entrée dans games_previous pour que le diff fonctionne
          await database.run('UPDATE games_previous SET name = ? WHERE id = ?', [newGame.name, bestPrev.id]);
          // Transférer la sélection de l'ancien jeu (sélectionné ou non)
          const prevSelected = await database.get<{ is_selected: number }>(
            'SELECT is_selected FROM games_previous WHERE id = ?', [bestPrev.id]
          );
          if (prevSelected) {
            await database.run('UPDATE games SET is_selected = ? WHERE id = ?', [prevSelected.is_selected, newGame.id]);
          }
          console.log(`[DAT Update] Jeu renommé détecté : "${bestPrev.name}" → "${newGame.name}"`);
        }
      }
    }

    // 5c. Appliquer le paramètre de sélection automatique des nouveaux jeux
    const autoSelectNewGames = settingsManager.get('autoSelectNewGames');
    if (autoSelectNewGames === false) {
      await database.run(`UPDATE games SET is_selected = 0 WHERE change_status = 'new'`);
    }

    // 6. Invalider le matching existant (les dat_rom_id ont changé)
    await database.run('DELETE FROM rom_matches');

    // 7. Calculer les statistiques
    const stats = await database.get<{ new_count: number, modified_count: number, unchanged_count: number }>(`
      SELECT
        SUM(CASE WHEN change_status = 'new' THEN 1 ELSE 0 END) as new_count,
        SUM(CASE WHEN change_status = 'modified' THEN 1 ELSE 0 END) as modified_count,
        SUM(CASE WHEN change_status = 'unchanged' THEN 1 ELSE 0 END) as unchanged_count
      FROM games
    `);

    // Jeux disparus : dans games_previous mais pas dans games
    const disappeared = await database.all<{ name: string, description: string, category: string }>(`
      SELECT name, description, category FROM games_previous
      WHERE name NOT IN (SELECT name FROM games)
    `);

    return {
      success: true,
      gamesCount,
      romsCount,
      datInfo: {
        name: datName, description: datDescription, version: datVersion,
        date: datDate, author: datAuthor, homepage: datHomepage, url: datUrl
      },
      previousVersion: oldVersion,
      previousName: oldName,
      comparison: {
        newGames: stats?.new_count || 0,
        modifiedGames: stats?.modified_count || 0,
        unchangedGames: stats?.unchanged_count || 0,
        disappearedGames: disappeared.length,
        disappeared
      }
    };
  });

  // Obtenir le détail des changements de ROMs pour un jeu modifié
  ipcMain.handle('dat:get-game-diff', async (_event, gameName: string) => {
    const database = databaseService.getDatabase();
    if (!database) throw new Error('Aucune base de données active.');

    // ROMs de la nouvelle version
    const newRoms = await database.all<{ name: string, size: number, crc32: string, md5: string, sha1: string }>(`
      SELECT dr.name, dr.size, dr.crc32, dr.md5, dr.sha1
      FROM dat_roms dr
      INNER JOIN games g ON dr.game_id = g.id
      WHERE g.name = ?
      ORDER BY dr.name
    `, [gameName]);

    // ROMs de l'ancienne version
    const oldRoms = await database.all<{ name: string, size: number, crc32: string, md5: string, sha1: string }>(`
      SELECT dr.name, dr.size, dr.crc32, dr.md5, dr.sha1
      FROM dat_roms_previous dr
      INNER JOIN games_previous gp ON dr.game_id = gp.id
      WHERE gp.name = ?
      ORDER BY dr.name
    `, [gameName]);

    const oldMap = new Map(oldRoms.map(r => [r.name, r]));
    const newMap = new Map(newRoms.map(r => [r.name, r]));

    const added: typeof newRoms = [];
    const removed: typeof oldRoms = [];
    const changed: { name: string, old: typeof oldRoms[0], new: typeof newRoms[0] }[] = [];

    // ROMs ajoutées ou modifiées
    for (const rom of newRoms) {
      const old = oldMap.get(rom.name);
      if (!old) {
        added.push(rom);
      } else if (old.crc32 !== rom.crc32 || old.md5 !== rom.md5 || old.sha1 !== rom.sha1 || old.size !== rom.size) {
        changed.push({ name: rom.name, old, new: rom });
      }
    }

    // ROMs supprimées
    for (const rom of oldRoms) {
      if (!newMap.has(rom.name)) {
        removed.push(rom);
      }
    }

    return { added, removed, changed };
  });

  // Reconstruire le rapport de la dernière mise à jour DAT depuis les données en base.
  // Retourne null s'il n'y a pas eu de mise à jour (pas de snapshot en base).
  ipcMain.handle('dat:get-update-report', async () => {
    const database = databaseService.getDatabase();
    if (!database) throw new Error('Aucune base de données active.');

    // Vérifier qu'une mise à jour a bien eu lieu (présence de la métadonnée)
    const previousVersion = await getMetadata(database, 'dat_previous_version');
    const previousName = await getMetadata(database, 'dat_previous_name');
    if (!previousVersion || !previousName) {
      return null;
    }

    // Récupérer les métadonnées du DAT actuel
    const datName = await getMetadata(database, 'dat_name') || 'N/A';
    const datDescription = await getMetadata(database, 'dat_description') || 'N/A';
    const datVersion = await getMetadata(database, 'dat_version') || 'N/A';
    const datDate = await getMetadata(database, 'dat_date') || 'N/A';
    const datAuthor = await getMetadata(database, 'dat_author') || 'N/A';
    const datHomepage = await getMetadata(database, 'dat_homepage') || 'N/A';
    const datUrl = await getMetadata(database, 'dat_url') || 'N/A';

    // Statistiques sur les change_status
    const stats = await database.get<{ new_count: number, modified_count: number, unchanged_count: number }>(`
      SELECT
        SUM(CASE WHEN change_status = 'new' THEN 1 ELSE 0 END) as new_count,
        SUM(CASE WHEN change_status = 'modified' THEN 1 ELSE 0 END) as modified_count,
        SUM(CASE WHEN change_status = 'unchanged' THEN 1 ELSE 0 END) as unchanged_count
      FROM games
    `);

    // Jeux disparus
    const disappeared = await database.all<{ name: string, description: string, category: string }>(`
      SELECT name, description, category FROM games_previous
      WHERE name NOT IN (SELECT name FROM games)
      ORDER BY name
    `);

    return {
      success: true,
      datInfo: {
        name: datName, description: datDescription, version: datVersion,
        date: datDate, author: datAuthor, homepage: datHomepage, url: datUrl
      },
      previousVersion,
      previousName,
      comparison: {
        newGames: stats?.new_count || 0,
        modifiedGames: stats?.modified_count || 0,
        unchangedGames: stats?.unchanged_count || 0,
        disappearedGames: disappeared.length,
        disappeared
      }
    };
  });

  // Obtenir les jeux disparus depuis la dernière mise à jour
  ipcMain.handle('dat:get-disappeared-games', async () => {
    const database = databaseService.getDatabase();
    if (!database) throw new Error('Aucune base de données active.');

    const games = await database.all<{ id: number, name: string, description: string, category: string, is_selected: number }>(`
      SELECT id, name, description, category, is_selected FROM games_previous
      WHERE name NOT IN (SELECT name FROM games)
      ORDER BY name
    `);

    // Pour chaque jeu disparu, récupérer ses ROMs
    const result = [];
    for (const game of games) {
      const roms = await database.all<{ name: string, size: number, crc32: string }>(`
        SELECT dr.name, dr.size, dr.crc32
        FROM dat_roms_previous dr
        INNER JOIN games_previous gp ON dr.game_id = gp.id
        WHERE gp.name = ?
      `, [game.name]);
      result.push({ ...game, roms });
    }

    return result;
  });
}
