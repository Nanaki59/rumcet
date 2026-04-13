// src/helpers/consolidateRoms.ts

import { Database, getMetadata } from '../database/init.js';
import { settingsManager, ArchiveFormat, DEFAULT_SYSTEM_COMPATIBILITY } from './settingsManager.js';
import { ArchiveManager } from './archives/ArchiveManager.js';
import path from 'path';
import fs from 'fs/promises';

export interface ConsolidationProgress {
  phase: 'preparing' | 'consolidating' | 'moving-unmatched' | 'complete';
  currentGame?: string;
  currentGameIndex: number;
  totalGames: number;
  message: string;
}

export interface ConsolidationResult {
  stats: {
    totalGamesProcessed: number;
    gamesConsolidated: number;
    gamesSkipped: number;
    gamesErrored: number;
    romsExtracted: number;
    archivesCreated: number;
    unmatchedFilesMoved: number;
  };
  errors: Array<{ gameName: string; error: string }>;
}

type ProgressCallback = (progress: ConsolidationProgress) => void;

interface MatchedRomInfo {
  datRomName: string;
  scannedFileId: number | null;
  scannedFilePath: string | null;
  scannedFileName: string | null;
  archiveContentId: number | null;
  archiveFileName: string | null;
  archivePath: string | null;
  archiveType: string | null;
}

/**
 * Sanitise un nom de fichier en remplaçant les caractères interdits
 */
function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim();
}

/**
 * Table de correspondance DAT name → systemId pour la compatibilité système
 */
const DAT_NAME_TO_SYSTEM: Array<{ pattern: RegExp; systemId: string }> = [
  // Sony
  { pattern: /playstation\s*2|ps2/i, systemId: 'ps2' },
  { pattern: /playstation\s*portable|psp/i, systemId: 'psp' },
  { pattern: /playstation|psx|ps1/i, systemId: 'psx' },
  // Sega
  { pattern: /dreamcast/i, systemId: 'dreamcast' },
  { pattern: /saturn/i, systemId: 'saturn' },
  { pattern: /sega\s*cd|mega\s*cd/i, systemId: 'segacd' },
  { pattern: /32x/i, systemId: 'sega32x' },
  { pattern: /mega\s*drive|genesis/i, systemId: 'genesis' },
  { pattern: /master\s*system/i, systemId: 'mastersystem' },
  { pattern: /game\s*gear/i, systemId: 'gamegear' },
  // Nintendo
  { pattern: /3ds/i, systemId: '3ds' },
  { pattern: /nintendo\s*ds|nds/i, systemId: 'nds' },
  { pattern: /game\s*boy\s*advance|gba/i, systemId: 'gba' },
  { pattern: /game\s*boy\s*color|gbc/i, systemId: 'gbc' },
  { pattern: /game\s*boy|gb(?!a|c)/i, systemId: 'gb' },
  { pattern: /gamecube|gc/i, systemId: 'gamecube' },
  { pattern: /wii(?!u)/i, systemId: 'wii' },
  { pattern: /super\s*nintendo|snes|super\s*famicom/i, systemId: 'snes' },
  { pattern: /nintendo\s*64|n64/i, systemId: 'n64' },
  { pattern: /nintendo\s*entertainment|nes|famicom(?!\s*disk)/i, systemId: 'nes' },
  // Arcade
  { pattern: /mame/i, systemId: 'mame' },
  { pattern: /final\s*burn|fba|fbneo/i, systemId: 'fba' },
  { pattern: /neo\s*geo/i, systemId: 'neogeo' },
  // Ordinateurs
  { pattern: /dos|ibm\s*pc/i, systemId: 'pc' },
  // Autres
  { pattern: /atari\s*2600/i, systemId: 'atari2600' },
  { pattern: /pc\s*engine|turbografx/i, systemId: 'pcengine' },
];

/**
 * Détecte le systemId à partir du nom du DAT
 */
function detectSystemFromDatName(datName: string): string {
  for (const entry of DAT_NAME_TO_SYSTEM) {
    if (entry.pattern.test(datName)) {
      return entry.systemId;
    }
  }
  return 'default';
}

/**
 * Retourne les formats autorisés pour un système, en se basant sur :
 * 1. Les settings utilisateur (systemCompatibility) — prioritaire
 * 2. Les valeurs par défaut (DEFAULT_SYSTEM_COMPATIBILITY) — fallback
 */
function getSystemAllowedFormats(
  systemId: string,
  settings: ReturnType<typeof settingsManager.getAll>
): ArchiveFormat[] {
  // Chercher dans les settings utilisateur
  const systemCompat = settings.systemCompatibility || DEFAULT_SYSTEM_COMPATIBILITY;
  const config = systemCompat.find(
    sc => sc.systemId.toLowerCase() === systemId.toLowerCase()
  );
  if (config && config.supportedFormats.length > 0) {
    return config.supportedFormats;
  }

  // Système non configuré : fallback zip + 7z
  return ['7z', 'zip'];
}

/**
 * Détermine le meilleur format d'archive pour un système donné
 * en croisant les formats autorisés (par système) avec la priorité utilisateur
 */
function determineTargetFormat(
  systemId: string,
  settings: ReturnType<typeof settingsManager.getAll>,
  chdPossible: boolean
): ArchiveFormat {
  const allowedFormats = getSystemAllowedFormats(systemId, settings);

  // Croiser la priorité utilisateur avec les formats autorisés du système
  for (const format of settings.archiveFormatPriority) {
    if (format === 'chd' && !chdPossible) continue;
    if (allowedFormats.includes(format)) {
      return format;
    }
  }

  // Fallback : premier format autorisé (hors CHD si impossible)
  for (const format of allowedFormats) {
    if (format === 'chd' && !chdPossible) continue;
    return format;
  }

  // Dernier recours
  return '7z';
}

/**
 * Extensions de fichiers acceptés comme point d'entrée pour chdman
 * (.bin seul n'est PAS suffisant — il faut un .cue, .gdi, .iso, etc.)
 */
const CHD_ENTRY_EXTENSIONS = ['.cue', '.gdi', '.iso', '.toc', '.nrg', '.cdi', '.ccd'];

/**
 * Vérifie si les ROMs d'un jeu contiennent un point d'entrée valide pour conversion CHD
 * Utilisé AVANT extraction pour décider si CHD est un format candidat
 */
function canConvertToChd(roms: MatchedRomInfo[]): boolean {
  return roms.some(rom => {
    const ext = path.extname(rom.datRomName).toLowerCase();
    return CHD_ENTRY_EXTENSIONS.includes(ext);
  });
}

/**
 * Trouve le fichier point d'entrée CHD parmi les fichiers extraits
 * Utilisé APRÈS extraction pour trouver le fichier à passer à chdman
 */
function findChdEntryPoint(filePaths: string[]): string | null {
  return filePaths.find(f =>
    CHD_ENTRY_EXTENSIONS.includes(path.extname(f).toLowerCase())
  ) || null;
}

/**
 * Consolide les ROMs : extrait, renomme, archive et déplace les fichiers
 */
export async function consolidateRoms(
  db: Database,
  onProgress?: ProgressCallback
): Promise<ConsolidationResult> {
  const settings = settingsManager.getAll();
  const archiveManager = new ArchiveManager();

  // Détecter le système à partir du DAT
  const datName = await getMetadata(db, 'dat_name') || '';
  const systemId = detectSystemFromDatName(datName);
  console.log(`Système détecté : "${systemId}" (depuis DAT : "${datName}")`);

  const result: ConsolidationResult = {
    stats: {
      totalGamesProcessed: 0,
      gamesConsolidated: 0,
      gamesSkipped: 0,
      gamesErrored: 0,
      romsExtracted: 0,
      archivesCreated: 0,
      unmatchedFilesMoved: 0
    },
    errors: []
  };

  // S'assurer que les dossiers existent
  await fs.mkdir(settings.validatedRomsFolder, { recursive: true });
  await fs.mkdir(settings.tempExtractionFolder, { recursive: true });
  if (settings.cleanSourceAfterConsolidation) {
    await fs.mkdir(settings.unmatchedRomsFolder, { recursive: true });
  }

  // Phase 1 : Récupérer les jeux sélectionnés ayant des matches
  onProgress?.({
    phase: 'preparing',
    currentGameIndex: 0,
    totalGames: 0,
    message: 'Préparation de la consolidation...'
  });

  // Uniquement les jeux complètement matchés (chaque ROM du DAT a au moins 1 match)
  const selectedGames = await db.all<{
    id: number;
    name: string;
    totalRoms: number;
    matchedRoms: number;
  }>(`
    SELECT
      g.id,
      g.name,
      (SELECT COUNT(*) FROM dat_roms dr WHERE dr.game_id = g.id) as totalRoms,
      (SELECT COUNT(DISTINCT dr.id) FROM dat_roms dr
       WHERE dr.game_id = g.id
       AND EXISTS (SELECT 1 FROM rom_matches rm WHERE rm.dat_rom_id = dr.id)
      ) as matchedRoms
    FROM games g
    WHERE g.is_selected != 0
    AND (SELECT COUNT(*) FROM dat_roms dr WHERE dr.game_id = g.id) =
        (SELECT COUNT(DISTINCT dr.id) FROM dat_roms dr
         WHERE dr.game_id = g.id
         AND EXISTS (SELECT 1 FROM rom_matches rm WHERE rm.dat_rom_id = dr.id))
    AND (SELECT COUNT(*) FROM dat_roms dr WHERE dr.game_id = g.id) > 0
    ORDER BY g.name
  `);

  result.stats.totalGamesProcessed = selectedGames.length;

  // Phase 2 : Consolider chaque jeu
  for (let i = 0; i < selectedGames.length; i++) {
    const game = selectedGames[i];

    onProgress?.({
      phase: 'consolidating',
      currentGame: game.name,
      currentGameIndex: i + 1,
      totalGames: selectedGames.length,
      message: `Consolidation de ${game.name}...`
    });

    try {
      await consolidateGame(db, game, settings, archiveManager, result, systemId);
    } catch (error: any) {
      result.stats.gamesErrored++;
      result.errors.push({ gameName: game.name, error: error.message || String(error) });
      console.error(`❌ Erreur consolidation ${game.name}:`, error);

      // Logger l'erreur en base
      await db.run(
        `INSERT INTO consolidation_log (game_id, game_name, status, roms_total, error_message)
         VALUES (?, ?, 'error', ?, ?)`,
        [game.id, game.name, game.totalRoms, error.message || String(error)]
      );
    }
  }

  // Phase 3 : Supprimer tous les fichiers matchés restants (si scope = all-matched)
  if (settings.cleanSourceAfterConsolidation && settings.cleanupScope === 'all-matched') {
    onProgress?.({
      phase: 'moving-unmatched',
      currentGameIndex: selectedGames.length,
      totalGames: selectedGames.length,
      message: 'Suppression des fichiers matchés restants (doublons)...'
    });

    await deleteAllMatchedFiles(db, settings.protectFilesForUnselectedGames);
  }

  // Phase 4 : Déplacer les fichiers non matchés (si cleanSourceAfterConsolidation activé)
  if (settings.cleanSourceAfterConsolidation) {
    onProgress?.({
      phase: 'moving-unmatched',
      currentGameIndex: selectedGames.length,
      totalGames: selectedGames.length,
      message: 'Déplacement des fichiers non matchés...'
    });

    await moveUnmatchedFiles(db, settings, result);
  }

  onProgress?.({
    phase: 'complete',
    currentGameIndex: selectedGames.length,
    totalGames: selectedGames.length,
    message: `Consolidation terminée : ${result.stats.gamesConsolidated} jeux consolidés`
  });

  return result;
}

/**
 * Sélectionne le meilleur match par ROM en fonction des priorités.
 *
 * recreateArchivesIfNeeded OFF :
 *   1. Archive complète (contenant TOUTES les ROMs) dans un format compatible, par ordre de priorité
 *   2. Fichiers loose
 *   3. Autres archives
 *
 * recreateArchivesIfNeeded ON :
 *   1. Fichiers loose
 *   2. Archives dans un format compatible, par ordre de priorité
 *   3. Autres archives
 */
function selectBestMatches(
  allMatches: MatchedRomInfo[],
  settings: ReturnType<typeof settingsManager.getAll>,
  systemId: string
): MatchedRomInfo[] {
  const allowedFormats = getSystemAllowedFormats(systemId, settings);
  const formatPriority = settings.archiveFormatPriority;

  // Grouper par datRomName (une ROM peut avoir plusieurs matches : loose + archive(s))
  const grouped = new Map<string, MatchedRomInfo[]>();
  for (const match of allMatches) {
    if (!grouped.has(match.datRomName)) grouped.set(match.datRomName, []);
    grouped.get(match.datRomName)!.push(match);
  }

  const romCount = grouped.size;

  // Quand recreateArchivesIfNeeded est OFF, chercher d'abord une archive unique
  // contenant TOUTES les ROMs dans un format compatible → copie directe possible
  if (!settings.recreateArchivesIfNeeded) {
    const archiveInfos = new Map<string, { format: string; matches: MatchedRomInfo[]; romNames: Set<string> }>();

    for (const [, matches] of grouped) {
      for (const match of matches) {
        if (match.archivePath) {
          if (!archiveInfos.has(match.archivePath)) {
            archiveInfos.set(match.archivePath, {
              format: match.archiveType || '',
              matches: [],
              romNames: new Set()
            });
          }
          const entry = archiveInfos.get(match.archivePath)!;
          if (!entry.romNames.has(match.datRomName)) {
            entry.romNames.add(match.datRomName);
            entry.matches.push(match);
          }
        }
      }
    }

    // Trouver les archives complètes dans un format compatible, triées par priorité
    // Note : le tri final est fait par priorité format ici (le tri par taille est géré
    // dans tryDirectArchiveCopy quand useBestCompression est activé)
    const completeArchives = [...archiveInfos.entries()]
      .filter(([, info]) => info.romNames.size === romCount)
      .filter(([, info]) => allowedFormats.includes(info.format as ArchiveFormat))
      .sort((a, b) => {
        const aIdx = formatPriority.indexOf(a[1].format as ArchiveFormat);
        const bIdx = formatPriority.indexOf(b[1].format as ArchiveFormat);
        return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
      });

    if (completeArchives.length > 0) {
      console.log(`[SelectMatch] Archive complète trouvée : "${path.basename(completeArchives[0][0])}" (${completeArchives[0][1].format})`);
      return completeArchives[0][1].matches;
    }
  }

  // Fallback : sélectionner le meilleur match par ROM individuellement
  function scoreMatch(match: MatchedRomInfo): number {
    const isLoose = !match.archivePath;
    const archiveFormat = (match.archiveType?.toLowerCase() || '') as ArchiveFormat;
    const isAllowedFormat = archiveFormat ? allowedFormats.includes(archiveFormat) : false;
    const formatIdx = formatPriority.indexOf(archiveFormat);

    if (!settings.recreateArchivesIfNeeded) {
      // Pas d'archive complète trouvée, fallback : loose > compatible archive > other
      if (isLoose) return 500;
      if (isAllowedFormat) return 400 - (formatIdx >= 0 ? formatIdx : 99);
      return 100;
    } else {
      // recreate ON : loose > compatible archive > other
      if (isLoose) return 1000;
      if (isAllowedFormat) return 500 - (formatIdx >= 0 ? formatIdx : 99);
      return 100;
    }
  }

  const result: MatchedRomInfo[] = [];
  for (const [, matches] of grouped) {
    matches.sort((a, b) => scoreMatch(b) - scoreMatch(a));
    result.push(matches[0]);
  }

  return result;
}

/**
 * Consolide un jeu individuel
 */
/**
 * Affiche un séparateur visuel pour démarquer le traitement d'un jeu dans les logs.
 */
function logGameHeader(gameName: string): void {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Jeu : ${gameName}`);
  console.log('═══════════════════════════════════════════════════════════════');
}

/**
 * Affiche dans les logs la liste des fichiers sources utilisés pour consolider un jeu.
 * Distingue les fichiers loose (chemin direct) des contenus d'archives (chemin complet
 * de l'archive + nom du fichier interne).
 */
function logSourceFiles(matchedRoms: MatchedRomInfo[]): void {
  console.log(`[1/4 Sélection] ${matchedRoms.length} fichier(s) à consolider :`);
  for (const rom of matchedRoms) {
    if (rom.archivePath && rom.archiveFileName) {
      console.log(`  • ${rom.datRomName}`);
      console.log(`      ↳ depuis archive : ${rom.archivePath}`);
      console.log(`      ↳ entrée interne  : ${rom.archiveFileName}`);
    } else if (rom.scannedFilePath) {
      console.log(`  • ${rom.datRomName}`);
      console.log(`      ↳ fichier loose : ${rom.scannedFilePath}`);
    } else {
      console.log(`  • ${rom.datRomName}  (source inconnue)`);
    }
  }
}

async function consolidateGame(
  db: Database,
  game: { id: number; name: string; totalRoms: number; matchedRoms: number },
  settings: ReturnType<typeof settingsManager.getAll>,
  archiveManager: ArchiveManager,
  result: ConsolidationResult,
  systemId: string
): Promise<void> {
  // Récupérer TOUS les matches pour ce jeu depuis rom_matches
  // scanned_file_id pointe toujours vers le fichier physique (loose ou archive)
  // archive_content_id est renseigné si le match vient d'un contenu d'archive
  const allMatches = await db.all<MatchedRomInfo>(`
    SELECT
      dr.name as datRomName,
      CASE WHEN rm.archive_content_id IS NULL THEN sf.id ELSE NULL END as scannedFileId,
      CASE WHEN rm.archive_content_id IS NULL THEN sf.file_path ELSE NULL END as scannedFilePath,
      CASE WHEN rm.archive_content_id IS NULL THEN sf.file_name ELSE NULL END as scannedFileName,
      rm.archive_content_id as archiveContentId,
      ac.file_name as archiveFileName,
      CASE WHEN rm.archive_content_id IS NOT NULL THEN sf.file_path ELSE NULL END as archivePath,
      CASE WHEN rm.archive_content_id IS NOT NULL THEN sf.archive_type ELSE NULL END as archiveType
    FROM dat_roms dr
    JOIN rom_matches rm ON rm.dat_rom_id = dr.id
    JOIN scanned_files sf ON rm.scanned_file_id = sf.id
    LEFT JOIN archive_contents ac ON rm.archive_content_id = ac.id
    WHERE dr.game_id = ?
    ORDER BY dr.name
  `, [game.id]);

  if (allMatches.length === 0) {
    result.stats.gamesSkipped++;
    return;
  }

  // En-tête visuel du jeu
  logGameHeader(game.name);

  // Sélectionner le meilleur match par ROM selon les priorités
  const matchedRoms = selectBestMatches(allMatches, settings, systemId);

  // Logger les fichiers sources qui seront utilisés pour ce jeu
  logSourceFiles(matchedRoms);

  const sanitizedName = sanitizeFileName(game.name);

  // Cas spécial CHD : si toutes les ROMs sont déjà des CHD, copier directement
  const allChd = matchedRoms.every(rom => {
    const ext = path.extname(rom.datRomName).toLowerCase();
    return ext === '.chd';
  });

  if (allChd) {
    console.log(`[2/4 Stratégie] toutes les ROMs sont déjà au format CHD → copie directe sans recompression`);
    await consolidateChdGame(db, game, matchedRoms, settings, result);
    return;
  }

  // Déterminer si le contenu peut être converti en CHD (point d'entrée .cue/.gdi/.iso présent)
  const chdPossible = canConvertToChd(matchedRoms);

  // Déterminer le format cible en fonction du système et des préférences
  const targetFormat = determineTargetFormat(systemId, settings, chdPossible);
  const allowedFormats = getSystemAllowedFormats(systemId, settings);

  if (settings.useBestCompression) {
    console.log(`[2/4 Stratégie] mode multi-format : tous les formats compatibles avec « ${systemId} » seront testés → [${allowedFormats.join(', ')}]${chdPossible ? '' : ' (CHD impossible : pas de point d\'entrée .cue/.gdi/.iso)'}`);
  } else {
    console.log(`[2/4 Stratégie] mode standard : format cible « ${targetFormat} » (système : ${systemId}, CHD possible : ${chdPossible})`);
  }

  // Si recreateArchivesIfNeeded est désactivé, vérifier si l'archive source peut être copiée directement
  // Cela s'applique même si useBestCompression est activé : une archive déjà parfaite n'a pas besoin d'être recompressée
  if (!settings.recreateArchivesIfNeeded) {
    if (allowedFormats.length > 0) {
      console.log(`[2/4 Stratégie] option « recréer les archives parfaites » désactivée → recherche d'une archive source réutilisable`);
      const directCopyResult = await tryDirectArchiveCopy(
        db, game, matchedRoms, settings, result, allowedFormats, sanitizedName, archiveManager
      );
      if (directCopyResult) return; // Archive copiée directement, pas besoin de recréer
    }
  }

  // Créer le dossier temporaire pour ce jeu (extraction + output)
  const tempDir = path.join(settings.tempExtractionFolder, `game-${game.id}`);
  const tempOutputDir = path.join(tempDir, 'output');
  await fs.mkdir(tempDir, { recursive: true });
  await fs.mkdir(tempOutputDir, { recursive: true });

  try {
    // Extraire/copier chaque ROM matchée dans le dossier temp
    console.log(`[3/4 Préparation] extraction des fichiers sources vers : ${tempDir}`);
    for (const rom of matchedRoms) {
      await extractRomToTemp(rom, tempDir, archiveManager);
      result.stats.romsExtracted++;
    }

    // Lister les fichiers bruts extraits (exclure le sous-dossier output)
    const tempFiles = (await fs.readdir(tempDir)).filter(f => f !== 'output');
    const filePaths = tempFiles.map(f => path.join(tempDir, f));

    if (filePaths.length === 0) {
      console.log(`[3/4 Préparation] aucun fichier extrait → jeu ignoré`);
      result.stats.gamesSkipped++;
      return;
    }

    console.log(`[3/4 Préparation] ${filePaths.length} fichier(s) prêts pour la compression :`);
    for (const fp of filePaths) {
      console.log(`    - ${path.basename(fp)}`);
    }

    // Tout se passe dans tempOutputDir, on copie le résultat final vers validatedRomsFolder
    const tempOutputBasePath = path.join(tempOutputDir, sanitizedName);
    let tempOutputPath: string;
    let finalFormat: string;

    if (settings.useBestCompression) {
      // Mode meilleure compression : tester plusieurs formats et garder le plus petit
      const result_best = await createBestCompressedArchive(
        filePaths, tempOutputBasePath, settings, archiveManager, systemId, chdPossible
      );
      tempOutputPath = result_best.outputPath;
      finalFormat = result_best.format;
    } else {
      // Mode standard : créer l'archive dans tempDir
      const archiveFiles = (targetFormat === 'chd')
        ? getChdInputFiles(filePaths)
        : filePaths;

      if (archiveFiles.length === 0) {
        console.warn(`[4/4 Compression] pas de point d'entrée CHD → fallback 7z`);
        // Fallback si CHD impossible
        tempOutputPath = await withTimeout(
          archiveManager.createArchive(filePaths, tempOutputBasePath,
            { archiveFormatPriority: ['7z'], compressionLevel: settings.compressionLevel,
              solidArchive: settings.solidArchive, multithreading: settings.multithreading },
            '7z' as any),
          ARCHIVE_CREATION_TIMEOUT_MS, `Création archive 7z (fallback) pour ${game.name}`
        );
        finalFormat = '7z';
      } else {
        console.log(`[4/4 Compression] création de l'archive ${targetFormat}…`);
        tempOutputPath = await withTimeout(
          archiveManager.createArchive(archiveFiles, tempOutputBasePath,
            { archiveFormatPriority: [targetFormat], compressionLevel: settings.compressionLevel,
              solidArchive: settings.solidArchive, multithreading: settings.multithreading },
            targetFormat as any),
          ARCHIVE_CREATION_TIMEOUT_MS, `Création archive ${targetFormat} pour ${game.name}`
        );
        finalFormat = targetFormat;
      }
    }

    // Copier le résultat final vers validatedRomsFolder
    const finalDestPath = path.join(settings.validatedRomsFolder, path.basename(tempOutputPath));
    await fs.copyFile(tempOutputPath, finalDestPath);
    console.log(`[✓ Terminé]      archive consolidée → ${finalDestPath}`);

    result.stats.archivesCreated++;
    result.stats.gamesConsolidated++;

    // Logger en base
    await db.run(
      `INSERT INTO consolidation_log (game_id, game_name, output_path, output_format, status, roms_consolidated, roms_total)
       VALUES (?, ?, ?, ?, 'success', ?, ?)`,
      [game.id, game.name, finalDestPath, finalFormat, matchedRoms.length, game.totalRoms]
    );

    // Supprimer les fichiers sources si demandé (vérification intelligente)
    if (settings.cleanSourceAfterConsolidation) {
      await tryDeleteSourceFiles(db, matchedRoms, settings.protectFilesForUnselectedGames);
    }

  } finally {
    // Nettoyer le dossier temporaire (y compris output et candidats ratés)
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignorer les erreurs de nettoyage
    }
  }
}

/**
 * Pour CHD : retourne uniquement le fichier point d'entrée (.cue, .gdi, .iso)
 * Pour les autres formats : retourne tous les fichiers
 */
function getChdInputFiles(filePaths: string[]): string[] {
  const entryPoint = findChdEntryPoint(filePaths);
  return entryPoint ? [entryPoint] : [];
}

/**
 * Timeout pour la création d'une archive (5 minutes par défaut)
 */
const ARCHIVE_CREATION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Enveloppe une promesse avec un timeout
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout (${timeoutMs / 1000}s) : ${label}`));
    }, timeoutMs);

    promise
      .then(value => { clearTimeout(timer); resolve(value); })
      .catch(err => { clearTimeout(timer); reject(err); });
  });
}

/**
 * Crée des archives dans plusieurs formats compatibles et garde la plus petite.
 * Tous les fichiers candidats sont créés dans le même dossier que tempOutputBasePath.
 * Les fichiers d'entrée (filePaths) sont les fichiers bruts déjà extraits — pas de re-décompression.
 */
async function createBestCompressedArchive(
  filePaths: string[],
  tempOutputBasePath: string,
  settings: ReturnType<typeof settingsManager.getAll>,
  archiveManager: ArchiveManager,
  systemId: string,
  chdPossible: boolean
): Promise<{ outputPath: string; format: string }> {
  const allowedFormats = getSystemAllowedFormats(systemId, settings);

  // Formats candidats : uniquement les formats autorisés pour le système
  const candidates: ArchiveFormat[] = allowedFormats.filter(f => {
    if (f === 'chd' && !chdPossible) return false;
    return true;
  });

  if (candidates.length === 0) {
    candidates.push('7z');
  }

  console.log(`[4/4 Compression] mode « tester tous les formats » : [${candidates.join(', ')}]`);

  // Tester chaque format et comparer les tailles
  const results: Array<{ format: string; path: string; size: number }> = [];

  for (const format of candidates) {
    const candidatePath = (candidates.length === 1)
      ? tempOutputBasePath
      : `${tempOutputBasePath}_candidate_${format}`;

    // Pour CHD : passer uniquement le fichier point d'entrée
    const inputFiles = (format === 'chd') ? getChdInputFiles(filePaths) : filePaths;

    if (inputFiles.length === 0) {
      console.warn(`  → ${format} : pas de point d'entrée CHD, ignoré`);
      continue;
    }

    try {
      const createdPath = await withTimeout(
        archiveManager.createArchive(
          inputFiles, candidatePath,
          {
            archiveFormatPriority: [format],
            compressionLevel: settings.compressionLevel,
            solidArchive: settings.solidArchive,
            multithreading: settings.multithreading
          },
          format as any
        ),
        ARCHIVE_CREATION_TIMEOUT_MS,
        `Création archive ${format}`
      );
      const stat = await fs.stat(createdPath);
      results.push({ format, path: createdPath, size: stat.size });
      console.log(`[4/4 Compression]   → ${format.padEnd(4)} : ${(stat.size / 1024 / 1024).toFixed(2)} Mo`);
    } catch (error: any) {
      console.warn(`[4/4 Compression]   → ${format.padEnd(4)} : ÉCHEC (${error.message})`);
    }
  }

  if (results.length === 0) {
    throw new Error('Aucun format d\'archive n\'a pu être créé');
  }

  // Trier par taille croissante (le plus petit en premier)
  results.sort((a, b) => a.size - b.size);
  const best = results[0];

  // Supprimer les candidats perdants (dans tempDir, sera nettoyé de toute façon)
  for (let i = 1; i < results.length; i++) {
    try { await fs.unlink(results[i].path); } catch { /* ignore */ }
  }

  // Si le meilleur a un suffixe _candidate_, le renommer
  if (best.path.includes('_candidate_')) {
    const ext = path.extname(best.path);
    const cleanPath = `${tempOutputBasePath}${ext}`;
    await fs.rename(best.path, cleanPath);
    best.path = cleanPath;
  }

  console.log(`[4/4 Compression] format retenu : ${best.format} (${(best.size / 1024 / 1024).toFixed(2)} Mo)`);
  return { outputPath: best.path, format: best.format };
}

/**
 * Tente de copier directement une archive source si elle est dans un format compatible
 * et contient toutes les ROMs du jeu (identifiées par hash).
 * Recherche directement en base, indépendamment du match sélectionné par le matching engine.
 * Retourne true si la copie directe a réussi, false sinon.
 */
async function tryDirectArchiveCopy(
  db: Database,
  game: { id: number; name: string; totalRoms: number; matchedRoms: number },
  matchedRoms: MatchedRomInfo[],
  settings: ReturnType<typeof settingsManager.getAll>,
  result: ConsolidationResult,
  allowedFormats: ArchiveFormat[],
  sanitizedName: string,
  archiveManager: ArchiveManager
): Promise<boolean> {
  const logPrefix = `[2/4 Stratégie]`;

  // Récupérer les hashes des ROMs attendues pour ce jeu
  const datRoms = await db.all<{ name: string; crc32: string; md5: string; sha1: string }>(`
    SELECT name, crc32, md5, sha1 FROM dat_roms WHERE game_id = ?
  `, [game.id]);

  if (datRoms.length === 0) return false;

  // Chercher toutes les archives qui contiennent AU MOINS une ROM du jeu (par hash)
  // Construire la liste des CRC32 attendus
  const expectedCrcs = datRoms.map(r => r.crc32).filter(Boolean);
  if (expectedCrcs.length === 0) {
    console.log(`${logPrefix} pas de CRC32 dans le DAT → recréation nécessaire`);
    return false;
  }

  // Chercher les archives candidates : archives dans un format compatible
  // qui contiennent des fichiers correspondant aux hashes du DAT
  const placeholders = expectedCrcs.map(() => '?').join(',');
  const candidateArchives = await db.all<{
    archive_id: number;
    archive_path: string;
    archive_type: string;
    archive_size: number;
    matched_count: number;
  }>(`
    SELECT
      sf.id as archive_id,
      sf.file_path as archive_path,
      sf.archive_type as archive_type,
      sf.size as archive_size,
      COUNT(DISTINCT ac.file_name) as matched_count
    FROM scanned_files sf
    JOIN archive_contents ac ON ac.archive_id = sf.id
    WHERE sf.is_archive = 1
      AND LOWER(ac.crc32) IN (${placeholders})
    GROUP BY sf.id
    HAVING matched_count >= ?
  `, [...expectedCrcs.map(c => c.toLowerCase()), datRoms.length]);

  if (candidateArchives.length === 0) {
    console.log(`${logPrefix} aucune archive existante ne contient toutes les ROMs → recréation nécessaire`);
    return false;
  }

  // Filtrer par format compatible et trier selon le mode
  const formatPriority = settings.archiveFormatPriority;
  const validCandidates = candidateArchives
    .filter(a => allowedFormats.includes(a.archive_type as ArchiveFormat))
    .sort((a, b) => {
      if (settings.useBestCompression) {
        // Mode meilleure compression : trier par taille croissante (la plus petite d'abord)
        return (a.archive_size || Infinity) - (b.archive_size || Infinity);
      }
      // Mode standard : trier par priorité format utilisateur
      const aIdx = formatPriority.indexOf(a.archive_type as ArchiveFormat);
      const bIdx = formatPriority.indexOf(b.archive_type as ArchiveFormat);
      return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
    });

  if (validCandidates.length === 0) {
    console.log(`${logPrefix} archives trouvées mais aucune dans un format compatible (${allowedFormats.join(', ')}) → recréation nécessaire`);
    return false;
  }

  if (settings.useBestCompression) {
    console.log(`${logPrefix} ${validCandidates.length} archive(s) source candidate(s) triée(s) par taille :`);
    for (const c of validCandidates) {
      console.log(`${logPrefix}   - ${c.archive_type.padEnd(4)} ${((c.archive_size || 0) / 1024 / 1024).toFixed(2)} Mo : ${c.archive_path}`);
    }
  }

  // Vérifier les candidats un par un
  for (const candidate of validCandidates) {
    const sourcePath = candidate.archive_path;

    // Vérifier que le fichier archive existe toujours
    try { await fs.access(sourcePath); } catch { continue; }

    // CHD : format monolithique, pas de listing/vérification de noms possible.
    // Si la DB confirme que tous les CRC matchent, copier directement.
    if (candidate.archive_type === 'chd') {
      const ext = path.extname(sourcePath);
      const destFileName = `${sanitizedName}${ext}`;
      const finalDestPath = path.join(settings.validatedRomsFolder, destFileName);

      await fs.copyFile(sourcePath, finalDestPath);
      console.log(`${logPrefix} archive source CHD réutilisable → copie directe sans recompression`);
      console.log(`${logPrefix}   source : ${sourcePath}`);
      console.log(`[✓ Terminé]      archive consolidée → ${finalDestPath}`);

      result.stats.archivesCreated++;
      result.stats.gamesConsolidated++;
      result.stats.romsExtracted += matchedRoms.length;

      await db.run(
        `INSERT INTO consolidation_log (game_id, game_name, output_path, output_format, status, roms_consolidated, roms_total)
         VALUES (?, ?, ?, ?, 'success', ?, ?)`,
        [game.id, game.name, finalDestPath, 'chd', matchedRoms.length, game.totalRoms]
      );

      if (settings.cleanSourceAfterConsolidation) {
        await tryDeleteSourceFiles(db, matchedRoms, settings.protectFilesForUnselectedGames);
      }

      return true;
    }

    // Formats non-monolithiques (zip, 7z, rar) : lister et vérifier le contenu
    let archiveContents: string[];
    try {
      const entries = await archiveManager.listArchive(sourcePath);
      archiveContents = entries.map(e => e.fileName);
    } catch (err: any) {
      console.log(`${logPrefix} impossible de lister l'archive "${sourcePath}" : ${err.message}`);
      continue;
    }

    // Récupérer le mapping fichier → CRC dans l'archive (depuis la base)
    const archiveFileHashes = await db.all<{ file_name: string; crc32: string }>(`
      SELECT file_name, crc32 FROM archive_contents WHERE archive_id = ?
    `, [candidate.archive_id]);

    const archiveCrcMap = new Map<string, string>();
    for (const f of archiveFileHashes) {
      archiveCrcMap.set(f.crc32?.toLowerCase(), f.file_name);
    }

    // Vérifier que chaque ROM du DAT a un fichier correspondant dans l'archive par CRC
    // et que les noms correspondent (sinon renommage nécessaire → pas de copie directe)
    let allNamesMatch = true;
    const matchedArchiveFiles = new Set<string>();

    for (const datRom of datRoms) {
      const archiveFileName = archiveCrcMap.get(datRom.crc32?.toLowerCase());
      if (!archiveFileName) {
        allNamesMatch = false;
        break;
      }
      matchedArchiveFiles.add(archiveFileName);
      if (archiveFileName !== datRom.name) {
        console.log(`${logPrefix} nom dans archive "${archiveFileName}" ≠ nom DAT "${datRom.name}" dans "${path.basename(sourcePath)}" → candidat ignoré`);
        allNamesMatch = false;
        break;
      }
    }

    if (!allNamesMatch) continue;

    // Fichiers en trop dans l'archive
    const extraFiles = archiveContents.filter(f => !matchedArchiveFiles.has(f));

    const ext = path.extname(sourcePath);
    const destFileName = `${sanitizedName}${ext}`;
    const finalDestPath = path.join(settings.validatedRomsFolder, destFileName);

    if (extraFiles.length === 0) {
      // Archive parfaite : copier directement
      await fs.copyFile(sourcePath, finalDestPath);
      console.log(`${logPrefix} archive source ${candidate.archive_type} parfaite → copie directe sans recompression`);
      console.log(`${logPrefix}   source : ${sourcePath}`);
      console.log(`[✓ Terminé]      archive consolidée → ${finalDestPath}`);
    } else {
      // Archive avec fichiers en trop : copier dans tempDir, supprimer les extras
      const tempDir = path.join(settings.tempExtractionFolder, `game-${game.id}-copy`);
      await fs.mkdir(tempDir, { recursive: true });
      try {
        const tempArchivePath = path.join(tempDir, destFileName);
        await fs.copyFile(sourcePath, tempArchivePath);

        await archiveManager.deleteFilesFromArchive(tempArchivePath, extraFiles);
        console.log(`${logPrefix} archive source ${candidate.archive_type} réutilisable après nettoyage de ${extraFiles.length} fichier(s) en trop`);
        console.log(`${logPrefix}   source : ${sourcePath}`);

        await fs.copyFile(tempArchivePath, finalDestPath);
        console.log(`[✓ Terminé]      archive consolidée → ${finalDestPath}`);
      } finally {
        try { await fs.rm(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }

    result.stats.archivesCreated++;
    result.stats.gamesConsolidated++;
    result.stats.romsExtracted += matchedRoms.length;

    await db.run(
      `INSERT INTO consolidation_log (game_id, game_name, output_path, output_format, status, roms_consolidated, roms_total)
       VALUES (?, ?, ?, ?, 'success', ?, ?)`,
      [game.id, game.name, finalDestPath, candidate.archive_type, matchedRoms.length, game.totalRoms]
    );

    if (settings.cleanSourceAfterConsolidation) {
      await tryDeleteSourceFiles(db, matchedRoms, settings.protectFilesForUnselectedGames);
    }

    return true;
  }

  console.log(`${logPrefix} aucune archive source réutilisable → recréation nécessaire`);
  return false;
}

/**
 * Consolide un jeu dont toutes les ROMs sont des CHD
 * Les CHD ne sont pas re-archivés, juste copiés/renommés
 */
async function consolidateChdGame(
  db: Database,
  game: { id: number; name: string; totalRoms: number },
  matchedRoms: MatchedRomInfo[],
  settings: ReturnType<typeof settingsManager.getAll>,
  result: ConsolidationResult
): Promise<void> {
  const sanitizedName = sanitizeFileName(game.name);

  // Si un seul CHD, le copier directement
  // Si plusieurs, créer un sous-dossier
  const targetDir = matchedRoms.length > 1
    ? path.join(settings.validatedRomsFolder, sanitizedName)
    : settings.validatedRomsFolder;

  await fs.mkdir(targetDir, { recursive: true });

  for (const rom of matchedRoms) {
    const sourcePath = rom.scannedFilePath || rom.archivePath;
    if (!sourcePath) continue;

    const expectedName = rom.datRomName;
    const currentName = rom.scannedFileName || rom.archiveFileName || '';

    // Vérifier si le nom correspond déjà
    const targetPath = path.join(targetDir, expectedName);

    if (currentName === expectedName) {
      // Nom correct, copier directement
      await fs.copyFile(sourcePath, targetPath);
    } else {
      // Renommer en copiant
      await fs.copyFile(sourcePath, targetPath);
    }

    result.stats.romsExtracted++;
  }

  result.stats.gamesConsolidated++;

  await db.run(
    `INSERT INTO consolidation_log (game_id, game_name, output_path, output_format, status, roms_consolidated, roms_total)
     VALUES (?, ?, ?, 'chd', 'success', ?, ?)`,
    [game.id, game.name, targetDir, matchedRoms.length, game.totalRoms]
  );

  if (settings.cleanSourceAfterConsolidation) {
    await tryDeleteSourceFiles(db, matchedRoms, settings.protectFilesForUnselectedGames);
  }
}

/**
 * Extrait/copie une ROM matchée dans le dossier temporaire avec le nom du DAT
 */
async function extractRomToTemp(
  rom: MatchedRomInfo,
  tempDir: string,
  archiveManager: ArchiveManager
): Promise<void> {
  const targetPath = path.join(tempDir, rom.datRomName);

  if (rom.archiveContentId && rom.archivePath && rom.archiveFileName) {
    // ROM dans une archive : extraire le fichier spécifique
    const extractDir = path.join(tempDir, '_extract_tmp');
    await fs.mkdir(extractDir, { recursive: true });

    try {
      await archiveManager.extractArchive(rom.archivePath, extractDir, [rom.archiveFileName]);

      // Le fichier extrait peut être dans un sous-dossier
      const extractedPath = path.join(extractDir, rom.archiveFileName);

      // Renommer/déplacer vers le nom du DAT
      await fs.rename(extractedPath, targetPath);
    } finally {
      // Nettoyer le dossier d'extraction temporaire
      try {
        await fs.rm(extractDir, { recursive: true, force: true });
      } catch {
        // Ignorer
      }
    }
  } else if (rom.scannedFilePath) {
    // Fichier loose : copier et renommer
    await fs.copyFile(rom.scannedFilePath, targetPath);
  }
}

/**
 * Vérifie si un fichier source peut être supprimé en toute sécurité.
 * Un fichier est encore nécessaire si :
 * - Il est référencé par un rom_match d'un jeu qui n'a pas encore été consolidé avec succès
 * - Si protectUnselected est true, les fichiers servant à des jeux non sélectionnés sont aussi protégés
 */
async function canDeleteSourceFile(db: Database, sourcePath: string, protectUnselected: boolean): Promise<boolean> {
  // Chercher si ce fichier est encore nécessaire pour d'autres jeux non consolidés
  // scanned_file_id pointe vers le fichier physique (loose ou archive)
  const query = protectUnselected
    ? `SELECT 1 FROM rom_matches rm
       JOIN dat_roms dr ON rm.dat_rom_id = dr.id
       JOIN games g ON dr.game_id = g.id
       JOIN scanned_files sf ON rm.scanned_file_id = sf.id
       LEFT JOIN consolidation_log cl ON cl.game_id = g.id AND cl.status = 'success'
       WHERE sf.file_path = ?
       AND cl.id IS NULL
       LIMIT 1`
    : `SELECT 1 FROM rom_matches rm
       JOIN dat_roms dr ON rm.dat_rom_id = dr.id
       JOIN games g ON dr.game_id = g.id
       JOIN scanned_files sf ON rm.scanned_file_id = sf.id
       LEFT JOIN consolidation_log cl ON cl.game_id = g.id AND cl.status = 'success'
       WHERE sf.file_path = ?
       AND cl.id IS NULL
       AND g.is_selected != 0
       LIMIT 1`;

  const stillNeeded = await db.get(query, [sourcePath]);
  return !stillNeeded;
}

/**
 * Tente de supprimer les fichiers sources des ROMs matchées,
 * en vérifiant d'abord qu'ils ne sont plus nécessaires pour d'autres jeux
 */
async function tryDeleteSourceFiles(
  db: Database,
  matchedRoms: MatchedRomInfo[],
  protectUnselected: boolean
): Promise<void> {
  const checkedPaths = new Set<string>();

  for (const rom of matchedRoms) {
    const sourcePath = rom.scannedFilePath || rom.archivePath;
    if (!sourcePath || checkedPaths.has(sourcePath)) continue;
    checkedPaths.add(sourcePath);

    try {
      if (await canDeleteSourceFile(db, sourcePath, protectUnselected)) {
        await fs.unlink(sourcePath);
        console.log(`Source supprimée : ${path.basename(sourcePath)}`);
      }
    } catch {
      // Fichier déjà supprimé ou inaccessible
    }
  }
}

/**
 * Supprime tous les fichiers matchés (pas seulement ceux utilisés pour la consolidation).
 * Utilisé quand cleanupScope === 'all-matched'.
 */
async function deleteAllMatchedFiles(db: Database, protectUnselected: boolean): Promise<void> {
  // Récupérer tous les fichiers physiques ayant au moins un match
  const matchedFiles = await db.all<{ file_path: string }>(`
    SELECT DISTINCT sf.file_path
    FROM scanned_files sf
    WHERE EXISTS (
      SELECT 1 FROM rom_matches rm WHERE rm.scanned_file_id = sf.id
    )
  `);

  for (const file of matchedFiles) {
    try {
      // Vérifier que le fichier existe encore (pas déjà supprimé lors de la phase per-game)
      await fs.access(file.file_path);
      if (await canDeleteSourceFile(db, file.file_path, protectUnselected)) {
        await fs.unlink(file.file_path);
        console.log(`Source supprimée (all-matched) : ${path.basename(file.file_path)}`);
      }
    } catch {
      // Fichier déjà supprimé ou inaccessible
    }
  }
}

/**
 * Déplace les fichiers non matchés vers le dossier unmatchedRomsFolder
 */
async function moveUnmatchedFiles(
  db: Database,
  settings: ReturnType<typeof settingsManager.getAll>,
  result: ConsolidationResult
): Promise<void> {
  // Récupérer les fichiers loose non matchés
  const unmatchedFiles = await db.all<{
    id: number;
    file_path: string;
    file_name: string;
  }>(`
    SELECT
      sf.id,
      sf.file_path,
      sf.file_name
    FROM scanned_files sf
    WHERE sf.is_archive = 0
    AND NOT EXISTS (
      SELECT 1 FROM rom_matches rm
      WHERE rm.scanned_file_id = sf.id AND rm.archive_content_id IS NULL
    )
  `);

  // Récupérer les archives dont aucun contenu n'est matché
  const unmatchedArchives = await db.all<{
    id: number;
    file_path: string;
    file_name: string;
  }>(`
    SELECT DISTINCT
      sf.id,
      sf.file_path,
      sf.file_name
    FROM scanned_files sf
    WHERE sf.is_archive = 1
    AND NOT EXISTS (
      SELECT 1 FROM rom_matches rm
      WHERE rm.archive_content_id IN (
        SELECT ac.id FROM archive_contents ac WHERE ac.archive_id = sf.id
      )
    )
  `);

  const allUnmatched = [...unmatchedFiles, ...unmatchedArchives];

  for (const file of allUnmatched) {
    try {
      // Vérifier que le fichier existe encore
      try {
        await fs.access(file.file_path);
      } catch {
        continue; // Fichier déjà supprimé
      }

      const destPath = path.join(settings.unmatchedRomsFolder, file.file_name);

      // Gérer les conflits de noms
      let finalDestPath = destPath;
      let counter = 1;
      while (true) {
        try {
          await fs.access(finalDestPath);
          // Le fichier existe, ajouter un suffixe
          const ext = path.extname(file.file_name);
          const base = path.basename(file.file_name, ext);
          finalDestPath = path.join(settings.unmatchedRomsFolder, `${base}_${counter}${ext}`);
          counter++;
        } catch {
          break; // Le fichier n'existe pas, on peut utiliser ce chemin
        }
      }

      await fs.rename(file.file_path, finalDestPath);

      // Logger en base
      await db.run(
        `INSERT INTO unmatched_moves (original_path, destination_path, status)
         VALUES (?, ?, 'success')`,
        [file.file_path, finalDestPath]
      );

      result.stats.unmatchedFilesMoved++;
    } catch (error: any) {
      // Logger l'erreur mais continuer
      await db.run(
        `INSERT INTO unmatched_moves (original_path, destination_path, status)
         VALUES (?, ?, 'error')`,
        [file.file_path, settings.unmatchedRomsFolder]
      );
      console.error(`Erreur déplacement ${file.file_name}:`, error);
    }
  }
}
