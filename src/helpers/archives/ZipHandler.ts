// src/helpers/archives/ZipHandler.ts

import AdmZip from 'adm-zip';
import Seven from 'node-7z';
import { getBundled7zaPath } from '../toolPaths.js';
import { trackProcess } from './processRegistry.js';
import path from 'path';
import fs from 'fs/promises';
import {
  IArchiveHandler,
  ArchiveContent,
  ArchiveCreateOptions,
  ArchiveExtractOptions,
  ArchiveAddOptions,
  ArchiveDeleteOptions
} from './types.js';

// 7za de 7zip-bin, hors de app.asar dans la version packagée
const pathTo7zip = getBundled7zaPath();

/**
 * Handler pour les archives ZIP utilisant AdmZip (pure Node.js)
 * Support: Lecture et Écriture
 * 
 * Nouvelles fonctionnalités:
 * - Détection du niveau de compression
 * - Détection des commentaires d'archive
 * - Effacement des commentaires
 * - Ajout de fichiers à une archive existante
 * - Suppression de fichiers d'une archive existante
 */
export class ZipHandler implements IArchiveHandler {
  
  canRead(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.zip');
  }
  
  /**
   * Liste le contenu d'une archive ZIP
   * Détecte automatiquement le niveau de compression et la présence de commentaires
   */
  async list(filePath: string): Promise<ArchiveContent[]> {
    try {
      const zip = new AdmZip(filePath);
      const contents: ArchiveContent[] = [];
      
      // Détecter la présence de commentaire global (au niveau de l'archive)
      const globalComment = zip.getZipComment();
      const hasGlobalComment = !!(globalComment && globalComment.trim().length > 0);
      //const hasComment = !!zip.getZipComment();
          
      // DEBUG: Log for each file
      /*console.log(`[ZipHandler DEBUG] File: ${filePath}`, {
        'entry.comment exists': !!globalComment,
        'entry.comment value': globalComment,
        'entry.comment type': typeof globalComment,
        'entry.comment length': globalComment ? globalComment.length : 0,
        hasGlobalComment
      });*/
      
      // Détection du niveau de compression en analysant les entrées
      let detectedCompressionLevel: number | undefined;
      
      for (const entry of zip.getEntries()) {
        // Ignorer les dossiers
        if (!entry.isDirectory) {
          const crc32 = entry.header.crc.toString(16).padStart(8, '0').toUpperCase();
          
          // Détecter le niveau de compression de cette entrée
          // method: 0 = Stored (pas de compression), 8 = Deflated (compression)
          if (entry.header.method === 8 && detectedCompressionLevel === undefined) {
            // Pour ZIP, on ne peut pas détecter le niveau exact de compression,
            // mais on peut estimer en fonction du ratio de compression
            const ratio = entry.header.size > 0 ? entry.header.compressedSize / entry.header.size : 1;
            
            // Estimation approximative du niveau:
            // ratio > 0.9 = niveau 1-3 (faible compression)
            // ratio 0.7-0.9 = niveau 4-6 (compression normale)
            // ratio < 0.7 = niveau 7-9 (haute compression)
            if (ratio > 0.9) {
              detectedCompressionLevel = 3;
            } else if (ratio > 0.7) {
              detectedCompressionLevel = 6;
            } else {
              detectedCompressionLevel = 9;
            }
          } else if (entry.header.method === 0) {
            detectedCompressionLevel = 0; // Stored, pas de compression
          }
          
          // Détecter si CE FICHIER SPÉCIFIQUE a un commentaire attaché
          const fileComment = entry.comment;
          const hasFileComment = !!(fileComment && fileComment.trim().length > 0);
          
          // DEBUG: Log for each file
          /*console.log(`[ZipHandler DEBUG] File: ${entry.entryName}`, {
            'entry.comment exists': !!fileComment,
            'entry.comment value': fileComment,
            'entry.comment type': typeof fileComment,
            'entry.comment length': fileComment ? fileComment.length : 0,
            hasFileComment,
            'all entry keys': Object.keys(entry),
            'all header keys': Object.keys(entry.header)
          });*/

          contents.push({
            fileName: entry.entryName,
            size: entry.header.size,
            hashes: crc32 ? {
              crc32: crc32,
              md5: '',
              sha1: ''
            } : undefined,
            compressionLevel: detectedCompressionLevel,
            hasComment: hasFileComment,              // Commentaire du fichier individuel
            hasGlobalComment: hasGlobalComment       // Commentaire global de l'archive
          });
        }
      }
      
      return contents;
    } catch (error) {
      console.error(`Error reading ZIP file ${filePath}:`, error);
      throw error;
    }
  }
  
  /**
   * Extrait une archive ZIP
   */
  async extract(options: ArchiveExtractOptions): Promise<void> {
    try {
      const zip = new AdmZip(options.archivePath);
      
      // Créer le dossier de destination s'il n'existe pas
      await fs.mkdir(options.outputDir, { recursive: true });
      
      if (options.files && options.files.length > 0) {
        // Extraire des fichiers spécifiques
        for (const fileName of options.files) {
          const entry = zip.getEntry(fileName);
          if (entry) {
            zip.extractEntryTo(entry, options.outputDir, true, true);
          }
        }
      } else {
        // Extraire tout
        zip.extractAllTo(options.outputDir, true);
      }
    } catch (error) {
      console.error(`Error extracting ZIP file ${options.archivePath}:`, error);
      throw error;
    }
  }
  
  canWrite(): boolean {
    return true;
  }
  
  /**
   * Crée une archive ZIP via 7-Zip pour contrôler le niveau de compression
   */
  async create(options: ArchiveCreateOptions): Promise<void> {
    // Créer le dossier parent si nécessaire
    const outputDir = path.dirname(options.outputPath);
    await fs.mkdir(outputDir, { recursive: true });

    // Niveau de compression : 1 (fastest) à 9 (maximum), défaut 5
    const mx = options.compressionLevel?.toString() || '5';

    console.log(`[ZIP] compression mx=${mx}, mt=${options.multithreading}${options.workingDirectory ? ', cwd=' + options.workingDirectory : ''}`);

    return new Promise((resolve, reject) => {
      const addOptions: any = {
        $bin: pathTo7zip,
        method: ['0=Deflate'],
        $raw: [
          `-mx=${mx}`,
          `-mmt=${options.multithreading ? 'on' : 'off'}`
        ]
      };

      // Phase 6 : node-7z 3.0.0 ignore silencieusement l'option $cwd — la variable
      // _spawnOptions est utilisée dans lifecycle.js mais jamais peuplée par le
      // factory. Contournement : changer process.cwd() juste avant Seven.add (qui
      // appelle spawn() synchroniquement) et restaurer immédiatement après. Le
      // processus 7z hérite du cwd à sa création, indépendant des changements
      // ultérieurs. Nécessaire pour préserver la structure des sous-dossiers
      // {cloneName}/ dans les archives merged.
      const originalCwd = process.cwd();
      let myStream: any;
      try {
        if (options.workingDirectory) process.chdir(options.workingDirectory);
        myStream = Seven.add(options.outputPath, options.files, addOptions);
      } finally {
        if (options.workingDirectory) process.chdir(originalCwd);
      }
      // Suivi du processus 7z (lancé de façon synchrone) pour l'arrêt forcé
      trackProcess(myStream?._childProcess);

      myStream.on('end', () => {
        console.log(`[ZIP] ✓ archive created: ${options.outputPath}`);
        resolve();
      });

      myStream.on('error', (err: any) => {
        console.error(`Error creating ZIP file ${options.outputPath}:`, err);
        reject(err);
      });
    });
  }
  
  canHandleComments(): boolean {
    return true;
  }
  
  /**
   * Efface les commentaires d'une archive ZIP
   * AdmZip ne fournit pas de méthode pour supprimer les commentaires,
   * donc on recrée l'archive sans commentaires
   */
  async clearComments(archivePath: string): Promise<void> {
    try {
      // Lire l'archive existante
      const zip = new AdmZip(archivePath);
      
      // Créer une nouvelle archive sans commentaires
      const newZip = new AdmZip();
      
      // Copier tous les fichiers sans leurs commentaires
      for (const entry of zip.getEntries()) {
        if (!entry.isDirectory) {
          // Ajouter le contenu du fichier
          newZip.addFile(entry.entryName, entry.getData(), '', entry.header.attr);
        } else {
          // Ajouter le dossier
          newZip.addFile(entry.entryName, Buffer.alloc(0), '', entry.header.attr);
        }
      }
      
      // Sauvegarder (écrase l'archive originale)
      newZip.writeZip(archivePath);
      
      console.log(`✅ Comments cleared from: ${archivePath}`);
    } catch (error) {
      console.error(`Error clearing comments from ZIP file ${archivePath}:`, error);
      throw error;
    }
  }
  
  /**
   * Ajoute des fichiers à une archive ZIP existante
   */
  async addFiles(options: ArchiveAddOptions): Promise<void> {
    try {
      const zip = new AdmZip(options.archivePath);
      
      for (const filePath of options.files) {
        const stats = await fs.stat(filePath);
        
        if (stats.isFile()) {
          const baseName = path.basename(filePath);
          zip.addLocalFile(filePath, '', baseName);
        } else if (stats.isDirectory()) {
          zip.addLocalFolder(filePath, path.basename(filePath));
        }
      }
      
      // Sauvegarder les modifications
      zip.writeZip(options.archivePath);
      
      console.log(`✅ Files added to: ${options.archivePath}`);
    } catch (error) {
      console.error(`Error adding files to ZIP file ${options.archivePath}:`, error);
      throw error;
    }
  }
  
  /**
   * Supprime des fichiers d'une archive ZIP existante
   */
  async deleteFiles(options: ArchiveDeleteOptions): Promise<void> {
    try {
      const zip = new AdmZip(options.archivePath);
      
      for (const fileName of options.files) {
        zip.deleteFile(fileName);
      }
      
      // Sauvegarder les modifications
      zip.writeZip(options.archivePath);
      
      console.log(`✅ Files removed from: ${options.archivePath}`);
    } catch (error) {
      console.error(`Error deleting files from ZIP file ${options.archivePath}:`, error);
      throw error;
    }
  }
  
  getSupportedExtensions(): string[] {
    return ['.zip'];
  }
}
