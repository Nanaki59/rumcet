// src/helpers/archives/ArchiveManager.ts

import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { EventEmitter } from 'events';
import { 
  IArchiveHandler, 
  ArchiveContent, 
  ArchiveCreateOptions, 
  ArchiveFormat,
  ArchiveProgressEvent,
  ArchiveAddOptions,
  ArchiveDeleteOptions
} from './types.js';
import { ZipHandler } from './ZipHandler.js';
import { SevenZipHandler } from './SevenZipHandler.js';
import { RarHandler } from './RarHandler.js';
import { ChdHandler } from './ChdHandler.js';
import { IsoHandler } from './IsoHandler.js';
import { CsoHandler } from './CsoHandler.js';

/**
 * ArchiveManager - Gestionnaire centralisé pour tous les formats d'archive
 * 
 * Fonctionnalités:
 * - Détection automatique du format
 * - Liste et extraction d'archives
 * - Création d'archives selon les préférences utilisateur
 * - Conversion entre formats
 * - Optimisation d'archives existantes
 * - Gestion des commentaires d'archives (ZIP, 7z)
 * - Ajout/suppression de fichiers dans les archives (ZIP, 7z)
 * - Détection du niveau de compression
 * 
 * Formats supportés:
 * - ZIP (lecture/écriture)
 * - 7z (lecture/écriture)
 * - RAR (lecture seule)
 * - CHD (lecture/écriture via chdman)
 * - ISO (lecture seule via 7zip)
 * - CSO (lecture seule via maxcso)
 */
export class ArchiveManager extends EventEmitter {
  private handlers: Map<string, IArchiveHandler>;
  private formatToExtension: Map<ArchiveFormat, string>;
  
  constructor() {
    super();
    
    this.handlers = new Map();
    this.formatToExtension = new Map([
      ['zip', '.zip'],
      ['7z', '.7z'],
      ['rar', '.rar'],
      ['chd', '.chd'],
      ['iso', '.iso'],
      ['cso', '.cso']
    ]);
    
    // Initialiser les handlers
    this.initializeHandlers();
  }
  
  /**
   * Initialise tous les handlers et les enregistre
   */
  private initializeHandlers(): void {
    const handlers: IArchiveHandler[] = [
      new ZipHandler(),
      new SevenZipHandler(),
      new RarHandler(),
      new ChdHandler(),
      new IsoHandler(),
      new CsoHandler()
    ];
    
    // Enregistrer chaque handler pour ses extensions
    for (const handler of handlers) {
      for (const ext of handler.getSupportedExtensions()) {
        this.handlers.set(ext.toLowerCase(), handler);
      }
    }
  }
  
  /**
   * Obtenir le handler approprié pour un fichier
   */
  private getHandler(filePath: string): IArchiveHandler | null {
    const ext = path.extname(filePath).toLowerCase();
    return this.handlers.get(ext) || null;
  }
  
  /**
   * Obtenir le handler pour un format spécifique
   */
  private getHandlerByFormat(format: ArchiveFormat): IArchiveHandler | null {
    const ext = this.formatToExtension.get(format);
    return ext ? this.handlers.get(ext) || null : null;
  }
  
  /**
   * Vérifier si un fichier est une archive supportée
   */
  isArchive(filePath: string): boolean {
    return this.getHandler(filePath) !== null;
  }
  
  /**
   * Obtenir le format d'une archive
   */
  getArchiveFormat(filePath: string): ArchiveFormat | null {
    const ext = path.extname(filePath).toLowerCase();
    
    for (const [format, extension] of this.formatToExtension.entries()) {
      if (extension === ext) {
        return format;
      }
    }
    
    return null;
  }
  
  /**
   * Liste le contenu d'une archive
   * Retourne également le niveau de compression et la présence de commentaires si disponibles
   */
  async listArchive(filePath: string): Promise<ArchiveContent[]> {
    const handler = this.getHandler(filePath);
    if (!handler) {
      throw new Error(`Unsupported archive format: ${filePath}`);
    }
    
    this.emitProgress({
      type: 'start',
      archivePath: filePath,
      operation: 'list'
    });
    
    try {
      const contents = await handler.list(filePath);
      
      this.emitProgress({
        type: 'complete',
        archivePath: filePath,
        operation: 'list',
        totalFiles: contents.length
      });
      
      return contents;
    } catch (error: any) {
      this.emitProgress({
        type: 'error',
        archivePath: filePath,
        operation: 'list',
        error: error
      });
      throw error;
    }
  }
  
  /**
   * Extrait une archive
   */
  async extractArchive(
    archivePath: string, 
    outputDir: string, 
    files?: string[]
  ): Promise<void> {
    const handler = this.getHandler(archivePath);
    if (!handler) {
      throw new Error(`Unsupported archive format: ${archivePath}`);
    }
    
    this.emitProgress({
      type: 'start',
      archivePath: archivePath,
      operation: 'extract'
    });
    
    try {
      await handler.extract({ archivePath, outputDir, files });
      
      this.emitProgress({
        type: 'complete',
        archivePath: archivePath,
        operation: 'extract'
      });
    } catch (error: any) {
      this.emitProgress({
        type: 'error',
        archivePath: archivePath,
        operation: 'extract',
        error: error
      });
      throw error;
    }
  }
  
  /**
   * Crée une archive selon les préférences utilisateur
   * C'est ici que la magie opère !
   * 
   * @param files Fichiers à archiver
   * @param outputPath Chemin de sortie (avec ou sans extension)
   * @param settings Paramètres utilisateur (priorité de format, compression, etc.)
   * @param format Format spécifique (optionnel, sinon utilise la priorité)
   */
  async createArchive(
    files: string[],
    outputPath: string,
    settings?: {
      archiveFormatPriority?: ArchiveFormat[];
      compressionLevel?: 'fastest' | 'normal' | 'maximum';
      solidArchive?: boolean;
      multithreading?: boolean;
      /**
       * Phase 6 — CWD pour l'opération 7z. Quand défini, `files` doit contenir
       * des chemins RELATIFS à ce répertoire pour que 7z préserve la structure
       * des sous-dossiers dans l'archive (nécessaire pour les sets MAME merged).
       */
      workingDirectory?: string;
    },
    format?: ArchiveFormat
  ): Promise<string> {
    if (files.length === 0) {
      throw new Error('No files specified for archive creation');
    }
    
    // Déterminer le format à utiliser
    let targetFormat = format;
    
    if (!targetFormat) {
      // Utiliser la priorité définie par l'utilisateur
      const priority = settings?.archiveFormatPriority || ['7z', 'zip', 'chd'];
      targetFormat = priority[0];
    }
    
    // Obtenir le handler
    const handler = this.getHandlerByFormat(targetFormat);
    if (!handler || !handler.canWrite()) {
      throw new Error(`Cannot create ${targetFormat} archives (not supported or read-only)`);
    }
    
    // Ajuster le chemin de sortie avec la bonne extension
    const ext = this.formatToExtension.get(targetFormat)!;
    if (!outputPath.toLowerCase().endsWith(ext)) {
      // Remplacer l'extension existante uniquement si c'est une vraie extension de fichier
      // (courte, sans espaces) — sinon, simplement ajouter la nouvelle extension
      const currentExt = path.extname(outputPath);
      if (currentExt && currentExt.length <= 5 && !/\s/.test(currentExt)) {
        outputPath = outputPath.slice(0, -currentExt.length) + ext;
      } else {
        outputPath = outputPath + ext;
      }
    }
    
    this.emitProgress({
      type: 'start',
      archivePath: outputPath,
      operation: 'create',
      totalFiles: files.length
    });
    
    try {
      // Mapper le niveau de compression textuel vers une valeur numérique
      const compressionMap: Record<string, number> = {
        'fastest': 1,
        'normal': 5,
        'maximum': 9
      };
      const numericLevel = settings?.compressionLevel
        ? compressionMap[settings.compressionLevel] ?? 5
        : undefined;

      // Options de création
      const options: ArchiveCreateOptions = {
        files: files,
        outputPath: outputPath,
        compressionLevel: numericLevel,
        solidArchive: settings?.solidArchive !== undefined ? settings.solidArchive : true,
        multithreading: settings?.multithreading !== undefined ? settings.multithreading : true,
        workingDirectory: settings?.workingDirectory
      };
      
      await handler.create(options);
      
      this.emitProgress({
        type: 'complete',
        archivePath: outputPath,
        operation: 'create',
        totalFiles: files.length
      });
      
      return outputPath;
      
    } catch (error: any) {
      this.emitProgress({
        type: 'error',
        archivePath: outputPath,
        operation: 'create',
        error: error
      });
      throw error;
    }
  }
  
  /**
   * Convertit une archive d'un format à un autre
   * 
   * @param sourcePath Archive source
   * @param targetFormat Format cible
   * @param outputPath Chemin de sortie (optionnel)
   * @param settings Paramètres de création
   */
  async convertArchive(
    sourcePath: string, 
    targetFormat: ArchiveFormat,
    outputPath?: string,
    settings?: {
      compressionLevel?: 'fastest' | 'normal' | 'maximum';
      solidArchive?: boolean;
      multithreading?: boolean;
    }
  ): Promise<string> {
    this.emitProgress({
      type: 'start',
      archivePath: sourcePath,
      operation: 'convert'
    });
    
    // Créer un dossier temporaire pour l'extraction
    const tempDir = path.join(os.tmpdir(), 'archive_convert_' + Date.now());
    await fs.mkdir(tempDir, { recursive: true });
    
    try {
      // Extraire l'archive source
      await this.extractArchive(sourcePath, tempDir);
      
      // Lister tous les fichiers extraits récursivement
      const extractedFiles = await this.getAllFiles(tempDir);
      
      // Déterminer le chemin de sortie
      if (!outputPath) {
        const baseName = path.basename(sourcePath, path.extname(sourcePath));
        const ext = this.formatToExtension.get(targetFormat)!;
        outputPath = path.join(path.dirname(sourcePath), baseName + ext);
      }
      
      // Créer la nouvelle archive
      const result = await this.createArchive(extractedFiles, outputPath, settings, targetFormat);
      
      this.emitProgress({
        type: 'complete',
        archivePath: sourcePath,
        operation: 'convert'
      });
      
      return result;
      
    } catch (error: any) {
      this.emitProgress({
        type: 'error',
        archivePath: sourcePath,
        operation: 'convert',
        error: error
      });
      throw error;
    } finally {
      // Nettoyer le dossier temporaire
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (error) {
        console.warn('Failed to clean up temp directory:', error);
      }
    }
  }
  
  /**
   * Optimise une archive existante
   * Re-compresse avec de meilleurs paramètres ou convertit vers un meilleur format
   * 
   * @param archivePath Archive à optimiser
   * @param settings Paramètres d'optimisation
   */
  async optimizeArchive(
    archivePath: string,
    settings: {
      archiveFormatPriority?: ArchiveFormat[];
      recreateArchivesIfNeeded?: boolean;
      useBestCompression?: boolean;
      compressionLevel?: 'fastest' | 'normal' | 'maximum';
      solidArchive?: boolean;
      multithreading?: boolean;
    }
  ): Promise<void> {
    if (!settings.recreateArchivesIfNeeded) {
      console.log('Archive optimization disabled by user settings');
      return;
    }
    
    this.emitProgress({
      type: 'start',
      archivePath: archivePath,
      operation: 'optimize'
    });
    
    try {
      const currentFormat = this.getArchiveFormat(archivePath);
      if (!currentFormat) {
        throw new Error(`Unknown archive format: ${archivePath}`);
      }
      
      // Déterminer si on peut faire mieux
      const betterFormat = this.getBetterFormat(
        currentFormat, 
        settings.archiveFormatPriority || ['7z', 'zip']
      );
      
      if (betterFormat && settings.useBestCompression) {
        // Convertir vers un meilleur format
        console.log(`Converting ${currentFormat} to ${betterFormat} for better compression`);
        
        const tempPath = archivePath + '.optimized';
        await this.convertArchive(archivePath, betterFormat, tempPath, settings);
        
        // Comparer les tailles
        const originalSize = (await fs.stat(archivePath)).size;
        const newSize = (await fs.stat(tempPath)).size;
        
        if (newSize < originalSize) {
          // Remplacer l'original
          await fs.unlink(archivePath);
          await fs.rename(tempPath, archivePath.replace(path.extname(archivePath), this.formatToExtension.get(betterFormat)!));
          console.log(`✅ Archive optimized: ${((1 - newSize / originalSize) * 100).toFixed(2)}% size reduction`);
        } else {
          // Garder l'original
          await fs.unlink(tempPath);
          console.log('Original archive already optimal');
        }
      } else {
        // Re-compresser avec les paramètres actuels
        console.log(`Re-compressing ${currentFormat} with better settings`);
        
        const tempPath = archivePath + '.optimized';
        await this.convertArchive(archivePath, currentFormat, tempPath, settings);
        
        // Comparer les tailles
        const originalSize = (await fs.stat(archivePath)).size;
        const newSize = (await fs.stat(tempPath)).size;
        
        if (newSize < originalSize) {
          // Remplacer l'original
          await fs.unlink(archivePath);
          await fs.rename(tempPath, archivePath);
          console.log(`✅ Archive re-compressed: ${((1 - newSize / originalSize) * 100).toFixed(2)}% size reduction`);
        } else {
          // Garder l'original
          await fs.unlink(tempPath);
          console.log('Original archive already optimal');
        }
      }
      
      this.emitProgress({
        type: 'complete',
        archivePath: archivePath,
        operation: 'optimize'
      });
      
    } catch (error: any) {
      this.emitProgress({
        type: 'error',
        archivePath: archivePath,
        operation: 'optimize',
        error: error
      });
      throw error;
    }
  }
  
  /**
   * Efface les commentaires d'une archive
   * Fonctionne uniquement pour les formats qui supportent les commentaires (ZIP)
   * 
   * @param archivePath Chemin de l'archive
   */
  async clearArchiveComments(archivePath: string): Promise<void> {
    const handler = this.getHandler(archivePath);
    if (!handler) {
      throw new Error(`Unsupported archive format: ${archivePath}`);
    }
    
    if (!handler.canWrite()) {
      throw new Error(`Cannot modify ${archivePath} (read-only format)`);
    }
    
    if (!handler.canHandleComments || !handler.canHandleComments()) {
      console.log(`Format ${this.getArchiveFormat(archivePath)} does not support comments`);
      return;
    }
    
    if (!handler.clearComments) {
      throw new Error(`clearComments not implemented for this handler`);
    }
    
    this.emitProgress({
      type: 'start',
      archivePath: archivePath,
      operation: 'clearComments'
    });
    
    try {
      await handler.clearComments(archivePath);
      
      this.emitProgress({
        type: 'complete',
        archivePath: archivePath,
        operation: 'clearComments'
      });
    } catch (error: any) {
      this.emitProgress({
        type: 'error',
        archivePath: archivePath,
        operation: 'clearComments',
        error: error
      });
      throw error;
    }
  }
  
  /**
   * Ajoute des fichiers à une archive existante
   * Fonctionne uniquement pour les formats qui supportent la modification (ZIP, 7z)
   * 
   * @param archivePath Chemin de l'archive
   * @param files Fichiers à ajouter (chemins absolus)
   * @param compressionLevel Niveau de compression optionnel
   */
  async addFilesToArchive(archivePath: string, files: string[], compressionLevel?: number): Promise<void> {
    const handler = this.getHandler(archivePath);
    if (!handler) {
      throw new Error(`Unsupported archive format: ${archivePath}`);
    }
    
    if (!handler.canWrite()) {
      throw new Error(`Cannot modify ${archivePath} (read-only format)`);
    }
    
    if (!handler.addFiles) {
      throw new Error(`addFiles not implemented for this handler`);
    }
    
    this.emitProgress({
      type: 'start',
      archivePath: archivePath,
      operation: 'add',
      totalFiles: files.length
    });
    
    try {
      await handler.addFiles({ archivePath, files, compressionLevel });
      
      this.emitProgress({
        type: 'complete',
        archivePath: archivePath,
        operation: 'add',
        totalFiles: files.length
      });
    } catch (error: any) {
      this.emitProgress({
        type: 'error',
        archivePath: archivePath,
        operation: 'add',
        error: error
      });
      throw error;
    }
  }
  
  /**
   * Supprime des fichiers d'une archive existante
   * Fonctionne uniquement pour les formats qui supportent la modification (ZIP, 7z)
   * 
   * @param archivePath Chemin de l'archive
   * @param files Noms des fichiers à supprimer (chemins relatifs dans l'archive)
   */
  async deleteFilesFromArchive(archivePath: string, files: string[]): Promise<void> {
    const handler = this.getHandler(archivePath);
    if (!handler) {
      throw new Error(`Unsupported archive format: ${archivePath}`);
    }
    
    if (!handler.canWrite()) {
      throw new Error(`Cannot modify ${archivePath} (read-only format)`);
    }
    
    if (!handler.deleteFiles) {
      throw new Error(`deleteFiles not implemented for this handler`);
    }
    
    this.emitProgress({
      type: 'start',
      archivePath: archivePath,
      operation: 'delete',
      totalFiles: files.length
    });
    
    try {
      await handler.deleteFiles({ archivePath, files });
      
      this.emitProgress({
        type: 'complete',
        archivePath: archivePath,
        operation: 'delete',
        totalFiles: files.length
      });
    } catch (error: any) {
      this.emitProgress({
        type: 'error',
        archivePath: archivePath,
        operation: 'delete',
        error: error
      });
      throw error;
    }
  }
  
  /**
   * Récupère récursivement tous les fichiers d'un dossier
   */
  private async getAllFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isFile()) {
        files.push(fullPath);
      } else if (entry.isDirectory()) {
        const subFiles = await this.getAllFiles(fullPath);
        files.push(...subFiles);
      }
    }
    
    return files;
  }
  
  /**
   * Détermine s'il existe un meilleur format selon la priorité
   */
  private getBetterFormat(
    currentFormat: ArchiveFormat, 
    priority: ArchiveFormat[]
  ): ArchiveFormat | null {
    const currentIndex = priority.indexOf(currentFormat);
    
    if (currentIndex > 0) {
      // Il y a un format préféré
      return priority[0];
    }
    
    return null;
  }
  
  /**
   * Émet un événement de progression
   */
  private emitProgress(event: ArchiveProgressEvent): void {
    this.emit('progress', event);
  }
  
  /**
   * Configure le chemin vers chdman
   */
  setChdmanPath(chdmanPath: string): void {
    const handler = this.getHandlerByFormat('chd');
    if (handler && handler instanceof ChdHandler) {
      handler.setPath(chdmanPath);
    }
  }
  
  /**
   * Configure le chemin vers 7zip
   */
  setSevenZipPath(sevenZipPath: string): void {
    const handler = this.getHandlerByFormat('7z');
    if (handler && handler instanceof SevenZipHandler) {
      handler.setPath(sevenZipPath);
    }
  }
  
  /**
   * Configure les chemins vers les outils RAR
   */
  setRarToolPaths(paths: { sevenZip?: string; winrar?: string; unrar?: string }): void {
    const handler = this.getHandlerByFormat('rar');
    if (handler && handler instanceof RarHandler) {
      handler.setToolPaths(paths);
      console.log('🔧 RAR tool paths configured:', paths);
    }
  }
  
  /**
   * Configure l'ordre de priorité des outils RAR
   */
  setRarToolPriority(priority: Array<'7zip' | 'winrar' | 'unrar'>): void {
    const handler = this.getHandlerByFormat('rar');
    if (handler && handler instanceof RarHandler) {
      handler.setToolPriority(priority);
      console.log('🔧 RAR tool priority order configured:', priority);
    }
  }
}

// Export d'une instance singleton
export const archiveManager = new ArchiveManager();
