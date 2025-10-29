// ============================================
// src/helpers/chdmanHandler.ts
// ============================================

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs/promises';
import { app } from 'electron';

// Créer un EventEmitter pour les événements CHD
export const chdmanEvents = new EventEmitter();

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
  allMetadata?: string[];  // Toutes les lignes de metadata
  tracks?: ChdTrackInfo[];  // Informations des tracks pour CD/DVD
  isGDI?: boolean;  // Indicateur si c'est un GD-ROM (Dreamcast)
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

// Détection du type selon l'extension pour la création
const CD_FORMATS = ['.cue', '.gdi', '.toc', '.nrg', '.cdi', '.iso', '.ccd'];
const DVD_FORMATS = ['.iso', '.mds'];  // ISO peut être CD ou DVD selon la taille
const HD_FORMATS = ['.img', '.vhd', '.vmdk', '.vdi', '.qcow2', '.raw'];

// Pour déterminer le type lors de la création
export function detectMediaType(filePath: string, fileSize?: number): string {
  const ext = path.extname(filePath).toLowerCase();
  
  if (ext === '.gdi') return 'cd';  // GDI est toujours CD (Dreamcast)
  if (ext === '.cue') return 'cd';  // CUE est toujours CD
  if (ext === '.toc') return 'cd';  // TOC est toujours CD
  
  // ISO peut être CD ou DVD selon la taille
  if (ext === '.iso' && fileSize) {
    return fileSize > 800 * 1024 * 1024 ? 'dvd' : 'cd';  // > 800MB = probablement DVD
  }
  
  if (HD_FORMATS.includes(ext)) return 'hd';
  
  return 'cd'; // Par défaut
}

export class ChdmanHandler {
  private chdmanPath: string;
  
  constructor(chdmanPath?: string) {
    // Chemin vers chdman.exe - peut être dans le dossier de l'app ou configuré
    this.chdmanPath = chdmanPath || path.join(app.getPath('userData'), 'tools', 'chdman.exe');
  }
  
  /**
   * Définir le chemin vers chdman
   */
  setPath(newPath: string): void {
    this.chdmanPath = newPath;
  }
  
  /**
   * Vérifie si chdman est disponible
   */
  async isAvailable(): Promise<boolean> {
    try {
      await fs.access(this.chdmanPath);
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Convertit un CD en CHD
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
            message: `Conversion réussie : ${outputPath}`
          });
        } else {
          reject(new Error(`Erreur chdman createcd (code ${code}): ${errorOutput || output}`));
        }
      });
      
      process.on('error', (err) => {
        reject(new Error(`Impossible de lancer chdman: ${err.message}`));
      });
    });
  }
  
  /**
   * Convertit un DVD en CHD
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
            message: `Conversion réussie : ${outputPath}`
          });
        } else {
          reject(new Error(`Erreur chdman createdvd (code ${code}): ${errorOutput || output}`));
        }
      });
      
      process.on('error', (err) => {
        reject(new Error(`Impossible de lancer chdman: ${err.message}`));
      });
    });
  }
  
  /**
   * Convertit un Laser Disc en CHD
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
            message: `Conversion réussie : ${outputPath}`
          });
        } else {
          reject(new Error(`Erreur chdman createld (code ${code}): ${errorOutput || output}`));
        }
      });
      
      process.on('error', (err) => {
        reject(new Error(`Impossible de lancer chdman: ${err.message}`));
      });
    });
  }
  
  /**
   * Convertit un disque dur ou une ROM en CHD
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
            message: `Conversion réussie : ${outputPath}`
          });
        } else {
          reject(new Error(`Erreur chdman createhd (code ${code}): ${errorOutput || output}`));
        }
      });
      
      process.on('error', (err) => {
        reject(new Error(`Impossible de lancer chdman: ${err.message}`));
      });
    });
  }
  
  /**
   * Convertit un Raw en CHD
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
            message: `Conversion réussie : ${outputPath}`
          });
        } else {
          reject(new Error(`Erreur chdman createraw (code ${code}): ${errorOutput || output}`));
        }
      });
      
      process.on('error', (err) => {
        reject(new Error(`Impossible de lancer chdman: ${err.message}`));
      });
    });
  }
  
  /**
   * Extrait un CHD vers son format CD original
   * Détermine automatiquement si l'option -sb (split bins) doit être utilisée
   */
  //async extractCD(chdPath: string, outputPath?: string): Promise<{ success: boolean; message: string }> {
  //async extractCD(chdPath: string, outputPath?: string, hasMultipleDataTracks?: boolean): Promise<{ success: boolean; message: string }> {
  async extractCD(chdPath: string, outputPath?: string, chdInfo?: ChdInfo): Promise<{ success: boolean; message: string }> {
    // Déterminer si on a besoin de plusieurs BINs
    let needsMultipleBins = false;
    
    if (chdInfo) {
      // Utiliser getExpectedBinCount pour déterminer si on a plusieurs BINs
      needsMultipleBins = this.getExpectedBinCount(chdInfo) > 1;
    } else {
      // Si aucune info fournie, essayer de la récupérer
      try {
        const info = await this.info(chdPath);
        needsMultipleBins = this.getExpectedBinCount(info) > 1;
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
        }
      }

      // Extraire en plusieurs bins si nécessaire
      if (needsMultipleBins) {
        args.push('-sb');
      }
      
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
            message: `Extraction réussie : ${output}`
          });
        } else {
          reject(new Error(`Erreur chdman extractcd (code ${code}): ${errorOutput || outputStr}\n${args}`));
        }
      });
      
      process.on('error', (err) => {
        reject(new Error(`Impossible de lancer chdman: ${err.message}`));
      });
    });
  }
  
  /**
   * Extrait un CHD vers son format DVD original
   */
  async extractDVD(chdPath: string, outputPath?: string): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve, reject) => {
      const args = ['extractdvd'];
      
      args.push('-i', chdPath);
      
      // Déterminer le format de sortie basé sur l'extension
      const output = outputPath || chdPath.replace('.chd', '.cue');
      args.push('-o', output);
      
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
            message: `Extraction réussie : ${output}`
          });
        } else {
          reject(new Error(`Erreur chdman extractdvd (code ${code}): ${errorOutput || outputStr}`));
        }
      });
      
      process.on('error', (err) => {
        reject(new Error(`Impossible de lancer chdman: ${err.message}`));
      });
    });
  }
  
  /**
   * Extrait un CHD vers son format Laser Disc original
   */
  async extractLD(chdPath: string, outputPath?: string): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve, reject) => {
      const args = ['extractld'];
      
      args.push('-i', chdPath);
      
      // Déterminer le format de sortie basé sur l'extension
      const output = outputPath || chdPath.replace('.chd', '.cue');
      args.push('-o', output);
      
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
            message: `Extraction réussie : ${output}`
          });
        } else {
          reject(new Error(`Erreur chdman extractld (code ${code}): ${errorOutput || outputStr}`));
        }
      });
      
      process.on('error', (err) => {
        reject(new Error(`Impossible de lancer chdman: ${err.message}`));
      });
    });
  }
  
  /**
   * Extrait un CHD vers son format Hard Disk original
   */
  async extractHD(chdPath: string, outputPath?: string): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve, reject) => {
      const args = ['extracthd'];
      
      args.push('-i', chdPath);
      
      // Déterminer le format de sortie basé sur l'extension
      const output = outputPath || chdPath.replace('.chd', '.cue');
      args.push('-o', output);
      
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
            message: `Extraction réussie : ${output}`
          });
        } else {
          reject(new Error(`Erreur chdman extracthd (code ${code}): ${errorOutput || outputStr}`));
        }
      });
      
      process.on('error', (err) => {
        reject(new Error(`Impossible de lancer chdman: ${err.message}`));
      });
    });
  }
  
  /**
   * Extrait un CHD vers son format Raw original
   */
  async extractRaw(chdPath: string, outputPath?: string): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve, reject) => {
      const args = ['extractraw'];
      
      args.push('-i', chdPath);
      
      // Déterminer le format de sortie basé sur l'extension
      const output = outputPath || chdPath.replace('.chd', '.cue');
      args.push('-o', output);
      
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
            message: `Extraction réussie : ${output}`
          });
        } else {
          reject(new Error(`Erreur chdman extractraw (code ${code}): ${errorOutput || outputStr}`));
        }
      });
      
      process.on('error', (err) => {
        reject(new Error(`Impossible de lancer chdman: ${err.message}`));
      });
    });
  }
  
  /**
   * Obtient les informations d'un fichier CHD
   */
  async info(chdPath: string): Promise<ChdInfo> {
    return new Promise((resolve, reject) => {
      const args = ['info', '-i', chdPath, '-v'];
      
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
          const info = this.parseInfo(output);
          resolve(info);
        } else {
          reject(new Error(`Erreur chdman info (code ${code}): ${errorOutput || output}`));
        }
      });
      
      process.on('error', (err) => {
        reject(new Error(`Impossible de lancer chdman: ${err.message}`));
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
            message: 'CHD valide'
          });
        } else {
          resolve({
            valid: false,
            message: `Erreur de vérification: ${errorOutput || output}`
          });
        }
      });
      
      process.on('error', (err) => {
        reject(new Error(`Impossible de lancer chdman: ${err.message}`));
      });
    });
  }
  
  /**
   * Parse la progression depuis la sortie de chdman
   */
  private parseProgress(output: string) {
    // chdman affiche la progression comme : "Compressing, 50.5%"
    const match = output.match(/(\d+\.?\d*)%/);
    if (match) {
      const progress = parseFloat(match[1]);
      // Émettre un événement de progression
      chdmanEvents.emit('progress', progress);
    }
  }
  
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
