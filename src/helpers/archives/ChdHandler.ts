// src/helpers/archives/ChdHandler.ts
// VERSION FUSIONNÉE : Intègre tout le code de chdmanHandler.ts

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { app } from 'electron';
import { 
  IArchiveHandler, 
  ArchiveContent, 
  ArchiveCreateOptions, 
  ArchiveExtractOptions 
} from './types.js';
import { calculateFileHashes } from '../hashCalculator.js';

// ============================================
// INTERFACES ET TYPES
// ============================================

export interface ChdConversionOptions {
  inputPath: string;
  outputPath?: string;
  compression?: 'none' | 'cdlz' | 'cdzl' | 'cdfl' | 'avhu' | 'lzma' | 'zlib' | 'huff' | 'flac';
  force?: boolean;
  numProcessors?: number;
}

export interface ChdInfo {
  version: number;
  logicalSize: number;
  hunkSize: number;
  totalHunks: number;
  compression: string;
  sha1: string;
  md5: string;
  // Tag = CHT2 =>  CD
  // Tag = DVD  =>  DVD
  // Tag = LD   =>  LD
  // Tag = HD   =>  HD
  // Tag = RAW  =>  RAW
  metadata: string;
  mediaType?: 'CD' | 'DVD' | 'HD' | 'LD' | 'RAW';
  allMetadata?: string[];
  tracks?: ChdTrackInfo[];
  isGDI?: boolean;
  discType?: 'CD-ROM' | 'CD-DA' | 'GD-ROM' | 'DVD-ROM' | 'DVD-VIDEO';
}

export interface ChdTrackInfo {
  trackNumber?: number;
  type?: string;           // MODE2_RAW, AUDIO, MODE1/2352, etc.
  subtype?: string;        // NONE, RW, etc.
  frames?: number;         // Nombre total de frames de la track
  pregap?: number;         // En frames (pas en MM:SS:FF)
  postgap?: number;        // En frames
  pgtype?: string;         // MODE1, VAUDIO, etc.
  pgsub?: string;          // NONE, RW, etc.
}

// ============================================
// CONSTANTES
// ============================================

const CD_FORMATS = ['.cue', '.gdi', '.toc', '.nrg', '.cdi', '.iso', '.ccd'];
const DVD_FORMATS = ['.iso', '.mds'];
const HD_FORMATS = ['.img', '.vhd', '.vmdk', '.vdi', '.qcow2', '.raw'];

// ============================================
// FONCTIONS UTILITAIRES
// ============================================

/**
 * Détecte le type de média selon l'extension et la taille
 */
export function detectMediaType(filePath: string, fileSize?: number): string {
  const ext = path.extname(filePath).toLowerCase();
  
  if (ext === '.gdi') return 'cd';  // GDI est toujours CD (Dreamcast)
  if (ext === '.cue') return 'cd';  // CUE est toujours CD
  if (ext === '.toc') return 'cd';  // TOC est toujours CD

  // ISO peut être CD ou DVD selon la taille
  if (ext === '.iso' && fileSize) {
    return fileSize > 800 * 1024 * 1024 ? 'dvd' : 'cd';  // > 800MB = probablement DVD
  }

  if (CD_FORMATS.includes(ext)) return 'cd';

  if (DVD_FORMATS.includes(ext)) return 'dvd';

  if (HD_FORMATS.includes(ext)) return 'hd';

  return 'cd'; // Par défaut
}

// ============================================
// CLASSE PRINCIPALE : ChdHandler
// ============================================

/**
 * Handler pour les archives CHD (Compressed Hunks of Data)
 * Support: Lecture et Écriture (via chdman binaire)
 * 
 * Cette classe fusionne les fonctionnalités de chdmanHandler.ts
 * et implémente l'interface IArchiveHandler
 */
export class ChdHandler extends EventEmitter implements IArchiveHandler {
  private chdmanPath: string;
  
  constructor(chdmanPath?: string) {
    super();
    this.chdmanPath = chdmanPath || path.join(app.getPath('userData'), 'tools', 'chdman.exe');
  }
  
  // ============================================
  // MÉTHODES IARCHIVEHANDLER
  // ============================================
  
  canRead(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.chd');
  }
  
  /**
   * Liste le contenu d'un CHD en l'extrayant temporairement
   */
  async list(filePath: string): Promise<ArchiveContent[]> {
    const isAvailable = await this.isAvailable();
    if (!isAvailable) {
      throw new Error('chdman not available. Please configure chdman path in settings.');
    }
    
    const chdInfo = await this.info(filePath);
    const tempDir = path.join(os.tmpdir(), 'chd_list_' + Date.now());
    await fs.mkdir(tempDir, { recursive: true });
    
    try {
      const baseName = path.basename(filePath, '.chd');
      const outputBase = path.join(tempDir, baseName);
      
      if (chdInfo.mediaType === 'DVD') {
        await this.extractDVD(filePath, outputBase);
      } else if (chdInfo.mediaType === 'HD') {
        await this.extractHD(filePath, outputBase + '.img');
      } else {
        await this.extractCD(filePath, outputBase + '.cue', chdInfo);
      }
      
      /*const files = await fs.readdir(tempDir);
      const contents: ArchiveContent[] = [];
      
      for (const file of files) {
        const fullPath = path.join(tempDir, file);
        const stats = await fs.stat(fullPath);
        
        if (stats.isFile()) {
          const hashes = await calculateFileHashes(fullPath);
          contents.push({
            fileName: file,
            size: stats.size,
            hashes: hashes
          });
        }
      }*/

      const files = await fs.readdir(tempDir);
      console.log(`📀 CHD extraits : ${files.length} fichiers détectés`);

      const contents: ArchiveContent[] = [];

      for (const file of files) {
        const fullPath = path.join(tempDir, file);
        const stats = await fs.stat(fullPath);
        
        if (stats.isFile()) {
          console.log(`  - ${file} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
          
          // Calculer les hashes uniquement pour les fichiers BIN, CUE, GDI et ISO
          // Les autres fichiers (comme .ccd, .sub) ne sont pas hashés pour des raisons de performance
          const ext = path.extname(file).toLowerCase();
          if (ext === '.bin' || ext === '.cue' || ext === '.gdi' || ext === '.iso') {
            const hashes = await calculateFileHashes(fullPath);
            contents.push({
              fileName: file,
              size: stats.size,
              hashes: hashes
            });
          } else {
            // Pour les autres fichiers, ajouter sans hash
            contents.push({
              fileName: file,
              size: stats.size,
              hashes: {
                crc32: '',
                md5: '',
                sha1: ''
              }
            });
          }
        }
      }
      
      return contents;
      
    } finally {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (error) {
        console.warn('Failed to clean up temp directory:', error);
      }
    }
  }
  
  async extract(options: ArchiveExtractOptions): Promise<void> {
    const isAvailable = await this.isAvailable();
    if (!isAvailable) {
      throw new Error('chdman not available. Please configure chdman path in settings.');
    }
    
    await fs.mkdir(options.outputDir, { recursive: true });
    
    const chdInfo = await this.info(options.archivePath);
    const baseName = path.basename(options.archivePath, '.chd');
    const outputBase = path.join(options.outputDir, baseName);
    
    if (chdInfo.mediaType === 'DVD') {
      await this.extractDVD(options.archivePath, outputBase);
    } else if (chdInfo.mediaType === 'HD') {
      await this.extractHD(options.archivePath, outputBase + '.img');
    } else {
      await this.extractCD(options.archivePath, outputBase + '.cue', chdInfo);
    }
  }
  
  canWrite(): boolean {
    return true;
  }
  
  async create(options: ArchiveCreateOptions): Promise<void> {
    const isAvailable = await this.isAvailable();
    if (!isAvailable) {
      throw new Error('chdman not available. Please configure chdman path in settings.');
    }
    
    if (options.files.length === 0) {
      throw new Error('No input file specified for CHD creation');
    }
    
    if (options.files.length > 1) {
      throw new Error('CHD can only be created from a single source file (.cue, .gdi, .iso, etc.)');
    }
    
    const inputFile = options.files[0];
    
    try {
      await fs.access(inputFile);
    } catch (error) {
      throw new Error(`Input file not found: ${inputFile}`);
    }
    
    const outputDir = path.dirname(options.outputPath);
    await fs.mkdir(outputDir, { recursive: true });
    
    const chdOptions: ChdConversionOptions = {
      inputPath: inputFile,
      outputPath: options.outputPath,
      force: true
    };
    
    const stats = await fs.stat(inputFile);
    const mediaType = detectMediaType(inputFile, stats.size);
    
    let result;
    
    if (mediaType === 'dvd') {
      result = await this.createDVD(chdOptions);
    } else if (mediaType === 'hd') {
      result = await this.createHD(chdOptions);
    } else {
      result = await this.createCD(chdOptions);
    }
    
    if (!result.success) {
      throw new Error(`CHD creation failed: ${result.message}`);
    }
  }
  
  getSupportedExtensions(): string[] {
    return ['.chd'];
  }
  
  // ============================================
  // MÉTHODES CHDMAN (fusionnées depuis chdmanHandler.ts)
  // ============================================
  
  setPath(newPath: string): void {
    this.chdmanPath = newPath;
  }
  
  async isAvailable(): Promise<boolean> {
    try {
      await fs.access(this.chdmanPath);
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Crée un CHD depuis un CD
   */
  async createCD(options: ChdConversionOptions): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve, reject) => {
      const args = ['createcd'];
      
      // Input file (cue, gdi ?, toc, nrg, iso, img, ccd, sub, etc.)
      args.push('-i', options.inputPath);
      
      // Output file
      const outputPath = options.outputPath || options.inputPath.replace(/\.[^/.]+$/, '.chd');
      args.push('-o', outputPath);
      
      // Compression (default: cdlz, cdzl, cdfl)
      if (options.compression) {
        args.push('-c', options.compression);
      }

      // Force overwrite
      if (options.force) {
        args.push('-f');
      }

      // Number of processors
      if (options.numProcessors) {
        args.push('-np', options.numProcessors.toString());
      }
      
      const process = spawn(this.chdmanPath, args);
      
      let output = '';
      let errorOutput = '';
      
      process.stdout.on('data', (data) => {
        output += data.toString();
        this.parseProgress(data.toString());
      });
      
      process.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            message: `CHD CD created successfully: ${outputPath}`
          });
        } else {
          reject(new Error(`chdman createcd failed (code ${code}): ${errorOutput || output}`));
        }
      });
      
      process.on('error', (err) => {
        reject(new Error(`Unable to run chdman: ${err.message}`));
      });
    });
  }
  
  /**
   * Crée un CHD depuis un DVD
   */
  async createDVD(options: ChdConversionOptions): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve, reject) => {
      const args = ['createdvd'];
      
      // Input file (cue, gdi?, nrg, iso, mds, mdf, etc.)
      args.push('-i', options.inputPath);
      
      // Output file
      const outputPath = options.outputPath || options.inputPath.replace(/\.[^/.]+$/, '.chd');
      args.push('-o', outputPath);
      
      // Compression (default: lzma, zlib, huff, flac)
      if (options.compression) {
        args.push('-c', options.compression);
      }
      
      // Force overwrite
      if (options.force) {
        args.push('-f');
      }
      
      // Number of processors
      if (options.numProcessors) {
        args.push('-np', options.numProcessors.toString());
      }
      
      const process = spawn(this.chdmanPath, args);
      
      let output = '';
      let errorOutput = '';
      
      process.stdout.on('data', (data) => {
        output += data.toString();
        // Émettre la progression si nécessaire
        this.parseProgress(data.toString());
      });
      
      process.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            message: `CHD DVD created successfully: ${outputPath}`
          });
        } else {
          reject(new Error(`chdman createdvd failed (code ${code}): ${errorOutput || output}`));
        }
      });
      
      process.on('error', (err) => {
        reject(new Error(`Unable to run chdman: ${err.message}`));
      });
    });
  }
  
  /**
   * Crée un CHD depuis un Laser Disc
   */
  async createLD(options: ChdConversionOptions): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve, reject) => {
      const args = ['createld'];
      
      // Input file (cue, m2v, mpg, avi, ogv, mkv, chd, etc.)
      args.push('-i', options.inputPath);
      
      // Output file
      const outputPath = options.outputPath || options.inputPath.replace(/\.[^/.]+$/, '.chd');
      args.push('-o', outputPath);
      
      // Compression (default: avhu)
      if (options.compression) {
        args.push('-c', options.compression);
      }
      
      // Force overwrite
      if (options.force) {
        args.push('-f');
      }
      
      // Number of processors
      if (options.numProcessors) {
        args.push('-np', options.numProcessors.toString());
      }
      
      const process = spawn(this.chdmanPath, args);
      
      let output = '';
      let errorOutput = '';
      
      process.stdout.on('data', (data) => {
        output += data.toString();
        // Émettre la progression si nécessaire
        this.parseProgress(data.toString());
      });
      
      process.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            message: `CHD LD created successfully: ${outputPath}`
          });
        } else {
          reject(new Error(`chdman createld failed (code ${code}): ${errorOutput || output}`));
        }
      });
      
      process.on('error', (err) => {
        reject(new Error(`Unable to run chdman: ${err.message}`));
      });
    });
  }
  
  /**
   * Crée un CHD depuis un disque dur
   */
  async createHD(options: ChdConversionOptions): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve, reject) => {
      const args = ['createhd'];
      
      // Input file (vhd, vmdk, qcow2, img, raw, chd)
      args.push('-i', options.inputPath);
      
      // Output file
      const outputPath = options.outputPath || options.inputPath.replace(/\.[^/.]+$/, '.chd');
      args.push('-o', outputPath);
      
      // Compression (default: lzma, zlib, huff, flac)
      if (options.compression) {
        args.push('-c', options.compression);
      }
      
      // Force overwrite
      if (options.force) {
        args.push('-f');
      }
      
      // Number of processors
      if (options.numProcessors) {
        args.push('-np', options.numProcessors.toString());
      }
      
      const process = spawn(this.chdmanPath, args);
      
      let output = '';
      let errorOutput = '';
      
      process.stdout.on('data', (data) => {
        output += data.toString();
        this.parseProgress(data.toString());
      });
      
      process.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            message: `CHD HD created successfully: ${outputPath}`
          });
        } else {
          reject(new Error(`chdman createhd failed (code ${code}): ${errorOutput || output}`));
        }
      });
      
      process.on('error', (err) => {
        reject(new Error(`Unable to run chdman: ${err.message}`));
      });
    });
  }
  
  /**
   * Crée un CHD depuis un Raw
   */
  async createRaw(options: ChdConversionOptions): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve, reject) => {
      const args = ['createraw'];
      
      // Input file (bin, img, raw, rom, dat, etc.)
      args.push('-i', options.inputPath);
      
      // Output file
      const outputPath = options.outputPath || options.inputPath.replace(/\.[^/.]+$/, '.chd');
      args.push('-o', outputPath);
      
      // Compression (default: lzma, zlib, huff, flac)
      if (options.compression) {
        args.push('-c', options.compression);
      }
      
      // Force overwrite
      if (options.force) {
        args.push('-f');
      }
      
      // Number of processors
      if (options.numProcessors) {
        args.push('-np', options.numProcessors.toString());
      }
      
      const process = spawn(this.chdmanPath, args);
      
      let output = '';
      let errorOutput = '';
      
      process.stdout.on('data', (data) => {
        output += data.toString();
        // Émettre la progression si nécessaire
        this.parseProgress(data.toString());
      });
      
      process.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            message: `CHD Raw created successfully: ${outputPath}`
          });
        } else {
          reject(new Error(`chdman createraw failed (code ${code}): ${errorOutput || output}`));
        }
      });
      
      process.on('error', (err) => {
        reject(new Error(`Unable to run chdman: ${err.message}`));
      });
    });
  }
  
  /**
   * Extrait un CD depuis un CHD
   */
  async extractCD(chdPath: string, outputPath?: string, chdInfo?: ChdInfo): Promise<{ success: boolean; message: string }> {
    // Déterminer si on a besoin de plusieurs BINs
    let expectedBinCount = 1;
    let needsMultipleBins = false;
    
    if (chdInfo) {
      // Utiliser getExpectedBinCount pour déterminer si on a plusieurs BINs
      expectedBinCount = this.getExpectedBinCount(chdInfo);
      needsMultipleBins = expectedBinCount > 1;
    } else {
      // Si aucune info fournie, essayer de la récupérer
      try {
        const info = await this.info(chdPath);
        expectedBinCount = this.getExpectedBinCount(info);
        needsMultipleBins = expectedBinCount > 1;
      } catch (error) {
        console.warn('Impossible de récupérer les infos CHD, utilisation du mode par défaut');
      }
    }

    return new Promise((resolve, reject) => {
      const args = ['extractcd'];
      
      // Input CHD
      args.push('-i', chdPath);
      
      // Déterminer le format de sortie basé sur l'extension
      //const output = outputPath || chdPath.replace('.chd', '.cue');
      const output = outputPath || chdPath.replace(/\.chd$/i, '');
      args.push('-o', output);
      
      // Pour les BIN/CUE
      if (output.endsWith('.cue')) {
        const binPath = output.replace('.cue', '.bin');
        // Si on n'a qu'un seul BIN attendu, spécifier le nom du fichier bin
        if (!needsMultipleBins) {
          args.push('-ob', binPath);
          console.log(`📀 single bin CHD detected (${expectedBinCount} expected files), usage of -ob ${binPath}`);
        }
      }

      // Extract multiple bins if necessary
      if (needsMultipleBins) {
        args.push('-sb');
        console.log(`📀 multi-bin CHD detected (${expectedBinCount} expected files), usage of --splitbin`);
      }

      // Force overwrite
      args.push('-f');
      
      const process = spawn(this.chdmanPath, args);
      
      let outputStr = '';
      let errorOutput = '';
      
      process.stdout.on('data', (data) => {
        outputStr += data.toString();
        this.parseProgress(data.toString());
      });
      
      process.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            message: `Extraction successful : ${output}`
          });
        } else {
          reject(new Error(`chdman extractcd failed (code ${code}): ${errorOutput || outputStr}\n${args}}`));
        }
      });
      
      process.on('error', (err) => {
        reject(new Error(`Unable to run chdman: ${err.message}`));
      });
    });
  }
  
  /**
   * Extrait un DVD depuis un CHD
   */
  async extractDVD(chdPath: string, outputPath?: string): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve, reject) => {
      const args = ['extractdvd'];
      
      // Input CHD
      args.push('-i', chdPath);
      
      // Déterminer le format de sortie basé sur l'extension
      const output = outputPath || chdPath.replace('.chd', '.cue');
      args.push('-o', output);

      // Force overwrite
      args.push('-f');
      
      const process = spawn(this.chdmanPath, args);
      
      let outputStr = '';
      let errorOutput = '';
      
      process.stdout.on('data', (data) => {
        outputStr += data.toString();
        this.parseProgress(data.toString());
      });
      
      process.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            message: `Extraction successful : ${output}`
          });
        } else {
          reject(new Error(`chdman extractdvd failed (code ${code}): ${errorOutput || outputStr}`));
        }
      });
      
      process.on('error', (err) => {
        reject(new Error(`Unable to run chdman: ${err.message}`));
      });
    });
  }
  
  /**
   * Extrait un DVD depuis un CHD
   */
  async extractLD(chdPath: string, outputPath?: string): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve, reject) => {
      const args = ['extractld'];
      
      // Input CHD
      args.push('-i', chdPath);
      
      // Déterminer le format de sortie basé sur l'extension
      const output = outputPath || chdPath.replace('.chd', '.cue');
      args.push('-o', output);

      // Force overwrite
      args.push('-f');
      
      const process = spawn(this.chdmanPath, args);
      
      let outputStr = '';
      let errorOutput = '';
      
      process.stdout.on('data', (data) => {
        outputStr += data.toString();
        this.parseProgress(data.toString());
      });
      
      process.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            message: `Extraction successful : ${output}`
          });
        } else {
          reject(new Error(`chdman extractld failed (code ${code}): ${errorOutput || outputStr}`));
        }
      });
      
      process.on('error', (err) => {
        reject(new Error(`Unable to run chdman: ${err.message}`));
      });
    });
  }
  
  /**
   * Extrait un Hard Disk depuis un CHD
   */
  async extractHD(chdPath: string, outputPath?: string): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve, reject) => {
      const args = ['extracthd'];
      
      // Input CHD
      args.push('-i', chdPath);
      
      // Déterminer le format de sortie basé sur l'extension
      const output = outputPath || chdPath.replace('.chd', '.cue');
      args.push('-o', output);

      // Force overwrite
      args.push('-f');
      
      const process = spawn(this.chdmanPath, args);
      
      let outputStr = '';
      let errorOutput = '';
      
      process.stdout.on('data', (data) => {
        outputStr += data.toString();
        this.parseProgress(data.toString());
      });
      
      process.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            message: `Extraction successful : ${output}`
          });
        } else {
          reject(new Error(`chdman extracthd failed (code ${code}): ${errorOutput || outputStr}`));
        }
      });
      
      process.on('error', (err) => {
        reject(new Error(`Unable to run chdman: ${err.message}`));
      });
    });
  }
  
  /**
   * Extrait un Hard Disk depuis un CHD
   */
  async extractRaw(chdPath: string, outputPath?: string): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve, reject) => {
      const args = ['extractraw'];
      
      // Input CHD
      args.push('-i', chdPath);
      
      // Déterminer le format de sortie basé sur l'extension
      const output = outputPath || chdPath.replace('.chd', '.cue');
      args.push('-o', output);

      // Force overwrite
      args.push('-f');
      
      const process = spawn(this.chdmanPath, args);
      
      let outputStr = '';
      let errorOutput = '';
      
      process.stdout.on('data', (data) => {
        outputStr += data.toString();
        this.parseProgress(data.toString());
      });
      
      process.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            message: `Extraction successful : ${output}`
          });
        } else {
          reject(new Error(`chdman extractraw failed (code ${code}): ${errorOutput || outputStr}`));
        }
      });
      
      process.on('error', (err) => {
        reject(new Error(`Unable to run chdman: ${err.message}`));
      });
    });
  }
  
  /**
   * Récupère les informations d'un CHD
   */
  async info(inputPath: string): Promise<ChdInfo> {
    return new Promise((resolve, reject) => {
      const args = ['info', '-i', inputPath, '-v'];
      
      const process = spawn(this.chdmanPath, args);
      
      let output = '';
      let errorOutput = '';
      
      process.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      process.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          try {
            const info = this.parseInfo(output);
            resolve(info);
          } catch (err: any) {
            reject(new Error(`Failed to parse CHD info: ${err.message}`));
          }
        } else {
          reject(new Error(`chdman info failed (code ${code}): ${errorOutput || output}`));
        }
      });
      
      process.on('error', (err) => {
        reject(new Error(`Unable to run chdman: ${err.message}`));
      });
    });
  }
  
  /**
   * Vérifie l'intégrité d'un fichier CHD
   */
  async verify(chdPath: string): Promise<{ valid: boolean; message: string }> {
    return new Promise((resolve, reject) => {
      const args = ['verify', '-i', chdPath];
      
      const process = spawn(this.chdmanPath, args);
      
      let output = '';
      let errorOutput = '';
      
      process.stdout.on('data', (data) => {
        output += data.toString();
        this.parseProgress(data.toString());
      });
      
      process.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve({
            valid: true,
            message: 'CHD valid'
          });
        } else {
          resolve({
            valid: false,
            message: `chdman verify failed (code ${code}): ${errorOutput || output}`
          });
        }
      });
      
      process.on('error', (err) => {
        reject(new Error(`Unable to run chdman: ${err.message}`));
      });
    });
  }


  // ============================================
  // Méthodes utilitaire pour parser la sortie de chdman info
  // ============================================

  /**
   * Parse les informations depuis la sortie de chdman info
   */
  private parseInfo(output: string): ChdInfo {
    const info: Partial<ChdInfo> = {};
    const lines = output.split('\n');
    
    // Parse version
    const versionMatch = output.match(/Version:\s+(\d+)/);
    if (versionMatch) info.version = parseInt(versionMatch[1]);
    
    // Parse logical size
    const logicalMatch = output.match(/Logical size:\s+(\d+)/);
    if (logicalMatch) info.logicalSize = parseInt(logicalMatch[1]);
    
    // Parse hunk size
    const hunkMatch = output.match(/Hunk Size:\s+(\d+)/);
    if (hunkMatch) info.hunkSize = parseInt(hunkMatch[1]);
    
    // Parse total hunks
    const totalMatch = output.match(/Total Hunks:\s+(\d+)/);
    if (totalMatch) info.totalHunks = parseInt(totalMatch[1]);
    
    // Parse compression
    const compMatch = output.match(/Compression:\s+(\w+)/);
    if (compMatch) info.compression = compMatch[1];
    
    // Parse SHA1
    const sha1Match = output.match(/SHA1:\s+([a-f0-9]{40})/i);
    if (sha1Match) info.sha1 = sha1Match[1];
    
    // Parse MD5
    const md5Match = output.match(/MD5:\s+([a-f0-9]{32})/i);
    if (md5Match) info.md5 = md5Match[1];
    
    // Parse metadata
    // Tag = CHT2 =>  CD
    // Tag = DVD  =>  DVD
    // Tag = LD   =>  LD
    // Tag = HD   =>  HD
    // Tag = RAW  =>  RAW
    //const metadataMatch = output.match(/Metadata:\s+(\w+)/);
    /*const metadataMatch = output.match(/Metadata:\s+(.+)/);
    if (metadataMatch) {
      info.metadata = metadataMatch[1];
            
      // Déterminer le type de média
      if (info.metadata.includes('CHT2') || info.metadata.includes('CD') || info.metadata.includes('CHCD')) {
        info.mediaType = 'CD';
      } else if (info.metadata.includes('DVD')) {
        info.mediaType = 'DVD';
      } else if (info.metadata.includes('LD') || info.metadata.includes('LASERDISC')) {
        info.mediaType = 'LD';
      } else if (info.metadata.includes('HD') || info.metadata.includes('CHD_HD') || info.metadata.includes('HARD_DISK')) {
        info.mediaType = 'HD';
      } else if (info.metadata.includes('RAW')) {
        info.mediaType = 'RAW';
      }
    }*/
  
    // Parse TOUTES les lignes de metadata
    const allMetadata: string[] = [];
    let inMetadata = false;
    
    for (const line of lines) {
      // Début de la section metadata
      if (line.includes('Metadata:')) {
        inMetadata = true;
        // Capturer ce qui suit "Metadata:" sur la même ligne
        const firstLineMatch = line.match(/Metadata:\s+(.+)/);
        if (firstLineMatch && firstLineMatch[1].trim()) {
          allMetadata.push(firstLineMatch[1].trim());
        }
        continue;
      }
      
      // Si on est dans la section metadata
      if (inMetadata) {
        // Sortir si on atteint une nouvelle section (commence sans espaces)
        if (line.length > 0 && !line.startsWith(' ') && !line.startsWith('\t')) {
          inMetadata = false;
          continue;
        }
        
        // Ajouter la ligne de metadata (enlever l'indentation)
        const trimmed = line.trim();
        if (trimmed) {
          allMetadata.push(trimmed);
        }
      }
    }
    
    info.allMetadata = allMetadata;
    
    // Joindre toutes les metadata en une seule string pour compatibilité
    info.metadata = allMetadata.join(' ');
    
    // Parser les TRACKS depuis les metadata
    const tracks: ChdTrackInfo[] = [];
    let trackCount = 0;
    
    for (const metaLine of allMetadata) {
      // Format typique : TRACK:TRACK 01 MODE1/2352 PREGAP 00:02:00 PGTYPE MODE1 PGSUB RW
      if (metaLine.startsWith('TRACK:')) {
        const trackData = metaLine.substring(6); // Enlever "TRACK:"
        const track = this.parseTrackInfo(trackData);
        if (track) {
          tracks.push(track);
          trackCount++;
        }
      }
    }
    
    info.tracks = tracks;
    
    // Déterminer le type de média et sous-type
    if (info.metadata) {
      // Type principal
      if (info.metadata.includes('CHT2') || info.metadata.includes('CHCD') || info.metadata.includes('CD')) {
        info.mediaType = 'CD';
        
        // Détecter GD-ROM (Dreamcast)
        if (info.metadata.includes('GDROM') || 
            info.metadata.includes('GD-ROM') ||
            // Les GDI ont souvent 3+ tracks avec des modes spécifiques
            (tracks.length >= 3 && tracks.some(t => t.frames && t.frames > 150000))) {
          info.isGDI = true;
          info.discType = 'GD-ROM';
        }
        // Détecter CD Audio
        else if (tracks.every(t => t.type === 'AUDIO')) {
          info.discType = 'CD-DA';
        }
        // CD-ROM standard
        else {
          info.discType = 'CD-ROM';
        }
      }
      else if (info.metadata.includes('DVD')) {
        info.mediaType = 'DVD';
        info.discType = info.metadata.includes('VIDEO') ? 'DVD-VIDEO' : 'DVD-ROM';
      }
      else if (info.metadata.includes('LD') || info.metadata.includes('LASERDISC')) {
        info.mediaType = 'LD';
      }
      else if (info.metadata.includes('HD') || info.metadata.includes('HARD_DISK')) {
        info.mediaType = 'HD';
      }
      else if (info.metadata.includes('RAW')) {
        info.mediaType = 'RAW';
      }
      // Par défaut, si on a des tracks, c'est probablement un CD
      else if (tracks.length > 0) {
        info.mediaType = 'CD';
        info.discType = 'CD-ROM';
      }
    }
      
      return info as ChdInfo;
  }
  
  /**
   * Parse une ligne d'information de track
   */
  private parseTrackInfo(trackData: string): ChdTrackInfo | null {
    try {
      const track: Partial<ChdTrackInfo> = {};
      
      // Extraire le numéro de track (Format: TRACK:1)
      const trackNumMatch = trackData.match(/^(\d+)/);
      if (trackNumMatch) {
        track.trackNumber = parseInt(trackNumMatch[1]);
      }
      
      // Extraire le type (Format: TYPE:MODE2_RAW, MODE1/2352, AUDIO, etc.)
      const typeMatch = trackData.match(/TYPE:(\S+)/);
      if (typeMatch) {
        track.type = typeMatch[1];
      }
      
      // Format: SUBTYPE:NONE
      const subtypeMatch = trackData.match(/SUBTYPE:(\S+)/);
      if (subtypeMatch) {
        track.subtype = subtypeMatch[1];
      }
      
      // Format: FRAMES:0
      const framesMatch = trackData.match(/FRAMES:(\d+)/);
      if (framesMatch) {
        track.frames = parseInt(framesMatch[1]);
      }
      
      // Extraire PREGAP (Format: PREGAP:0)
      const pregapMatch = trackData.match(/PREGAP:(\d+)/);
      if (pregapMatch) {
        track.pregap = parseInt(pregapMatch[1]);
      }
      
      // Extraire PGTYPE (Format: PGTYPE:MODE1)
      const pgtypeMatch = trackData.match(/PGTYPE:(\S+)/);
      if (pgtypeMatch) {
        track.pgtype = pgtypeMatch[1];
      }
      
      // Extraire PGSUB (Format: PGSUB:NONE)
      const pgsubMatch = trackData.match(/PGSUB:(\S+)/);
      if (pgsubMatch) {
        track.pgsub = pgsubMatch[1];
      }
      
      // Extraire POSTGAP (Format: POSTGAP:0)
      const postgapMatch = trackData.match(/POSTGAP:(\d+)/);
      if (postgapMatch) {
        track.postgap = parseInt(postgapMatch[1]);
      }
      
      return track as ChdTrackInfo;
    } catch (error) {
      console.error('Erreur parsing track:', error);
      return null;
    }
  }
  
  /**
   * Parse la progression de chdman
   */
  private parseProgress(output: string): void {
    // chdman affiche la progression comme : "Compressing, 50.5%"
    const match = output.match(/(\d+)%/);
    if (match) {
      const progress = parseInt(match[1]);
      // Émettre un événement de progression
      this.emit('progress', progress);
    }
  }


  // ============================================
  // Méthode utilitaire pour déterminer le type de disque
  // ============================================

  /**
   * Détermine si un CHD est un GD-ROM (Dreamcast)
   */
  public isGDROM(info: ChdInfo): boolean {
    // Vérifier le flag direct
    if (info.isGDI) return true;
    
    // Vérifier les caractéristiques typiques d'un GD-ROM
    if (info.tracks && info.tracks.length >= 3) {
      // Les GD-ROM ont généralement:
      // - Track 1: Data (petit, ~300MB zone basse densité)
      // - Track 2: Audio (gap)
      // - Track 3+: Data (gros, zone haute densité)
      
      const hasLargeTrack = info.tracks.some(t => {
        // Les tracks haute densité ont > 150000 frames (~300MB)
        return t.frames && t.frames > 150000;
      });
      
      const hasMultipleDataTracks = info.tracks.filter(t => 
        t.type && t.type.includes('MODE')
      ).length >= 2;
      
      return hasLargeTrack || hasMultipleDataTracks;
    }
    
    return false;
  }

  /**
   * Obtient le nombre de fichiers BIN qui seront extraits
   */
  public getExpectedBinCount(info: ChdInfo): number {
    if (!info.tracks || info.tracks.length === 0) return 1;
  
    // CORRECTION: Pour les CHD, le nombre de BIN = nombre de tracks
    // chdman extractcd -sb crée un fichier .bin par track
    return info.tracks.length;
  }
}
