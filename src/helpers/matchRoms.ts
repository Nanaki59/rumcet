// src/helpers/matchRoms.ts
import { Database } from '../database/init';

export interface RomMatch {
  datRomId: number;
  datRomName: string;
  gameName: string;
  scannedFileId?: number;
  scannedFileName?: string;
  archiveContentId?: number;
  archiveFileName?: string;
  matchType: 'perfect' | 'good' | 'partial' | 'none';
  matchScore: number; // 0-100
  matchedBy: string[]; // ['crc32', 'md5', 'sha1', 'name']
}

export interface MatchingStats {
  totalDatRoms: number;
  perfectMatches: number;
  goodMatches: number;
  partialMatches: number;
  missingRoms: number;
  extraFiles: number;
}

/**
 * Trouve les correspondances entre les ROMs du DAT et les fichiers scannés
 */
export async function matchRomsWithFiles(db: Database): Promise<{
  matches: RomMatch[],
  stats: MatchingStats
}> {
  // Récupérer toutes les ROMs du DAT avec leurs jeux
  const datRoms = await db.all<{
    rom_id: number;
    rom_name: string;
    game_name: string;
    crc32: string;
    md5: string;
    sha1: string;
  }>(`
    SELECT 
      dr.id as rom_id,
      dr.name as rom_name,
      g.name as game_name,
      dr.crc32,
      dr.md5,
      dr.sha1
    FROM dat_roms dr
    JOIN games g ON dr.game_id = g.id
    ORDER BY g.name, dr.name
  `);

  // Récupérer tous les fichiers scannés et contenus d'archives
  const scannedFiles = await db.all(`
    SELECT 
      sf.id,
      sf.file_name,
      sf.crc32,
      sf.md5,
      sf.sha1,
      sf.is_archive
    FROM scanned_files sf
  `);

  const archiveContents = await db.all(`
    SELECT 
      ac.id,
      ac.file_name,
      ac.crc32,
      ac.md5,
      ac.sha1,
      ac.archive_id,
      sf.file_name as archive_name
    FROM archive_contents ac
    JOIN scanned_files sf ON ac.archive_id = sf.id
  `);

  const matches: RomMatch[] = [];
  const matchedFileIds = new Set<number>();
  const matchedArchiveContentIds = new Set<number>();

  // Pour chaque ROM du DAT, chercher une correspondance
  for (const datRom of datRoms) {
    let bestMatch: RomMatch = {
      datRomId: datRom.rom_id,
      datRomName: datRom.rom_name,
      gameName: datRom.game_name,
      matchType: 'none',
      matchScore: 0,
      matchedBy: []
    };

    // Chercher dans les fichiers scannés
    for (const file of scannedFiles) {
      if (matchedFileIds.has(file.id)) continue;

      const match = compareRom(datRom, {
        name: file.file_name,
        crc32: file.crc32,
        md5: file.md5,
        sha1: file.sha1
      });

      if (match.score > bestMatch.matchScore) {
        bestMatch = {
          datRomId: datRom.rom_id,
          datRomName: datRom.rom_name,
          gameName: datRom.game_name,
          scannedFileId: file.id,
          scannedFileName: file.file_name,
          matchType: match.type,
          matchScore: match.score,
          matchedBy: match.matchedBy
        };
      }
    }

    // Chercher dans les contenus d'archives
    for (const content of archiveContents) {
      if (matchedArchiveContentIds.has(content.id)) continue;

      const match = compareRom(datRom, {
        name: content.file_name,
        crc32: content.crc32,
        md5: content.md5,
        sha1: content.sha1
      });

      if (match.score > bestMatch.matchScore) {
        bestMatch = {
          datRomId: datRom.rom_id,
          datRomName: datRom.rom_name,
          gameName: datRom.game_name,
          archiveContentId: content.id,
          archiveFileName: `${content.archive_name} > ${content.file_name}`,
          matchType: match.type,
          matchScore: match.score,
          matchedBy: match.matchedBy
        };
      }
    }

    // Marquer les fichiers/contenus comme matchés
    if (bestMatch.scannedFileId) {
      matchedFileIds.add(bestMatch.scannedFileId);
    }
    if (bestMatch.archiveContentId) {
      matchedArchiveContentIds.add(bestMatch.archiveContentId);
    }

    matches.push(bestMatch);
  }

  // Sauvegarder les correspondances dans la base
  await saveMatches(db, matches);

  // Calculer les statistiques
  const stats: MatchingStats = {
    totalDatRoms: datRoms.length,
    perfectMatches: matches.filter(m => m.matchType === 'perfect').length,
    goodMatches: matches.filter(m => m.matchType === 'good').length,
    partialMatches: matches.filter(m => m.matchType === 'partial').length,
    missingRoms: matches.filter(m => m.matchType === 'none').length,
    extraFiles: scannedFiles.length - matchedFileIds.size + 
                archiveContents.length - matchedArchiveContentIds.size
  };

  return { matches, stats };
}

/**
 * Compare une ROM du DAT avec un fichier
 */
function compareRom(
  datRom: { rom_name: string; crc32: string; md5: string; sha1: string },
  file: { name: string; crc32: string; md5: string; sha1: string }
): { score: number; type: 'perfect' | 'good' | 'partial' | 'none'; matchedBy: string[] } {
  const matchedBy: string[] = [];
  let score = 0;

  // Vérifier les hashes (priorité maximale)
  if (datRom.crc32 && file.crc32 && datRom.crc32 === file.crc32) {
    matchedBy.push('crc32');
    score += 35;
  }
  if (datRom.md5 && file.md5 && datRom.md5 === file.md5) {
    matchedBy.push('md5');
    score += 35;
  }
  if (datRom.sha1 && file.sha1 && datRom.sha1 === file.sha1) {
    matchedBy.push('sha1');
    score += 30;
  }

  // Vérifier le nom (bonus si correspond)
  if (datRom.rom_name && file.name) {
    const romNameClean = cleanFileName(datRom.rom_name);
    const fileNameClean = cleanFileName(file.name);
    
    if (romNameClean === fileNameClean) {
      matchedBy.push('name');
      score += 10; // Bonus pour le nom
    } else if (fileNameClean.includes(romNameClean) || romNameClean.includes(fileNameClean)) {
      matchedBy.push('partial_name');
      score += 5; // Petit bonus pour correspondance partielle
    }
  }

  // Déterminer le type de match
  let type: 'perfect' | 'good' | 'partial' | 'none';
  if (score >= 100) {
    type = 'perfect';
  } else if (score >= 70) {
    type = 'good';
  } else if (score > 0) {
    type = 'partial';
  } else {
    type = 'none';
  }

  return { score: Math.min(score, 100), type, matchedBy };
}

/**
 * Nettoie un nom de fichier pour la comparaison
 */
function cleanFileName(name: string): string {
  // Enlever l'extension
  const withoutExt = name.replace(/\.[^/.]+$/, '');
  // Convertir en minuscules et enlever les caractères spéciaux
  return withoutExt.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Sauvegarde les correspondances dans la base de données
 */
async function saveMatches(db: Database, matches: RomMatch[]): Promise<void> {
  await db.run('BEGIN TRANSACTION');

  try {
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
          match.matchScore,
          (err: Error | null) => err ? reject(err) : resolve()
        );
      });
    }

    insertMatch.finalize();
    await db.run('COMMIT');

    console.log(`Saved ${matches.length} ROM matches to database`);
  } catch (error) {
    await db.run('ROLLBACK');
    throw error;
  }
}

/**
 * Récupère les ROMs manquantes
 */
export async function getMissingRoms(db: Database): Promise<RomMatch[]> {
  const matches = await db.all<RomMatch>(`
    SELECT 
      dr.id as datRomId,
      dr.name as datRomName,
      g.name as gameName,
      rm.match_type as matchType,
      rm.match_score as matchScore
    FROM dat_roms dr
    JOIN games g ON dr.game_id = g.id
    LEFT JOIN rom_matches rm ON dr.id = rm.dat_rom_id
    WHERE rm.match_type = 'none' OR rm.match_type IS NULL
    ORDER BY g.name, dr.name
  `);

  return matches.map(m => ({
    ...m,
    matchedBy: []
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
    WHERE rm.id IS NULL
    
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
