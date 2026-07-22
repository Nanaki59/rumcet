// src/helpers/matchRoms.ts
import { Database } from '../database/init';

export interface RomMatch {
  datRomId: number;
  datRomName: string;
  gameName: string;
  gameId: number;
  scannedFileId: number;           // Toujours le fichier physique (loose OU archive)
  scannedFileName: string;
  scannedFilePath: string;
  archiveContentId?: number;       // Renseigné uniquement si le match vient d'un contenu d'archive
  archiveFileName?: string;        // Nom du fichier dans l'archive (ex: "archive.zip > rom.bin")
  archiveType?: string;            // 'zip', '7z', 'rar', 'iso', 'cso', 'chd', ou undefined pour fichiers loose
  archiveIsPerfect: boolean;       // L'archive contient toutes les ROMs du jeu
}

export interface GameMatchStatus {
  gameId: number;
  gameName: string;
  totalRoms: number;
  matchedRoms: number;
  status: 'complete' | 'partial' | 'missing'; // ✅ | ⚠️ | ❌
}

interface MatchingStats {
  // Statistiques par jeu
  totalGames: number;
  completeGames: number;       // ✅
  partialGames: number;        // ⚠️
  missingGames: number;        // ❌

  // Statistiques par ROM (sans doublons de matching)
  totalDatRoms: number;
  matchedRoms: number;         // ROMs du DAT ayant au moins 1 match
  missingRoms: number;         // ROMs du DAT sans aucun match
  extraFiles: number;          // Fichiers sur disque sans aucun match
}

/**
 * Trouve TOUTES les correspondances entre les ROMs du DAT et les fichiers scannés.
 * Chaque fichier/contenu d'archive peut matcher plusieurs ROMs du DAT.
 * Chaque ROM du DAT peut avoir plusieurs matches (fichiers différents avec le même hash).
 */
export async function matchRomsWithFiles(db: Database): Promise<{
  matches: RomMatch[],
  gameStatuses: GameMatchStatus[],
  stats: MatchingStats
}> {
  console.log('🔍 Starting ROM matching...');

  // Récupérer toutes les ROMs du DAT avec leurs jeux
  const datRoms = await db.all<{
    rom_id: number;
    rom_name: string;
    game_id: number;
    game_name: string;
    crc32: string | null;
    md5: string | null;
    sha1: string | null;
  }>(`
    SELECT
      dr.id as rom_id,
      dr.name as rom_name,
      dr.game_id as game_id,
      g.name as game_name,
      dr.crc32,
      dr.md5,
      dr.sha1
    FROM dat_roms dr
    JOIN games g ON dr.game_id = g.id
    ORDER BY g.name, dr.name
  `);

  console.log(`📊 ${datRoms.length} ROMs to match`);

  // Récupérer tous les fichiers scannés non-archives (fichiers loose)
  const looseFiles = await db.all<{
    id: number;
    file_name: string;
    file_path: string;
    crc32: string | null;
    md5: string | null;
    sha1: string | null;
  }>(`
    SELECT
      sf.id,
      sf.file_name,
      sf.file_path,
      sf.crc32,
      sf.md5,
      sf.sha1
    FROM scanned_files sf
    WHERE sf.is_archive = 0
  `);

  console.log(`📂 ${looseFiles.length} loose files`);

  // Récupérer tous les contenus d'archives avec info de l'archive parente
  const archiveContents = await db.all<{
    id: number;
    file_name: string;
    crc32: string | null;
    md5: string | null;
    sha1: string | null;
    archive_id: number;
    archive_name: string;
    archive_path: string;
    archive_type: string;
  }>(`
    SELECT
      ac.id,
      ac.file_name,
      ac.crc32,
      ac.md5,
      ac.sha1,
      ac.archive_id,
      sf.file_name as archive_name,
      sf.file_path as archive_path,
      sf.archive_type
    FROM archive_contents ac
    JOIN scanned_files sf ON ac.archive_id = sf.id
  `);

  console.log(`🗜️ ${archiveContents.length} files inside archives`);

  const matches: RomMatch[] = [];

  // Pour chaque ROM du DAT, chercher TOUTES les correspondances
  for (const datRom of datRoms) {

    // Chercher dans les fichiers loose
    for (const file of looseFiles) {
      const hashMatch = compareHashes(datRom, file);
      if (hashMatch.matched) {
        matches.push({
          datRomId: datRom.rom_id,
          datRomName: datRom.rom_name,
          gameName: datRom.game_name,
          gameId: datRom.game_id,
          scannedFileId: file.id,
          scannedFileName: file.file_name,
          scannedFilePath: file.file_path,
          archiveType: undefined,
          archiveIsPerfect: false, // Sera calculé après pour les archives
        });
      }
    }

    // Chercher dans les contenus d'archives
    for (const content of archiveContents) {
      const hashMatch = compareHashes(datRom, content);
      if (hashMatch.matched) {
        matches.push({
          datRomId: datRom.rom_id,
          datRomName: datRom.rom_name,
          gameName: datRom.game_name,
          gameId: datRom.game_id,
          scannedFileId: content.archive_id,      // Le fichier physique = l'archive
          scannedFileName: content.archive_name,
          scannedFilePath: content.archive_path,
          archiveContentId: content.id,
          archiveFileName: `${content.archive_name} > ${content.file_name}`,
          archiveType: content.archive_type,
          archiveIsPerfect: false, // Sera calculé ci-dessous
        });
      }
    }
  }

  // Calculer archiveIsPerfect : pour chaque jeu, vérifier si une archive
  // contient TOUTES les ROMs du jeu
  computeArchiveIsPerfect(datRoms, matches);

  console.log(`💾 ${matches.length} matches found in total`);

  // Sauvegarder les correspondances dans la base
  await saveMatches(db, matches);

  // Calculer les statuts par jeu
  const gameStatuses = await calculateGameStatuses(db);

  // Calculer les statistiques globales (sans doublons)
  const stats = calculateStats(datRoms, db, looseFiles, archiveContents, gameStatuses, matches);

  console.log('✅ Matching complete!');
  console.log(`📊 Statistiques :`);
  console.log(`   - Complete games: ${stats.completeGames}/${stats.totalGames}`);
  console.log(`   - Partial games: ${stats.partialGames}/${stats.totalGames}`);
  console.log(`   - Missing games: ${stats.missingGames}/${stats.totalGames}`);
  console.log(`   - Matched ROMs: ${stats.matchedRoms}/${stats.totalDatRoms}`);
  console.log(`   - ROMs manquantes : ${stats.missingRoms}/${stats.totalDatRoms}`);

  return { matches, gameStatuses, stats };
}

/**
 * Calcule le flag archiveIsPerfect pour chaque match provenant d'une archive.
 * Une archive est "parfaite" pour un jeu si elle contient toutes les ROMs de ce jeu.
 */
function computeArchiveIsPerfect(
  datRoms: Array<{ rom_id: number; game_id: number }>,
  matches: RomMatch[]
): void {
  // Nombre de ROMs par jeu dans le DAT
  const romsPerGame = new Map<number, number>();
  for (const rom of datRoms) {
    romsPerGame.set(rom.game_id, (romsPerGame.get(rom.game_id) || 0) + 1);
  }

  // Pour chaque combinaison (gameId, archiveFileId), compter les ROMs distinctes matchées
  // Clé = "gameId|scannedFileId"
  const archiveGameMatches = new Map<string, Set<number>>();
  for (const match of matches) {
    if (match.archiveContentId == null) continue; // Pas un match d'archive
    const key = `${match.gameId}|${match.scannedFileId}`;
    if (!archiveGameMatches.has(key)) archiveGameMatches.set(key, new Set());
    archiveGameMatches.get(key)!.add(match.datRomId);
  }

  // Identifier les archives parfaites
  const perfectKeys = new Set<string>();
  for (const [key, matchedRomIds] of archiveGameMatches) {
    const gameId = parseInt(key.split('|')[0]);
    const totalRoms = romsPerGame.get(gameId) || 0;
    if (matchedRomIds.size === totalRoms) {
      perfectKeys.add(key);
    }
  }

  // Mettre à jour le flag sur les matches correspondants
  for (const match of matches) {
    if (match.archiveContentId == null) continue;
    const key = `${match.gameId}|${match.scannedFileId}`;
    if (perfectKeys.has(key)) {
      match.archiveIsPerfect = true;
    }
  }
}

/**
 * Compare les hashes entre une ROM du DAT et un fichier
 * Retourne true si AU MOINS UN hash correspond
 */
export function compareHashes(
  datRom: { crc32: string | null; md5: string | null; sha1: string | null },
  file: { crc32: string | null; md5: string | null; sha1: string | null }
): { matched: boolean } {
  if (datRom.crc32 && file.crc32 && datRom.crc32.toUpperCase() === file.crc32.toUpperCase()) {
    return { matched: true };
  }
  if (datRom.md5 && file.md5 && datRom.md5.toUpperCase() === file.md5.toUpperCase()) {
    return { matched: true };
  }
  if (datRom.sha1 && file.sha1 && datRom.sha1.toUpperCase() === file.sha1.toUpperCase()) {
    return { matched: true };
  }
  return { matched: false };
}

/**
 * Calcule le statut de matching pour chaque jeu.
 * Compte les ROMs DISTINCTES du DAT ayant au moins 1 match (pas de doublons).
 */
async function calculateGameStatuses(db: Database): Promise<GameMatchStatus[]> {
  const gameStatuses = await db.all<{
    game_id: number;
    game_name: string;
    total_roms: number;
    matched_roms: number;
  }>(`
    SELECT
      g.id as game_id,
      g.name as game_name,
      COUNT(dr.id) as total_roms,
      (SELECT COUNT(DISTINCT rm.dat_rom_id)
       FROM rom_matches rm
       WHERE rm.dat_rom_id IN (SELECT dr2.id FROM dat_roms dr2 WHERE dr2.game_id = g.id)
      ) as matched_roms
    FROM games g
    JOIN dat_roms dr ON g.id = dr.game_id
    GROUP BY g.id, g.name
    ORDER BY g.name
  `);

  return gameStatuses.map(gs => {
    let status: 'complete' | 'partial' | 'missing';

    if (gs.matched_roms === gs.total_roms) {
      status = 'complete';
    } else if (gs.matched_roms > 0) {
      status = 'partial';
    } else {
      status = 'missing';
    }

    return {
      gameId: gs.game_id,
      gameName: gs.game_name,
      totalRoms: gs.total_roms,
      matchedRoms: gs.matched_roms,
      status
    };
  });
}

/**
 * Calcule les statistiques globales sans doublons de matching.
 * matchedRoms = nombre de ROMs DAT distinctes ayant au moins 1 match.
 */
function calculateStats(
  datRoms: any[],
  _db: Database,
  looseFiles: any[],
  archiveContents: any[],
  gameStatuses: GameMatchStatus[],
  matches: RomMatch[]
): MatchingStats {
  // ROMs du DAT distinctes ayant au moins 1 match
  const matchedDatRomIds = new Set(matches.map(m => m.datRomId));
  const matchedRoms = matchedDatRomIds.size;
  const missingRoms = datRoms.length - matchedRoms;

  const completeGames = gameStatuses.filter(gs => gs.status === 'complete').length;
  const partialGames = gameStatuses.filter(gs => gs.status === 'partial').length;
  const missingGames = gameStatuses.filter(gs => gs.status === 'missing').length;

  // Fichiers non matchés : fichiers loose et contenus d'archive sans aucun match
  const matchedLooseFileIds = new Set(
    matches.filter(m => m.archiveContentId == null).map(m => m.scannedFileId)
  );
  const matchedArchiveContentIds = new Set(
    matches.filter(m => m.archiveContentId != null).map(m => m.archiveContentId)
  );

  const unmatchedLoose = looseFiles.filter(f => !matchedLooseFileIds.has(f.id)).length;
  const unmatchedArchiveContents = archiveContents.filter(ac => !matchedArchiveContentIds.has(ac.id)).length;

  return {
    totalGames: gameStatuses.length,
    completeGames,
    partialGames,
    missingGames,
    totalDatRoms: datRoms.length,
    matchedRoms,
    missingRoms,
    extraFiles: unmatchedLoose + unmatchedArchiveContents
  };
}

/**
 * Sauvegarde les correspondances sans démarrer de nouvelle transaction
 */
async function saveMatchesWithoutTransaction(db: Database, matches: RomMatch[]): Promise<void> {
  await db.run('DELETE FROM rom_matches');

  const insertMatch = db.prepare(`
    INSERT INTO rom_matches
    (dat_rom_id, scanned_file_id, archive_content_id, archive_is_perfect)
    VALUES (?, ?, ?, ?)
  `);

  for (const match of matches) {
    await new Promise<void>((resolve, reject) => {
      insertMatch.run(
        match.datRomId,
        match.scannedFileId,
        match.archiveContentId || null,
        match.archiveIsPerfect ? 1 : 0,
        (err: Error | null) => err ? reject(err) : resolve()
      );
    });
  }

  insertMatch.finalize();
  console.log(`💾 ${matches.length} matches saved to the database`);
}

/**
 * Sauvegarde les correspondances dans la base de données
 * Gère automatiquement les transactions imbriquées
 */
async function saveMatches(db: Database, matches: RomMatch[]): Promise<void> {
  let hasOwnTransaction = false;

  try {
    await db.run('BEGIN IMMEDIATE TRANSACTION');
    hasOwnTransaction = true;
  } catch (error: any) {
    const errorMsg = error?.message?.toLowerCase() || '';
    if (errorMsg.includes('cannot start a transaction') ||
        errorMsg.includes('transaction') ||
        error?.errno === 1) {
      console.log('⚠️ Transaction already active, saving without a new transaction');
      await saveMatchesWithoutTransaction(db, matches);
      return;
    }
    throw error;
  }

  try {
    await saveMatchesWithoutTransaction(db, matches);
    await db.run('COMMIT');
  } catch (error) {
    if (hasOwnTransaction) {
      try {
        await db.run('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error during ROLLBACK:', rollbackError);
      }
    }
    throw error;
  }
}

/**
 * Récupère les ROMs manquantes (ROMs du DAT sans aucun match)
 */
export async function getMissingRoms(db: Database): Promise<any[]> {
  return await db.all(`
    SELECT
      dr.id as datRomId,
      dr.name as datRomName,
      g.name as gameName,
      g.id as gameId
    FROM dat_roms dr
    JOIN games g ON dr.game_id = g.id
    WHERE NOT EXISTS (
      SELECT 1 FROM rom_matches rm WHERE rm.dat_rom_id = dr.id
    )
    ORDER BY g.name, dr.name
  `);
}

/**
 * Récupère les fichiers non matchés (extras)
 */
export async function getExtraFiles(db: Database): Promise<any[]> {
  return await db.all(`
    SELECT
      sf.id,
      sf.file_name,
      sf.file_path,
      sf.size,
      'file' as type
    FROM scanned_files sf
    WHERE sf.is_archive = 0
    AND NOT EXISTS (
      SELECT 1 FROM rom_matches rm
      WHERE rm.scanned_file_id = sf.id AND rm.archive_content_id IS NULL
    )

    UNION ALL

    SELECT
      ac.id,
      ac.file_name,
      sf.file_name || ' > ' || ac.file_name as file_path,
      ac.size,
      'archive_content' as type
    FROM archive_contents ac
    JOIN scanned_files sf ON ac.archive_id = sf.id
    WHERE NOT EXISTS (
      SELECT 1 FROM rom_matches rm WHERE rm.archive_content_id = ac.id
    )

    ORDER BY file_name
  `);
}

/**
 * Récupère les statuts de matching pour tous les jeux
 */
export async function getGameMatchStatuses(db: Database): Promise<GameMatchStatus[]> {
  return await calculateGameStatuses(db);
}
