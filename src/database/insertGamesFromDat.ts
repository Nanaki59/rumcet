// src/database/insertGamesFromDat.ts
import { Database } from './init';
import { parseString } from 'xml2js';
import fs from 'fs/promises';
import path from 'path';

interface RomAttributes {
  name?: string;
  size?: string;
  md5?: string;
  crc?: string;
  sha1?: string;
}

interface GameEntry {
  $?: { name: string };
  description?: string[];
  category?: string[];
  rom?: Array<{ $: RomAttributes }>;
}

interface DatHeader {
  name?: string[];
  description?: string[];
  version?: string[];
  date?: string[];
  author?: string[];
  homepage?: string[];
  url?: string[];
}

interface DatObject {
  datafile?: {
    header?: DatHeader[];
    game?: GameEntry[];
  };
}

export async function parseDatFile(datFilePath: string): Promise<DatObject> {
  const data = await fs.readFile(datFilePath, 'utf8');
  
  return new Promise((resolve, reject) => {
    parseString(data, {
      explicitArray: true,
      mergeAttrs: false
    }, (err, result) => {
      if (err) {
        reject(new Error(`Failed to parse DAT file: ${err.message}`));
      } else {
        resolve(result);
      }
    });
  });
}

export async function insertGamesFromDat(
  db: Database, 
  datObject: DatObject
): Promise<{ gamesCount: number; romsCount: number }> {
  const games = datObject?.datafile?.game || [];
  
  if (!games.length) {
    throw new Error('No games found in DAT file');
  }

  let gamesCount = 0;
  let romsCount = 0;

  // Commencer une transaction
  await db.run('BEGIN TRANSACTION');

  try {
    // Supprimer les anciennes données
    await db.run('DELETE FROM games');

    // Préparer les statements
    const insertGame = db.prepare('INSERT OR REPLACE INTO games (name, description, category) VALUES (?, ?, ?)');
    const getGameId = db.prepare('SELECT id FROM games WHERE name = ?');
    const insertRom = db.prepare(
      'INSERT INTO dat_roms (game_id, name, size, crc32, md5, sha1) VALUES (?, ?, ?, ?, ?, ?)'
    );

    // Insérer les jeux et ROMs
    for (const game of games) {
      const gameName = game.$?.name;
      if (!gameName) continue;

      const description = game.description?.[0] || null;

      const category = game.category?.[0] || null;

      // Promisifier l'insertion du jeu
      await new Promise<void>((resolve, reject) => {
        insertGame.run(gameName, description, category, function(err: Error | null) {
          if (err) reject(err);
          else resolve();
        });
      });
      gamesCount++;

      // Récupérer l'ID du jeu
      const gameId = await new Promise<number>((resolve, reject) => {
        getGameId.get(gameName, (err, row: any) => {
          if (err) reject(err);
          else if (!row?.id) reject(new Error('Game ID not found'));
          else resolve(row.id);
        });
      });

      // Insérer les ROMs
      const roms = game.rom || [];
      for (const rom of roms) {
        const romData = rom.$ || {};
        await new Promise<void>((resolve, reject) => {
          insertRom.run(
            gameId,
            romData.name || null,
            romData.size ? parseInt(romData.size, 10) : null,
            romData.crc || null,
            romData.md5 || null,
            romData.sha1 || null,
            (err: Error | null) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
        romsCount++;
      }
    }

    // Finaliser les statements
    insertGame.finalize();
    getGameId.finalize();
    insertRom.finalize();

    // Commit la transaction
    await db.run('COMMIT');

    console.log(`Imported ${gamesCount} games with ${romsCount} ROMs`);
    
    return { gamesCount, romsCount };

  } catch (error) {
    // Rollback en cas d'erreur
    await db.run('ROLLBACK');
    throw error;
  }
}
