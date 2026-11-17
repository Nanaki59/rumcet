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
 */

// src/helpers/recordConsolidation.ts
//
// Insère directement les sorties de consolidation dans la base de données
// (scanned_folders, scanned_files, archive_contents, rom_matches), sans passer
// par un rescan complet du dossier cible. Les hashs des contenus sont déjà
// connus de la phase de matching, on évite donc de les recalculer.

import path from 'path';
import { Database } from '../database/init.js';
import { calculateFileHashes } from './hashCalculator.js';

export interface ConsolidatedRomEntry {
  /** ID du dat_rom auquel ce fichier correspond. */
  datRomId: number;
  /** Nom du fichier tel qu'il apparaît dans l'archive (ou nom du fichier brut). */
  fileName: string;
  size: number;
  crc32: string | null;
  md5: string | null;
  sha1: string | null;
  compressionLevel?: number;
}

/**
 * Récupère ou crée l'entrée scanned_folders correspondant à folderPath.
 *
 * Si le dossier n'existe pas, on remonte la hiérarchie de chemins pour trouver
 * un parent existant en base : si trouvé, on insère avec ce parent (is_root=0) ;
 * sinon, on insère comme racine (is_root=1).
 *
 * `forceIsRoot` permet de forcer is_root=1 même si un parent en base existe.
 */
async function ensureScannedFolder(
  db: Database,
  folderPath: string,
  options: { forceIsRoot?: boolean } = {}
): Promise<number> {
  const existing = await db.get<{ id: number }>(
    'SELECT id FROM scanned_folders WHERE folder_path = ?',
    [folderPath]
  );
  if (existing) return existing.id;

  let parentId: number | null = null;
  if (!options.forceIsRoot) {
    // Remonter la hiérarchie pour trouver un parent existant en base
    let candidate = path.dirname(folderPath);
    while (candidate && candidate !== path.dirname(candidate)) {
      const row = await db.get<{ id: number }>(
        'SELECT id FROM scanned_folders WHERE folder_path = ?',
        [candidate]
      );
      if (row) {
        parentId = row.id;
        break;
      }
      candidate = path.dirname(candidate);
    }
  }

  const isRoot = options.forceIsRoot || parentId === null;
  const result = await db.run(
    `INSERT INTO scanned_folders (folder_path, parent_folder_id, is_root, file_count)
     VALUES (?, ?, ?, 0)`,
    [folderPath, parentId, isRoot ? 1 : 0]
  );
  return result.lastID!;
}

/**
 * Insère ou met à jour une archive consolidée + ses contenus + ses rom_matches.
 *
 * @param db                  Base de données
 * @param archivePath         Chemin du fichier archive produit (ex: validated/Game.zip)
 * @param parentFolderPath    Chemin du dossier parent (ex: validatedRomsFolder)
 * @param archiveType         'zip' | '7z' | 'chd'
 * @param entries             Liste des fichiers contenus, chacun lié à un dat_rom_id
 */
export async function recordConsolidatedArchive(
  db: Database,
  archivePath: string,
  parentFolderPath: string,
  archiveType: string,
  entries: ConsolidatedRomEntry[]
): Promise<void> {
  // 1) S'assurer que le dossier parent existe en tant que scanned_folders.
  //    ensureScannedFolder remonte la hiérarchie pour trouver un parent ; si
  //    parentFolderPath n'existe pas et qu'aucun ancêtre n'est en base, il
  //    sera inséré comme racine.
  const folderId = await ensureScannedFolder(db, parentFolderPath);

  // 2) Calculer le hash de l'archive elle-même (un seul fichier à hasher, pas tous les contenus)
  const archiveHashes = await calculateFileHashes(archivePath);
  const fs = await import('fs/promises');
  const stat = await fs.stat(archivePath);
  const archiveName = path.basename(archivePath);

  // 3) Insérer / remplacer dans scanned_files
  // OR REPLACE : si une archive avec ce file_path existait déjà (re-consolidation),
  // l'ancienne ligne et ses dépendances cascade (archive_contents, rom_matches) sont supprimées.
  const archiveResult = await db.run(
    `INSERT OR REPLACE INTO scanned_files
       (folder_id, file_path, file_name, size, crc32, md5, sha1,
        is_archive, archive_type, compression_level, has_comment, has_global_comment, file_mtime)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0, 0, ?)`,
    [
      folderId,
      archivePath,
      archiveName,
      stat.size,
      archiveHashes.crc32,
      archiveHashes.md5,
      archiveHashes.sha1,
      archiveType,
      entries[0]?.compressionLevel ?? null,
      Math.trunc(stat.mtimeMs)
    ]
  );
  const archiveFileId = archiveResult.lastID!;

  // 4) Insérer les contenus de l'archive
  for (const entry of entries) {
    const contentResult = await db.run(
      `INSERT INTO archive_contents
         (archive_id, file_name, size, crc32, md5, sha1, compression_level, has_comment)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        archiveFileId,
        entry.fileName,
        entry.size,
        entry.crc32,
        entry.md5,
        entry.sha1,
        entry.compressionLevel ?? null
      ]
    );
    const archiveContentId = contentResult.lastID!;

    // 5) Insérer les rom_matches (1 par dat_rom)
    await db.run(
      `INSERT INTO rom_matches
         (dat_rom_id, scanned_file_id, archive_content_id, archive_is_perfect)
       VALUES (?, ?, ?, 1)`,
      [entry.datRomId, archiveFileId, archiveContentId]
    );
  }

  // 6) Mettre à jour le compteur du dossier parent
  await db.run(
    `UPDATE scanned_folders SET file_count = (
       SELECT COUNT(*) FROM scanned_files WHERE folder_id = ?
     ) WHERE id = ?`,
    [folderId, folderId]
  );
}

/**
 * Insère ou met à jour des fichiers bruts consolidés (mode "sans compression").
 * Les fichiers sont placés dans un sous-dossier (gameName) sous parentFolderPath.
 *
 * @param db                  Base de données
 * @param gameSubfolderPath   Chemin du sous-dossier (ex: validated/Game/)
 * @param parentFolderPath    Chemin du dossier parent (ex: validatedRomsFolder)
 * @param entries             Liste des fichiers, chacun lié à un dat_rom_id, avec le chemin local
 */
export async function recordConsolidatedRawFiles(
  db: Database,
  gameSubfolderPath: string,
  parentFolderPath: string,
  entries: Array<ConsolidatedRomEntry & { filePath: string }>
): Promise<void> {
  // 1) S'assurer que le dossier parent (validatedFolder) est dans scanned_folders.
  //    Si l'utilisateur n'a pas encore ajouté ce dossier comme racine, on le force ici.
  await ensureScannedFolder(db, parentFolderPath);

  // 2) S'assurer que le sous-dossier du jeu est dans scanned_folders.
  //    ensureScannedFolder remontera la hiérarchie et trouvera parentFolderPath comme parent.
  const subFolderId = await ensureScannedFolder(db, gameSubfolderPath);

  // 3) Insérer chaque fichier brut + son rom_match
  const fs = await import('fs/promises');
  for (const entry of entries) {
    // Date de modification : permet au scan rapide de reconnaître ce fichier comme inchangé
    const mtime = await fs.stat(entry.filePath).then(st => Math.trunc(st.mtimeMs)).catch(() => null);
    const result = await db.run(
      `INSERT OR REPLACE INTO scanned_files
         (folder_id, file_path, file_name, size, crc32, md5, sha1,
          is_archive, archive_type, compression_level, has_comment, has_global_comment, file_mtime)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, 0, 0, ?)`,
      [
        subFolderId,
        entry.filePath,
        entry.fileName,
        entry.size,
        entry.crc32,
        entry.md5,
        entry.sha1,
        mtime
      ]
    );
    const fileId = result.lastID!;

    await db.run(
      `INSERT INTO rom_matches
         (dat_rom_id, scanned_file_id, archive_content_id, archive_is_perfect)
       VALUES (?, ?, NULL, 0)`,
      [entry.datRomId, fileId]
    );
  }

  // 4) Mettre à jour le compteur du sous-dossier
  await db.run(
    `UPDATE scanned_folders SET file_count = (
       SELECT COUNT(*) FROM scanned_files WHERE folder_id = ?
     ) WHERE id = ?`,
    [subFolderId, subFolderId]
  );
}

/**
 * Nettoie les entrées scanned_files dont le fichier physique n'existe plus.
 * À appeler après un nettoyage des sources pour synchroniser la base.
 * Le cascade DELETE retire automatiquement les rom_matches et archive_contents associés.
 */
export async function cleanupStaleScannedFiles(db: Database): Promise<number> {
  const fs = await import('fs/promises');
  const allFiles = await db.all<{ id: number; file_path: string }>(
    'SELECT id, file_path FROM scanned_files'
  );

  const staleIds: number[] = [];
  for (const f of allFiles) {
    try {
      await fs.access(f.file_path);
    } catch {
      staleIds.push(f.id);
    }
  }

  if (staleIds.length === 0) return 0;

  // Supprimer par lots
  const chunkSize = 500;
  for (let i = 0; i < staleIds.length; i += chunkSize) {
    const chunk = staleIds.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    await db.run(`DELETE FROM scanned_files WHERE id IN (${placeholders})`, chunk);
  }

  return staleIds.length;
}
