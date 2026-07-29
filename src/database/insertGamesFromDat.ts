// src/database/insertGamesFromDat.ts

import { Database, setMetadata } from './init.js';
import { parseString } from 'xml2js';
import fs from 'fs/promises';

interface RomAttributes {
  name?: string;
  size?: string;
  md5?: string;
  crc?: string;
  sha1?: string;
  /** Attribut <rom merge="..."> : indique que cette ROM est identique à une ROM nommée X dans le parent. */
  merge?: string;
}

interface DiskAttributes {
  name?: string;
  sha1?: string;
  /** Les disks n'ont pas de crc32/md5/size dans les DAT MAME, uniquement sha1. */
}

interface DeviceRefAttributes {
  name?: string;
}

interface DriverAttributes {
  /** MAME : statut global du driver. 'good' | 'imperfect' | 'preliminary'. */
  status?: string;
}

interface GameEntry {
  $?: {
    name: string;
    /** MAME : parent logique (variante régionale, hack…). Pointe sur le name d'une autre <machine>. */
    cloneof?: string;
    /** MAME : parent technique des ROMs (souvent = cloneof, sauf pour BIOS partagés). */
    romof?: string;
    /** MAME : 'yes' si la machine est un set BIOS (non jouable). */
    isbios?: string;
    /** MAME : 'yes' si la machine est un device matériel partagé (non jouable). */
    isdevice?: string;
    /** MAME : 'yes' si la machine est électromécanique (flipper, machine à sous… — non jouable au pad). */
    ismechanical?: string;
  };
  description?: string[];
  category?: string[];
  /** MAME : <manufacturer> au niveau de <machine>. Utilisé en fallback de category. */
  manufacturer?: string[];
  rom?: Array<{ $: RomAttributes }>;
  /** MAME : <disk> pour les CHD (Naomi GD-ROM, Chihiro…). */
  disk?: Array<{ $: DiskAttributes }>;
  /** MAME : <device_ref name="..."> — dépendances vers d'autres machines (cartes mère, sous-systèmes). */
  device_ref?: Array<{ $: DeviceRefAttributes }>;
  /** MAME : <driver status="good|imperfect|preliminary"/> — qualité d'émulation globale. */
  driver?: Array<{ $: DriverAttributes }>;
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
  /** Racine des DAT format Logiqx/CMPro (No-Intro, Redump, Progettosnaps, Pleasuredome). */
  datafile?: {
    header?: DatHeader[];
    game?: GameEntry[];
    /** MAME utilise <machine> au lieu de <game>. Même structure interne. */
    machine?: GameEntry[];
  };
  /**
   * Racine de la sortie native `mame -listxml` (DAT MAMEDev brut, ex. mame0288.xml).
   * Pas de <header>, attributs `build` et `debug` sur <mame> directement.
   */
  mame?: {
    machine?: GameEntry[];
  };
}

/** Modes possibles d'un DAT arcade. 'n/a' = DAT non arcade (No-Intro/Redump). */
export type DatSetMode = 'split' | 'non-merged' | 'merged' | 'unknown' | 'n/a';

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

/**
 * Extrait les méta-informations du DAT (name, description, version) en gérant
 * les deux formats : Logiqx/CMPro (<datafile><header>) et MAME brut (<mame> avec
 * attributs build/debug). Retourne des champs vides si non disponibles ; les
 * appelants doivent prévoir leur propre fallback (typiquement nom de fichier).
 */
export function extractDatHeader(parsed: DatObject): {
  name: string;
  description: string;
  version: string;
} {
  const lh = parsed.datafile?.header?.[0];
  if (lh) {
    return {
      name: lh.name?.[0] || '',
      description: lh.description?.[0] || '',
      version: lh.version?.[0] || ''
    };
  }
  const mameRoot = parsed.mame as any;
  if (mameRoot) {
    const build = mameRoot.$?.build || '';
    return {
      name: build ? `MAME ${build}` : '',
      description: build ? `MAME ${build} (listxml)` : '',
      version: build
    };
  }
  return { name: '', description: '', version: '' };
}

/**
 * Heuristique de détection du mode d'un DAT arcade.
 *
 * Règles (par ordre de priorité) :
 *  - 'split'      : au moins une <rom> a un attribut merge="..."
 *  - 'merged'     : aucune merge, ET les clones n'ont aucune <rom>/<disk>
 *  - 'non-merged' : aucune merge, ET les clones ont leurs propres <rom>/<disk>
 *  - fallback     : si aucun cloneof n'est présent (cas des DAT Pleasuredome qui
 *                   strippent les attributs relationnels), on essaie de deviner
 *                   le mode depuis le nom du header (ex: "MAME ROMs (split)").
 *  - 'unknown'    : impossible à déterminer.
 *  - 'n/a'        : aucune balise typiquement arcade.
 */
function detectDatSetMode(games: GameEntry[], headerName: string = ''): { mode: DatSetMode; inferredFromHeader: boolean } {
  let hasMerge = false;
  let hasArcadeMarkers = false;
  let clonesWithRoms = 0;
  let clonesWithoutRoms = 0;

  for (const g of games) {
    const cloneof = g.$?.cloneof;
    const romof = g.$?.romof;
    const isbios = g.$?.isbios === 'yes';
    const isdevice = g.$?.isdevice === 'yes';

    if (cloneof || romof || isbios || isdevice || (g.device_ref && g.device_ref.length > 0)) {
      hasArcadeMarkers = true;
    }

    for (const rom of g.rom || []) {
      if (rom.$?.merge) {
        hasMerge = true;
      }
    }

    if (cloneof) {
      const romCount = (g.rom?.length || 0) + (g.disk?.length || 0);
      if (romCount > 0) clonesWithRoms++;
      else clonesWithoutRoms++;
    }
  }

  if (!hasArcadeMarkers) return { mode: 'n/a', inferredFromHeader: false };
  if (hasMerge) return { mode: 'split', inferredFromHeader: false };
  if (clonesWithRoms === 0 && clonesWithoutRoms === 0) {
    // Aucun cloneof dans le DAT → Pleasuredome ou variantes strippées.
    // Fallback : lire le mode depuis le nom du header (ordre IMPORTANT :
    // tester 'non-merged' avant 'merged' car la sous-chaîne 'merged' est commune).
    const lower = headerName.toLowerCase();
    if (lower.includes('non-merged') || lower.includes('non merged')) return { mode: 'non-merged', inferredFromHeader: true };
    if (lower.includes('merged')) return { mode: 'merged', inferredFromHeader: true };
    if (lower.includes('split')) return { mode: 'split', inferredFromHeader: true };
    return { mode: 'unknown', inferredFromHeader: false };
  }
  if (clonesWithoutRoms > clonesWithRoms) return { mode: 'merged', inferredFromHeader: false };
  return { mode: 'non-merged', inferredFromHeader: false };
}

/**
 * Insère les jeux et leurs ROMs/disks depuis le DAT.
 * Pour les DAT arcade (MAME), gère également :
 *  - cloneof / romof / device_ref → table game_relationships (2e passe)
 *  - <rom merge="..."> → colonne dat_roms.merge_name
 *  - <disk> → colonne dat_roms.is_disk = 1
 *  - isbios / isdevice → colonnes games.is_bios / games.is_device
 *  - mode du DAT (split / non-merged / merged) → metadata.dat_set_mode
 */
export interface InsertGamesOptions {
  /**
   * Phase 9 — Rôle du DAT chargé.
   *  - 'primary'      : remplace intégralement la DB (comportement historique).
   *  - 'complementary': fusion. Les jeux/ROMs existants sont préservés, seuls
   *    les nouveaux jeux et les ROMs manquantes des jeux existants sont ajoutés.
   */
  role?: 'primary' | 'complementary';
  /** Chemin du fichier DAT source, stocké dans dat_sources pour traçabilité. */
  sourceFilePath?: string;
}

export async function insertGamesFromDat(
  db: Database,
  datObject: DatObject,
  options: InsertGamesOptions = {}
): Promise<{ gamesCount: number; romsCount: number; relationshipsCount: number; disksCount: number; datSetMode: DatSetMode; sourceId: number }> {
  const role: 'primary' | 'complementary' = options.role || 'primary';
  const isComplementary = role === 'complementary';

  // Les DAT No-Intro/Redump utilisent <game>, les DAT MAME Logiqx (Progettosnaps,
  // Pleasuredome) utilisent <machine> sous <datafile>, et la sortie brute
  // `mame -listxml` (DAT MAMEDev) utilise <machine> sous <mame>.
  const games = [
    ...(datObject?.datafile?.game || []),
    ...(datObject?.datafile?.machine || []),
    ...(datObject?.mame?.machine || [])
  ];

  if (!games.length) {
    throw new Error('No games found in DAT file');
  }

  let gamesCount = 0;
  let romsCount = 0;
  let disksCount = 0;
  let relationshipsCount = 0;

  // Détection du mode DAT avant l'insertion (ne nécessite pas la DB).
  // Le nom du header sert de fallback quand le DAT a été strippé de ses
  // attributs relationnels (cas Pleasuredome).
  const hdr = extractDatHeader(datObject);
  const { mode: datSetMode, inferredFromHeader: datModeInferred } = detectDatSetMode(games, hdr.name);

  await db.run('BEGIN TRANSACTION');

  try {
    // Phase 9 — Enregistrer la source DAT. Le primaire nettoie les sources
    // précédentes (comme il nettoie les jeux) ; le complémentaire s'ajoute.
    if (!isComplementary) {
      await db.run('DELETE FROM dat_sources');
    }
    const sourceResult = await db.run(
      `INSERT INTO dat_sources (file_path, role, dat_name, dat_description, dat_version, dat_set_mode)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [options.sourceFilePath || null, role, hdr.name || null, hdr.description || null, hdr.version || null, datSetMode]
    );
    const sourceId = sourceResult.lastID;

    // Sauvegarder les sélections existantes avant suppression (primaire uniquement)
    const existingSelections = new Map<string, number>();
    if (!isComplementary) {
      const existingGames = await db.all<{ name: string; is_selected: number }>('SELECT name, is_selected FROM games');
      for (const g of existingGames) {
        existingSelections.set(g.name, g.is_selected);
      }

      // Supprimer les anciennes données (cascade : dat_roms, game_relationships)
      await db.run('DELETE FROM games');
    }

    // Préparer les statements. En complémentaire on ne veut pas écraser les jeux
    // existants — INSERT OR IGNORE + SELECT pour récupérer l'ID (nouveau ou existant).
    // Pour les ROMs, on vérifie l'unicité par (game_id, name) avant d'insérer.
    const insertGame = db.prepare(
      isComplementary
        ? `INSERT OR IGNORE INTO games
           (name, description, category, is_selected, is_bios, is_device, is_mechanical, parent_name_ref, cloneof_ref, romof_ref, driver_status, source_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        : `INSERT OR REPLACE INTO games
           (name, description, category, is_selected, is_bios, is_device, is_mechanical, parent_name_ref, cloneof_ref, romof_ref, driver_status, source_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const getGameId = db.prepare('SELECT id FROM games WHERE name = ?');
    const insertRom = db.prepare(
      'INSERT INTO dat_roms (game_id, name, size, crc32, md5, sha1, merge_name, is_disk, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    // Complémentaire : vérifier l'existence d'une dat_rom par (game_id, name)
    // pour ne pas dupliquer les entrées quand un jeu existe déjà.
    const romExists = isComplementary
      ? db.prepare('SELECT 1 FROM dat_roms WHERE game_id = ? AND name = ? LIMIT 1')
      : null;

    // Mémoire pour la 2e passe (résolution des relations)
    interface PendingRelation {
      childGameId: number;
      parentName: string;
      type: 'cloneof' | 'romof' | 'device_ref';
    }
    const pendingRelations: PendingRelation[] = [];

    // ── 1ère passe : insertion des jeux + ROMs + disks ──
    for (const game of games) {
      const gameName = game.$?.name;
      if (!gameName) continue;

      const description = game.description?.[0] || null;
      // category : <category> (No-Intro/Redump) ou fallback <manufacturer> (MAME)
      const category = game.category?.[0] || game.manufacturer?.[0] || null;

      const cloneof = game.$?.cloneof || null;
      const romof = game.$?.romof || null;
      const isBios = game.$?.isbios === 'yes' ? 1 : 0;
      const isDevice = game.$?.isdevice === 'yes' ? 1 : 0;
      const isMechanical = game.$?.ismechanical === 'yes' ? 1 : 0;
      // parent_name_ref = cloneof (priorité) ou romof (fallback). Pour la traçabilité
      // textuelle même quand le parent n'existe pas dans le DAT (cas DAT pré-filtré).
      const parentNameRef = cloneof || romof || null;
      // driver_status : présent dans le DAT MAMEDev brut et Progettosnaps, absent
      // chez Pleasuredome et Logiqx classique (No-Intro/Redump). NULL si manquant.
      const driverStatus = game.driver?.[0]?.$?.status || null;

      // Restaurer la sélection existante ou sélectionner par défaut.
      // BIOS et devices ne sont jamais sélectionnés par défaut (non jouables).
      let isSelected: number;
      if (existingSelections.has(gameName)) {
        isSelected = existingSelections.get(gameName)!;
      } else {
        isSelected = (isBios || isDevice) ? 0 : 1;
      }

      // Insertion / dédup du jeu. En complémentaire, INSERT OR IGNORE ne fait
      // rien si le nom existe déjà : les attributs du primaire sont préservés.
      // Le compteur gamesCount ne s'incrémente que pour les jeux réellement nouveaux.
      const wasNewGame = await new Promise<boolean>((resolve, reject) => {
        insertGame.run(
          gameName, description, category, isSelected, isBios, isDevice, isMechanical, parentNameRef, cloneof, romof, driverStatus, sourceId,
          function (this: import('sqlite3').RunResult, err: Error | null) {
            if (err) return reject(err);
            resolve((this.changes ?? 0) > 0);
          }
        );
      });
      if (wasNewGame) gamesCount++;

      const gameId = await new Promise<number>((resolve, reject) => {
        getGameId.get(gameName, (err, row: any) => {
          if (err) reject(err);
          else if (!row?.id) reject(new Error('Game ID not found'));
          else resolve(row.id);
        });
      });

      // Helper : vérifier si une dat_rom (game_id, name) existe déjà. Utilisé
      // uniquement en mode complémentaire pour éviter la duplication des ROMs
      // sur les jeux existants.
      const romAlreadyExists = async (name: string | null): Promise<boolean> => {
        if (!romExists || !name) return false;
        return new Promise<boolean>((resolve, reject) => {
          romExists.get(gameId, name, (err: Error | null, row: any) => {
            if (err) reject(err);
            else resolve(!!row);
          });
        });
      };

      // Insérer les ROMs (balise <rom>)
      for (const rom of game.rom || []) {
        const r = rom.$ || {};
        const romName = r.name || null;
        if (await romAlreadyExists(romName)) continue; // complementary: skip dup
        await new Promise<void>((resolve, reject) => {
          insertRom.run(
            gameId,
            romName,
            r.size ? parseInt(r.size, 10) : null,
            r.crc || null,
            r.md5 || null,
            r.sha1 || null,
            r.merge || null,
            0, // is_disk = 0
            sourceId,
            (err: Error | null) => err ? reject(err) : resolve()
          );
        });
        romsCount++;
      }

      // Insérer les disks (balise <disk>) — uniquement sha1 disponible côté MAME
      for (const disk of game.disk || []) {
        const d = disk.$ || {};
        const diskName = d.name || null;
        if (await romAlreadyExists(diskName)) continue;
        await new Promise<void>((resolve, reject) => {
          insertRom.run(
            gameId,
            diskName,
            null, // size : indisponible
            null, // crc : indisponible
            null, // md5 : indisponible
            d.sha1 || null,
            null, // merge_name : pas de merge sur <disk>
            1, // is_disk = 1
            sourceId,
            (err: Error | null) => err ? reject(err) : resolve()
          );
        });
        disksCount++;
      }

      // Enregistrer les relations à résoudre en 2e passe
      if (cloneof) {
        pendingRelations.push({ childGameId: gameId, parentName: cloneof, type: 'cloneof' });
      }
      // romof n'est inséré comme relation que s'il diffère de cloneof (sinon doublon)
      if (romof && romof !== cloneof) {
        pendingRelations.push({ childGameId: gameId, parentName: romof, type: 'romof' });
      }
      for (const dr of game.device_ref || []) {
        const name = dr.$?.name;
        if (name) {
          pendingRelations.push({ childGameId: gameId, parentName: name, type: 'device_ref' });
        }
      }
    }

    insertGame.finalize();
    insertRom.finalize();
    if (romExists) romExists.finalize();

    // ── 2e passe : résoudre les relations vers les IDs et insérer dans game_relationships ──
    if (pendingRelations.length > 0) {
      const insertRel = db.prepare(
        `INSERT OR IGNORE INTO game_relationships (child_game_id, parent_game_id, relationship_type, source_id)
         VALUES (?, ?, ?, ?)`
      );

      // Construire une map name → id pour éviter de relire la DB en boucle
      const allGames = await db.all<{ id: number; name: string }>('SELECT id, name FROM games');
      const nameToId = new Map<string, number>();
      for (const g of allGames) nameToId.set(g.name, g.id);

      for (const rel of pendingRelations) {
        const parentId = nameToId.get(rel.parentName);
        if (parentId === undefined) {
          // Parent absent du DAT (cas DAT pré-filtré). On laisse la trace dans
          // games.parent_name_ref qui a déjà été renseigné en 1ère passe.
          continue;
        }
        await new Promise<void>((resolve, reject) => {
          insertRel.run(rel.childGameId, parentId, rel.type, sourceId, (err: Error | null) =>
            err ? reject(err) : resolve()
          );
        });
        relationshipsCount++;
      }
      insertRel.finalize();
    }

    getGameId.finalize();

    // Mettre à jour les compteurs de la source (pour affichage dans un panneau
    // "Sources DAT" ou pour audit).
    await db.run(
      'UPDATE dat_sources SET games_added = ?, roms_added = ? WHERE id = ?',
      [gamesCount, romsCount + disksCount, sourceId]
    );

    await db.run('COMMIT');

    // Metadata globales. En primaire, on écrase avec les valeurs du DAT courant.
    // En complémentaire, on ne touche PAS dat_set_mode (le mode du set reste
    // celui du primaire) mais on recalcule les compteurs CHD sur toute la DB.
    if (!isComplementary) {
      await setMetadata(db, 'dat_set_mode', datSetMode);
      await setMetadata(db, 'dat_set_mode_inferred', datModeInferred ? 'true' : 'false');
    }

    // Stocker les compteurs CHD (nombre de jeux ayant au moins un <disk>, et nombre
    // total de disques). Recalcul global — inclut les entrées apportées par les
    // sources complémentaires.
    const diskStats = await db.get<{ games_with_disks: number; total_disks: number }>(`
      SELECT COUNT(DISTINCT game_id) AS games_with_disks, COUNT(*) AS total_disks
      FROM dat_roms WHERE is_disk = 1
    `);
    await setMetadata(db, 'dat_games_with_disks', String(diskStats?.games_with_disks ?? 0));
    await setMetadata(db, 'dat_total_disks', String(diskStats?.total_disks ?? 0));

    console.log(
      `[${role}] Imported ${gamesCount} games, ${romsCount} ROMs, ${disksCount} disks, ` +
      `${relationshipsCount} parent-child relations. DAT mode: ${datSetMode} (source_id=${sourceId})`
    );

    return { gamesCount, romsCount, relationshipsCount, disksCount, datSetMode, sourceId };

  } catch (error) {
    await db.run('ROLLBACK');
    throw error;
  }
}
