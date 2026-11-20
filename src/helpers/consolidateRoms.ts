// src/helpers/consolidateRoms.ts

import { Database, getMetadata } from '../database/init.js';
import {
  settingsManager,
  ArchiveFormat,
  ArcadeTargetSetMode,
  getEffectiveValidatedRomsFolder,
  getEffectiveUnmatchedRomsFolder,
  getEffectiveTempExtractionFolder
} from './settingsManager.js';
import { detectSystemFromDatName as detectSystem } from '../config/systems.js';
import { ArchiveManager } from './archives/ArchiveManager.js';
import {
  recordConsolidatedArchive,
  recordConsolidatedRawFiles,
  cleanupStaleScannedFiles,
  type ConsolidatedRomEntry
} from './recordConsolidation.js';
import { systemProfileManager } from './systemProfiles/index.js';
import type { SystemProfile } from './systemProfiles/index.js';
import type { MatchedRomInfo } from './systemProfiles/types.js';
import {
  getSystemAllowedFormats, determineTargetFormat, findChdEntryPoint, CHD_ENTRY_EXTENSIONS,
  systemAcceptsM3u, withM3uCompatibleFormats
} from './systemProfiles/rules.js';
import { buildM3uGroups, writeM3uFiles } from './m3uWriter.js';
// Ré-exports de compatibilité : ces helpers vivent désormais dans systemProfiles/rules.
export { getSystemAllowedFormats, determineTargetFormat } from './systemProfiles/rules.js';
import { OperationSignal, OperationAbortedError, raceAbort, throwIfAborted } from './operationSignal.js';
import { SourceCleaner, type GameCleanupRecord } from './sourceCleanup.js';
import { isInsideFolder } from './sourceCleanupPlan.js';
import path from 'path';
import fs from 'fs/promises';

/**
 * Mode debug activable via variable d'env `RUMCET_DEBUG=1`. Contrôle la verbosité
 * des logs de consolidation (listing détaillé des fichiers extraits, diagnostics
 * pré-archivage, dump du tempDir, etc.). En mode normal seuls les warnings
 * lors d'anomalies apparaissent — les traces de debug de Phase 6 restent
 * accessibles à la demande pour investigation future.
 */
const RUMCET_DEBUG = process.env.RUMCET_DEBUG === '1' || process.env.RUMCET_DEBUG === 'true';

/** Étape du jeu en cours ('done' | 'skipped' | 'error' | 'aborted' = issue du jeu) */
export type ConsolidationStep =
  | 'analyzing' | 'direct-copy' | 'extracting' | 'compressing' | 'copying' | 'cleaning'
  | 'done' | 'skipped' | 'error' | 'aborted';

/** Stratégie appliquée au jeu en cours */
export type ConsolidationMode = 'standard' | 'best' | 'direct' | 'raw' | 'chd-copy';

/** Format cible étudié (ou archive source candidate en copie directe) */
export interface FormatCandidate {
  /** Identifiant unique dans la liste (format, ou chemin de l'archive source) */
  id: string;
  /** Format : 7z, zip, chd, raw… */
  format: string;
  /** Libellé complémentaire (nom de l'archive source en copie directe) */
  label?: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'rejected' | 'chosen';
  /** Taille en octets (archive créée, ou archive source) */
  size?: number;
  /** Clé i18n (index.consolidationModal.notes.*) expliquant un statut skipped/rejected/failed */
  note?: string;
}

export interface ConsolidationProgress {
  phase: 'preparing' | 'consolidating' | 'moving-unmatched' | 'complete';
  currentGame?: string;
  currentGameIndex: number;
  totalGames: number;
  /** Clé i18n du message (résolue dans la langue de l'UI par le renderer). */
  key: string;
  /** Paramètres d'interpolation {nom} de la clé. */
  params?: Record<string, string | number>;
  /** Détail du jeu en cours */
  step?: ConsolidationStep;
  mode?: ConsolidationMode;
  formats?: FormatCandidate[];
  /** Format retenu pour le jeu en cours */
  chosenFormat?: string;
  /** Message d'erreur du jeu (step = 'error') */
  error?: string;
  /** Compteurs cumulés */
  consolidated?: number;
  errored?: number;
  skipped?: number;
  /** Consolidation interrompue par l'utilisateur (phase 'complete') */
  cancelled?: boolean;
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
    /** Nettoyage : fichiers et archives sources supprimés */
    sourcesDeleted: number;
    /** Nettoyage : archives dont des fichiers inutiles ont été retirés */
    archivesCleaned: number;
    /** Nettoyage : archives dont les non matchés ont été séparés dans une nouvelle archive */
    archivesSplit: number;
    /** Fichiers sans lien avec le DAT laissés dans le dossier cible (jamais déplacés) */
    unmatchedInTarget: number;
    cleanupErrors: number;
    /** Jeux non traités (consolidation interrompue) */
    gamesRemaining?: number;
  };
  errors: Array<{ gameName: string; error: string }>;
  /** Interrompue par l'utilisateur : passe finale (déplacement des non matchés) non exécutée */
  cancelled?: boolean;
  /** Option .m3u active et applicable : jeux multi-disques détectés et .m3u produits */
  m3u?: {
    /** Jeux multi-disques consolidés sans 7z/zip (CHD ou fichiers bruts) */
    forcedGames: number;
    created: number;
    skipped: number;
  };
}

type ProgressCallback = (progress: ConsolidationProgress) => void;

/**
 * État affichable du jeu en cours (étape, stratégie, formats étudiés, format retenu).
 * Chaque modification est réémise via le callback.
 */
class GameProgressReporter {
  private state: { step?: ConsolidationStep; mode?: ConsolidationMode; formats: FormatCandidate[]; chosenFormat?: string; error?: string } = { formats: [] };

  constructor(private readonly emit: (state: GameProgressReporter['state']) => void) {}

  private flush(): void {
    this.emit({ ...this.state, formats: this.state.formats.map(f => ({ ...f })) });
  }

  step(step: ConsolidationStep, error?: string): void {
    this.state.step = step;
    if (error !== undefined) this.state.error = error;
    this.flush();
  }

  mode(mode: ConsolidationMode): void {
    this.state.mode = mode;
    this.flush();
  }

  /** Remplace la liste des formats étudiés (et oublie le format retenu) */
  setFormats(formats: FormatCandidate[]): void {
    this.state.formats = formats.map(f => ({ ...f }));
    this.state.chosenFormat = undefined;
    this.flush();
  }

  updateFormat(id: string, patch: Partial<FormatCandidate>): void {
    const candidate = this.state.formats.find(f => f.id === id);
    if (candidate) Object.assign(candidate, patch);
    this.flush();
  }

  /** Marque un candidat comme retenu */
  chosen(id: string): void {
    const candidate = this.state.formats.find(f => f.id === id);
    if (candidate) {
      candidate.status = 'chosen';
      this.state.chosenFormat = candidate.format;
    }
    this.flush();
  }

  get chosenFormat(): string | undefined {
    return this.state.chosenFormat;
  }
}

/** Contexte d'exécution d'un jeu : affichage de la progression et interruption */
interface GameRunContext {
  reporter?: GameProgressReporter;
  signal?: OperationSignal;
  /** Sources réellement utilisées et fichiers produits (nettoyage des sources) */
  cleanup?: GameCleanupRecord;
}

/** Mémorise la source d'une ROM utilisée pour le jeu (pour le nettoyage). */
function recordSource(ctx: GameRunContext | undefined, rom: MatchedRomInfo): void {
  if (ctx?.cleanup && rom.sourceFileId) {
    ctx.cleanup.sources.push({ fileId: rom.sourceFileId, contentId: rom.archiveContentId ?? null });
  }
}

/** Mémorise un fichier produit dans le dossier cible (jamais nettoyé). */
function recordOutput(ctx: GameRunContext | undefined, outputPath: string): void {
  ctx?.cleanup?.outputs.push(outputPath);
}

/**
 * Copie un fichier vers le dossier cible sans jamais y laisser de copie partielle :
 * copie vers un fichier temporaire, puis renommage (qui remplace l'éventuel fichier
 * existant). Si un arrêt forcé survient pendant la copie, le temporaire est supprimé
 * et le fichier existant reste intact.
 */
async function copyToTarget(source: string, dest: string, ctx?: GameRunContext): Promise<void> {
  throwIfAborted(ctx?.signal);
  const partial = `${dest}.rumcet-tmp`;
  try {
    await fs.copyFile(source, partial);
    throwIfAborted(ctx?.signal);
    await fs.rename(partial, dest);
  } catch (error) {
    try { await fs.unlink(partial); } catch { /* déjà absent */ }
    throw error;
  }
}

/** Candidats du mode « meilleure compression » (CHD ignoré sans point d'entrée) */
function bestCompressionCandidates(allowedFormats: ArchiveFormat[], chdPossible: boolean): FormatCandidate[] {
  const list: FormatCandidate[] = allowedFormats.map(f => (f === 'chd' && !chdPossible)
    ? { id: f, format: f, status: 'skipped' as const, note: 'chdNoEntryPoint' }
    : { id: f, format: f, status: 'pending' as const });
  if (!list.some(f => f.status === 'pending')) {
    list.push({ id: '7z', format: '7z', status: 'pending' });
  }
  return list;
}

/**
 * Sanitise un nom de fichier en remplaçant les caractères interdits
 */
export function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim();
}

/**
 * Détecte le systemId à partir du nom du DAT.
 * Délègue à src/config/systems.ts. Retourne 'default' si aucun match.
 */
export function detectSystemFromDatName(datName: string): string {
  return detectSystem(datName)?.systemId ?? 'default';
}

/**
 * Nom de sortie d'un CHD : le name de la balise <disk> suffixé de .chd
 * (les <disk> MAME n'ont pas d'extension). Idempotent si déjà présent.
 */
function chdOutputName(rom: MatchedRomInfo): string {
  return rom.datRomName.toLowerCase().endsWith('.chd')
    ? rom.datRomName
    : `${rom.datRomName}.chd`;
}

/**
 * Copie les disques CHD d'un jeu tels quels (aucune extraction / recompression),
 * dans un sous-dossier au nom du jeu à côté de l'archive (convention MAME :
 * <jeu>/<disque>.chd). Utilisé pour les jeux "ROMs + CHD" ; les jeux 100 % CHD
 * passent par consolidateChdGame.
 */
async function copyChdDisksToOutput(
  db: Database,
  game: { id: number; name: string },
  diskRoms: MatchedRomInfo[],
  gameOutDir: string,
  result: ConsolidationResult,
  ctx?: GameRunContext
): Promise<void> {
  if (diskRoms.length === 0) return;
  const chdDir = path.join(gameOutDir, sanitizeFileName(game.name));
  await fs.mkdir(chdDir, { recursive: true });

  for (const rom of diskRoms) {
    const source = rom.archivePath || rom.scannedFilePath;
    if (!source) {
      console.warn(`[CHD] no source path for disk "${rom.datRomName}" — skipped`);
      continue;
    }
    const target = path.join(chdDir, chdOutputName(rom));
    await copyToTarget(source, target, ctx);
    recordSource(ctx, rom);
    recordOutput(ctx, target);
    console.log(`[CHD] disk copied as-is (no extraction) → ${target}`);
    result.stats.romsExtracted++;

    try {
      await recordConsolidatedArchive(db, target, chdDir, 'chd', [{
        datRomId: rom.datRomId,
        fileName: rom.datRomName,
        size: rom.datRomSize ?? 0,
        crc32: rom.datRomCrc32,
        md5: rom.datRomMd5,
        sha1: rom.datRomSha1
      }]);
    } catch (recErr) {
      console.warn(`[recordConsolidation] CHD disk recording failed: ${recErr}`);
    }
  }
}

/**
 * Consolide les ROMs : extrait, renomme, archive et déplace les fichiers
 */
export async function consolidateRoms(
  db: Database,
  onProgress?: ProgressCallback,
  signal?: OperationSignal
): Promise<ConsolidationResult> {
  const settings = settingsManager.getAll();
  // Résoudre les dossiers cibles effectifs (avec sous-dossier système si mode multi-système)
  settings.validatedRomsFolder = await getEffectiveValidatedRomsFolder(db);
  settings.unmatchedRomsFolder = await getEffectiveUnmatchedRomsFolder(db);
  settings.tempExtractionFolder = await getEffectiveTempExtractionFolder(db);
  const archiveManager = new ArchiveManager();

  // Détecter le système à partir du DAT
  const datName = await getMetadata(db, 'dat_name') || '';
  const systemId = detectSystemFromDatName(datName);
  console.log(`Detected system: "${systemId}" (from DAT: "${datName}")`);

  // Phase 4/5 — Mode arcade cible + détection si le DAT porte les concepts arcade.
  // Détermine si l'on filtre les dat_roms par merge_name (split) et si l'on
  // injecte des jeux auto-sélectionnés (BIOS/parents/devices requis par cascade).
  const targetMode: ArcadeTargetSetMode = settings.arcadeTargetSetMode || 'split';
  const datSetMode = await getMetadata(db, 'dat_set_mode');
  const scannedSetMode = await getMetadata(db, 'scanned_set_mode');
  const datIsArcade = !!(datSetMode && datSetMode !== 'n/a');
  // Profil système pour la consolidation. forConsolidation force le profil arcade
  // quand le DAT porte des concepts arcade (dat_set_mode ≠ 'n/a'), reproduisant
  // exactement l'ancien gate `datIsArcade`.
  const profile = systemProfileManager.forConsolidation(systemId, datSetMode);
  if (datIsArcade) {
    console.log('');
    console.log('───── Arcade mode ─────');
    console.log(`  DAT       : "${datSetMode}"`);
    console.log(`  Scanned   : "${scannedSetMode || 'unknown'}"`);
    console.log(`  Target    : "${targetMode}"`);
    // Récap des flux prévisibles pour aider à comprendre les logs qui suivent
    if (targetMode === 'split' && scannedSetMode === 'non-merged') {
      console.log(`  Flow      : ROMs shared with the parent will be extracted from the clone's archive`);
      console.log(`              and moved into the parent's archive (deduplication).`);
    } else if (targetMode === 'non-merged' && (scannedSetMode === 'split' || datSetMode === 'split')) {
      console.log(`  Flow      : ROMs shared from the parent will be inlined into their clones' archives`);
      console.log(`              (each clone becomes self-contained).`);
    } else if (targetMode === 'split') {
      console.log(`  Flow      : each archive contains only the game's own ROMs.`);
    } else if (targetMode === 'non-merged') {
      console.log(`  Flow      : each archive contains all required ROMs (self-contained, except BIOS).`);
    } else if (targetMode === 'merged') {
      console.log(`  Flow      : each parent merges its clones (one archive per family).`);
      console.log(`              Clones' own ROMs go into {cloneName}/ subfolders.`);
    }
    console.log('───────────────────────');
  }

  // Phase 4 — Résoudre la cascade de dépendances (BIOS, parents, devices requis
  // par les jeux user-sélectionnés). Ces auto-sélectionnés doivent être consolidés
  // au même titre que les user-sélectionnés, sinon les archives produites seront
  // inutilisables (manque le BIOS, le parent, etc.).
  let autoIds: number[] = [];
  if (datIsArcade) {
    try {
      const dep = await profile.resolveDependencies(db, targetMode);
      if (dep) {
        autoIds = [...dep.states.entries()].filter(([, s]) => s === 'auto').map(([id]) => id);
        if (autoIds.length > 0) {
          console.log(`Cascade: ${autoIds.length} auto-required game(s) (BIOS / parents / devices) added to consolidation.`);
        }
      }
    } catch (err) {
      console.warn(`Cascade: dependency resolution failed — consolidating user-selected games only (${err})`);
    }
  }

  // Phase 5 — Pré-check : en mode non-merged (et merged fallback), un clone doit
  // avoir TOUTES ses ROMs matchées, y compris les merge_name'd (à récupérer depuis
  // l'archive du parent). Si le parent est absent du romset, le clone ne pourra
  // pas être consolidé (il sera silencieusement skippé par la query principale).
  // On liste ces cas pour que l'utilisateur comprenne pourquoi certains clones
  // sélectionnés n'apparaissent pas dans le résultat.
  if (datIsArcade && targetMode !== 'split') {
    const incompleteClones = await db.all<{ clone_name: string; parent_name: string | null; missing: number }>(`
      SELECT
        g.name AS clone_name,
        g.parent_name_ref AS parent_name,
        COUNT(dr.id) AS missing
      FROM games g
      JOIN dat_roms dr ON dr.game_id = g.id
      WHERE g.is_selected != 0
        AND dr.merge_name IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM rom_matches rm WHERE rm.dat_rom_id = dr.id)
      GROUP BY g.id, g.name, g.parent_name_ref
      LIMIT 20
    `);
    if (incompleteClones.length > 0) {
      console.warn('');
      console.warn(`⚠️  Mode "${targetMode}": ${incompleteClones.length} selected clone(s) cannot be consolidated`);
      console.warn(`    (ROMs shared with the parent not found — the parent is absent or incomplete in the scanned romset):`);
      for (const c of incompleteClones) {
        console.warn(`      • ${c.clone_name} → ${c.missing} missing ROM(s) from parent "${c.parent_name || '?'}"`);
      }
      console.warn(`    To consolidate them, add the parent's romset or switch to "split" mode (each clone contains only its own ROMs).`);
      console.warn('');
    }
  }

  const result: ConsolidationResult = {
    stats: {
      totalGamesProcessed: 0,
      gamesConsolidated: 0,
      gamesSkipped: 0,
      gamesErrored: 0,
      romsExtracted: 0,
      archivesCreated: 0,
      unmatchedFilesMoved: 0,
      sourcesDeleted: 0,
      archivesCleaned: 0,
      archivesSplit: 0,
      unmatchedInTarget: 0,
      cleanupErrors: 0,
      gamesRemaining: 0
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
    key: 'logs.consolidation.progress.preparing'
  });

  // Phase 4 — Filtrage des dat_roms selon le mode cible (split exclut les
  // ROMs merge_name'd qui appartiennent au parent). Le filtre est appliqué dans
  // les sous-requêtes COUNT pour ne compter que les ROMs effectivement requises
  // dans l'archive du jeu cible.
  const cond = profile.romsSqlCondition(targetMode, 'dr');

  // Cascade : inclure les jeux auto-sélectionnés en plus des user-sélectionnés.
  // Via une table temporaire — une liste IN(?,?,…) dépasserait la limite de
  // variables SQLite (« too many SQL variables ») quand la cascade tire des
  // milliers de parents/BIOS/devices sur un DAT MAME complet.
  let autoIdsClause = '';
  if (autoIds.length > 0) {
    await db.exec(`
      CREATE TEMP TABLE IF NOT EXISTS temp_consolidation_auto_ids (id INTEGER PRIMARY KEY);
      DELETE FROM temp_consolidation_auto_ids;
    `);
    const ID_CHUNK = 900;
    for (let i = 0; i < autoIds.length; i += ID_CHUNK) {
      const chunk = autoIds.slice(i, i + ID_CHUNK);
      const values = chunk.map(() => '(?)').join(',');
      await db.run(`INSERT OR IGNORE INTO temp_consolidation_auto_ids (id) VALUES ${values}`, chunk);
    }
    autoIdsClause = 'OR g.id IN (SELECT id FROM temp_consolidation_auto_ids)';
  }

  // Uniquement les jeux complètement matchés selon le mode cible (chaque ROM
  // requise par le mode a au moins 1 match dans rom_matches).
  const selectedGames = await db.all<{
    id: number;
    name: string;
    totalRoms: number;
    matchedRoms: number;
    parent_name_ref: string | null;
    is_bios: number;
  }>(`
    SELECT
      g.id,
      g.name,
      g.parent_name_ref,
      g.is_bios,
      (SELECT COUNT(*) FROM dat_roms dr WHERE dr.game_id = g.id ${cond}) as totalRoms,
      (SELECT COUNT(DISTINCT dr.id) FROM dat_roms dr
       WHERE dr.game_id = g.id ${cond}
       AND EXISTS (SELECT 1 FROM rom_matches rm WHERE rm.dat_rom_id = dr.id)
      ) as matchedRoms
    FROM games g
    WHERE (g.is_selected != 0 ${autoIdsClause})
    AND (SELECT COUNT(*) FROM dat_roms dr WHERE dr.game_id = g.id ${cond}) =
        (SELECT COUNT(DISTINCT dr.id) FROM dat_roms dr
         WHERE dr.game_id = g.id ${cond}
         AND EXISTS (SELECT 1 FROM rom_matches rm WHERE rm.dat_rom_id = dr.id))
    AND (SELECT COUNT(*) FROM dat_roms dr WHERE dr.game_id = g.id ${cond}) > 0
    ORDER BY g.name
  `);

  result.stats.totalGamesProcessed = selectedGames.length;

  // Diagnostic : si aucun jeu n'est retenu, indiquer POURQUOI (sélection vide,
  // aucun match, DB non matchée…). Cause fréquente : un re-scan supprime les
  // rom_matches (CASCADE) sans relancer l'étape de matching.
  if (selectedGames.length === 0) {
    const diag = await db.get<{ sel: number; withMatch: number; withRoms: number }>(`
      SELECT
        (SELECT COUNT(*) FROM games WHERE is_selected != 0) AS sel,
        (SELECT COUNT(DISTINCT dr.game_id) FROM dat_roms dr
          WHERE EXISTS (SELECT 1 FROM rom_matches rm WHERE rm.dat_rom_id = dr.id)) AS withMatch,
        (SELECT COUNT(DISTINCT game_id) FROM dat_roms) AS withRoms
    `);
    console.warn(
      `[Consolidation] 0 game selected — diagnostic: selected=${diag?.sel ?? 0}, ` +
      `games with ≥1 matched ROM=${diag?.withMatch ?? 0}, games with ROMs=${diag?.withRoms ?? 0}. ` +
      `If "games with ≥1 matched ROM" is 0, run the Matching step first (a re-scan clears matches).`
    );
  }

  // Jeux multi-disques (option .m3u) : leurs disques ne doivent pas finir en 7z/zip,
  // qu'un .m3u ne peut pas référencer. Ils reçoivent des paramètres restreints aux
  // formats compatibles (CHD, sinon mode brut à plat).
  const m3uGroups = (settings.generateM3u && !datIsArcade && systemAcceptsM3u(systemId))
    ? buildM3uGroups(selectedGames)
    : [];
  const m3uGameIds = new Set(m3uGroups.flatMap(g => g.discs.map(d => d.gameId)));
  const m3uSettings = m3uGameIds.size > 0 ? withM3uCompatibleFormats(settings, systemId) : settings;
  if (m3uGroups.length > 0) {
    console.log(`[m3u] ${m3uGroups.length} multi-disc game(s) (${m3uGameIds.size} discs) → no 7z/zip for these discs, .m3u created after consolidation`);
    result.m3u = { forcedGames: m3uGroups.length, created: 0, skipped: 0 };
  } else if (settings.generateM3u && !systemAcceptsM3u(systemId)) {
    console.log(`[m3u] option enabled but system "${systemId}" does not accept .m3u → ignored`);
  }
  const consolidatedIds = new Set<number>();

  // Phase 6 — En mode merged, calculer les groupes parent → clones-à-fusionner.
  // Un clone est fusionné dans son parent si le parent est dans la sélection
  // (user ou auto). Les clones fusionnés seront skippés dans la boucle principale.
  // Les clones sont inclus SANS égard à leur is_selected — en merged, la sémantique
  // est "l'archive du parent contient toute la famille" (comportement MAME standard).
  const parentToFoldedClones = new Map<number, Array<{ id: number; name: string }>>();
  const foldedCloneIds = new Set<number>();
  if (datIsArcade && targetMode === 'merged') {
    const selectedIds = selectedGames.map(g => g.id);
    if (selectedIds.length > 0) {
      // Trouver tous les clones (via game_relationships cloneof) dont le parent
      // est dans la sélection ET qui ont au moins une ROM propre matchée.
      // Chunké par lots de 900 IDs (limite de variables SQLite sur les gros DAT).
      const ID_CHUNK = 900;
      const cloneRows: Array<{ parent_id: number; child_id: number; child_name: string }> = [];
      for (let i = 0; i < selectedIds.length; i += ID_CHUNK) {
        const chunk = selectedIds.slice(i, i + ID_CHUNK);
        const placeholders = chunk.map(() => '?').join(',');
        const rows = await db.all<{ parent_id: number; child_id: number; child_name: string }>(`
          SELECT gr.parent_game_id AS parent_id,
                 gr.child_game_id AS child_id,
                 g.name AS child_name
          FROM game_relationships gr
          JOIN games g ON g.id = gr.child_game_id
          WHERE gr.relationship_type = 'cloneof'
            AND gr.parent_game_id IN (${placeholders})
            AND EXISTS (
              SELECT 1 FROM dat_roms dr
              WHERE dr.game_id = gr.child_game_id
                AND dr.merge_name IS NULL
                AND EXISTS (SELECT 1 FROM rom_matches rm WHERE rm.dat_rom_id = dr.id)
            )
        `, chunk);
        cloneRows.push(...rows);
      }
      for (const row of cloneRows) {
        if (!parentToFoldedClones.has(row.parent_id)) parentToFoldedClones.set(row.parent_id, []);
        parentToFoldedClones.get(row.parent_id)!.push({ id: row.child_id, name: row.child_name });
        foldedCloneIds.add(row.child_id);
      }
      if (foldedCloneIds.size > 0) {
        console.log(`[Merged mode] ${foldedCloneIds.size} clone(s) will be merged into their parent's archive`);
      }
    }
  }

  const counters = () => ({
    consolidated: result.stats.gamesConsolidated,
    errored: result.stats.gamesErrored,
    skipped: result.stats.gamesSkipped
  });

  // Nettoyage des sources au fil de l'eau (src/helpers/sourceCleanup.ts)
  const foldedOwner = new Map<number, number>();
  for (const [parentId, clones] of parentToFoldedClones) {
    for (const clone of clones) foldedOwner.set(clone.id, parentId);
  }
  const cleaner = settings.cleanSourceAfterConsolidation
    ? await SourceCleaner.create(
        db, settings, archiveManager, result.stats, signal,
        selectedGames.filter(g => !foldedCloneIds.has(g.id)).map(g => g.id), foldedOwner)
    : null;

  // Phase 2 : Consolider chaque jeu
  let gamesHandled = 0;
  for (let i = 0; i < selectedGames.length; i++) {
    const game = selectedGames[i];

    // Interruption demandée : on s'arrête avant le jeu suivant
    if (signal && (signal.cancelRequested || signal.abort.signal.aborted)) {
      result.cancelled = true;
      break;
    }

    // Phase 6 — Skip les clones foldés : leurs ROMs propres seront extraites lors
    // de la consolidation de leur parent, sous un sous-dossier {cloneName}/.
    if (foldedCloneIds.has(game.id)) {
      console.log(`[Merged mode] Skip ${game.name} — ROMs merged into the parent`);
      gamesHandled++;
      continue;
    }

    const gameProgress = (state: Partial<ConsolidationProgress>) => onProgress?.({
      phase: 'consolidating',
      currentGame: game.name,
      currentGameIndex: i + 1,
      totalGames: selectedGames.length,
      key: 'logs.consolidation.progress.game',
      params: { game: game.name },
      ...state,
      ...counters()
    });
    const reporter = new GameProgressReporter(state => gameProgress(state));
    reporter.step('analyzing');

    const before = { ...result.stats };
    const mergedClones = parentToFoldedClones.get(game.id) || [];
    const gameSettings = m3uGameIds.has(game.id) ? m3uSettings : settings;
    const cleanupRecord: GameCleanupRecord = { sources: [], outputs: [], consumedDatRomIds: [] };
    const gamePromise = consolidateGame(
      db, game, gameSettings, archiveManager, result, systemId, targetMode, datIsArcade, profile, mergedClones,
      { reporter, signal, cleanup: cleanupRecord }
    );
    try {
      await (signal ? raceAbort(gamePromise, signal.abort.signal) : gamePromise);
      gamesHandled++;
      if (result.stats.gamesConsolidated > before.gamesConsolidated) {
        consolidatedIds.add(game.id);
        if (cleaner) {
          reporter.step('cleaning');
          await cleaner.gameFinished(game.id, 'succeeded', cleanupRecord);
        }
        reporter.step('done');
      } else {
        await cleaner?.gameFinished(game.id, 'failed');
        reporter.step('skipped');
      }
    } catch (error: any) {
      if (error instanceof OperationAbortedError) {
        // Arrêt forcé : le jeu est abandonné. On laisse la promesse abandonnée se
        // terminer (ses processus ont été tués) pour que son `finally` nettoie le
        // dossier temporaire avant la suite.
        result.cancelled = true;
        reporter.step('aborted');
        const settled = await Promise.race([
          gamePromise.then(() => true, () => true),
          new Promise<boolean>(resolve => setTimeout(() => resolve(false), 10000))
        ]);
        if (!settled) {
          // Le jeu ne s'est pas terminé (outil qui ne rend pas la main) : nettoyer
          // nous-mêmes ses dossiers temporaires
          for (const dir of [`game-${game.id}`, `game-${game.id}-copy`]) {
            try { await fs.rm(path.join(settings.tempExtractionFolder, dir), { recursive: true, force: true }); } catch { /* ignore */ }
          }
        }
        console.warn(`⏹️ Consolidation of ${game.name} aborted (forced stop)`);
        break;
      }

      gamesHandled++;
      result.stats.gamesErrored++;
      result.errors.push({ gameName: game.name, error: error.message || String(error) });
      console.error(`❌ Consolidation error ${game.name}:`, error);
      await cleaner?.gameFinished(game.id, 'failed');
      reporter.step('error', error.message || String(error));

      // Logger l'erreur en base
      await db.run(
        `INSERT INTO consolidation_log (game_id, game_name, status, roms_total, error_message)
         VALUES (?, ?, 'error', ?, ?)`,
        [game.id, game.name, game.totalRoms, error.message || String(error)]
      );
    }
  }
  result.stats.gamesRemaining = selectedGames.length - gamesHandled;

  if (result.cancelled) {
    // Les sources des jeux déjà consolidés ont été nettoyées au fil de l'eau ; seule la
    // passe finale (déplacement des fichiers sans lien avec le DAT) est sautée.
    console.warn(`⏹️ Consolidation interrupted: ${result.stats.gamesRemaining} game(s) not processed — final unmatched pass skipped`);
  }

  // Phase 2b : .m3u des jeux multi-disques dont tous les disques retenus ont été
  // consolidés. Avant le nettoyage : la recherche des fichiers produits passe par la base.
  if (!result.cancelled && result.m3u) {
    const complete = m3uGroups.filter(g => g.discs.every(d => consolidatedIds.has(d.gameId)));
    try {
      const written = await writeM3uFiles(db, complete, settings.validatedRomsFolder, sanitizeFileName);
      result.m3u.created = written.created.length;
      result.m3u.skipped = written.skipped.length + (m3uGroups.length - complete.length);
    } catch (err) {
      console.warn(`[m3u] .m3u creation failed: ${err}`);
      result.m3u.skipped = m3uGroups.length;
    }
  }

  // Phase 3 : passe finale — déplacer les fichiers sans lien avec le DAT (hors dossier
  // cible) et séparer les non matchés des archives hybrides restantes.
  if (!result.cancelled && cleaner) {
    const emitFinalPass = (params?: Record<string, number>) => onProgress?.({
      phase: 'moving-unmatched',
      currentGameIndex: selectedGames.length,
      totalGames: selectedGames.length,
      key: params ? 'logs.consolidation.progress.movingUnmatchedCount' : 'logs.consolidation.progress.movingUnmatched',
      params,
      ...counters()
    });
    emitFinalPass();
    await cleaner.finish(p => emitFinalPass({ current: p.current, total: p.total }));
  }

  // Phase 5 : Nettoyer les entrées scanned_files dont le fichier n'existe plus
  // (suppression cascade des rom_matches/archive_contents associés). Évite le rescan.
  try {
    const stale = await cleanupStaleScannedFiles(db);
    if (stale > 0) {
      console.log(`[Cleanup] ${stale} stale scanned_files entry(ies) removed from the database`);
    }
  } catch (err) {
    console.warn(`[Cleanup] failed to clean up stale files: ${err}`);
  }

  onProgress?.({
    phase: 'complete',
    currentGameIndex: selectedGames.length,
    totalGames: selectedGames.length,
    key: 'logs.consolidation.progress.complete',
    params: { count: result.stats.gamesConsolidated },
    cancelled: !!result.cancelled,
    ...counters()
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
  // À priorité égale, préférer une source hors du dossier cible : avec la portée
  // « fichiers utilisés uniquement », c'est la copie source qui est alors nettoyée
  // (la copie déjà présente dans la cible est réécrite à l'identique).
  const inTarget = (p: string | null) => (p && isInsideFolder(p, settings.validatedRomsFolder)) ? 1 : 0;

  // Grouper par (owner_game_id | datRomName) — pas juste par datRomName !
  // En mode merged, le parent et ses clones peuvent avoir des ROMs de même nom
  // (typique MAME : "prg1.bin" chez puckman ET chez pacman). Sans owner dans la
  // clé, un seul match par nom survivait et les ROMs propres des clones étaient
  // perdues silencieusement.
  const romKey = (m: MatchedRomInfo) => `${m.datRomOwnerGameId}|${m.datRomName}`;
  const grouped = new Map<string, MatchedRomInfo[]>();
  for (const match of allMatches) {
    const k = romKey(match);
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(match);
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
          const k = romKey(match);
          if (!entry.romNames.has(k)) {
            entry.romNames.add(k);
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
        return ((aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx)) || (inTarget(a[0]) - inTarget(b[0]));
      });

    if (completeArchives.length > 0) {
      console.log(`[SelectMatch] Complete archive found: "${path.basename(completeArchives[0][0])}" (${completeArchives[0][1].format})`);
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
    matches.sort((a, b) => (scoreMatch(b) - scoreMatch(a))
      || (inTarget(a.archivePath || a.scannedFilePath) - inTarget(b.archivePath || b.scannedFilePath)));
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
  console.log(`  Game: ${gameName}`);
  console.log('═══════════════════════════════════════════════════════════════');
}

/**
 * Affiche dans les logs la liste des fichiers sources utilisés pour consolider un jeu.
 * Distingue les fichiers loose (chemin direct) des contenus d'archives (chemin complet
 * de l'archive + nom du fichier interne).
 */
function logSourceFiles(matchedRoms: MatchedRomInfo[]): void {
  console.log(`[1/4 Selection] ${matchedRoms.length} file(s) to consolidate:`);
  for (const rom of matchedRoms) {
    if (rom.archivePath && rom.archiveFileName) {
      console.log(`  • ${rom.datRomName}`);
      console.log(`      ↳ from archive: ${rom.archivePath}`);
      console.log(`      ↳ inner entry : ${rom.archiveFileName}`);
    } else if (rom.scannedFilePath) {
      console.log(`  • ${rom.datRomName}`);
      console.log(`      ↳ loose file: ${rom.scannedFilePath}`);
    } else {
      console.log(`  • ${rom.datRomName}  (unknown source)`);
    }
  }
}

/**
 * Dossier de sortie de l'ARCHIVE d'un jeu (zip / 7z / fichiers bruts), en tenant
 * compte du rangement optionnel des sets BIOS dans un sous-dossier `bios/`
 * (option arcadeSeparateBios, DAT MAME uniquement). Les CHD ont leur propre
 * logique de sous-dossier au nom du jeu — voir consolidateChdGame.
 */
function getGameOutputDir(
  game: { is_bios?: number },
  settings: ReturnType<typeof settingsManager.getAll>
): string {
  if (settings.arcadeSeparateBios && game.is_bios) {
    return path.join(settings.validatedRomsFolder, 'bios');
  }
  return settings.validatedRomsFolder;
}

// Enregistrement de fin de répertoire central (EOCD) d'un ZIP vide : 22 octets,
// aucune entrée. Structure minimale valide acceptée par les outils zip et par
// MAME/Recalbox — sert de placeholder `<jeu>.zip` pour les jeux CHD-only.
const EMPTY_ZIP_EOCD = Buffer.from([
  0x50, 0x4b, 0x05, 0x06, // signature "PK\x05\x06"
  0, 0, 0, 0, 0, 0, 0, 0, // n° disque, disque du CD, entrées (disque/total)
  0, 0, 0, 0, 0, 0, 0, 0, // taille du CD, offset du CD
  0, 0                    // longueur du commentaire
]);

/**
 * Crée un fichier ZIP vide au chemin donné. Utilisé pour les jeux dont toutes les
 * ROMs sont des CHD : Recalbox liste les jeux via les .zip présents, il faut donc
 * un placeholder `<jeu>.zip` à côté du sous-dossier `<jeu>/` contenant le CHD.
 * N'écrase pas un .zip existant (un vrai zip de ROMs a priorité).
 */
async function writeEmptyChdZip(destPath: string): Promise<void> {
  try {
    await fs.access(destPath);
    return; // un fichier existe déjà (vrai zip ou placeholder précédent) — ne pas écraser
  } catch {
    /* n'existe pas → on le crée */
  }
  await fs.writeFile(destPath, EMPTY_ZIP_EOCD);
}

async function consolidateGame(
  db: Database,
  game: { id: number; name: string; totalRoms: number; matchedRoms: number; parent_name_ref?: string | null; is_bios?: number },
  settings: ReturnType<typeof settingsManager.getAll>,
  archiveManager: ArchiveManager,
  result: ConsolidationResult,
  systemId: string,
  targetMode: ArcadeTargetSetMode,
  datIsArcade: boolean,
  profile: SystemProfile,
  mergedClones: Array<{ id: number; name: string }> = [],
  ctx: GameRunContext = {}
): Promise<void> {
  const reporter = ctx.reporter;
  // Phase 4 — Filtre des dat_roms par mode cible (split exclut merge_name).
  const gameCond = profile.romsSqlCondition(targetMode, 'dr');

  // Récupérer TOUS les matches pour ce jeu depuis rom_matches
  // scanned_file_id pointe toujours vers le fichier physique (loose ou archive)
  // archive_content_id est renseigné si le match vient d'un contenu d'archive.
  // Phase 6 — datRomOwnerGameId/Name : pour ce jeu (parent), toujours = game.
  const parentMatches = await db.all<MatchedRomInfo>(`
    SELECT
      dr.id as datRomId,
      dr.name as datRomName,
      dr.size as datRomSize,
      dr.crc32 as datRomCrc32,
      dr.md5 as datRomMd5,
      dr.sha1 as datRomSha1,
      dr.merge_name as datRomMergeName,
      dr.game_id as datRomOwnerGameId,
      ? as datRomOwnerGameName,
      sf.id as sourceFileId,
      CASE WHEN rm.archive_content_id IS NULL THEN sf.id ELSE NULL END as scannedFileId,
      CASE WHEN rm.archive_content_id IS NULL THEN sf.file_path ELSE NULL END as scannedFilePath,
      CASE WHEN rm.archive_content_id IS NULL THEN sf.file_name ELSE NULL END as scannedFileName,
      rm.archive_content_id as archiveContentId,
      ac.file_name as archiveFileName,
      CASE WHEN rm.archive_content_id IS NOT NULL THEN sf.file_path ELSE NULL END as archivePath,
      CASE WHEN rm.archive_content_id IS NOT NULL THEN sf.archive_type ELSE NULL END as archiveType,
      dr.is_disk as isDisk
    FROM dat_roms dr
    JOIN rom_matches rm ON rm.dat_rom_id = dr.id
    JOIN scanned_files sf ON rm.scanned_file_id = sf.id
    LEFT JOIN archive_contents ac ON rm.archive_content_id = ac.id
    WHERE dr.game_id = ? ${gameCond}
    ORDER BY dr.name
  `, [game.name, game.id]);

  // Phase 6 — En mode merged, ajouter les ROMs PROPRES (merge_name IS NULL) de
  // chaque clone à fusionner. Elles seront placées dans un sous-dossier
  // {cloneName}/ dans l'archive résultante — convention MAME merged.
  let cloneOwnMatches: MatchedRomInfo[] = [];
  if (mergedClones.length > 0) {
    const cloneIds = mergedClones.map(c => c.id);
    const clonePlaceholders = cloneIds.map(() => '?').join(',');
    cloneOwnMatches = await db.all<MatchedRomInfo>(`
      SELECT
        dr.id as datRomId,
        dr.name as datRomName,
        dr.size as datRomSize,
        dr.crc32 as datRomCrc32,
        dr.md5 as datRomMd5,
        dr.sha1 as datRomSha1,
        dr.merge_name as datRomMergeName,
        dr.game_id as datRomOwnerGameId,
        cg.name as datRomOwnerGameName,
        sf.id as sourceFileId,
        CASE WHEN rm.archive_content_id IS NULL THEN sf.id ELSE NULL END as scannedFileId,
        CASE WHEN rm.archive_content_id IS NULL THEN sf.file_path ELSE NULL END as scannedFilePath,
        CASE WHEN rm.archive_content_id IS NULL THEN sf.file_name ELSE NULL END as scannedFileName,
        rm.archive_content_id as archiveContentId,
        ac.file_name as archiveFileName,
        CASE WHEN rm.archive_content_id IS NOT NULL THEN sf.file_path ELSE NULL END as archivePath,
        CASE WHEN rm.archive_content_id IS NOT NULL THEN sf.archive_type ELSE NULL END as archiveType,
        dr.is_disk as isDisk
      FROM dat_roms dr
      JOIN games cg ON cg.id = dr.game_id
      JOIN rom_matches rm ON rm.dat_rom_id = dr.id
      JOIN scanned_files sf ON rm.scanned_file_id = sf.id
      LEFT JOIN archive_contents ac ON rm.archive_content_id = ac.id
      WHERE dr.game_id IN (${clonePlaceholders})
        AND dr.merge_name IS NULL
      ORDER BY cg.name, dr.name
    `, cloneIds);
  }

  const allMatches = [...parentMatches, ...cloneOwnMatches];

  if (allMatches.length === 0) {
    result.stats.gamesSkipped++;
    return;
  }

  // En-tête visuel du jeu
  logGameHeader(game.name);

  // Sélectionner le meilleur match par ROM selon les priorités
  const matchedRoms = selectBestMatches(allMatches, settings, systemId);
  if (ctx.cleanup) ctx.cleanup.consumedDatRomIds = matchedRoms.map(m => m.datRomId);

  // Logger les fichiers sources qui seront utilisés pour ce jeu
  logSourceFiles(matchedRoms);

  // Phase 5 — En mode non-merged (et merged fallback), afficher la composition
  // du romset produit : combien de ROMs marquées "propres" au clone vs combien
  // marquées merge_name (partagées avec le parent en style split). Utile pour
  // vérifier que le clone est bien autonome et pour comprendre l'origine physique
  // des ROMs héritées. En mode split le compteur n'a pas d'intérêt car les
  // héritées sont filtrées côté SQL.
  if (datIsArcade && targetMode !== 'split') {
    const ownRoms = matchedRoms.filter(r => !r.datRomMergeName).length;
    const inheritedRoms = matchedRoms.filter(r => !!r.datRomMergeName).length;
    if (inheritedRoms > 0) {
      // Basename physique de chaque source où le matcher a trouvé la ROM
      // marquée merge_name (peut être : le clone lui-même, son parent, ou un
      // autre clone frère du même parent).
      const sourceBasenames = [...new Set(matchedRoms
        .filter(r => !!r.datRomMergeName)
        .map(r => {
          const fileName = r.scannedFileName || (r.archivePath ? path.basename(r.archivePath) : '');
          return fileName.replace(/\.(zip|7z|rar|chd|iso|cso)$/i, '') || '?';
        }))];
      const gameBase = sanitizeFileName(game.name).toLowerCase();
      const parentBase = (game.parent_name_ref || '').toLowerCase();

      // Classifier la source par nature pour un libellé plus précis.
      // Le matcher retient un seul candidat par ROM (selectBestMatches) ; si
      // plusieurs archives contiennent la même CRC, l'ordre d'insertion tranche.
      const classify = (src: string): 'self' | 'parent' | 'other' => {
        const lo = src.toLowerCase();
        if (lo === gameBase) return 'self';
        if (parentBase && lo === parentBase) return 'parent';
        return 'other';
      };

      let sourceInfo = '';
      if (sourceBasenames.length === 1) {
        const kind = classify(sourceBasenames[0]);
        if (kind === 'self') {
          sourceInfo = ` (déjà présentes dans ${sourceBasenames[0]} — archive source non-merged)`;
        } else if (kind === 'parent') {
          sourceInfo = ` (inlinées depuis le parent ${sourceBasenames[0]})`;
        } else {
          const parentHint = parentBase ? ` — le parent « ${game.parent_name_ref} » n'est pas dans le romset scanné` : '';
          sourceInfo = ` (inlinées depuis ${sourceBasenames[0]}, archive d'un jeu frère${parentHint})`;
        }
      } else {
        const kinds = new Set(sourceBasenames.map(classify));
        const parts: string[] = [];
        if (kinds.has('self')) parts.push('l\'archive du clone');
        if (kinds.has('parent')) parts.push(`le parent ${game.parent_name_ref}`);
        if (kinds.has('other')) parts.push('un ou plusieurs jeux frères');
        sourceInfo = ` (inlinées depuis ${sourceBasenames.length} sources : ${parts.join(' + ')})`;
      }
      console.log(`[Mode ${targetMode}] Composition: ${ownRoms} own ROM(s) + ${inheritedRoms} merge_name-marked ROM(s)${sourceInfo}`);
    }
  }

  // Phase 6 — Log spécifique merged : liste les clones foldés et le nombre de
  // ROMs qu'ils apportent, pour que l'utilisateur voie la fusion s'effectuer.
  if (datIsArcade && targetMode === 'merged' && mergedClones.length > 0) {
    const perClone = new Map<string, number>();
    for (const r of matchedRoms) {
      if (r.datRomOwnerGameName && r.datRomOwnerGameName !== game.name) {
        perClone.set(r.datRomOwnerGameName, (perClone.get(r.datRomOwnerGameName) || 0) + 1);
      }
    }
    const parentOwnCount = matchedRoms.filter(r => r.datRomOwnerGameName === game.name).length;
    console.log(`[Merged mode] Merge: ${parentOwnCount} ROM(s) from parent "${game.name}" + ${mergedClones.length} merged clone(s):`);
    for (const [cloneName, count] of perClone) {
      console.log(`              ↳ ${cloneName}/ : ${count} own ROM(s) → archive subfolder`);
    }
    const unfoldedClones = mergedClones.filter(c => !perClone.has(c.name));
    if (unfoldedClones.length > 0) {
      console.warn(`[Merged mode] ⚠️ ${unfoldedClones.length} expected clone(s) with no matched ROM: ${unfoldedClones.map(c => c.name).join(', ')}`);
    }
  }

  const sanitizedName = sanitizeFileName(game.name);

  // Séparer les disques CHD (<disk> MAME, is_disk=1) des ROMs "fichiers" via le
  // profil. Un CHD ne se ré-archive ni ne s'extrait jamais : il est copié tel quel.
  //  - diskRoms (copyAsIs) : copiés via consolidateChdGame (jeu 100 % CHD) ou
  //    copyChdDisksToOutput (jeu ROMs + CHD).
  //  - fileRoms (archivable) : passent par le flux d'archivage normal.
  const { archivable: fileRoms, copyAsIs: diskRoms } = profile.classifyRoms(matchedRoms);

  // Jeu 100 % CHD (aucune ROM fichier) → copie directe des disques, pas d'archive.
  if (fileRoms.length === 0) {
    console.log(`[2/4 Strategy] game contains only CHD disk(s) → direct copy without recompression`);
    reporter?.mode('chd-copy');
    reporter?.setFormats([{ id: 'chd', format: 'chd', status: 'running' }]);
    reporter?.step('copying');
    await consolidateChdGame(db, game, diskRoms, settings, result, ctx);
    reporter?.chosen('chd');
    return;
  }

  // Déterminer si le contenu peut être converti en CHD (point d'entrée .cue/.gdi/.iso présent)
  const chdPossible = profile.canProduceChd(fileRoms);

  // Déterminer le format cible en fonction du système et des préférences
  const targetFormat = profile.determineTargetFormat(systemId, settings, chdPossible);
  const allowedFormats = profile.allowedFormats(systemId, settings);

  if (settings.useBestCompression) {
    console.log(`[2/4 Strategy] multi-format mode: all formats compatible with "${systemId}" will be tested → [${allowedFormats.join(', ')}]${chdPossible ? '' : ' (CHD not possible: no .cue/.gdi/.iso entry point)'}`);
  } else {
    console.log(`[2/4 Strategy] standard mode: target format "${targetFormat}" (system: ${systemId}, CHD possible: ${chdPossible})`);
  }

  // Si recreateArchivesIfNeeded est désactivé, vérifier si l'archive source peut être copiée directement
  // Cela s'applique même si useBestCompression est activé : une archive déjà parfaite n'a pas besoin d'être recompressée.
  // Phase 6 — En mode merged avec des clones foldés, la copie directe est impossible : aucune archive source
  // ne peut contenir exactement la fusion (parent + N sous-dossiers de clones). On force la recréation.
  if (!settings.recreateArchivesIfNeeded && mergedClones.length === 0) {
    if (allowedFormats.length > 0) {
      console.log(`[2/4 Strategy] "recreate perfect archives" option disabled → looking for a reusable source archive`);
      const directCopyResult = await tryDirectArchiveCopy(
        db, game, matchedRoms, settings, result, allowedFormats, sanitizedName, archiveManager,
        targetMode, datIsArcade, profile, ctx
      );
      if (directCopyResult) return; // Archive copiée directement, pas besoin de recréer
    }
  } else if (mergedClones.length > 0) {
    console.log(`[2/4 Strategy] merged mode: ${mergedClones.length} clone(s) to merge → the archive must be recreated (no reusable source archive)`);
  }

  // Formats étudiés pour la recréation de l'archive
  if (targetFormat === null) {
    reporter?.mode('raw');
    reporter?.setFormats([{ id: 'raw', format: 'raw', status: 'pending' }]);
  } else if (settings.useBestCompression) {
    reporter?.mode('best');
    reporter?.setFormats(bestCompressionCandidates(getSystemAllowedFormats(systemId, settings), chdPossible));
  } else {
    reporter?.mode('standard');
    reporter?.setFormats([{ id: targetFormat, format: targetFormat, status: 'pending' }]);
  }

  // Créer le dossier temporaire pour ce jeu (extraction + output)
  const tempDir = path.join(settings.tempExtractionFolder, `game-${game.id}`);
  const tempOutputDir = path.join(tempDir, 'output');
  await fs.mkdir(tempDir, { recursive: true });
  await fs.mkdir(tempOutputDir, { recursive: true });

  try {
    // Extraire/copier chaque ROM FICHIER matchée dans le dossier temp.
    // Les disques CHD (diskRoms) sont volontairement exclus : ils seront copiés
    // tels quels après création de l'archive (copyChdDisksToOutput).
    console.log(`[3/4 Preparation] extracting source files to: ${tempDir}`);
    reporter?.step('extracting');

    // Optimisation : un CHD est monolithique — chdman extrait TOUT le disque à
    // chaque appel. Grouper les ROMs sourcées d'un même CHD pour ne l'extraire
    // qu'UNE fois puis distribuer ses fichiers (cas Redump/PS1 : bin/cue issus du
    // même CHD). Les autres sources (zip/7z, extraction par fichier peu coûteuse)
    // passent par le chemin habituel, un fichier à la fois.
    const chdGroups = new Map<string, MatchedRomInfo[]>();
    const nonChdRoms: MatchedRomInfo[] = [];
    for (const rom of fileRoms) {
      if (rom.archiveType === 'chd' && rom.archivePath && rom.archiveContentId && rom.archiveFileName) {
        const key = rom.archivePath;
        if (!chdGroups.has(key)) chdGroups.set(key, []);
        chdGroups.get(key)!.push(rom);
      } else {
        nonChdRoms.push(rom);
      }
    }

    for (const rom of nonChdRoms) {
      throwIfAborted(ctx.signal);
      // Phase 6 — Passer game.name comme "hôte" : les ROMs de clones foldés seront
      // placées dans un sous-dossier {cloneName}/ pour respecter la convention MAME.
      await extractRomToTemp(rom, tempDir, archiveManager, game.name);
      result.stats.romsExtracted++;
    }
    for (const [chdPath, roms] of chdGroups) {
      await extractChdRomsToTemp(chdPath, roms, tempDir, archiveManager, game.name);
      result.stats.romsExtracted += roms.length;
    }

    // Lister les fichiers bruts extraits (récursivement, pour capter les sous-dossiers
    // des clones foldés en mode merged) — exclure le sous-dossier `output` réservé.
    const filePaths = await listExtractedFiles(tempDir);

    if (filePaths.length === 0) {
      console.log(`[3/4 Preparation] no file extracted → game skipped`);
      result.stats.gamesSkipped++;
      return;
    }

    // Phase 6 — Convertir en chemins relatifs à tempDir pour que 7z préserve la
    // structure des sous-dossiers ({cloneName}/) via `$cwd`. Sans ça, 7z strippe
    // les chemins et deux fichiers de même basename dans des sous-dossiers
    // différents provoquent "Duplicate filename on disk".
    const relativeFilePaths = filePaths.map(fp => path.relative(tempDir, fp));

    // Log de la liste des fichiers : verbeux (jusqu'à 40+ lignes en mode merged).
    // Uniquement en mode debug pour éviter le bruit dans les logs normaux.
    if (RUMCET_DEBUG) {
      console.log(`[3/4 Preparation] ${filePaths.length} file(s) ready for compression:`);
      for (const rp of relativeFilePaths) {
        console.log(`    - ${rp}`);
      }
    } else {
      console.log(`[3/4 Preparation] ${filePaths.length} file(s) ready for compression (RUMCET_DEBUG=1 for details).`);
    }

    // Diagnostic pré-archivage : vérification fichier par fichier + comparaison
    // listExtractedFiles ↔ état du disque. Ajouté pendant le debug de Phase 6
    // (issue $cwd non respecté par node-7z), conservé pour investigation future.
    // Ne parle que si problème détecté sauf en mode debug.
    if (RUMCET_DEBUG) {
      console.log(`[Diagnostic] Pre-archiving check — cwd=${tempDir}, ${filePaths.length} files expected.`);
    }
    const missingFiles: Array<{ path: string; reason: string }> = [];
    for (const fp of filePaths) {
      try {
        await fs.access(fp);
        const stat = await fs.stat(fp);
        if (!stat.isFile()) {
          missingFiles.push({ path: fp, reason: 'pas un fichier régulier' });
        } else if (stat.size === 0 && !fp.endsWith('.chd')) {
          missingFiles.push({ path: fp, reason: 'taille 0 octet' });
        }
      } catch (err: any) {
        missingFiles.push({ path: fp, reason: err?.code || String(err) });
      }
    }
    if (missingFiles.length > 0) {
      console.warn(`[Diagnostic] ${missingFiles.length} file(s) inaccessible right before archiving:`);
      for (const mf of missingFiles) {
        console.warn(`    ✗ ${mf.path}  (reason: ${mf.reason})`);
      }
    }
    // Comparaison filesystem ↔ listExtractedFiles : dump si divergence uniquement.
    if (RUMCET_DEBUG || missingFiles.length > 0) {
      const actualOnDisk: string[] = [];
      try {
        const walk = async (dir: string, base: string): Promise<void> => {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const e of entries) {
            if (e.name === 'output' || e.name === '_extract_tmp') continue;
            const rel = base ? path.join(base, e.name) : e.name;
            if (e.isDirectory()) await walk(path.join(dir, e.name), rel);
            else if (e.isFile()) actualOnDisk.push(rel);
          }
        };
        await walk(tempDir, '');
      } catch {}
      if (actualOnDisk.length !== relativeFilePaths.length) {
        console.warn(`[Diagnostic] ⚠️ Mismatch: filePaths=${relativeFilePaths.length}, disk=${actualOnDisk.length}`);
        const rSet = new Set(relativeFilePaths);
        const dSet = new Set(actualOnDisk);
        for (const rp of relativeFilePaths) {
          if (!dSet.has(rp)) console.warn(`    listed but missing from disk: ${rp}`);
        }
        for (const dp of actualOnDisk) {
          if (!rSet.has(dp)) console.warn(`    on disk but not listed: ${dp}`);
        }
      } else if (RUMCET_DEBUG) {
        console.log(`[Diagnostic] tempDir state consistent: ${actualOnDisk.length} files to archive.`);
      }
    }

    // Tout se passe dans tempOutputDir, on copie le résultat final vers validatedRomsFolder
    const tempOutputBasePath = path.join(tempOutputDir, sanitizedName);
    let tempOutputPath: string;
    let finalFormat: string;

    // Mode brut : aucun format d'archive autorisé → conserver les fichiers tels quels
    // Les fichiers sont placés à la racine du dossier cible des ROMs validées
    // (et du sous-dossier système si l'option multi-système est activée).
    if (targetFormat === null) {
      console.log(`[4/4 Raw storage] no archive format allowed for "${systemId}" → copying raw files (without compression)`);
      reporter?.step('copying');
      // Dossier de sortie du jeu (bios/ si set BIOS + option activée)
      const gameOutDir = getGameOutputDir(game, settings);
      await fs.mkdir(gameOutDir, { recursive: true });
      const rawEntries: Array<ConsolidatedRomEntry & { filePath: string }> = [];
      for (const fp of filePaths) {
        const dest = path.join(gameOutDir, path.basename(fp));
        await copyToTarget(fp, dest, ctx);
        recordOutput(ctx, dest);

        // Faire correspondre ce fichier extrait à un dat_rom (par nom de fichier)
        const baseName = path.basename(fp);
        const matched = matchedRoms.find(m => m.datRomName === baseName);
        if (matched) {
          rawEntries.push({
            datRomId: matched.datRomId,
            fileName: baseName,
            filePath: dest,
            size: matched.datRomSize ?? 0,
            crc32: matched.datRomCrc32,
            md5: matched.datRomMd5,
            sha1: matched.datRomSha1
          });
        }
      }
      console.log(`[✓ Done]         ${filePaths.length} raw file(s) copied → ${gameOutDir}`);
      for (const rom of fileRoms) recordSource(ctx, rom);

      // Enregistrer directement en base : scanned_files + rom_matches dans le dossier cible.
      // Si gameOutDir est un sous-dossier (bios/), il est enregistré sous validatedRomsFolder.
      throwIfAborted(ctx.signal);
      if (rawEntries.length > 0) {
        await recordConsolidatedRawFiles(db, gameOutDir, settings.validatedRomsFolder, rawEntries);
      }

      // Copier les CHD éventuels tels quels (sans les inclure dans les fichiers bruts).
      await copyChdDisksToOutput(db, game, diskRoms, gameOutDir, result, ctx);
      reporter?.chosen('raw');

      result.stats.archivesCreated++;
      result.stats.gamesConsolidated++;

      await db.run(
        `INSERT INTO consolidation_log (game_id, game_name, output_path, output_format, status, roms_consolidated, roms_total)
         VALUES (?, ?, ?, ?, 'success', ?, ?)`,
        [game.id, game.name, gameOutDir, 'raw', matchedRoms.length, game.totalRoms]
      );
      return;
    }

    reporter?.step('compressing');
    if (settings.useBestCompression) {
      // Mode meilleure compression : tester plusieurs formats et garder le plus petit
      const result_best = await createBestCompressedArchive(
        relativeFilePaths, tempOutputBasePath, settings, archiveManager, systemId, chdPossible, tempDir, ctx
      );
      tempOutputPath = result_best.outputPath;
      finalFormat = result_best.format;
    } else {
      // Mode standard : créer l'archive dans tempDir avec chemins relatifs +
      // workingDirectory pour préserver les sous-dossiers ({cloneName}/) en merged.
      const archiveFiles = (targetFormat === 'chd')
        ? getChdInputFiles(relativeFilePaths)
        : relativeFilePaths;

      if (archiveFiles.length === 0) {
        console.warn(`[4/4 Compression] no CHD entry point → 7z fallback`);
        reporter?.setFormats([
          { id: 'chd', format: 'chd', status: 'skipped', note: 'chdNoEntryPoint' },
          { id: '7z', format: '7z', status: 'running' }
        ]);
        // Fallback si CHD impossible
        tempOutputPath = await withTimeout(
          archiveManager.createArchive(relativeFilePaths, tempOutputBasePath,
            { archiveFormatPriority: ['7z'], compressionLevel: settings.compressionLevel,
              solidArchive: settings.solidArchive, multithreading: settings.multithreading,
              workingDirectory: tempDir },
            '7z' as any),
          ARCHIVE_CREATION_TIMEOUT_MS, `Création archive 7z (fallback) pour ${game.name}`
        );
        finalFormat = '7z';
      } else {
        console.log(`[4/4 Compression] creating the ${targetFormat} archive…`);
        reporter?.updateFormat(targetFormat, { status: 'running' });
        tempOutputPath = await withTimeout(
          archiveManager.createArchive(archiveFiles, tempOutputBasePath,
            { archiveFormatPriority: [targetFormat], compressionLevel: settings.compressionLevel,
              solidArchive: settings.solidArchive, multithreading: settings.multithreading,
              workingDirectory: tempDir },
            targetFormat as any),
          ARCHIVE_CREATION_TIMEOUT_MS, `Création archive ${targetFormat} pour ${game.name}`
        );
        finalFormat = targetFormat;
      }
      const archiveSize = await fs.stat(tempOutputPath).then(st => st.size).catch(() => undefined);
      reporter?.updateFormat(finalFormat, { status: 'done', size: archiveSize });
      reporter?.chosen(finalFormat);
    }

    // Copier le résultat final vers le dossier cible (bios/ si set BIOS + option activée)
    reporter?.step('copying');
    const gameOutDir = getGameOutputDir(game, settings);
    await fs.mkdir(gameOutDir, { recursive: true });
    const finalDestPath = path.join(gameOutDir, path.basename(tempOutputPath));
    await copyToTarget(tempOutputPath, finalDestPath, ctx);
    recordOutput(ctx, finalDestPath);
    for (const rom of fileRoms) recordSource(ctx, rom);
    console.log(`[✓ Done]         consolidated archive → ${finalDestPath}`);

    // Copier les disques CHD tels quels à côté de l'archive (jeu ROMs + CHD).
    // Jamais inclus dans l'archive : un CHD reste un fichier de disque autonome.
    await copyChdDisksToOutput(db, game, diskRoms, gameOutDir, result, ctx);
    throwIfAborted(ctx.signal);

    result.stats.archivesCreated++;
    result.stats.gamesConsolidated++;

    // Enregistrer directement l'archive en base (scanned_files + archive_contents + rom_matches)
    // au lieu de rescanner le dossier après coup. Seules les ROMs fichiers sont
    // dans l'archive ; les disques CHD ont été enregistrés par copyChdDisksToOutput.
    try {
      const archiveEntries: ConsolidatedRomEntry[] = fileRoms.map(m => ({
        datRomId: m.datRomId,
        fileName: m.datRomName,
        size: m.datRomSize ?? 0,
        crc32: m.datRomCrc32,
        md5: m.datRomMd5,
        sha1: m.datRomSha1
      }));
      await recordConsolidatedArchive(
        db, finalDestPath, path.dirname(finalDestPath), finalFormat, archiveEntries
      );
    } catch (recErr) {
      console.warn(`[recordConsolidation] direct recording failed, a later rescan will catch it: ${recErr}`);
    }

    // Logger en base
    await db.run(
      `INSERT INTO consolidation_log (game_id, game_name, output_path, output_format, status, roms_consolidated, roms_total)
       VALUES (?, ?, ?, ?, 'success', ?, ?)`,
      [game.id, game.name, finalDestPath, finalFormat, matchedRoms.length, game.totalRoms]
    );

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
  chdPossible: boolean,
  workingDirectory?: string,
  ctx?: GameRunContext
): Promise<{ outputPath: string; format: string }> {
  const reporter = ctx?.reporter;
  const allowedFormats = getSystemAllowedFormats(systemId, settings);

  // Formats candidats : uniquement les formats autorisés pour le système
  const candidates: ArchiveFormat[] = allowedFormats.filter(f => {
    if (f === 'chd' && !chdPossible) return false;
    return true;
  });

  if (candidates.length === 0) {
    candidates.push('7z');
  }

  console.log(`[4/4 Compression] "test all formats" mode: [${candidates.join(', ')}]`);

  // Tester chaque format et comparer les tailles
  const results: Array<{ format: string; path: string; size: number }> = [];

  for (const format of candidates) {
    const candidatePath = (candidates.length === 1)
      ? tempOutputBasePath
      : `${tempOutputBasePath}_candidate_${format}`;

    // Pour CHD : passer uniquement le fichier point d'entrée
    const inputFiles = (format === 'chd') ? getChdInputFiles(filePaths) : filePaths;

    if (inputFiles.length === 0) {
      console.warn(`  → ${format}: no CHD entry point, skipped`);
      reporter?.updateFormat(format, { status: 'skipped', note: 'chdNoEntryPoint' });
      continue;
    }

    throwIfAborted(ctx?.signal);
    reporter?.updateFormat(format, { status: 'running' });
    try {
      const createdPath = await withTimeout(
        archiveManager.createArchive(
          inputFiles, candidatePath,
          {
            archiveFormatPriority: [format],
            compressionLevel: settings.compressionLevel,
            solidArchive: settings.solidArchive,
            multithreading: settings.multithreading,
            workingDirectory
          },
          format as any
        ),
        ARCHIVE_CREATION_TIMEOUT_MS,
        `Création archive ${format}`
      );
      const stat = await fs.stat(createdPath);
      results.push({ format, path: createdPath, size: stat.size });
      reporter?.updateFormat(format, { status: 'done', size: stat.size });
      console.log(`[4/4 Compression]   → ${format.padEnd(4)} : ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
    } catch (error: any) {
      throwIfAborted(ctx?.signal);
      reporter?.updateFormat(format, { status: 'failed', note: 'creationFailed' });
      console.warn(`[4/4 Compression]   → ${format.padEnd(4)} : FAILED (${error.message})`);
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

  reporter?.chosen(best.format);
  console.log(`[4/4 Compression] chosen format: ${best.format} (${(best.size / 1024 / 1024).toFixed(2)} MB)`);
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
  game: { id: number; name: string; totalRoms: number; matchedRoms: number; is_bios?: number },
  matchedRoms: MatchedRomInfo[],
  settings: ReturnType<typeof settingsManager.getAll>,
  result: ConsolidationResult,
  allowedFormats: ArchiveFormat[],
  sanitizedName: string,
  archiveManager: ArchiveManager,
  targetMode: ArcadeTargetSetMode,
  datIsArcade: boolean,
  profile: SystemProfile,
  ctx: GameRunContext = {}
): Promise<boolean> {
  const logPrefix = `[2/4 Stratégie]`;
  const reporter = ctx.reporter;

  // Phase 4 — Restreindre aux dat_roms effectivement attendues dans l'archive cible.
  // En split, on exclut les merge_name (elles appartiennent au parent).
  const directCond = profile.romsSqlCondition(targetMode, '');

  // Récupérer les hashes des ROMs attendues pour ce jeu (filtrées selon le mode cible)
  const datRoms = await db.all<{ name: string; crc32: string; md5: string; sha1: string }>(`
    SELECT name, crc32, md5, sha1 FROM dat_roms WHERE game_id = ? ${directCond}
  `, [game.id]);

  if (datRoms.length === 0) return false;

  // Chercher toutes les archives qui contiennent AU MOINS une ROM du jeu (par hash)
  // Construire la liste des CRC32 attendus
  const expectedCrcs = datRoms.map(r => r.crc32).filter(Boolean);
  if (expectedCrcs.length === 0) {
    console.log(`${logPrefix} no CRC32 in the DAT → recreation required`);
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
    console.log(`${logPrefix} no existing archive contains all ROMs → recreation required`);
    return false;
  }

  // Filtrer par format compatible et trier selon le mode
  const formatPriority = settings.archiveFormatPriority;
  const validCandidates = candidateArchives
    .filter(a => allowedFormats.includes(a.archive_type as ArchiveFormat))
    .sort((a, b) => {
      // À critère égal, préférer une archive hors du dossier cible (voir selectBestMatches)
      const targetTie = (isInsideFolder(a.archive_path, settings.validatedRomsFolder) ? 1 : 0)
        - (isInsideFolder(b.archive_path, settings.validatedRomsFolder) ? 1 : 0);
      if (settings.useBestCompression) {
        // Mode meilleure compression : trier par taille croissante (la plus petite d'abord)
        return ((a.archive_size || Infinity) - (b.archive_size || Infinity)) || targetTie;
      }
      // Mode standard : trier par priorité format utilisateur
      const aIdx = formatPriority.indexOf(a.archive_type as ArchiveFormat);
      const bIdx = formatPriority.indexOf(b.archive_type as ArchiveFormat);
      return ((aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx)) || targetTie;
    });

  if (validCandidates.length === 0) {
    console.log(`${logPrefix} archives found but none in a compatible format (${allowedFormats.join(', ')}) → recreation required`);
    return false;
  }

  // Archives sources candidates affichées comme « formats étudiés »
  reporter?.mode('direct');
  reporter?.step('direct-copy');
  reporter?.setFormats(validCandidates.map(c => ({
    id: c.archive_path,
    format: c.archive_type,
    label: path.basename(c.archive_path),
    size: c.archive_size || undefined,
    status: 'pending' as const
  })));

  if (settings.useBestCompression) {
    console.log(`${logPrefix} ${validCandidates.length} candidate source archive(s) sorted by size:`);
    for (const c of validCandidates) {
      console.log(`${logPrefix}   - ${c.archive_type.padEnd(4)} ${((c.archive_size || 0) / 1024 / 1024).toFixed(2)} MB : ${c.archive_path}`);
    }
  }

  // Vérifier les candidats un par un
  for (const candidate of validCandidates) {
    const sourcePath = candidate.archive_path;

    throwIfAborted(ctx.signal);
    reporter?.updateFormat(sourcePath, { status: 'running' });

    // Vérifier que le fichier archive existe toujours
    try { await fs.access(sourcePath); } catch {
      reporter?.updateFormat(sourcePath, { status: 'rejected', note: 'sourceMissing' });
      continue;
    }

    // CHD : format monolithique, pas de listing/vérification de noms possible.
    // Si la DB confirme que tous les CRC matchent, copier directement.
    if (candidate.archive_type === 'chd') {
      const ext = path.extname(sourcePath);
      const destFileName = `${sanitizedName}${ext}`;
      // Layout du CHD selon la famille (via le profil) : arcade → sous-dossier au nom
      // du set (obligatoire pour MAME/Recalbox : <rompath>/<machine>/<disk>.chd) ;
      // disque optique (PS1…) → le CHD est le jeu lui-même, il reste à plat.
      const chdBaseDir = profile.isArcade()
        ? path.join(settings.validatedRomsFolder, sanitizedName)
        : settings.validatedRomsFolder;
      await fs.mkdir(chdBaseDir, { recursive: true });
      const finalDestPath = path.join(chdBaseDir, destFileName);

      reporter?.step('copying');
      await copyToTarget(sourcePath, finalDestPath, ctx);
      recordOutput(ctx, finalDestPath);
      ctx.cleanup?.sources.push({ fileId: candidate.archive_id, contentId: null, wholeArchive: true });
      reporter?.chosen(sourcePath);
      console.log(`${logPrefix} reusable CHD source archive → direct copy without recompression`);
      console.log(`${logPrefix}   source: ${sourcePath}`);
      console.log(`[✓ Done]         consolidated archive → ${finalDestPath}`);

      throwIfAborted(ctx.signal);
      result.stats.archivesCreated++;
      result.stats.gamesConsolidated++;
      result.stats.romsExtracted += matchedRoms.length;

      // Enregistrer directement en base pour éviter le rescan post-consolidation
      try {
        const entries: ConsolidatedRomEntry[] = matchedRoms.map(m => ({
          datRomId: m.datRomId,
          fileName: m.datRomName,
          size: m.datRomSize ?? 0,
          crc32: m.datRomCrc32,
          md5: m.datRomMd5,
          sha1: m.datRomSha1
        }));
        await recordConsolidatedArchive(db, finalDestPath, path.dirname(finalDestPath), 'chd', entries);
      } catch (recErr) {
        console.warn(`[recordConsolidation] direct recording failed (CHD direct copy): ${recErr}`);
      }

      await db.run(
        `INSERT INTO consolidation_log (game_id, game_name, output_path, output_format, status, roms_consolidated, roms_total)
         VALUES (?, ?, ?, ?, 'success', ?, ?)`,
        [game.id, game.name, finalDestPath, 'chd', matchedRoms.length, game.totalRoms]
      );

      return true;
    }

    // Formats non-monolithiques (zip, 7z, rar) : lister et vérifier le contenu
    let archiveContents: string[];
    try {
      const entries = await archiveManager.listArchive(sourcePath);
      archiveContents = entries.map(e => e.fileName);
    } catch (err: any) {
      console.log(`${logPrefix} unable to list archive "${sourcePath}": ${err.message}`);
      reporter?.updateFormat(sourcePath, { status: 'rejected', note: 'listFailed' });
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
        console.log(`${logPrefix} name in archive "${archiveFileName}" ≠ DAT name "${datRom.name}" in "${path.basename(sourcePath)}" → candidate skipped`);
        allNamesMatch = false;
        break;
      }
    }

    if (!allNamesMatch) {
      reporter?.updateFormat(sourcePath, { status: 'rejected', note: 'contentMismatch' });
      continue;
    }

    // Fichiers en trop dans l'archive
    const extraFiles = archiveContents.filter(f => !matchedArchiveFiles.has(f));

    const ext = path.extname(sourcePath);
    const destFileName = `${sanitizedName}${ext}`;
    // Archive du jeu (bios/ si set BIOS + option activée)
    const gameOutDir = getGameOutputDir(game, settings);
    await fs.mkdir(gameOutDir, { recursive: true });
    const finalDestPath = path.join(gameOutDir, destFileName);

    reporter?.step('copying');
    if (extraFiles.length === 0) {
      // Archive parfaite : copier directement
      await copyToTarget(sourcePath, finalDestPath, ctx);
      console.log(`${logPrefix} perfect ${candidate.archive_type} source archive → direct copy without recompression`);
      console.log(`${logPrefix}   source: ${sourcePath}`);
      console.log(`[✓ Done]         consolidated archive → ${finalDestPath}`);
    } else {
      // Archive avec fichiers en trop : copier dans tempDir, supprimer les extras
      const tempDir = path.join(settings.tempExtractionFolder, `game-${game.id}-copy`);
      await fs.mkdir(tempDir, { recursive: true });
      try {
        const tempArchivePath = path.join(tempDir, destFileName);
        await fs.copyFile(sourcePath, tempArchivePath);

        await archiveManager.deleteFilesFromArchive(tempArchivePath, extraFiles);
        console.log(`${logPrefix} reusable ${candidate.archive_type} source archive after removing ${extraFiles.length} extra file(s)`);
        console.log(`${logPrefix}   source: ${sourcePath}`);

        await copyToTarget(tempArchivePath, finalDestPath, ctx);
        console.log(`[✓ Done]         consolidated archive → ${finalDestPath}`);
      } finally {
        try { await fs.rm(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }

    recordOutput(ctx, finalDestPath);
    ctx.cleanup?.sources.push({ fileId: candidate.archive_id, contentId: null, wholeArchive: true });
    reporter?.chosen(sourcePath);
    throwIfAborted(ctx.signal);
    result.stats.archivesCreated++;
    result.stats.gamesConsolidated++;
    result.stats.romsExtracted += matchedRoms.length;

    // Enregistrer directement en base pour éviter le rescan post-consolidation
    try {
      const entries: ConsolidatedRomEntry[] = matchedRoms.map(m => ({
        datRomId: m.datRomId,
        fileName: m.datRomName,
        size: m.datRomSize ?? 0,
        crc32: m.datRomCrc32,
        md5: m.datRomMd5,
        sha1: m.datRomSha1
      }));
      await recordConsolidatedArchive(
        db, finalDestPath, path.dirname(finalDestPath), candidate.archive_type, entries
      );
    } catch (recErr) {
      console.warn(`[recordConsolidation] direct recording failed (direct archive copy): ${recErr}`);
    }

    await db.run(
      `INSERT INTO consolidation_log (game_id, game_name, output_path, output_format, status, roms_consolidated, roms_total)
       VALUES (?, ?, ?, ?, 'success', ?, ?)`,
      [game.id, game.name, finalDestPath, candidate.archive_type, matchedRoms.length, game.totalRoms]
    );

    return true;
  }

  console.log(`${logPrefix} no reusable source archive → recreation required`);
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
  result: ConsolidationResult,
  ctx: GameRunContext = {}
): Promise<void> {
  const sanitizedName = sanitizeFileName(game.name);

  // consolidateChdGame n'est atteint que pour des <disk> MAME (is_disk=1) → arcade.
  // MAME et les cores Recalbox résolvent les CHD dans <rompath>/<machine>/<disk>.chd :
  // le sous-dossier au nom du set est donc TOUJOURS requis (jamais à plat).
  const targetDir = path.join(settings.validatedRomsFolder, sanitizedName);

  await fs.mkdir(targetDir, { recursive: true });

  // Placeholder <jeu>.zip vide pour les jeux CHD-only (visibilité dans Recalbox).
  // Placé à la racine du dossier cible, à côté du sous-dossier <jeu>/ contenant le CHD.
  if (settings.arcadeChdEmptyZip) {
    const emptyZipPath = path.join(settings.validatedRomsFolder, `${sanitizedName}.zip`);
    await writeEmptyChdZip(emptyZipPath);
    recordOutput(ctx, emptyZipPath);
    console.log(`[CHD] empty placeholder zip created → ${emptyZipPath}`);
  }

  // Liste des fichiers produits pour enregistrement direct en base
  const producedChds: Array<{ targetPath: string; rom: MatchedRomInfo }> = [];

  for (const rom of matchedRoms) {
    const sourcePath = rom.scannedFilePath || rom.archivePath;
    if (!sourcePath) continue;

    // Nom de sortie = <disk name> + .chd (les <disk> MAME sont sans extension).
    const targetPath = path.join(targetDir, chdOutputName(rom));

    // Copie telle quelle (aucune extraction ni recompression d'un CHD).
    await copyToTarget(sourcePath, targetPath, ctx);
    recordSource(ctx, rom);
    recordOutput(ctx, targetPath);

    producedChds.push({ targetPath, rom });
    result.stats.romsExtracted++;
  }

  throwIfAborted(ctx.signal);
  result.stats.gamesConsolidated++;

  // Enregistrer chaque CHD produit en base pour éviter le rescan.
  // targetDir est le dossier réel (sous-dossier au nom du jeu, ou dossier cible à
  // plat) ; recordConsolidatedArchive l'enregistre sous son parent via ensureScannedFolder.
  try {
    for (const { targetPath, rom } of producedChds) {
      const entry: ConsolidatedRomEntry = {
        datRomId: rom.datRomId,
        fileName: rom.datRomName,
        size: rom.datRomSize ?? 0,
        crc32: rom.datRomCrc32,
        md5: rom.datRomMd5,
        sha1: rom.datRomSha1
      };
      await recordConsolidatedArchive(db, targetPath, targetDir, 'chd', [entry]);
    }
  } catch (recErr) {
    console.warn(`[recordConsolidation] direct recording failed (CHD game): ${recErr}`);
  }

  await db.run(
    `INSERT INTO consolidation_log (game_id, game_name, output_path, output_format, status, roms_consolidated, roms_total)
     VALUES (?, ?, ?, 'chd', 'success', ?, ?)`,
    [game.id, game.name, targetDir, matchedRoms.length, game.totalRoms]
  );
}

/**
 * Extrait/copie une ROM matchée dans le dossier temporaire avec le nom du DAT
 */
/**
 * Phase 6 — Liste récursivement les fichiers dans tempDir en excluant :
 *  - le sous-dossier `output` (réservé aux archives candidates de useBestCompression)
 *  - le sous-dossier `_extract_tmp` (buffer temporaire d'extraction)
 *
 * Retourne des chemins absolus. 7z stocke les chemins de manière relative au
 * préfixe commun (comportement -spf- par défaut) — donc les sous-dossiers
 * {cloneName}/ seront préservés dans l'archive.
 */
async function listExtractedFiles(tempDir: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'output' || entry.name === '_extract_tmp' || entry.name === '_chd_extract') continue;
        await walk(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  }
  await walk(tempDir);
  return files;
}

async function extractRomToTemp(
  rom: MatchedRomInfo,
  tempDir: string,
  archiveManager: ArchiveManager,
  hostGameName?: string
): Promise<void> {
  // Phase 6 — Si la ROM appartient à un clone fusionné dans le parent (mode merged),
  // la placer dans un sous-dossier {cloneName}/ pour respecter la convention MAME.
  // 7z stocke des chemins relatifs par défaut, la structure sera préservée dans l'archive.
  const isFromClone = !!(hostGameName && rom.datRomOwnerGameName && rom.datRomOwnerGameName !== hostGameName);
  const targetDir = isFromClone
    ? path.join(tempDir, rom.datRomOwnerGameName!)
    : tempDir;
  if (isFromClone) await fs.mkdir(targetDir, { recursive: true });
  const targetPath = path.join(targetDir, rom.datRomName);
  // datRomName peut contenir un sous-dossier (DAT merged : "aa3010_de\rom.ic17").
  // S'assurer que le dossier parent existe avant le rename/copy (sinon ENOENT).
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  if (rom.archiveContentId && rom.archivePath && rom.archiveFileName) {
    // ROM dans une archive : extraire le fichier spécifique
    const extractDir = path.join(tempDir, '_extract_tmp');
    await fs.mkdir(extractDir, { recursive: true });

    try {
      await archiveManager.extractArchive(rom.archivePath, extractDir, [rom.archiveFileName]);

      // Le fichier extrait peut être dans un sous-dossier
      const extractedPath = path.join(extractDir, rom.archiveFileName);

      // Vérifier que le fichier attendu a bien été extrait. En cas d'échec
      // silencieux (adm-zip qui ne trouve pas l'entrée, node-7z qui ignore un
      // filtre, etc.), lister le contenu produit pour investigation.
      let extractedStats: import('fs').Stats | null = null;
      try {
        extractedStats = await fs.stat(extractedPath);
      } catch {
        console.warn(`[extract] ⚠️ ${rom.datRomName}: extractArchive did NOT produce "${rom.archiveFileName}" from "${rom.archivePath}"`);
        if (RUMCET_DEBUG) {
          const produced: string[] = [];
          try {
            const walk = async (dir: string, base: string): Promise<void> => {
              const entries = await fs.readdir(dir, { withFileTypes: true });
              for (const e of entries) {
                const rel = path.join(base, e.name);
                if (e.isDirectory()) await walk(path.join(dir, e.name), rel);
                else produced.push(rel);
              }
            };
            await walk(extractDir, '');
          } catch {}
          console.warn(`             _extract_tmp contains: ${produced.length === 0 ? '(empty)' : produced.join(', ')}`);
        }
        return;
      }

      if (!extractedStats.isFile()) {
        console.warn(`[extract] ⚠️ ${rom.datRomName}: "${extractedPath}" is not a regular file`);
        return;
      }

      // Renommer/déplacer vers le nom du DAT (avec sous-dossier si clone foldé)
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
    // Fichier loose : copier et renommer (avec sous-dossier si clone foldé)
    await fs.copyFile(rom.scannedFilePath, targetPath);
  } else {
    console.warn(`[extract] ⚠️ ${rom.datRomName}: no source (neither archive nor loose) — ROM not extracted`);
  }
}

/**
 * Extrait UNE SEULE FOIS un CHD source, puis distribue chacune des ROMs qui en
 * proviennent vers son emplacement cible (nom du DAT, + sous-dossier {clone}/ si
 * clone foldé). Évite N extractions complètes du même CHD (chdman est monolithique).
 * Toutes les ROMs de `roms` doivent avoir `archivePath === chdPath` et un
 * `archiveFileName` (le nom du fichier tel que produit à l'extraction du CHD).
 */
async function extractChdRomsToTemp(
  chdPath: string,
  roms: MatchedRomInfo[],
  tempDir: string,
  archiveManager: ArchiveManager,
  hostGameName?: string
): Promise<void> {
  const extractDir = path.join(tempDir, '_chd_extract');
  await fs.mkdir(extractDir, { recursive: true });

  try {
    // Extraction complète du CHD (chdman ignore de toute façon un filtre de fichiers).
    await archiveManager.extractArchive(chdPath, extractDir);

    for (const rom of roms) {
      const isFromClone = !!(hostGameName && rom.datRomOwnerGameName && rom.datRomOwnerGameName !== hostGameName);
      const targetDir = isFromClone ? path.join(tempDir, rom.datRomOwnerGameName!) : tempDir;
      const targetPath = path.join(targetDir, rom.datRomName);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });

      const extractedPath = path.join(extractDir, rom.archiveFileName!);
      try {
        const st = await fs.stat(extractedPath);
        if (!st.isFile()) {
          console.warn(`[extract] ⚠️ ${rom.datRomName}: "${extractedPath}" is not a regular file`);
          continue;
        }
      } catch {
        console.warn(`[extract] ⚠️ ${rom.datRomName}: "${rom.archiveFileName}" not found in extracted CHD "${chdPath}"`);
        continue;
      }
      // Copie (et non rename) : plusieurs ROMs proviennent de la même extraction.
      await fs.copyFile(extractedPath, targetPath);
    }
  } finally {
    try {
      await fs.rm(extractDir, { recursive: true, force: true });
    } catch {
      // Ignorer
    }
  }
}

/**
 * Consolide un jeu unique à partir de fichiers déjà extraits et vérifiés.
 * Utilisé par le moteur de téléchargement après download + hash matching.
 *
 * @param gameName - Nom du jeu (sera sanitisé pour le nom de fichier)
 * @param extractedFiles - Chemins absolus des fichiers extraits déjà matchés (nommés selon le DAT)
 * @param systemId - Identifiant du système (ex: 'psx', 'nes')
 * @param matchedDatRomIds - Optionnel : map filename → datRomId pour enregistrer
 *   directement les rom_matches en base (évite un rescan post-consolidation).
 * @param options - Optionnel : suivi de la progression (étape, formats étudiés,
 *   format retenu) et interruption (arrêt forcé).
 * @returns Chemin du fichier consolidé dans validatedRomsFolder
 */
export async function consolidateSingleGame(
  db: Database,
  gameName: string,
  extractedFiles: string[],
  systemId: string,
  matchedDatRomIds?: Map<string, number>,
  options: { onProgress?: (state: Partial<ConsolidationProgress>) => void; signal?: OperationSignal } = {}
): Promise<string> {
  const reporter = options.onProgress ? new GameProgressReporter(state => options.onProgress!(state)) : undefined;
  const ctx: GameRunContext = { reporter, signal: options.signal };
  reporter?.step('analyzing');
  const settings = settingsManager.getAll();
  // Résoudre les dossiers cibles effectifs (avec sous-dossier système si mode multi-système)
  settings.validatedRomsFolder = await getEffectiveValidatedRomsFolder(db);
  settings.tempExtractionFolder = await getEffectiveTempExtractionFolder(db);
  const archiveManager = new ArchiveManager();
  const sanitizedName = sanitizeFileName(gameName);

  await fs.mkdir(settings.validatedRomsFolder, { recursive: true });

  // Helper : construire les entrées d'enregistrement (size + hashs depuis dat_roms)
  // pour les fichiers extraits qui ont un datRomId connu.
  async function buildEntries(): Promise<ConsolidatedRomEntry[]> {
    if (!matchedDatRomIds || matchedDatRomIds.size === 0) return [];
    const ids = [...matchedDatRomIds.values()];
    const placeholders = ids.map(() => '?').join(',');
    const rows = await db.all<{ id: number; name: string; size: number | null; crc32: string | null; md5: string | null; sha1: string | null }>(
      `SELECT id, name, size, crc32, md5, sha1 FROM dat_roms WHERE id IN (${placeholders})`,
      ids
    );
    return rows.map(r => ({
      datRomId: r.id,
      fileName: r.name,
      size: r.size ?? 0,
      crc32: r.crc32,
      md5: r.md5,
      sha1: r.sha1
    }));
  }

  // Cas spécial CHD : si tous les fichiers sont déjà des CHD, copier directement
  const allChd = extractedFiles.every(f => path.extname(f).toLowerCase() === '.chd');

  if (allChd) {
    // Layout du CHD selon la famille (via le profil) : arcade → sous-dossier au nom
    // du set (obligatoire pour MAME/Recalbox) ; disque optique → CHD à plat.
    const useSubfolder = systemProfileManager.forSystem(systemId).isArcade();
    const chdDir = useSubfolder
      ? path.join(settings.validatedRomsFolder, sanitizedName)
      : settings.validatedRomsFolder;
    await fs.mkdir(chdDir, { recursive: true });

    // Placeholder <jeu>.zip vide pour les jeux CHD-only (visibilité dans Recalbox).
    if (settings.arcadeChdEmptyZip) {
      const emptyZipPath = path.join(settings.validatedRomsFolder, `${sanitizedName}.zip`);
      await writeEmptyChdZip(emptyZipPath);
      console.log(`[consolidateSingleGame] empty placeholder zip created → ${emptyZipPath}`);
    }

    reporter?.mode('chd-copy');
    reporter?.setFormats([{ id: 'chd', format: 'chd', status: 'running' }]);
    reporter?.step('copying');
    const copiedPaths: string[] = [];
    for (const filePath of extractedFiles) {
      const destPath = path.join(chdDir, path.basename(filePath));
      await copyToTarget(filePath, destPath, ctx);
      copiedPaths.push(destPath);
    }
    console.log(`[consolidateSingleGame] ${gameName} → ${extractedFiles.length} CHD(s) copied directly`);
    reporter?.chosen('chd');
    throwIfAborted(ctx.signal);

    // Enregistrer chaque CHD copié en base pour éviter le rescan
    try {
      const entries = await buildEntries();
      for (const destPath of copiedPaths) {
        const matching = entries.find(e => e.fileName === path.basename(destPath));
        if (matching) {
          await recordConsolidatedArchive(db, destPath, chdDir, 'chd', [matching]);
        }
      }
    } catch (recErr) {
      console.warn(`[recordConsolidation] direct recording failed (single CHD copy): ${recErr}`);
    }

    return chdDir;
  }

  // Déterminer si conversion CHD est possible
  const chdPossible = extractedFiles.some(f =>
    CHD_ENTRY_EXTENSIONS.includes(path.extname(f).toLowerCase())
  );

  const targetFormat = determineTargetFormat(systemId, settings, chdPossible);

  // Mode brut : aucun format d'archive autorisé → copier les fichiers bruts directement
  // à la racine du dossier cible (pas de sous-dossier par jeu).
  if (targetFormat === null) {
    reporter?.mode('raw');
    reporter?.setFormats([{ id: 'raw', format: 'raw', status: 'running' }]);
    reporter?.step('copying');
    await fs.mkdir(settings.validatedRomsFolder, { recursive: true });
    const rawCopies: Array<{ filePath: string; fileName: string }> = [];
    for (const fp of extractedFiles) {
      const fileName = path.basename(fp);
      const dest = path.join(settings.validatedRomsFolder, fileName);
      await copyToTarget(fp, dest, ctx);
      rawCopies.push({ filePath: dest, fileName });
    }
    console.log(`[consolidateSingleGame] ${gameName} → ${extractedFiles.length} raw file(s) copied to ${settings.validatedRomsFolder}`);
    reporter?.chosen('raw');
    throwIfAborted(ctx.signal);

    // Enregistrer en base pour éviter le rescan
    try {
      const entries = await buildEntries();
      const rawEntries = rawCopies
        .map(c => {
          const matching = entries.find(e => e.fileName === c.fileName);
          if (!matching) return null;
          return { ...matching, filePath: c.filePath };
        })
        .filter((e): e is ConsolidatedRomEntry & { filePath: string } => e !== null);
      if (rawEntries.length > 0) {
        await recordConsolidatedRawFiles(db, settings.validatedRomsFolder, settings.validatedRomsFolder, rawEntries);
      }
    } catch (recErr) {
      console.warn(`[recordConsolidation] direct recording failed (single raw): ${recErr}`);
    }

    return settings.validatedRomsFolder;
  }

  // Créer un dossier temporaire pour l'output
  const tempOutputDir = path.join(settings.tempExtractionFolder, `download-consolidate-${Date.now()}`);
  await fs.mkdir(tempOutputDir, { recursive: true });

  try {
    const tempOutputBasePath = path.join(tempOutputDir, sanitizedName);
    let tempOutputPath: string;

    reporter?.step('compressing');
    if (settings.useBestCompression) {
      reporter?.mode('best');
      reporter?.setFormats(bestCompressionCandidates(getSystemAllowedFormats(systemId, settings), chdPossible));
      const bestResult = await createBestCompressedArchive(
        extractedFiles, tempOutputBasePath, settings, archiveManager, systemId, chdPossible, undefined, ctx
      );
      tempOutputPath = bestResult.outputPath;
    } else {
      reporter?.mode('standard');
      const archiveFiles = (targetFormat === 'chd')
        ? getChdInputFiles(extractedFiles)
        : extractedFiles;
      let finalFormat: string = targetFormat;

      if (archiveFiles.length === 0) {
        reporter?.setFormats([
          { id: 'chd', format: 'chd', status: 'skipped', note: 'chdNoEntryPoint' },
          { id: '7z', format: '7z', status: 'running' }
        ]);
        finalFormat = '7z';
        // Fallback si CHD impossible
        tempOutputPath = await withTimeout(
          archiveManager.createArchive(extractedFiles, tempOutputBasePath,
            { archiveFormatPriority: ['7z'], compressionLevel: settings.compressionLevel,
              solidArchive: settings.solidArchive, multithreading: settings.multithreading },
            '7z' as any),
          ARCHIVE_CREATION_TIMEOUT_MS, `Création archive 7z (fallback) pour ${gameName}`
        );
      } else {
        reporter?.setFormats([{ id: targetFormat, format: targetFormat, status: 'running' }]);
        tempOutputPath = await withTimeout(
          archiveManager.createArchive(archiveFiles, tempOutputBasePath,
            { archiveFormatPriority: [targetFormat], compressionLevel: settings.compressionLevel,
              solidArchive: settings.solidArchive, multithreading: settings.multithreading },
            targetFormat as any),
          ARCHIVE_CREATION_TIMEOUT_MS, `Création archive ${targetFormat} pour ${gameName}`
        );
      }
      const archiveSize = await fs.stat(tempOutputPath).then(st => st.size).catch(() => undefined);
      reporter?.updateFormat(finalFormat, { status: 'done', size: archiveSize });
      reporter?.chosen(finalFormat);
    }

    // Copier le résultat final vers validatedRomsFolder
    reporter?.step('copying');
    const finalDestPath = path.join(settings.validatedRomsFolder, path.basename(tempOutputPath));
    await copyToTarget(tempOutputPath, finalDestPath, ctx);
    console.log(`[consolidateSingleGame] ${gameName} → ${finalDestPath}`);
    throwIfAborted(ctx.signal);

    // Enregistrer l'archive directement en base pour éviter le rescan
    try {
      const entries = await buildEntries();
      if (entries.length > 0) {
        const archiveType = path.extname(finalDestPath).toLowerCase().slice(1) || targetFormat;
        await recordConsolidatedArchive(
          db, finalDestPath, settings.validatedRomsFolder, archiveType, entries
        );
      }
    } catch (recErr) {
      console.warn(`[recordConsolidation] direct recording failed (single archive): ${recErr}`);
    }

    return finalDestPath;
  } finally {
    try {
      await fs.rm(tempOutputDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}
