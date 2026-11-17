// src/helpers/scanFolder.ts
// Scan d'un dossier de ROMs vers la base :
// - pré-comptage des fichiers (barre de progression déterminée)
// - mode 'full' (tout re-hasher) ou 'quick' (uniquement les fichiers nouveaux ou
//   modifiés, d'après la taille et la date de modification ; sert aussi de reprise
//   d'un scan interrompu)
// - persistance par lots : un scan interrompu (ou un crash) conserve les fichiers
//   déjà complètement scannés
// - interruption normale (après le fichier en cours) ou forcée (fichier abandonné,
//   processus externes tués)

import fs from 'fs/promises';
import path from 'path';
import { Database } from '../database/init.js';
import { calculateFileHashes } from './hashCalculator.js';
import { archiveManager } from './archives/ArchiveManager.js';
import { OperationSignal, OperationAbortedError, raceAbort } from './operationSignal.js';

// ============================================
// INTERFACES
// ============================================

export interface FileHash {
  crc32: string;
  md5: string;
  sha1: string;
}

export interface ArchiveContent {
  fileName: string;
  size: number;
  hashes?: FileHash;
  compressionLevel?: number;    // Niveau de compression numérique de l'archive
  hasComment?: boolean;         // Ce fichier a-t-il un commentaire individuel ?
  hasGlobalComment?: boolean;   // L'archive a-t-elle un commentaire global ? (même valeur pour tous les fichiers)
}

interface ScannedFile {
  filePath: string;
  fileName: string;
  size: number;
  mtime: number;
  hashes: FileHash;
  isArchive: boolean;
  archiveType?: string;
  contents?: ArchiveContent[];
}

/** 'full' : tout re-hasher. 'quick' : seulement les fichiers nouveaux/modifiés. */
export type ScanMode = 'full' | 'quick';

/** Statut d'un dossier racine : 'in_progress' persiste si l'application s'arrête en plein scan. */
export type ScanStatus = 'in_progress' | 'partial' | 'complete';

/**
 * Signal d'interruption partagé avec l'appelant.
 * - `cancelRequested` : s'arrêter après le fichier en cours.
 * - `abort` : abandonner immédiatement le fichier en cours (arrêt forcé).
 */
export type ScanSignal = OperationSignal;

export interface ScanProgress {
  phase: 'counting' | 'scanning';
  rootPath: string;
  /** Dossier du fichier courant */
  folder: string;
  /** Nom du fichier courant */
  file: string;
  /** Index (1-based) du fichier courant ; en phase 'counting', nombre de fichiers trouvés */
  current: number;
  total: number;
  /**
   * - start : début du scan du fichier
   * - done : fichier scanné et enregistré
   * - unchanged : fichier ignoré par le scan rapide
   * - aborted : fichier abandonné par un arrêt forcé
   * - error : fichier illisible (non enregistré)
   */
  status?: 'start' | 'done' | 'unchanged' | 'aborted' | 'error';
  isArchive?: boolean;
  archiveType?: string;
  contentCount?: number;
  error?: string;
  /** Compteurs cumulés du dossier racine (les événements peuvent être échantillonnés) */
  scannedCount?: number;
  unchangedCount?: number;
}

export interface ScanResult {
  filesTotal: number;
  filesScanned: number;
  filesUnchanged: number;
  filesRemoved: number;
  filesFailed: number;
  cancelled: boolean;
}

export { OperationAbortedError as ScanAbortedError };

interface DiskFile {
  filePath: string;
  fileName: string;
  folder: string;
  size: number;
  mtime: number;
}

interface ExistingFile {
  id: number;
  size: number;
  file_mtime: number | null;
  scanned_at: string | null;
}

/** Nombre de fichiers scannés regroupés dans une même transaction */
const BATCH_SIZE = 25;

// ============================================
// OUTILS
// ============================================

/** `scanned_at` est stocké par CURRENT_TIMESTAMP, en UTC, au format 'YYYY-MM-DD HH:MM:SS'. */
function parseSqliteUtc(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value.replace(' ', 'T') + 'Z');
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Un fichier déjà en base est considéré inchangé si sa taille est identique et :
 * - sa date de modification est égale à celle enregistrée (l'égalité détecte aussi
 *   un fichier remplacé par une copie plus ancienne) ;
 * - à défaut (lignes antérieures à file_mtime), s'il n'a pas été modifié après le scan.
 */
function isUnchanged(disk: DiskFile, existing: ExistingFile | undefined): boolean {
  if (!existing || existing.size !== disk.size) return false;
  if (existing.file_mtime !== null && existing.file_mtime !== undefined) {
    return existing.file_mtime === disk.mtime;
  }
  const scannedAt = parseSqliteUtc(existing.scanned_at);
  return scannedAt !== null && disk.mtime <= scannedAt;
}

/**
 * Parcourt l'arborescence (sans hasher) : liste des dossiers (ordre parent → enfant)
 * et des fichiers avec taille et date de modification.
 */
async function walkFolder(
  rootPath: string,
  signal: ScanSignal,
  onCount: (count: number, folder: string) => void
): Promise<{ folders: string[]; files: DiskFile[] }> {
  const folders: string[] = [];
  const files: DiskFile[] = [];

  async function walk(dir: string): Promise<void> {
    if (signal.cancelRequested || signal.abort.signal.aborted) return;
    folders.push(dir);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const subDirs: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        subDirs.push(fullPath);
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(fullPath);
          files.push({
            filePath: fullPath,
            fileName: entry.name,
            folder: dir,
            size: stat.size,
            mtime: Math.trunc(stat.mtimeMs)
          });
        } catch (error) {
          console.warn(`⚠️ Unable to stat ${fullPath}:`, error);
        }
      }
    }
    onCount(files.length, dir);

    for (const subDir of subDirs) {
      await walk(subDir);
    }
  }

  await walk(rootPath);
  return { folders, files };
}

/** Hash + listing d'archive d'un fichier. N'écrit rien en base. */
async function scanOneFile(disk: DiskFile, abortSignal: AbortSignal): Promise<ScannedFile> {
  const hashes = await calculateFileHashes(disk.filePath, undefined, abortSignal);

  const scannedFile: ScannedFile = {
    filePath: disk.filePath,
    fileName: disk.fileName,
    size: disk.size,
    mtime: disk.mtime,
    hashes,
    isArchive: false
  };

  if (archiveManager.isArchive(disk.filePath)) {
    scannedFile.isArchive = true;
    scannedFile.archiveType = path.extname(disk.filePath).toLowerCase().substring(1);

    console.log(`📦 Scanning archive: ${disk.fileName}`);
    try {
      // Les données compressionLevel, hasComment et hasGlobalComment sont déjà incluses
      const archiveContents = await archiveManager.listArchive(disk.filePath);
      scannedFile.contents = archiveContents.map(content => ({
        fileName: content.fileName,
        size: content.size,
        hashes: content.hashes,
        compressionLevel: content.compressionLevel,
        hasComment: content.hasComment,
        hasGlobalComment: content.hasGlobalComment
      }));
      console.log(`✅ Archive: ${disk.fileName} (${scannedFile.archiveType}) - ${scannedFile.contents.length} files`);
    } catch (error) {
      if (abortSignal.aborted) throw new OperationAbortedError();
      console.error(`❌ Archive scan error ${disk.filePath}:`, error);
      scannedFile.contents = [];
    }
  }

  return scannedFile;
}

// ============================================
// ÉCRITURE EN BASE
// ============================================

/**
 * Crée ou met à jour un dossier SANS le supprimer : un `INSERT OR REPLACE`
 * supprimerait la ligne existante et, avec foreign_keys = ON, effacerait en
 * cascade ses fichiers et sous-dossiers (incompatible avec le scan rapide).
 */
async function upsertFolder(
  db: Database,
  folderPath: string,
  parentId: number | null,
  isRoot: boolean
): Promise<number> {
  await db.run(
    `INSERT INTO scanned_folders (folder_path, parent_folder_id, is_root, file_count)
     VALUES (?, ?, ?, 0)
     ON CONFLICT(folder_path) DO UPDATE SET
       parent_folder_id = excluded.parent_folder_id,
       is_root = excluded.is_root`,
    [folderPath, parentId, isRoot ? 1 : 0]
  );
  const row = await db.get<{ id: number }>('SELECT id FROM scanned_folders WHERE folder_path = ?', [folderPath]);
  return row!.id;
}

/** Enregistre un fichier scanné et le contenu de l'archive (remplace l'éventuelle ligne existante). */
async function insertScannedFile(db: Database, folderId: number, file: ScannedFile): Promise<void> {
  // has_comment : true si commentaire global OU au moins un fichier avec commentaire
  let hasComment = false;
  let hasGlobalComment = false;
  if (file.contents && file.contents.length > 0) {
    hasGlobalComment = file.contents[0].hasGlobalComment || false;
    hasComment = hasGlobalComment || file.contents.some(c => c.hasComment);
  }

  // OR REPLACE : l'ancienne ligne et ses dépendances (archive_contents, rom_matches)
  // sont supprimées en cascade.
  const fileResult = await db.run(
    `INSERT OR REPLACE INTO scanned_files
     (folder_id, file_path, file_name, size, crc32, md5, sha1, is_archive, archive_type,
      compression_level, has_comment, has_global_comment, file_mtime, scanned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      folderId,
      file.filePath,
      file.fileName,
      file.size,
      file.hashes.crc32,
      file.hashes.md5,
      file.hashes.sha1,
      file.isArchive ? 1 : 0,
      file.archiveType || null,
      file.contents && file.contents.length > 0 ? file.contents[0].compressionLevel || null : null,
      hasComment ? 1 : 0,
      hasGlobalComment ? 1 : 0,
      file.mtime
    ]
  );

  if (file.isArchive && file.contents && file.contents.length > 0) {
    for (const content of file.contents) {
      await db.run(
        `INSERT INTO archive_contents
         (archive_id, file_name, size, crc32, md5, sha1, compression_level, has_comment)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          fileResult.lastID,
          content.fileName,
          content.size,
          content.hashes?.crc32 || null,
          content.hashes?.md5 || null,
          content.hashes?.sha1 || null,
          content.compressionLevel || null,
          content.hasComment ? 1 : 0
        ]
      );
    }
  }
}

/** Écrit un lot de fichiers scannés dans une seule transaction. */
async function flushBatch(db: Database, batch: Array<{ folderId: number; file: ScannedFile }>): Promise<void> {
  if (batch.length === 0) return;
  await db.run('BEGIN TRANSACTION');
  try {
    for (const { folderId, file } of batch) {
      await insertScannedFile(db, folderId, file);
    }
    await db.run('COMMIT');
  } catch (error) {
    // Ne jamais laisser l'échec du ROLLBACK masquer l'erreur d'origine
    try { await db.run('ROLLBACK'); } catch { /* pas de transaction active */ }
    throw error;
  }
  batch.length = 0;
}

/** Identifiants du dossier racine et de tous ses sous-dossiers en base. */
async function getSubtreeFolders(db: Database, rootId: number): Promise<Array<{ id: number; folder_path: string }>> {
  return db.all<{ id: number; folder_path: string }>(
    `WITH RECURSIVE subfolder AS (
       SELECT id, folder_path FROM scanned_folders WHERE id = ?
       UNION ALL
       SELECT sf.id, sf.folder_path FROM scanned_folders sf
       INNER JOIN subfolder s ON sf.parent_folder_id = s.id
     )
     SELECT id, folder_path FROM subfolder`,
    [rootId]
  );
}

async function setRootStatus(db: Database, rootId: number, status: ScanStatus): Promise<void> {
  await db.run(
    'UPDATE scanned_folders SET scan_status = ?, scanned_at = CURRENT_TIMESTAMP WHERE id = ?',
    [status, rootId]
  );
}

// ============================================
// FONCTION PRINCIPALE
// ============================================

/**
 * Scanne un dossier racine et enregistre son contenu en base au fil de l'eau.
 * Seuls les fichiers complètement scannés sont enregistrés : un fichier abandonné
 * par un arrêt forcé n'a pas de ligne (ou garde son ancienne ligne, dont la date
 * de modification ne correspond plus) et sera donc repris au scan suivant.
 */
export async function scanFolderIncremental(
  db: Database,
  rootPath: string,
  options: {
    mode: ScanMode;
    signal: ScanSignal;
    onProgress?: (progress: ScanProgress) => void;
  }
): Promise<ScanResult> {
  const { mode, signal, onProgress } = options;
  const abortSignal = signal.abort.signal;
  const result: ScanResult = {
    filesTotal: 0,
    filesScanned: 0,
    filesUnchanged: 0,
    filesRemoved: 0,
    filesFailed: 0,
    cancelled: false
  };

  // 1) Parcours de l'arborescence (sans hash) pour connaître le total
  const { folders, files } = await walkFolder(rootPath, signal, (count, folder) => {
    onProgress?.({ phase: 'counting', rootPath, folder, file: '', current: count, total: 0 });
  });
  result.filesTotal = files.length;

  if (signal.cancelRequested || abortSignal.aborted) {
    // Interrompu avant tout enregistrement : la base n'a pas été touchée
    result.cancelled = true;
    return result;
  }

  // 2) Préparation des dossiers en base
  if (mode === 'full') {
    // La cascade supprime sous-dossiers, fichiers, contenus d'archives et correspondances
    await db.run('DELETE FROM scanned_folders WHERE folder_path = ?', [rootPath]);
  }

  const folderIds = new Map<string, number>();
  await db.run('BEGIN TRANSACTION');
  try {
    for (const folder of folders) {
      const isRoot = folder === rootPath;
      const parentId = isRoot ? null : folderIds.get(path.dirname(folder)) ?? null;
      folderIds.set(folder, await upsertFolder(db, folder, parentId, isRoot));
    }
    await db.run('COMMIT');
  } catch (error) {
    try { await db.run('ROLLBACK'); } catch { /* pas de transaction active */ }
    throw error;
  }
  const rootId = folderIds.get(rootPath)!;
  await setRootStatus(db, rootId, 'in_progress');

  // 3) Fichiers déjà connus (scan rapide)
  const existing = new Map<string, ExistingFile>();
  if (mode === 'quick') {
    const subtree = await getSubtreeFolders(db, rootId);
    const ids = subtree.map(f => f.id);
    // Par paquets pour rester sous la limite de paramètres SQLite
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const rows = await db.all<ExistingFile & { file_path: string }>(
        `SELECT id, file_path, size, file_mtime, scanned_at FROM scanned_files
         WHERE folder_id IN (${chunk.map(() => '?').join(',')})`,
        chunk
      );
      for (const row of rows) existing.set(row.file_path, row);
    }
  }

  // 4) Scan fichier par fichier, enregistrement par lots
  const batch: Array<{ folderId: number; file: ScannedFile }> = [];
  try {
    for (let i = 0; i < files.length; i++) {
      if (signal.cancelRequested || abortSignal.aborted) {
        result.cancelled = true;
        break;
      }

      const disk = files[i];
      const base = (): ScanProgress => ({
        phase: 'scanning', rootPath, folder: disk.folder, file: disk.fileName, current: i + 1, total: files.length,
        scannedCount: result.filesScanned, unchangedCount: result.filesUnchanged
      });

      if (mode === 'quick' && isUnchanged(disk, existing.get(disk.filePath))) {
        result.filesUnchanged++;
        onProgress?.({ ...base(), status: 'unchanged' });
        continue;
      }

      onProgress?.({ ...base(), status: 'start' });
      try {
        const scanned = await raceAbort(scanOneFile(disk, abortSignal), abortSignal);
        batch.push({ folderId: folderIds.get(disk.folder)!, file: scanned });
        result.filesScanned++;
        onProgress?.({
          ...base(),
          status: 'done',
          isArchive: scanned.isArchive,
          archiveType: scanned.archiveType,
          contentCount: scanned.contents?.length ?? 0
        });
      } catch (error) {
        if (error instanceof OperationAbortedError || abortSignal.aborted) {
          result.cancelled = true;
          onProgress?.({ ...base(), status: 'aborted' });
          break;
        }
        // Fichier illisible : non enregistré, il sera retenté au prochain scan
        result.filesFailed++;
        console.error(`❌ Scan error ${disk.filePath}:`, error);
        onProgress?.({ ...base(), status: 'error', error: error instanceof Error ? error.message : String(error) });
      }

      if (batch.length >= BATCH_SIZE) {
        await flushBatch(db, batch);
      }
    }
    await flushBatch(db, batch);

    // 5) Scan rapide terminé : retirer ce qui n'existe plus sur disque. Uniquement
    //    si le parcours est complet, sinon des fichiers non encore visités seraient
    //    supprimés à tort.
    if (mode === 'quick' && !result.cancelled) {
      const onDisk = new Set(files.map(f => f.filePath));
      const stale = [...existing.entries()].filter(([filePath]) => !onDisk.has(filePath)).map(([, row]) => row.id);
      const existingFolders = new Set(folders);
      const staleFolders = (await getSubtreeFolders(db, rootId)).filter(f => !existingFolders.has(f.folder_path));

      await db.run('BEGIN TRANSACTION');
      try {
        for (const id of stale) {
          await db.run('DELETE FROM scanned_files WHERE id = ?', [id]);
        }
        for (const folder of staleFolders) {
          await db.run('DELETE FROM scanned_folders WHERE id = ?', [folder.id]);
        }
        await db.run('COMMIT');
      } catch (error) {
        try { await db.run('ROLLBACK'); } catch { /* pas de transaction active */ }
        throw error;
      }
      result.filesRemoved = stale.length;
    }
  } finally {
    // 6) Compteurs et statut, même en cas d'erreur (les lots déjà écrits restent valides)
    try {
      const subtreeIds = (await getSubtreeFolders(db, rootId)).map(f => f.id);
      for (const id of subtreeIds) {
        await db.run(
          'UPDATE scanned_folders SET file_count = (SELECT COUNT(*) FROM scanned_files WHERE folder_id = ?) WHERE id = ?',
          [id, id]
        );
      }
      await setRootStatus(db, rootId, result.cancelled ? 'partial' : 'complete');
    } catch (error) {
      console.error('❌ Unable to update the scan status:', error);
    }
  }

  console.log(
    `✅ Scan ${mode} of ${rootPath}: ${result.filesScanned} scanned, ${result.filesUnchanged} unchanged, ` +
    `${result.filesRemoved} removed, ${result.filesFailed} failed${result.cancelled ? ' (cancelled)' : ''}`
  );
  return result;
}

// ============================================
// FONCTIONS BONUS
// ============================================

/**
 * Extraire une archive scannée
 */
export async function extractScannedArchive(
  archivePath: string,
  outputDir: string,
  files?: string[]
): Promise<void> {
  if (!archiveManager.isArchive(archivePath)) {
    throw new Error(`Not a supported archive: ${archivePath}`);
  }

  await archiveManager.extractArchive(archivePath, outputDir, files);
}

/**
 * Créer une archive à partir de fichiers scannés
 */
export async function createArchiveFromScannedFiles(
  files: string[],
  outputPath: string,
  settings?: {
    archiveFormatPriority?: ('zip' | '7z' | 'chd')[];
    compressionLevel?: 'fastest' | 'normal' | 'maximum';
    solidArchive?: boolean;
    multithreading?: boolean;
  }
): Promise<string> {
  return await archiveManager.createArchive(files, outputPath, settings);
}
