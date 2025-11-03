// src/helpers/archives/types.ts

/**
 * Informations de hash d'un fichier
 */
export interface FileHash {
  crc32: string;
  md5: string;
  sha1: string;
}

/**
 * Contenu d'un fichier dans une archive
 */
export interface ArchiveContent {
  fileName: string;
  size: number;
  hashes?: FileHash;
}

/**
 * Informations complètes sur une archive
 */
export interface ArchiveInfo {
  path: string;
  format: ArchiveFormat;
  contents: ArchiveContent[];
  metadata?: Record<string, any>;
}

/**
 * Formats d'archive supportés
 */
export type ArchiveFormat = 'zip' | '7z' | 'rar' | 'chd' | 'iso' | 'cso';

/**
 * Options pour créer une archive
 */
export interface ArchiveCreateOptions {
  files: string[];              // Fichiers à archiver (chemins absolus)
  outputPath: string;           // Chemin de sortie de l'archive
  compressionLevel?: number;    // Niveau de compression (si applicable)
  solidArchive?: boolean;       // Archive solide (7z uniquement)
  multithreading?: boolean;     // Utiliser le multithreading
}

/**
 * Options pour extraire une archive
 */
export interface ArchiveExtractOptions {
  archivePath: string;          // Chemin de l'archive source
  outputDir: string;            // Dossier de destination
  files?: string[];             // Fichiers spécifiques à extraire (optionnel, sinon tout)
}

/**
 * Interface que tous les handlers d'archive doivent implémenter
 */
export interface IArchiveHandler {
  /**
   * Vérifie si ce handler peut lire le fichier donné
   * @param filePath Chemin du fichier à vérifier
   * @returns true si le handler supporte ce format
   */
  canRead(filePath: string): boolean;
  
  /**
   * Liste le contenu d'une archive
   * @param filePath Chemin de l'archive
   * @returns Liste des fichiers contenus dans l'archive
   */
  list(filePath: string): Promise<ArchiveContent[]>;
  
  /**
   * Extrait une archive
   * @param options Options d'extraction
   */
  extract(options: ArchiveExtractOptions): Promise<void>;
  
  /**
   * Vérifie si ce handler peut écrire/créer des archives
   * @returns true si le handler supporte la création d'archives
   */
  canWrite(): boolean;
  
  /**
   * Crée une nouvelle archive
   * @param options Options de création
   */
  create(options: ArchiveCreateOptions): Promise<void>;
  
  /**
   * Retourne les extensions de fichier supportées par ce handler
   * @returns Liste des extensions (avec le point, ex: ['.zip'])
   */
  getSupportedExtensions(): string[];
}

/**
 * Événements émis pendant les opérations d'archive
 */
export interface ArchiveProgressEvent {
  type: 'start' | 'progress' | 'complete' | 'error';
  archivePath: string;
  operation: 'list' | 'extract' | 'create' | 'convert' | 'optimize';
  progress?: number;           // 0-100
  currentFile?: string;
  totalFiles?: number;
  processedFiles?: number;
  error?: Error;
}
