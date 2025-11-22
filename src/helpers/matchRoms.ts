// src/helpers/matchRoms.ts
import { Database } from '../database/init';
import { settingsManager } from './settingsManager';

export interface RomMatch {
  datRomId: number;
  datRomName: string;
  gameName: string;
  gameId: number;
  scannedFileId?: number;
  scannedFileName?: string;
  scannedFilePath?: string;
  archiveContentId?: number;
  archiveFileName?: string;
  archiveType?: string;  // 'zip', '7z', 'rar', 'iso', 'cso', 'chd', ou null pour fichiers non compressés
  matchType: 'perfect' | 'none';
  matchedBy: string[]; // ['crc32'] ou ['md5'] ou ['sha1'] ou combinaison
  priorityScore: number; // Score de priorité basé sur le type d'archive (plus élevé = meilleur)
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
  
  // Statistiques par ROM
  totalDatRoms: number;
  matchedRoms: number;
  missingRoms: number;
  extraFiles: number;
}

/**
 * Priorité des formats d'archive pour le matching
 * Plus le score est élevé, plus le format est prioritaire
 */
const DEFAULT_ARCHIVE_PRIORITY: Record<string, number> = {
  'none': 1000,    // Fichiers non compressés (priorité maximale)
  'zip': 900,
  '7z': 800,
  'rar': 700,
  'iso': 600,
  'cso': 500,
  'chd': 400
};

/**
 * Obtenir le score de priorité pour un type d'archive
 */
function getArchivePriorityScore(archiveType: string | null | undefined): number {
  if (!archiveType) return DEFAULT_ARCHIVE_PRIORITY['none'];
  const type = archiveType.toLowerCase();
  return DEFAULT_ARCHIVE_PRIORITY[type] || 0;
}

/**
 * Trouve les correspondances entre les ROMs du DAT et les fichiers scannés
 * Logique simplifiée : si au moins un hash correspond, c'est un match parfait
 * Priorise les fichiers non compressés, puis par type d'archive selon les préférences
 */
export async function matchRomsWithFiles(db: Database): Promise<{
  matches: RomMatch[],
  gameStatuses: GameMatchStatus[],
  stats: MatchingStats
}> {
  console.log('🔍 Début du matching des ROMs...');
  
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

  console.log(`📊 ${datRoms.length} ROMs à matcher`);

  // Récupérer tous les fichiers scannés (non-archives uniquement pour les fichiers directs)
  const scannedFiles = await db.all<{
    id: number;
    file_name: string;
    file_path: string;
    crc32: string | null;
    md5: string | null;
    sha1: string | null;
    is_archive: number;
  }>(`
    SELECT 
      sf.id,
      sf.file_name,
      sf.file_path,
      sf.crc32,
      sf.md5,
      sf.sha1,
      sf.is_archive
    FROM scanned_files sf
  `);

  console.log(`📂 ${scannedFiles.length} fichiers scannés`);

  // Récupérer tous les contenus d'archives avec leur type
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

  console.log(`🗜️ ${archiveContents.length} fichiers dans les archives`);

  const matches: RomMatch[] = [];
  const matchedFileIds = new Set<number>();
  const matchedArchiveContentIds = new Set<number>();

  // Pour chaque ROM du DAT, chercher la MEILLEURE correspondance
  for (const datRom of datRoms) {
    const candidates: RomMatch[] = [];

    // Chercher dans les fichiers scannés directs (non-archives)
    for (const file of scannedFiles) {
      // Ne matcher que les fichiers qui ne sont PAS des archives
      if (file.is_archive) continue;
      
      // Ne pas réutiliser un fichier déjà matché
      if (matchedFileIds.has(file.id)) continue;

      const hashMatch = compareHashes(datRom, {
        crc32: file.crc32,
        md5: file.md5,
        sha1: file.sha1
      });

      if (hashMatch.matched) {
        candidates.push({
          datRomId: datRom.rom_id,
          datRomName: datRom.rom_name,
          gameName: datRom.game_name,
          gameId: datRom.game_id,
          scannedFileId: file.id,
          scannedFileName: file.file_name,
          scannedFilePath: file.file_path,
          archiveType: undefined, // Fichier non compressé
          matchType: 'perfect',
          matchedBy: hashMatch.matchedBy,
          priorityScore: getArchivePriorityScore(null)
        });
      }
    }

    // Chercher dans les contenus d'archives
    for (const content of archiveContents) {
      // Ne pas réutiliser un contenu déjà matché
      if (matchedArchiveContentIds.has(content.id)) continue;

      const hashMatch = compareHashes(datRom, {
        crc32: content.crc32,
        md5: content.md5,
        sha1: content.sha1
      });

      if (hashMatch.matched) {
        candidates.push({
          datRomId: datRom.rom_id,
          datRomName: datRom.rom_name,
          gameName: datRom.game_name,
          gameId: datRom.game_id,
          archiveContentId: content.id,
          archiveFileName: `${content.archive_name} > ${content.file_name}`,
          scannedFilePath: content.archive_path,
          archiveType: content.archive_type,
          matchType: 'perfect',
          matchedBy: hashMatch.matchedBy,
          priorityScore: getArchivePriorityScore(content.archive_type)
        });
      }
    }

    // Sélectionner le meilleur candidat (priorité la plus élevée)
    let bestMatch: RomMatch;
    
    if (candidates.length > 0) {
      // Trier par priorityScore décroissant
      candidates.sort((a, b) => b.priorityScore - a.priorityScore);
      bestMatch = candidates[0];

      // Marquer le fichier/contenu comme matché
      if (bestMatch.scannedFileId) {
        matchedFileIds.add(bestMatch.scannedFileId);
      }
      if (bestMatch.archiveContentId) {
        matchedArchiveContentIds.add(bestMatch.archiveContentId);
      }

      console.log(`✅ Match trouvé pour "${datRom.rom_name}" : ${bestMatch.scannedFileName || bestMatch.archiveFileName} (${bestMatch.matchedBy.join(', ')}) [priorité: ${bestMatch.priorityScore}]`);
    } else {
      // Aucun match trouvé
      bestMatch = {
        datRomId: datRom.rom_id,
        datRomName: datRom.rom_name,
        gameName: datRom.game_name,
        gameId: datRom.game_id,
        matchType: 'none',
        matchedBy: [],
        priorityScore: 0
      };

      console.log(`❌ Aucun match pour "${datRom.rom_name}"`);
    }

    matches.push(bestMatch);
  }

  // Sauvegarder les correspondances dans la base
  await saveMatches(db, matches);

  // Calculer les statuts par jeu
  const gameStatuses = await calculateGameStatuses(db);

  // Calculer les statistiques globales
  const stats = calculateStats(datRoms, matches, scannedFiles, archiveContents, matchedFileIds, matchedArchiveContentIds, gameStatuses);

  console.log('✅ Matching terminé !');
  console.log(`📊 Statistiques :`);
  console.log(`   - Jeux complets : ${stats.completeGames}/${stats.totalGames}`);
  console.log(`   - Jeux partiels : ${stats.partialGames}/${stats.totalGames}`);
  console.log(`   - Jeux manquants : ${stats.missingGames}/${stats.totalGames}`);
  console.log(`   - ROMs matchées : ${stats.matchedRoms}/${stats.totalDatRoms}`);
  console.log(`   - ROMs manquantes : ${stats.missingRoms}/${stats.totalDatRoms}`);

  return { matches, gameStatuses, stats };
}

/**
 * Compare les hashes entre une ROM du DAT et un fichier
 * Retourne true si AU MOINS UN hash correspond
 */
function compareHashes(
  datRom: { crc32: string | null; md5: string | null; sha1: string | null },
  file: { crc32: string | null; md5: string | null; sha1: string | null }
): { matched: boolean; matchedBy: string[] } {
  const matchedBy: string[] = [];

  // Vérifier CRC32
  if (datRom.crc32 && file.crc32 && datRom.crc32.toUpperCase() === file.crc32.toUpperCase()) {
    matchedBy.push('crc32');
  }

  // Vérifier MD5
  if (datRom.md5 && file.md5 && datRom.md5.toUpperCase() === file.md5.toUpperCase()) {
    matchedBy.push('md5');
  }

  // Vérifier SHA1
  if (datRom.sha1 && file.sha1 && datRom.sha1.toUpperCase() === file.sha1.toUpperCase()) {
    matchedBy.push('sha1');
  }

  return {
    matched: matchedBy.length > 0,
    matchedBy
  };
}

/**
 * Calcule le statut de matching pour chaque jeu
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
      SUM(CASE WHEN rm.match_type = 'perfect' THEN 1 ELSE 0 END) as matched_roms
    FROM games g
    JOIN dat_roms dr ON g.id = dr.game_id
    LEFT JOIN rom_matches rm ON dr.id = rm.dat_rom_id
    GROUP BY g.id, g.name
    ORDER BY g.name
  `);

  return gameStatuses.map(gs => {
    let status: 'complete' | 'partial' | 'missing';
    
    if (gs.matched_roms === gs.total_roms) {
      status = 'complete'; // ✅
    } else if (gs.matched_roms > 0) {
      status = 'partial'; // ⚠️
    } else {
      status = 'missing'; // ❌
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
 * Calcule les statistiques globales
 */
function calculateStats(
  datRoms: any[],
  matches: RomMatch[],
  scannedFiles: any[],
  archiveContents: any[],
  matchedFileIds: Set<number>,
  matchedArchiveContentIds: Set<number>,
  gameStatuses: GameMatchStatus[]
): MatchingStats {
  const matchedRoms = matches.filter(m => m.matchType === 'perfect').length;
  const missingRoms = matches.filter(m => m.matchType === 'none').length;
  
  const completeGames = gameStatuses.filter(gs => gs.status === 'complete').length;
  const partialGames = gameStatuses.filter(gs => gs.status === 'partial').length;
  const missingGames = gameStatuses.filter(gs => gs.status === 'missing').length;

  // Fichiers non matchés = fichiers non-archives non matchés + contenus d'archives non matchés
  const unmatchedFiles = scannedFiles.filter(f => !f.is_archive && !matchedFileIds.has(f.id)).length;
  const unmatchedArchiveContents = archiveContents.length - matchedArchiveContentIds.size;
  const extraFiles = unmatchedFiles + unmatchedArchiveContents;

  return {
    totalGames: gameStatuses.length,
    completeGames,
    partialGames,
    missingGames,
    totalDatRoms: datRoms.length,
    matchedRoms,
    missingRoms,
    extraFiles
  };
}

/**
 * Sauvegarde les correspondances sans démarrer de nouvelle transaction
 * (pour éviter les transactions imbriquées)
 */
async function saveMatchesWithoutTransaction(db: Database, matches: RomMatch[]): Promise<void> {
  // Effacer les anciennes correspondances
  await db.run('DELETE FROM rom_matches');

  // Insérer les nouvelles correspondances
  const insertMatch = db.prepare(`
    INSERT INTO rom_matches 
    (dat_rom_id, scanned_file_id, archive_content_id, match_type, match_score)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const match of matches) {
    await new Promise<void>((resolve, reject) => {
      insertMatch.run(
        match.datRomId,
        match.scannedFileId || null,
        match.archiveContentId || null,
        match.matchType,
        match.priorityScore,
        (err: Error | null) => err ? reject(err) : resolve()
      );
    });
  }

  insertMatch.finalize();
  console.log(`💾 ${matches.length} correspondances sauvegardées en base`);
}

/**
 * Sauvegarde les correspondances dans la base de données
 * Gère automatiquement les transactions imbriquées
 */
async function saveMatches(db: Database, matches: RomMatch[]): Promise<void> {
  // Essayer de démarrer une transaction IMMEDIATE
  // Si une transaction est déjà active, SQLite retournera une erreur
  let hasOwnTransaction = false;
  
  try {
    await db.run('BEGIN IMMEDIATE TRANSACTION');
    hasOwnTransaction = true;
  } catch (error: any) {
    // Si l'erreur indique qu'une transaction est déjà active, on continue sans
    const errorMsg = error?.message?.toLowerCase() || '';
    if (errorMsg.includes('cannot start a transaction') || 
        errorMsg.includes('transaction') ||
        error?.errno === 1) {
      console.log('⚠️ Transaction déjà active, sauvegarde sans nouvelle transaction');
      await saveMatchesWithoutTransaction(db, matches);
      return;
    }
    // Pour toute autre erreur, on la propage
    throw error;
  }

  // Si on a réussi à démarrer une transaction, on l'utilise
  try {
    await saveMatchesWithoutTransaction(db, matches);
    await db.run('COMMIT');
  } catch (error) {
    if (hasOwnTransaction) {
      try {
        await db.run('ROLLBACK');
      } catch (rollbackError) {
        console.error('Erreur lors du ROLLBACK:', rollbackError);
      }
    }
    throw error;
  }
}

/**
 * Récupère les ROMs manquantes
 */
export async function getMissingRoms(db: Database): Promise<RomMatch[]> {
  const matches = await db.all<{
    datRomId: number;
    datRomName: string;
    gameName: string;
    gameId: number;
    matchType: string;
  }>(`
    SELECT 
      dr.id as datRomId,
      dr.name as datRomName,
      g.name as gameName,
      g.id as gameId,
      COALESCE(rm.match_type, 'none') as matchType
    FROM dat_roms dr
    JOIN games g ON dr.game_id = g.id
    LEFT JOIN rom_matches rm ON dr.id = rm.dat_rom_id
    WHERE rm.match_type = 'none' OR rm.match_type IS NULL
    ORDER BY g.name, dr.name
  `);

  return matches.map(m => ({
    ...m,
    matchType: (m.matchType === 'perfect' || m.matchType === 'none' ? m.matchType : 'none') as 'perfect' | 'none',
    matchedBy: [],
    priorityScore: 0
  }));
}

/**
 * Récupère les fichiers non matchés (extras)
 */
export async function getExtraFiles(db: Database): Promise<any[]> {
  const extraFiles = await db.all(`
    SELECT 
      sf.id,
      sf.file_name,
      sf.file_path,
      sf.size,
      'file' as type
    FROM scanned_files sf
    LEFT JOIN rom_matches rm ON sf.id = rm.scanned_file_id
    WHERE rm.id IS NULL AND sf.is_archive = 0
    
    UNION ALL
    
    SELECT 
      ac.id,
      ac.file_name,
      sf.file_name || ' > ' || ac.file_name as file_path,
      ac.size,
      'archive_content' as type
    FROM archive_contents ac
    JOIN scanned_files sf ON ac.archive_id = sf.id
    LEFT JOIN rom_matches rm ON ac.id = rm.archive_content_id
    WHERE rm.id IS NULL
    
    ORDER BY file_name
  `);

  return extraFiles;
}

/**
 * Récupère les statuts de matching pour tous les jeux
 */
export async function getGameMatchStatuses(db: Database): Promise<GameMatchStatus[]> {
  return await calculateGameStatuses(db);
}
