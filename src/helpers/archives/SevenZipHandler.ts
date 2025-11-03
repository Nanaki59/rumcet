// src/helpers/archives/SevenZipHandler.ts

import Seven from 'node-7z';
import sevenBin from '7zip-bin';
import path from 'path';
import fs from 'fs/promises';
import { 
  IArchiveHandler, 
  ArchiveContent, 
  ArchiveCreateOptions, 
  ArchiveExtractOptions 
} from './types.js';

const pathTo7zip = sevenBin.path7za;

/**
 * Mapping des niveaux de compression vers les valeurs 7z
 */
const compressionLevels: Record<string, string> = {
  'fastest': '1',  // -mx1
  'fast': '3',     // -mx3
  'normal': '5',   // -mx5 (par défaut)
  'maximum': '7',  // -mx7
  'ultra': '9'     // -mx9
};

/**
 * Handler pour les archives 7z utilisant node-7z + 7zip-bin
 * Support: Lecture et Écriture
 */
export class SevenZipHandler implements IArchiveHandler {
  private sevenZipPath: string;
  
  constructor() {
    // Chemin par défaut depuis 7zip-bin
    this.sevenZipPath = pathTo7zip;
  }
  
  /**
   * Configure le chemin vers 7zip
   */
  setPath(newPath: string): void {
    this.sevenZipPath = newPath;
  }
  
  canRead(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.7z');
  }
  
  /**
   * Liste le contenu d'une archive 7z
   */
  async list(filePath: string): Promise<ArchiveContent[]> {
    const contents: ArchiveContent[] = [];
    
    return new Promise((resolve, reject) => {
      const myStream = Seven.list(filePath, {
        $bin: this.sevenZipPath,
        recursive: false,
        techInfo: true  // Important : pour obtenir le CRC
      });
      
      myStream.on('data', (data: any) => {
        // Ignorer les dossiers
        if (data.file && !data.file.endsWith('/')) {
          // Récupérer la taille
          let size = 0;
          if (data.techInfo && data.techInfo.has('Size')) {
            const sizeStr = data.techInfo.get('Size');
            size = parseInt(sizeStr) || 0;
          }
          
          // Récupérer le CRC32
          let crc32 = undefined;
          if (data.techInfo && data.techInfo.has('CRC')) {
            const crc = data.techInfo.get('CRC');
            if (crc !== undefined && crc !== null && crc !== '-') {
              crc32 = crc.toString().toUpperCase().padStart(8, '0');
            }
          }
          
          contents.push({
            fileName: data.file,
            size: size,
            hashes: crc32 ? {
              crc32: crc32,
              md5: '',
              sha1: ''
            } : undefined
          });
        }
      });
      
      myStream.on('end', () => {
        resolve(contents);
      });
      
      myStream.on('error', (err: any) => {
        console.error('Error listing 7z archive:', err);
        reject(err);
      });
    });
  }
  
  /**
   * Extrait une archive 7z
   */
  async extract(options: ArchiveExtractOptions): Promise<void> {
    // Créer le dossier de destination s'il n'existe pas
    await fs.mkdir(options.outputDir, { recursive: true });
    
    return new Promise((resolve, reject) => {
      const extractOptions: any = {
        $bin: this.sevenZipPath,
        output: options.outputDir,
        yes: true  // Overwrite without prompt
      };
      
      // Si fichiers spécifiques à extraire
      if (options.files && options.files.length > 0) {
        extractOptions.$cherryPick = options.files;
      }
      
      const myStream = Seven.extract(options.archivePath, options.outputDir, extractOptions);
      
      myStream.on('end', () => {
        resolve();
      });
      
      myStream.on('error', (err: any) => {
        console.error('Error extracting 7z archive:', err);
        reject(err);
      });
    });
  }
  
  canWrite(): boolean {
    return true;
  }
  
  /**
   * Crée une archive 7z
   */
  async create(options: ArchiveCreateOptions): Promise<void> {
    // Créer le dossier parent si nécessaire
    const outputDir = path.dirname(options.outputPath);
    await fs.mkdir(outputDir, { recursive: true });
    
    // Déterminer le niveau de compression
    const compressionLevel = options.compressionLevel?.toString() || '5';
    const mx = compressionLevels[compressionLevel] || compressionLevel;
    
    return new Promise((resolve, reject) => {
      const addOptions: any = {
        $bin: this.sevenZipPath,
        method: ['0=LZMA2'],           // Méthode de compression
        mx: mx,                         // Niveau de compression
        ms: options.solidArchive ? 'on' : 'off',  // Archive solide
        mmt: options.multithreading ? 'on' : 'off' // Multithreading
      };
      
      const myStream = Seven.add(options.outputPath, options.files, addOptions);
      
      myStream.on('end', () => {
        console.log(`✅ Archive 7z créée: ${options.outputPath}`);
        resolve();
      });
      
      myStream.on('error', (err: any) => {
        console.error('Error creating 7z archive:', err);
        reject(err);
      });
      
      myStream.on('progress', (progress: any) => {
        // Optionnel: émettre des événements de progression
        if (progress.percent) {
          console.log(`Progression 7z: ${progress.percent}%`);
        }
      });
    });
  }
  
  getSupportedExtensions(): string[] {
    return ['.7z'];
  }
}
