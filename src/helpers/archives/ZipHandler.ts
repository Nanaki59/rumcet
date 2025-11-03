// src/helpers/archives/ZipHandler.ts

import AdmZip from 'adm-zip';
import path from 'path';
import fs from 'fs/promises';
import { 
  IArchiveHandler, 
  ArchiveContent, 
  ArchiveCreateOptions, 
  ArchiveExtractOptions 
} from './types.js';

/**
 * Handler pour les archives ZIP utilisant AdmZip (pure Node.js)
 * Support: Lecture et Écriture
 */
export class ZipHandler implements IArchiveHandler {
  
  canRead(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.zip');
  }
  
  /**
   * Liste le contenu d'une archive ZIP
   */
  async list(filePath: string): Promise<ArchiveContent[]> {
    try {
      const zip = new AdmZip(filePath);
      const contents: ArchiveContent[] = [];
      
      for (const entry of zip.getEntries()) {
        // Ignorer les dossiers
        if (!entry.isDirectory) {
          const crc32 = entry.header.crc.toString(16).padStart(8, '0').toUpperCase();
          
          contents.push({
            fileName: entry.entryName,
            size: entry.header.size,
            hashes: crc32 ? {
              crc32: crc32,
              md5: '',
              sha1: ''
            } : undefined
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
   * Crée une archive ZIP
   * Note: AdmZip utilise un niveau de compression fixe (DEFLATE niveau 6)
   * Pour un contrôle plus fin, il faudrait utiliser 'yazl' ou 'archiver'
   */
  async create(options: ArchiveCreateOptions): Promise<void> {
    try {
      const zip = new AdmZip();
      
      for (const filePath of options.files) {
        const stats = await fs.stat(filePath);
        
        if (stats.isFile()) {
          // Ajouter le fichier avec son chemin relatif
          const baseName = path.basename(filePath);
          zip.addLocalFile(filePath, '', baseName);
        } else if (stats.isDirectory()) {
          // Ajouter un dossier récursivement
          zip.addLocalFolder(filePath, path.basename(filePath));
        }
      }
      
      // Créer le dossier parent si nécessaire
      const outputDir = path.dirname(options.outputPath);
      await fs.mkdir(outputDir, { recursive: true });
      
      // Écrire l'archive
      zip.writeZip(options.outputPath);
      
      console.log(`✅ Archive ZIP créée: ${options.outputPath}`);
    } catch (error) {
      console.error(`Error creating ZIP file ${options.outputPath}:`, error);
      throw error;
    }
  }
  
  getSupportedExtensions(): string[] {
    return ['.zip'];
  }
}
