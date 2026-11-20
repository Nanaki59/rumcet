/*
 * RUMCET - ROM's Ultimate Manager, Conversion and Editor Tool
 * Copyright (C) 2025 Nanaki59
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// src/helpers/sourceCleanup.ts
// Nettoyage des dossiers sources au fil de la consolidation.
//
// Après chaque jeu consolidé, ses sources (celles utilisées, ou toutes les copies
// selon la portée) deviennent candidates. Un conteneur (fichier seul ou archive)
// n'est traité qu'une fois qu'aucun jeu encore en attente n'est lié à son contenu :
// une archive partagée (set MAME fusionné, pack multi-jeux) n'est réécrite qu'une fois.
// Les sorties de la consolidation, les dossiers de travail et les fichiers d'autres
// jeux présents dans le dossier cible ne sont jamais touchés.
// En fin de run, une passe déplace les fichiers sans lien avec le DAT (hors dossier cible).

import fs from 'fs/promises';
import path from 'path';
import { Database, getMetadata, setMetadata } from '../database/init.js';
import { ArchiveManager } from './archives/ArchiveManager.js';
import { forgetScannedFile, recordEntriesRemoved } from './recordConsolidation.js';
import { settingsManager, loadDbFolderSettings, resolveEffectiveFolder } from './settingsManager.js';
import { OperationSignal } from './operationSignal.js';
import {
  isInsideFolder,
  normalizeForCompare,
  isItemNeeded,
  planContainer,
  minimalRootLabels,
  findRoot,
  ContainerAction,
  ContainerKind,
  NeedContext,
  RunGameStatus,
  ReadOnlyArchiveMode
} from './sourceCleanupPlan.js';

type Settings = ReturnType<typeof settingsManager.getAll>;

/** Source réellement utilisée pour produire un jeu. */
export interface SourceRef {
  /** scanned_files.id du fichier physique (fichier seul ou archive). */
  fileId: number;
  /** Entrée d'archive utilisée (null : fichier seul, ou archive entière avec `wholeArchive`). */
  contentId: number | null;
  /** Copie directe : toutes les entrées de l'archive liées aux ROMs du jeu. */
  wholeArchive?: boolean;
}

/** Ce que la consolidation d'un jeu a utilisé et produit. */
export interface GameCleanupRecord {
  sources: SourceRef[];
  outputs: string[];
  /** dat_roms consommées par la consolidation (clones fusionnés et disques compris). */
  consumedDatRomIds: number[];
}

/** Compteurs du nettoyage (sous-ensemble des stats de ConsolidationResult). */
export interface CleanupStats {
  sourcesDeleted: number;
  archivesCleaned: number;
  archivesSplit: number;
  unmatchedFilesMoved: number;
  unmatchedInTarget: number;
  cleanupErrors: number;
}

export interface FinalPassProgress {
  current: number;
  total: number;
}

/** Marqueur d'un fichier seul dans les candidats (pas d'entrée d'archive). */
const LOOSE = -1;

/** Métadonnée : dossier attribué à chaque racine source, par dossier des non matchés. */
const LABELS_METADATA_KEY = 'unmatched_source_folders';

interface Container {
  fileId: number;
  /** Candidats : id d'entrée (ou LOOSE) → jeux (propriétaires) qui l'ont déclaré. */
  candidates: Map<number, Set<number>>;
  blockers: Set<number>;
}

interface ScannedRow {
  id: number;
  file_path: string;
  file_name: string;
  is_archive: number;
  archive_type: string | null;
}

export class SourceCleaner {
  private readonly targetDir: string;
  private readonly unmatchedDir: string;
  private readonly protectedDirs: string[];
  private readonly baseTargetDir: string;
  private readonly scopeAll: boolean;
  private readonly moveUnmatched: boolean;
  private readonly readOnlyMode: ReadOnlyArchiveMode;

  private readonly status = new Map<number, RunGameStatus>();
  private readonly owner: Map<number, number>;
  private readonly selected: Set<number>;
  private readonly needCtx: NeedContext;

  private readonly containers = new Map<number, Container>();
  private readonly blockedBy = new Map<number, Set<number>>();
  private readonly runOutputs = new Set<string>();
  private roots: string[] = [];
  private labels = new Map<string, string[]>();
  private labelMapping: Record<string, Record<string, string>> = {};

  private constructor(
    private readonly db: Database,
    private readonly settings: Settings,
    private readonly archiveManager: ArchiveManager,
    private readonly stats: CleanupStats,
    private readonly signal: OperationSignal | undefined,
    folders: { target: string; baseTarget: string; unmatched: string; protectedDirs: string[] },
    runGameIds: number[],
    foldedOwner: Map<number, number>,
    selected: Set<number>
  ) {
    this.targetDir = folders.target;
    this.baseTargetDir = folders.baseTarget;
    this.unmatchedDir = folders.unmatched;
    this.protectedDirs = folders.protectedDirs;
    this.scopeAll = settings.cleanupScope === 'all-matched';
    this.moveUnmatched = settings.moveUnmatchedFiles !== false;
    this.readOnlyMode = settings.unmatchedInReadOnlyArchives === 'move' ? 'move' : 'repack';
    this.owner = foldedOwner;
    this.selected = selected;
    for (const id of runGameIds) this.status.set(id, 'pending');
    this.needCtx = {
      statusOf: id => this.status.get(this.ownerOf(id)),
      isSelected: id => this.selected.has(id),
      protectUnselected: settings.protectFilesForUnselectedGames !== false
    };
  }

  /**
   * @param settings paramètres dont les dossiers sont déjà résolus pour la base (dossiers effectifs)
   * @param runGameIds jeux traités par ce run (hors clones fusionnés)
   * @param foldedOwner clone fusionné → parent qui le consolide (mode merged)
   */
  static async create(
    db: Database,
    settings: Settings,
    archiveManager: ArchiveManager,
    stats: CleanupStats,
    signal: OperationSignal | undefined,
    runGameIds: number[],
    foldedOwner: Map<number, number>
  ): Promise<SourceCleaner> {
    const dbFolders = await loadDbFolderSettings(db);
    const base = (key: Parameters<typeof resolveEffectiveFolder>[0]) => resolveEffectiveFolder(key, dbFolders, null);
    const protectedDirs = [
      base('unmatchedRomsFolder'), settings.unmatchedRomsFolder,
      base('tempExtractionFolder'), settings.tempExtractionFolder,
      base('incompleteRomsFolder'), settings.incompleteRomsFolder
    ].filter((d): d is string => !!d);

    const selectedRows = await db.all<{ id: number }>('SELECT id FROM games WHERE is_selected != 0');
    const cleaner = new SourceCleaner(
      db, settings, archiveManager, stats, signal,
      {
        target: settings.validatedRomsFolder,
        baseTarget: base('validatedRomsFolder') || settings.validatedRomsFolder,
        unmatched: settings.unmatchedRomsFolder,
        protectedDirs
      },
      runGameIds, foldedOwner, new Set(selectedRows.map(r => r.id))
    );
    await cleaner.loadRoots();
    return cleaner;
  }

  // ─── Cycle de vie d'un jeu ───

  /**
   * À appeler après chaque jeu (quelle que soit l'issue). En cas de succès, les
   * sources du jeu deviennent candidates ; les conteneurs qui ne sont plus liés à
   * aucun jeu en attente sont traités.
   */
  async gameFinished(
    gameId: number,
    outcome: 'succeeded' | 'failed',
    record?: GameCleanupRecord
  ): Promise<void> {
    const consumedDatRomIds = record?.consumedDatRomIds ?? [];
    this.status.set(gameId, outcome);
    for (const out of record?.outputs ?? []) this.runOutputs.add(normalizeForCompare(out));

    const touched = new Set<number>();
    if (outcome === 'succeeded' && record) {
      const candidates = this.scopeAll
        ? await this.allCopiesOf(consumedDatRomIds)
        : await this.resolveUsed(record.sources, consumedDatRomIds);
      for (const { fileId, contentId } of candidates) {
        let c = this.containers.get(fileId);
        if (!c) {
          c = { fileId, candidates: new Map(), blockers: new Set() };
          this.containers.set(fileId, c);
        }
        const key = contentId ?? LOOSE;
        if (!c.candidates.has(key)) c.candidates.set(key, new Set());
        c.candidates.get(key)!.add(gameId);
        touched.add(fileId);
      }
    }

    // Conteneurs débloqués par la fin de ce jeu
    for (const fileId of this.blockedBy.get(gameId) ?? []) {
      const c = this.containers.get(fileId);
      if (c) {
        c.blockers.delete(gameId);
        touched.add(fileId);
      }
    }
    this.blockedBy.delete(gameId);

    for (const fileId of touched) {
      if (this.aborted()) return;
      await this.processIfReady(fileId);
    }
  }

  /** Copies de toutes les ROMs consommées (portée « tous les fichiers matchés »). */
  private async allCopiesOf(datRomIds: number[]): Promise<Array<{ fileId: number; contentId: number | null }>> {
    const out: Array<{ fileId: number; contentId: number | null }> = [];
    const ids = [...new Set(datRomIds)];
    for (let i = 0; i < ids.length; i += 900) {
      const chunk = ids.slice(i, i + 900);
      const rows = await this.db.all<{ fileId: number; contentId: number | null }>(
        `SELECT DISTINCT scanned_file_id AS fileId, archive_content_id AS contentId
         FROM rom_matches WHERE dat_rom_id IN (${chunk.map(() => '?').join(',')})`,
        chunk
      );
      out.push(...rows);
    }
    return out;
  }

  /** Sources réellement utilisées (portée « fichiers utilisés uniquement »). */
  private async resolveUsed(sources: SourceRef[], datRomIds: number[]): Promise<Array<{ fileId: number; contentId: number | null }>> {
    const out: Array<{ fileId: number; contentId: number | null }> = [];
    const ids = [...new Set(datRomIds)];
    for (const ref of sources) {
      if (!ref.wholeArchive) {
        out.push({ fileId: ref.fileId, contentId: ref.contentId });
        continue;
      }
      for (let i = 0; i < ids.length; i += 900) {
        const chunk = ids.slice(i, i + 900);
        const rows = await this.db.all<{ contentId: number | null }>(
          `SELECT DISTINCT archive_content_id AS contentId FROM rom_matches
           WHERE scanned_file_id = ? AND dat_rom_id IN (${chunk.map(() => '?').join(',')})`,
          [ref.fileId, ...chunk]
        );
        for (const r of rows) out.push({ fileId: ref.fileId, contentId: r.contentId });
      }
    }
    return out;
  }

  // ─── Traitement d'un conteneur ───

  private ownerOf(gameId: number): number {
    return this.owner.get(gameId) ?? gameId;
  }

  /** Arrêt forcé uniquement : une interruption douce laisse finir le nettoyage du jeu terminé. */
  private aborted(): boolean {
    return !!this.signal?.abort.signal.aborted;
  }

  /** Emplacement jamais modifié par le nettoyage. */
  private isProtected(filePath: string): boolean {
    const resolved = path.resolve(filePath);
    if (this.runOutputs.has(normalizeForCompare(resolved))) return true;
    if (this.protectedDirs.some(d => isInsideFolder(resolved, d))) return true;
    // Multi-systèmes : dossiers des autres systèmes dans le dossier cible de base
    if (isInsideFolder(resolved, this.baseTargetDir) && !isInsideFolder(resolved, this.targetDir)) return true;
    return false;
  }

  /** Liens (entrée → jeux propriétaires) d'un fichier scanné. */
  private async linksOf(fileId: number): Promise<Map<number, { name: string; games: Set<number> }>> {
    const rows = await this.db.all<{ contentId: number | null; name: string | null; gameId: number | null }>(
      `SELECT ac.id AS contentId, ac.file_name AS name, dr.game_id AS gameId
       FROM archive_contents ac
       LEFT JOIN rom_matches rm ON rm.archive_content_id = ac.id
       LEFT JOIN dat_roms dr ON dr.id = rm.dat_rom_id
       WHERE ac.archive_id = ?
       UNION ALL
       SELECT NULL AS contentId, NULL AS name, dr.game_id AS gameId
       FROM rom_matches rm JOIN dat_roms dr ON dr.id = rm.dat_rom_id
       WHERE rm.scanned_file_id = ? AND rm.archive_content_id IS NULL`,
      [fileId, fileId]
    );
    const links = new Map<number, { name: string; games: Set<number> }>();
    for (const r of rows) {
      const key = r.contentId ?? LOOSE;
      if (!links.has(key)) links.set(key, { name: r.name ?? '', games: new Set() });
      if (r.gameId !== null) links.get(key)!.games.add(this.ownerOf(r.gameId));
    }
    return links;
  }

  private async processIfReady(fileId: number): Promise<void> {
    const c = this.containers.get(fileId);
    if (!c) return;

    const row = await this.db.get<ScannedRow>(
      'SELECT id, file_path, file_name, is_archive, archive_type FROM scanned_files WHERE id = ?', [fileId]
    );
    // Ligne disparue (fichier déjà traité, ou sortie ré-enregistrée par-dessus) / emplacement protégé
    if (!row || this.isProtected(row.file_path)) {
      this.containers.delete(fileId);
      return;
    }

    const links = await this.linksOf(fileId);

    // Attendre la fin des jeux encore en attente liés à ce conteneur
    c.blockers.clear();
    for (const { games } of links.values()) {
      for (const g of games) {
        if (this.status.get(g) === 'pending') c.blockers.add(g);
      }
    }
    if (c.blockers.size > 0) {
      for (const g of c.blockers) {
        if (!this.blockedBy.has(g)) this.blockedBy.set(g, new Set());
        this.blockedBy.get(g)!.add(fileId);
      }
      return;
    }
    this.containers.delete(fileId);

    try {
      await fs.access(row.file_path);
    } catch {
      await forgetScannedFile(this.db, fileId);
      return;
    }

    try {
      await this.cleanContainer(row, c, links);
    } catch (err: any) {
      this.stats.cleanupErrors++;
      console.error(`[Cleanup] ❌ ${row.file_path}: ${err?.message || err}`);
    }
  }

  private async cleanContainer(
    row: ScannedRow,
    c: Container,
    links: Map<number, { name: string; games: Set<number> }>
  ): Promise<void> {
    const insideTarget = isInsideFolder(row.file_path, this.targetDir);
    const isRemovable = (key: number, games: Set<number>) => {
      const registrants = c.candidates.get(key);
      return !!registrants && !isItemNeeded(games, registrants, insideTarget, this.needCtx);
    };

    if (!row.is_archive) {
      const loose = links.get(LOOSE);
      if (loose && isRemovable(LOOSE, loose.games)) {
        await this.deleteFile(row);
      }
      return;
    }

    const removable: Array<{ id: number; name: string }> = [];
    const unmatched: Array<{ id: number; name: string }> = [];
    let keptCount = 0;
    for (const [key, { name, games }] of links) {
      if (key === LOOSE) continue;
      if (games.size === 0) unmatched.push({ id: key, name });
      else if (isRemovable(key, games)) removable.push({ id: key, name });
      else keptCount++;
    }

    const action = planContainer({
      kind: this.kindOf(row),
      removable: removable.map(e => e.name),
      keptCount,
      unmatched: unmatched.map(e => e.name),
      moveUnmatched: this.moveUnmatched,
      readOnlyMode: this.readOnlyMode
    });
    const idsOf = (names: string[]) => {
      const set = new Set(names);
      return [...removable, ...unmatched].filter(e => set.has(e.name)).map(e => e.id);
    };
    await this.apply(row, action, idsOf);
  }

  private kindOf(row: ScannedRow): ContainerKind {
    const type = (row.archive_type || path.extname(row.file_path).slice(1)).toLowerCase();
    return type === 'zip' || type === '7z' ? 'modifiable' : 'readonly';
  }

  private async apply(row: ScannedRow, action: ContainerAction, idsOf: (names: string[]) => number[]): Promise<void> {
    switch (action.type) {
      case 'none':
        return;
      case 'delete':
        await this.deleteFile(row);
        return;
      case 'strip':
        await this.stripEntries(row, action.remove, idsOf(action.remove));
        return;
      case 'strip-and-move':
        await this.stripEntries(row, action.remove, idsOf(action.remove));
        await this.moveToUnmatched(row);
        return;
      case 'strip-and-split':
        await this.splitOut(row, action.split);
        await this.stripEntries(row, [...action.remove, ...action.split], idsOf([...action.remove, ...action.split]), action.remove.length > 0);
        return;
      case 'repack-unmatched':
        await this.repackReadOnly(row, action.unmatched);
        return;
      case 'move':
        await this.moveToUnmatched(row);
        return;
      case 'keep-readonly':
        console.log(`[Cleanup] kept (non-modifiable archive still partly needed or holding unmatched files): ${row.file_path}`);
        return;
    }
  }

  // ─── Opérations ───

  private async deleteFile(row: ScannedRow): Promise<void> {
    await fs.unlink(row.file_path);
    await forgetScannedFile(this.db, row.id);
    this.stats.sourcesDeleted++;
    console.log(`[Cleanup] source deleted: ${row.file_path}`);
    await this.removeEmptyDirs(path.dirname(row.file_path));
  }

  private async stripEntries(row: ScannedRow, names: string[], contentIds: number[], countAsCleaned = true): Promise<void> {
    if (names.length === 0) return;
    await this.archiveManager.removeEntries(row.file_path, names);
    await recordEntriesRemoved(this.db, row.id, contentIds, row.file_path);
    if (countAsCleaned) this.stats.archivesCleaned++;
    console.log(`[Cleanup] ${names.length} entry(ies) removed from: ${row.file_path}`);
  }

  /** Copie des entrées non matchées dans une nouvelle archive (même format, même nom) du dossier des non matchés. */
  private async splitOut(row: ScannedRow, names: string[]): Promise<void> {
    const work = await this.workDir();
    try {
      const extractDir = path.join(work, 'x');
      await this.archiveManager.extractEntries(row.file_path, names, extractDir);
      const relFiles = await existingRelative(extractDir, names);
      if (relFiles.length === 0) throw new Error('no unmatched entry could be extracted');
      const format = this.kindOf(row) === 'modifiable' ? (path.extname(row.file_path).slice(1).toLowerCase() as 'zip' | '7z') : '7z';
      const built = await this.archiveManager.createArchive(
        relFiles,
        path.join(work, 'out', path.parse(row.file_name).name),
        { compressionLevel: this.settings.compressionLevel, solidArchive: this.settings.solidArchive,
          multithreading: this.settings.multithreading, workingDirectory: extractDir },
        format
      );
      const dest = await this.destinationFor(row.file_path, path.basename(built));
      await moveFile(built, dest);
      await this.logMove(row.file_path, dest);
      this.stats.archivesSplit++;
      this.stats.unmatchedFilesMoved++;
      console.log(`[Cleanup] ${relFiles.length} unmatched entry(ies) split out of ${row.file_path} → ${dest}`);
    } finally {
      await fs.rm(work, { recursive: true, force: true }).catch(() => { /* ignore */ });
    }
  }

  /** Archive non modifiable (RAR, CHD, CSO) : recompresser ses non matchés en 7z, puis la supprimer. */
  private async repackReadOnly(row: ScannedRow, names: string[]): Promise<void> {
    const work = await this.workDir();
    try {
      const extractDir = path.join(work, 'x');
      await fs.mkdir(extractDir, { recursive: true });
      await this.archiveManager.extractArchive(row.file_path, extractDir);
      const relFiles = await existingRelative(extractDir, names);
      if (relFiles.length === 0) throw new Error('no unmatched entry could be extracted');
      const built = await this.archiveManager.createArchive(
        relFiles,
        path.join(work, 'out', path.parse(row.file_name).name),
        { compressionLevel: this.settings.compressionLevel, solidArchive: this.settings.solidArchive,
          multithreading: this.settings.multithreading, workingDirectory: extractDir },
        '7z'
      );
      const dest = await this.destinationFor(row.file_path, path.basename(built));
      await moveFile(built, dest);
      await this.logMove(row.file_path, dest);
      this.stats.archivesSplit++;
      this.stats.unmatchedFilesMoved++;
      console.log(`[Cleanup] ${relFiles.length} unmatched file(s) of ${row.file_path} repacked → ${dest}`);
    } finally {
      await fs.rm(work, { recursive: true, force: true }).catch(() => { /* ignore */ });
    }
    await this.deleteFile(row);
  }

  private async moveToUnmatched(row: ScannedRow): Promise<void> {
    const dest = await this.destinationFor(row.file_path, row.file_name);
    await moveFile(row.file_path, dest);
    await forgetScannedFile(this.db, row.id);
    await this.logMove(row.file_path, dest);
    this.stats.unmatchedFilesMoved++;
    console.log(`[Cleanup] unmatched moved: ${row.file_path} → ${dest}`);
    await this.removeEmptyDirs(path.dirname(row.file_path));
  }

  private async logMove(original: string, destination: string): Promise<void> {
    await this.db.run(
      `INSERT INTO unmatched_moves (original_path, destination_path, status) VALUES (?, ?, 'success')`,
      [original, destination]
    );
  }

  private async workDir(): Promise<string> {
    const dir = path.join(this.settings.tempExtractionFolder, `cleanup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  /** Supprime les dossiers devenus vides, jusqu'à la racine scannée (exclue). */
  private async removeEmptyDirs(dir: string): Promise<void> {
    const root = findRoot(dir, this.roots);
    if (!root) return;
    let current = dir;
    while (isInsideFolder(current, root) && path.resolve(current) !== path.resolve(root) && !this.isProtected(current)
           && !isInsideFolder(current, this.targetDir)) {
      try {
        await fs.rmdir(current);
      } catch {
        return; // pas vide (ou inaccessible)
      }
      await this.db.run('DELETE FROM scanned_folders WHERE folder_path = ?', [current]);
      current = path.dirname(current);
    }
  }

  // ─── Destination des non matchés ───

  private async loadRoots(): Promise<void> {
    const rows = await this.db.all<{ folder_path: string }>('SELECT folder_path FROM scanned_folders WHERE is_root = 1');
    this.roots = rows.map(r => r.folder_path);
    this.labels = minimalRootLabels(this.roots);
    try {
      this.labelMapping = JSON.parse(await getMetadata(this.db, LABELS_METADATA_KEY) || '{}');
    } catch {
      this.labelMapping = {};
    }
  }

  /**
   * Dossier attribué à une racine source dans le dossier des non matchés. Mémorisé
   * en base ; un dossier déjà présent qui n'est pas attribué à cette racine n'est
   * jamais réutilisé (suffixe « (2) », « (3) »…).
   */
  private async labelFolderFor(root: string): Promise<string> {
    const mapping = this.labelMapping[this.unmatchedDir] ?? (this.labelMapping[this.unmatchedDir] = {});
    if (mapping[root]) return mapping[root];

    const base = path.join(...(this.labels.get(root) ?? [path.basename(root) || 'source']));
    const taken = new Set(Object.values(mapping).map(v => v.toLowerCase()));
    let candidate = base;
    for (let n = 2; ; n++) {
      if (!taken.has(candidate.toLowerCase()) && !(await exists(path.join(this.unmatchedDir, candidate)))) break;
      candidate = `${base} (${n})`;
    }
    mapping[root] = candidate;
    await setMetadata(this.db, LABELS_METADATA_KEY, JSON.stringify(this.labelMapping));
    return candidate;
  }

  /** Chemin libre dans le dossier des non matchés pour `fileName`, issu de `sourcePath`. */
  private async destinationFor(sourcePath: string, fileName: string): Promise<string> {
    const root = findRoot(sourcePath, this.roots);
    const dir = root
      ? path.join(this.unmatchedDir, await this.labelFolderFor(root), path.relative(root, path.dirname(sourcePath)))
      : path.join(this.unmatchedDir, path.basename(path.dirname(sourcePath)));
    await fs.mkdir(dir, { recursive: true });

    const ext = path.extname(fileName);
    const stem = path.basename(fileName, ext);
    let dest = path.join(dir, fileName);
    for (let n = 1; await exists(dest); n++) dest = path.join(dir, `${stem}_${n}${ext}`);
    return dest;
  }

  // ─── Passe finale ───

  /**
   * Fin de run (non interrompu) : déplace les fichiers et archives sans aucun lien
   * avec le DAT, et sépare les entrées non matchées des archives ZIP/7z hybrides.
   * Le dossier cible n'est jamais concerné (ses fichiers sans lien sont seulement comptés).
   */
  async finish(onProgress?: (p: FinalPassProgress) => void): Promise<void> {
    if (!this.moveUnmatched) return;

    const unlinked = await this.db.all<ScannedRow>(`
      SELECT sf.id, sf.file_path, sf.file_name, sf.is_archive, sf.archive_type
      FROM scanned_files sf
      WHERE NOT EXISTS (SELECT 1 FROM rom_matches rm WHERE rm.scanned_file_id = sf.id)
        AND (sf.is_archive = 0
             OR EXISTS (SELECT 1 FROM archive_contents ac WHERE ac.archive_id = sf.id
                        AND (COALESCE(ac.crc32, '') <> '' OR COALESCE(ac.sha1, '') <> '' OR COALESCE(ac.md5, '') <> '')))
    `);
    const hybrids = await this.db.all<ScannedRow>(`
      SELECT sf.id, sf.file_path, sf.file_name, sf.is_archive, sf.archive_type
      FROM scanned_files sf
      WHERE sf.is_archive = 1 AND LOWER(sf.archive_type) IN ('zip', '7z')
        AND EXISTS (SELECT 1 FROM rom_matches rm WHERE rm.scanned_file_id = sf.id)
        AND EXISTS (SELECT 1 FROM archive_contents ac WHERE ac.archive_id = sf.id
                    AND NOT EXISTS (SELECT 1 FROM rom_matches rm2 WHERE rm2.archive_content_id = ac.id))
    `);

    const eligible = (row: ScannedRow) => {
      if (this.isProtected(row.file_path)) return false;
      if (isInsideFolder(row.file_path, this.targetDir)) {
        this.stats.unmatchedInTarget++;
        return false;
      }
      // Les archives sans aucune entrée hachée (listage impossible, anciennes ISO
      // scannées comme archives…) sont exclues par la requête : non vérifiables.
      return true;
    };
    const toMove = unlinked.filter(eligible);
    const toSplit = hybrids.filter(eligible);
    const total = toMove.length + toSplit.length;
    let current = 0;

    for (const row of toMove) {
      if (this.aborted()) return;
      onProgress?.({ current: ++current, total });
      try {
        await fs.access(row.file_path);
        await this.moveToUnmatched(row);
      } catch (err: any) {
        if (err?.code === 'ENOENT') { await forgetScannedFile(this.db, row.id); continue; }
        this.stats.cleanupErrors++;
        await this.db.run(
          `INSERT INTO unmatched_moves (original_path, destination_path, status) VALUES (?, ?, 'error')`,
          [row.file_path, this.unmatchedDir]
        );
        console.error(`[Cleanup] ❌ move failed ${row.file_path}: ${err?.message || err}`);
      }
    }

    for (const row of toSplit) {
      if (this.aborted()) return;
      onProgress?.({ current: ++current, total });
      try {
        const links = await this.linksOf(row.id);
        const unmatched = [...links.entries()].filter(([key, l]) => key !== LOOSE && l.games.size === 0);
        if (unmatched.length === 0) continue;
        const names = unmatched.map(([, l]) => l.name);
        await this.splitOut(row, names);
        await this.stripEntries(row, names, unmatched.map(([key]) => key), false);
      } catch (err: any) {
        this.stats.cleanupErrors++;
        console.error(`[Cleanup] ❌ split failed ${row.file_path}: ${err?.message || err}`);
      }
    }

    if (this.stats.unmatchedInTarget > 0) {
      console.log(`[Cleanup] ${this.stats.unmatchedInTarget} unmatched file(s) left untouched in the target folder`);
    }
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Déplace un fichier, y compris vers un autre volume (copie puis suppression). */
async function moveFile(source: string, dest: string): Promise<void> {
  try {
    await fs.rename(source, dest);
  } catch (err: any) {
    if (err?.code !== 'EXDEV') throw err;
    await fs.copyFile(source, dest);
    await fs.unlink(source);
  }
}

/** Chemins (relatifs à `dir`) des entrées effectivement extraites. */
async function existingRelative(dir: string, names: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const name of names) {
    const rel = name.replace(/[\\/]+/g, path.sep);
    if (await exists(path.join(dir, rel))) out.push(rel);
  }
  return out;
}
