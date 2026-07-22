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
  compressionLevel?: number;    // Niveau de compression numérique de l'archive
  hasComment?: boolean;         // L'archive contient-elle un commentaire ?
  hasGlobalComment?: boolean;   // L'archive a-t-elle un commentaire global ?
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
  files: string[];              // Fichiers à archiver (chemins absolus ou relatifs à workingDirectory)
  outputPath: string;           // Chemin de sortie de l'archive
  compressionLevel?: number;    // Niveau de compression (si applicable)
  solidArchive?: boolean;       // Archive solide (7z uniquement)
  multithreading?: boolean;     // Utiliser le multithreading
  /**
   * Répertoire de travail pour l'opération 7z (option `$cwd`). Quand défini,
   * les chemins dans `files` doivent être RELATIFS à ce répertoire — 7z
   * préservera la structure des sous-dossiers dans l'archive. Sans ça, 7z
   * strippe les chemins et deux fichiers portant le même nom dans des sous-dossiers
   * différents provoquent une erreur "Duplicate filename on disk".
   * Nécessaire pour Phase 6 (consolidation merged avec sous-dossiers {clone}/).
   */
  workingDirectory?: string;
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
 * Options pour ajouter des fichiers à une archive
 */
export interface ArchiveAddOptions {
  archivePath: string;          // Chemin de l'archive cible
  files: string[];              // Fichiers à ajouter (chemins absolus)
  compressionLevel?: number;    // Niveau de compression (si applicable)
}

/**
 * Options pour supprimer des fichiers d'une archive
 */
export interface ArchiveDeleteOptions {
  archivePath: string;          // Chemin de l'archive cible
  files: string[];              // Noms des fichiers à supprimer (chemins relatifs dans l'archive)
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
   * @returns Liste des fichiers contenus dans l'archive (avec niveau de compression et présence de commentaires si disponibles)
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
   * Vérifie si ce handler supporte les commentaires d'archive
   * @returns true si le handler supporte les commentaires
   */
  canHandleComments?(): boolean;
  
  /**
   * Efface les commentaires d'une archive
   * @param archivePath Chemin de l'archive
   */
  clearComments?(archivePath: string): Promise<void>;
  
  /**
   * Ajoute des fichiers à une archive existante
   * @param options Options d'ajout
   */
  addFiles?(options: ArchiveAddOptions): Promise<void>;
  
  /**
   * Supprime des fichiers d'une archive existante
   * @param options Options de suppression
   */
  deleteFiles?(options: ArchiveDeleteOptions): Promise<void>;
  
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
  operation: 'list' | 'extract' | 'create' | 'convert' | 'optimize' | 'add' | 'delete' | 'clearComments';
  progress?: number;           // 0-100
  currentFile?: string;
  totalFiles?: number;
  processedFiles?: number;
  error?: Error;
}
