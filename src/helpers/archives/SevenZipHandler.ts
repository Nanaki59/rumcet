// src/helpers/archives/SevenZipHandler.ts

import Seven from 'node-7z';
import { getBundled7zaPath } from '../toolPaths.js';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { trackProcess, trackedExecFileAsync } from './processRegistry.js';
import { 
  IArchiveHandler, 
  ArchiveContent, 
  ArchiveCreateOptions, 
  ArchiveExtractOptions,
  ArchiveAddOptions,
  ArchiveDeleteOptions
} from './types.js';

const execAsync = promisify(exec);
// 7za de 7zip-bin, hors de app.asar dans la version packagée
const pathTo7zip = getBundled7zaPath();

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
 * 
 * Nouvelles fonctionnalités:
 * - Détection du niveau de compression
 * - Détection des commentaires d'archive
 * - Effacement des commentaires (note: 7z ne supporte pas vraiment les commentaires)
 * - Ajout de fichiers à une archive existante
 * - Suppression de fichiers d'une archive existante
 */
export class SevenZipHandler implements IArchiveHandler {
  private sevenZipPath: string;
  
  constructor() {
    // Chemin par défaut depuis 7zip-bin
    this.sevenZipPath = pathTo7zip;
  }
  
  /**
   * Configure le chemin vers 7zip (chemin vide : retour au 7za embarqué)
   */
  setPath(newPath: string): void {
    this.sevenZipPath = newPath || pathTo7zip;
  }
  
  canRead(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.7z');
  }
  
  /**
   * Liste le contenu d'une archive 7z
   * Détecte automatiquement le niveau de compression
   */
  async list(filePath: string): Promise<ArchiveContent[]> {
    const contents: ArchiveContent[] = [];
    let detectedCompressionLevel: number | undefined;
    
    return new Promise((resolve, reject) => {
      const myStream = Seven.list(filePath, {
        $bin: this.sevenZipPath,
        recursive: false,
        techInfo: true  // Important : pour obtenir le CRC et les infos techniques
      });
      // node-7z lance 7z de façon synchrone : le processus est déjà disponible
      trackProcess((myStream as any)._childProcess);
      
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
          
          // Détecter le niveau de compression depuis les informations techniques
          // Le format 7z stocke la méthode de compression, mais pas le niveau exact
          // On peut estimer le niveau en fonction du ratio de compression
          if (detectedCompressionLevel === undefined && data.techInfo) {
            if (data.techInfo.has('Packed Size')) {
              const packedSizeStr = data.techInfo.get('Packed Size');
              const packedSize = parseInt(packedSizeStr) || 0;
              
              if (size > 0 && packedSize > 0) {
                const ratio = packedSize / size;
                
                // Estimation approximative du niveau:
                // ratio > 0.9 = niveau 1-3 (faible compression)
                // ratio 0.7-0.9 = niveau 4-6 (compression normale)
                // ratio < 0.7 = niveau 7-9 (haute compression)
                if (ratio > 0.9) {
                  detectedCompressionLevel = 3;
                } else if (ratio > 0.7) {
                  detectedCompressionLevel = 5;
                } else {
                  detectedCompressionLevel = 9;
                }
              }
            }
          }
          
          contents.push({
            fileName: data.file,
            size: size,
            hashes: crc32 ? {
              crc32: crc32,
              md5: '',
              sha1: ''
            } : undefined,
            compressionLevel: detectedCompressionLevel,
            hasComment: false // 7z ne supporte pas vraiment les commentaires
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
      trackProcess((myStream as any)._childProcess);
      
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
      // Arguments bruts passés via $raw (node-7z ignore les options non reconnues comme mx, ms, mmt)
      const rawArgs = [
        `-mx=${mx}`,
        `-ms=${options.solidArchive ? 'on' : 'off'}`,
        `-mmt=${options.multithreading ? 'on' : 'off'}`
      ];

      // Pour les niveaux élevés : dictionnaire 128 Mo et word size 273
      if (parseInt(mx) >= 7) {
        rawArgs.push('-md=128m', '-mfb=273');
      }

      console.log(`[7z] compression mx=${mx}, solid=${options.solidArchive}, mt=${options.multithreading}${options.workingDirectory ? ', cwd=' + options.workingDirectory : ''}`);

      const addOptions: any = {
        $bin: this.sevenZipPath,
        method: ['0=LZMA2'],
        $raw: rawArgs
      };

      // Phase 6 : node-7z 3.0.0 ignore $cwd (bug de la lib : lifecycle.js utilise
      // _spawnOptions qui n'est jamais peuplé). Contournement via process.chdir()
      // temporaire autour de Seven.add — spawn() est synchrone donc le processus
      // 7z hérite du cwd immédiatement.
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
        console.log(`[7z] ✓ archive created: ${options.outputPath}`);
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
  
  canHandleComments(): boolean {
    return false; // 7z ne supporte pas vraiment les commentaires d'archive
  }
  
  /**
   * Efface les commentaires d'une archive 7z
   * Note: 7z ne supporte pas vraiment les commentaires, donc cette méthode ne fait rien
   */
  async clearComments(archivePath: string): Promise<void> {
    console.log('7z does not support archive comments, nothing to clear');
  }
  
  /**
   * Ajoute des fichiers à une archive 7z existante
   */
  async addFiles(options: ArchiveAddOptions): Promise<void> {
    // Déterminer le niveau de compression
    const compressionLevel = options.compressionLevel?.toString() || '5';
    const mx = compressionLevels[compressionLevel] || compressionLevel;
    
    return new Promise((resolve, reject) => {
      const addOptions: any = {
        $bin: this.sevenZipPath,
        method: ['0=LZMA2'],
        $raw: [`-mx=${mx}`]
      };

      const myStream = Seven.add(options.archivePath, options.files, addOptions);
      trackProcess((myStream as any)._childProcess);
      
      myStream.on('end', () => {
        console.log(`✅ Files added to: ${options.archivePath}`);
        resolve();
      });
      
      myStream.on('error', (err: any) => {
        console.error('Error adding files to 7z archive:', err);
        reject(err);
      });
    });
  }
  
  /**
   * Supprime des fichiers d'une archive 7z existante
   */
  async deleteFiles(options: ArchiveDeleteOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      const deleteOptions: any = {
        $bin: this.sevenZipPath
      };
      
      const myStream = Seven.delete(options.archivePath, options.files, deleteOptions);
      
      myStream.on('end', () => {
        console.log(`✅ Files removed from: ${options.archivePath}`);
        resolve();
      });
      
      myStream.on('error', (err: any) => {
        console.error('Error deleting files from 7z archive:', err);
        reject(err);
      });
    });
  }
  
  /**
   * Retire des entrées d'une archive ZIP ou 7z via la ligne de commande 7-Zip
   * (`7z d`). 7-Zip écrit la nouvelle archive dans un fichier temporaire puis
   * remplace l'original : une interruption laisse l'archive d'origine intacte.
   * Contrairement à adm-zip, aucune limite de taille (pas de chargement en mémoire).
   * Les noms sont passés via un fichier liste UTF-8, sans interprétation des jokers (-spd).
   */
  async removeEntriesCli(archivePath: string, entryNames: string[]): Promise<void> {
    if (entryNames.length === 0) return;
    await this.runWithListFile(entryNames, listFile =>
      ['d', archivePath, '-y', '-scsUTF-8', '-spd', `@${listFile}`]);
  }

  /**
   * Extrait des entrées d'une archive ZIP ou 7z en conservant leurs chemins (`7z x`).
   */
  async extractEntriesCli(archivePath: string, entryNames: string[], outputDir: string): Promise<void> {
    if (entryNames.length === 0) return;
    await fs.mkdir(outputDir, { recursive: true });
    await this.runWithListFile(entryNames, listFile =>
      ['x', archivePath, `-o${outputDir}`, '-y', '-scsUTF-8', '-spd', `@${listFile}`]);
  }

  private async runWithListFile(entryNames: string[], buildArgs: (listFile: string) => string[]): Promise<void> {
    const listFile = path.join(os.tmpdir(), `rumcet-7zlist-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    // 7-Zip ne reconnaît pas « sub\fichier » dans un ZIP : toujours des « / »
    await fs.writeFile(listFile, entryNames.map(n => n.replace(/\\/g, '/')).join('\n'), 'utf8');
    try {
      await trackedExecFileAsync(this.sevenZipPath, buildArgs(listFile), { maxBuffer: 64 * 1024 * 1024 });
    } finally {
      await fs.unlink(listFile).catch(() => { /* déjà absent */ });
    }
  }

  getSupportedExtensions(): string[] {
    return ['.7z'];
  }
}
