// src/helpers/scanFolder.ts
// VERSION NETTOYÉE : 
// - Suppression de formatFileSize() (inutile, utilisée seulement dans logs debug)
// - Suppression de scanFolder() (fonction plate, non utilisée)
// - Suppression de saveScanResults() (fonction plate, non utilisée)
// - Utilisation de archiveManager pour tous les formats

import fs from 'fs/promises';
import path from 'path';
import { Database } from '../database/init.js';
import { calculateFileHashes } from './hashCalculator.js';
import { archiveManager } from './archives/ArchiveManager.js';

// ============================================
// INTERFACES
// ============================================

export interface FileHash {
  crc32: string;
  md5: string;
  sha1: string;
}

export interface ScannedFile {
  filePath: string;
  fileName: string;
  size: number;
  hashes: FileHash;
  isArchive: boolean;
  archiveType?: string;
  contents?: ArchiveContent[];
  relativePath?: string;
}

export interface ArchiveContent {
  fileName: string;
  size: number;
  hashes?: FileHash;
  compressionLevel?: number;    // Niveau de compression numérique de l'archive
  hasComment?: boolean;         // Ce fichier a-t-il un commentaire individuel ?
  hasGlobalComment?: boolean;   // L'archive a-t-elle un commentaire global ? (même valeur pour tous les fichiers)
}

export interface FolderStructure {
  path: string;
  isRoot: boolean;
  parentPath?: string;
  files: ScannedFile[];
  subFolders: FolderStructure[];
}

// ============================================
// FONCTIONS PRINCIPALES
// ============================================

/**
 * Scanner récursivement un dossier avec structure hiérarchique
 * Utilise archiveManager pour détecter et lister toutes les archives
 */
async function scanDirectoryRecursive(
  dir: string, 
  rootDir: string,
  structure: FolderStructure
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Créer une sous-structure pour ce dossier
      const subFolder: FolderStructure = {
        path: fullPath,
        isRoot: false,
        parentPath: dir,
        files: [],
        subFolders: []
      };
      
      structure.subFolders.push(subFolder);
      await scanDirectoryRecursive(fullPath, rootDir, subFolder);
      
    } else if (entry.isFile()) {
      const buffer = await fs.readFile(fullPath);
      const hashes = await calculateFileHashes(fullPath);
      
      const scannedFile: ScannedFile = {
        filePath: fullPath,
        fileName: entry.name,
        size: buffer.length,
        hashes,
        isArchive: false,
        relativePath: path.relative(rootDir, fullPath)
      };

      // ✨ Utilisation de archiveManager pour gérer TOUS les formats
      if (archiveManager.isArchive(fullPath)) {
        scannedFile.isArchive = true;
        
        console.log(`📦 Scanning archive: ${entry.name}`);

        // Déterminer le type d'archive
        const ext = path.extname(fullPath).toLowerCase();
        scannedFile.archiveType = ext.substring(1); // Enlever le point
        
        try {
          // Lister le contenu via archiveManager
          // Les données compressionLevel, hasComment et hasGlobalComment sont déjà incluses
          const archiveContents = await archiveManager.listArchive(fullPath);
          
          // Récupérer TOUTES les infos retournées par list()
          scannedFile.contents = archiveContents.map(content => ({
            fileName: content.fileName,
            size: content.size,
            hashes: content.hashes,
            compressionLevel: content.compressionLevel,
            hasComment: content.hasComment,
            hasGlobalComment: content.hasGlobalComment
          }));
          
          console.log(`✅ Archive: ${entry.name} (${scannedFile.archiveType}) - ${scannedFile.contents.length} fichiers`);
        } catch (error) {
          console.error(`❌ Erreur scan archive ${fullPath}:`, error);
          scannedFile.contents = [];
        }
      }

      structure.files.push(scannedFile);
    }
  }
}

/**
 * Fonction principale de scan avec structure
 * C'EST LA SEULE FONCTION UTILISÉE DANS LE PROJET
 */
export async function scanFolderWithStructure(folderPath: string): Promise<FolderStructure> {
  const structure: FolderStructure = {
    path: folderPath,
    isRoot: true,
    files: [],
    subFolders: []
  };
  
  await scanDirectoryRecursive(folderPath, folderPath, structure);
  return structure;
}

/**
 * Sauvegarder les résultats du scan avec hiérarchie dans la base de données
 * C'EST LA SEULE FONCTION DE SAUVEGARDE UTILISÉE DANS LE PROJET
 */
export async function saveScanResultsWithStructure(
  db: Database, 
  structure: FolderStructure
): Promise<number> {
  await db.run('BEGIN TRANSACTION');

  try {
    let totalFiles = 0;

    // Fonction récursive pour sauvegarder la structure
    async function saveStructure(
      struct: FolderStructure, 
      parentFolderId: number | null = null
    ): Promise<number> {
      // Insérer le dossier
      const folderResult = await db.run(
        `INSERT OR REPLACE INTO scanned_folders 
         (folder_path, parent_folder_id, is_root, file_count)
         VALUES (?, ?, ?, ?)`,
        [struct.path, parentFolderId, struct.isRoot ? 1 : 0, struct.files.length]
      );
      
      const folderId = folderResult.lastID;

      // Insérer les fichiers de ce dossier
      const insertFile = db.prepare(`
        INSERT OR REPLACE INTO scanned_files 
        (folder_id, file_path, file_name, size, crc32, md5, sha1, is_archive, archive_type, compression_level, has_comment, has_global_comment)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertArchiveContent = db.prepare(`
        INSERT INTO archive_contents
        (archive_id, file_name, size, crc32, md5, sha1, compression_level, has_comment)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const file of struct.files) {
        // Calculer has_comment et has_global_comment pour scanned_files
        let hasComment = false;
        let hasGlobalComment = false;
        
        if (file.contents && file.contents.length > 0) {
          // has_comment : true si commentaire global OU au moins un fichier avec commentaire
          hasGlobalComment = file.contents[0].hasGlobalComment || false;
          const hasFileComment = file.contents.some(c => c.hasComment);
          hasComment = hasGlobalComment || hasFileComment;
        }
        
        const fileResult = await new Promise<{ lastID: number }>((resolve, reject) => {
          insertFile.run(
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
            hasComment ? 1 : 0,              // has_comment: global OU au moins un fichier
            hasGlobalComment ? 1 : 0,        // has_global_comment: commentaire global
            function(this: any, err: Error | null) {
              err ? reject(err) : resolve({ lastID: this.lastID })
            }
          );
        });

        // Si c'est une archive, sauvegarder son contenu
        if (file.isArchive && file.contents && file.contents.length > 0) {
          await Promise.all(
            file.contents.map(content =>
              new Promise<void>((resolve, reject) => {
                insertArchiveContent.run(
                  fileResult.lastID,
                  content.fileName,
                  content.size,
                  content.hashes?.crc32 || null,
                  content.hashes?.md5 || null,
                  content.hashes?.sha1 || null,
                  content.compressionLevel || null,
                  content.hasComment ? 1 : 0,    // hasComment du fichier individuel
                  function(this: any, err: Error | null) {
                    err ? reject(err) : resolve()
                  }
                );
              })
            )
          );
        }
        
        totalFiles++;
      }

      insertFile.finalize();
      insertArchiveContent.finalize();

      // Sauvegarder les sous-dossiers récursivement
      for (const subFolder of struct.subFolders) {
        totalFiles += await saveStructure(subFolder, folderId);
      }

      return totalFiles;
    }

    const total = await saveStructure(structure);

    await db.run('COMMIT');
    console.log(`✅ ${total} fichiers sauvegardés en base`);
    
    return total;

  } catch (error) {
    await db.run('ROLLBACK');
    throw error;
  }
}

// ============================================
// FONCTIONS BONUS (nouvelles fonctionnalités)
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
