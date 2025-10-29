// src/types/global.d.ts

export type ArchiveFormat = '7z' | 'zip' | 'chd';
export type CompressionLevel = 'fastest' | 'normal' | 'maximum';

export interface AppSettings {
  // Dossiers par défaut
  defaultDatFolder: string;
  defaultDatabaseFolder: string;
  defaultRomsFolder: string;
  unmatchedRomsFolder: string;
  
  // Préférences générales
  theme: 'light' | 'dark';
  language: 'fr' | 'en';
  autoScanOnStartup: boolean;
  
  // Paramètres de compression des archives
  compressionLevel: CompressionLevel;
  recreateArchivesIfNeeded: boolean;
  
  // Liste ordonnée des formats préférés (au lieu d'un seul)
  archiveFormatPriority: ArchiveFormat[];
  // Exemple: ['7z', 'zip', 'chd'] => Essaie 7z d'abord, puis zip, puis chd
  
  // Option "Best compression" (teste tous les formats)
  useBestCompression: boolean;
  
  solidArchive: boolean;
  multithreading: boolean;
  
  // Version des paramètres (pour migrations futures)
  settingsVersion?: number;
}

// Interface pour les résultats de test de compression
export interface CompressionTestResult {
  format: ArchiveFormat;
  size: number;
  duration: number;
  success: boolean;
  error?: string;
}

// Interface décrivant les informations résultant de l'analyse d'un fichier DAT
export interface DatLoadResult {
  success: boolean;
  dbPath: string;
  gamesCount: number;
  romsCount: number;
  datInfo?: {
    name: string;
    description: string;
    version: string;
    date: string;
    author: string;
    homepage: string;
    url: string;
  };
}

// Interface pour l'ouverture d'une base de données existante
export interface DatabaseOpenResult {
  success: boolean;
  dbPath: string;
  datPath: string | null;
  gamesCount: number;
  romsCount: number;
  folders: Array<{
    path: string;
    fileCount: number;
  }>;
  datInfo?: {
    name: string;
    description: string;
    version: string;
    date: string;
    author: string;
    homepage: string;
    url: string;
  };
}

// Interface pour les statistiques de scan
export interface ScanStats {
  length: number;
}

// Interface pour les messages de log
export interface LogMessage {
  severity: string;
  context: string;
  message: string;
}

export interface ArchiveFile {
  name: string;
  path?: string;
  content?: Buffer;
}

export interface ArchiveOperationResult {
  success: boolean;
  message: string;
  archivePath?: string;
  error?: string;
}

export interface ArchiveAPI {
  // Création d'archives
  createArchive: (files: ArchiveFile[], outputPath: string, format?: 'zip' | '7z') => Promise<ArchiveOperationResult>;
  createZip: (files: ArchiveFile[], outputPath: string) => Promise<ArchiveOperationResult>;
  create7z: (files: ArchiveFile[], outputPath: string) => Promise<ArchiveOperationResult>;
  
  // Ajout de fichiers
  addFiles: (archivePath: string, files: ArchiveFile[]) => Promise<ArchiveOperationResult>;
  
  // Suppression de fichiers
  removeFiles: (archivePath: string, fileNames: string[]) => Promise<ArchiveOperationResult>;
  
  // Extraction de fichiers
  extractFiles: (archivePath: string, fileNames: string[], outputDir: string, deleteAfterExtract?: boolean) => Promise<ArchiveOperationResult>;
  
  // Utilitaires
  listContents: (archivePath: string) => Promise<{ success: boolean; files?: string[]; error?: string }>;
  
  // Paramètres (utilise maintenant AppSettings)
  updateSettings: (settings: Partial<AppSettings>) => Promise<{ success: boolean }>;
  getSettings: () => Promise<{
    compressionLevel: 'fastest' | 'normal' | 'maximum';
    recreateArchivesIfNeeded: boolean;
    preferredArchiveFormat: 'zip' | '7z' | 'chd';
    solidArchive: boolean;
    multithreading: boolean;
  }>;
}

// Interface pour les résultats de matching
export interface MatchingResult {
  matches: any[];
  stats: {
    totalDatRoms: number;
    perfectMatches: number;
    goodMatches: number;
    partialMatches: number;
    missingRoms: number;
    extraFiles: number;
  };
}

// Interface pour les contenus de dossiers
export interface FolderContent {
  folders: Array<{
    path: string;
    name: string;
    isFolder: boolean;
    fileCount: number;
  }>;
  files: Array<{
    filePath: string;
    fileName: string;
    size: number;
    hashes: {
      crc32: string;
      md5: string;
      sha1: string;
    };
    isArchive: boolean;
    archiveType?: string;
    contents?: Array<{
      fileName: string;
      size: number;
      hashes?: {
        crc32: string;
        md5: string;
        sha1: string;
      };
    }>;
  }>;
}

// Déclaration globale pour étendre l'interface Window
declare global {
  interface Window {
    api: {
      // ========================================
      // API de boîtes de dialogue génériques
      // ========================================
      
      openFileDialog: (options?: {
        title?: string;
        defaultPath?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
        multiSelections?: boolean;
      }) => Promise<string | string[] | null>;
      
      saveFileDialog: (options?: {
        title?: string;
        defaultPath?: string;
        defaultName?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
      }) => Promise<string | null>;
      
      selectFolderDialog: (options?: {
        title?: string;
        defaultPath?: string;
        multiSelections?: boolean;
      }) => Promise<string | string[] | null>;

      showMessageBox: (options: {
        type: 'none' | 'info' | 'error' | 'question' | 'warning';
        title: string;
        message: string;
        detail?: string;
        buttons?: string[];
        defaultId?: number;
        cancelId?: number;
        noLink?: boolean;
      }) => Promise<{ response: number; checkboxChecked: boolean }>;

      // ========================================
      // API du workflow principal
      // ========================================

      /**
       * Etape 1 - Ouvre une boîte de dialogue pour sélectionner un fichier DAT/XML.
       * @returns Le chemin du fichier sélectionné ou undefined si annulé.
       */
      selectDatFile: () => Promise<string | null>;

      /**
       * Etape 2 - Crée une base de données.
       * @param datPath - Le chemin du fichier DAT associé.
       * @param clearExisting - Si true, efface la base existante.
       * @returns Les informations de la base créée ou null si annulé.
       */
      createDatabase: (datPath: string, clearExisting?: boolean) => Promise<DatLoadResult | null>;

      /**
       * Etape 3 - Charge un fichier DAT/XML dans l'application.
       * @param filePath - Le chemin du fichier DAT/XML à charger.
       * @returns Une promesse qui se résout quand le chargement est terminé.
       */
      loadDatFile: (filePath: string) => Promise<DatLoadResult>;

      /**
       * Etape 4 - Partie 1 - Sélectionner des dossiers de ROMs
       * @returns Les dossiers de ROMs à scanner et à ajouter dans la base de données
       */
      selectRomFolders: () => Promise<string | string[] | null>;

      /**
       * Etape 4 - Partie 2 - Scanne un ou plusieurs dossiers de ROMs et retourne les statistiques.
       * @param folderPaths - Le ou les chemins des dossiers de ROMs à scanner.
       * @returns Les statistiques du scan.
       */
      addRomsFolder: (folderPaths: string | string[]) => Promise<ScanStats>;

      /**
       * Chargement rapide : crée une DB et charge le DAT en une fois.
       * @param datPath - Le chemin du fichier DAT.
       * @returns Les informations de la base créée ou null si annulé.
       */
      quickLoadDatabase: (datPath: string) => Promise<DatLoadResult | null>;

      /**
       * Ouvre une base de données existante.
       * @returns Les informations de la base ouverte ou null si annulé.
       */
      openDatabase: () => Promise<DatabaseOpenResult | null>;

      /**
       * Ferme la base de données actuellement ouverte.
       * @returns true si la base a été fermée, false sinon.
       */
      closeDatabase: () => Promise<boolean>;

      /**
       * Supprime un dossier de la base de données.
       * @param folderPath - Le chemin du dossier à supprimer.
       * @returns true si le dossier a été supprimé.
       */
      removeFolder: (folderPath: string) => Promise<{ success: boolean }>;

      /**
       * Supprime physiquement un dossier (le déplace vers la corbeille).
       * @param folderPath - Le chemin du dossier à supprimer.
       * @returns true si le dossier a été supprimé.
       */
      deleteFolder: (folderPath: string) => Promise<boolean>;

      /**
       * Liste les jeux depuis la base de données.
       * @param systemId - Filtrer par système (optionnel).
       * @returns La liste des jeux.
       */
      listGames: (systemId?: number) => Promise<any[]>;
      
      /**
       * Liste les ROMs d'un jeu spécifique.
       * @param gameId - L'ID du jeu.
       * @returns La liste des ROMs.
       */
      listRomsByGame: (gameId: number) => Promise<any[]>;
      
      /**
       * Liste les fichiers d'un dossier.
       * @param folderPath - Le chemin du dossier.
       * @returns La liste des fichiers.
       */
      listFolderFiles: (folderPath: string) => Promise<any[]>;

      /**
       * Liste le contenu d'un dossier avec support des modes de vue.
       * @param folderPath - Le chemin du dossier.
       * @param viewMode - Mode de vue : hiérarchique ou plat.
       * @returns Le contenu du dossier.
       */
      listFolderContents: (folderPath: string, viewMode?: 'hierarchical' | 'flat') => Promise<FolderContent>;

      /**
       * Récupère les dossiers racines.
       * @returns La liste des dossiers racines.
       */
      getRootFolders: () => Promise<Array<{ path: string; fileCount: number }>>;

      // ========================================
      // API CHD
      // ========================================

      convertToChd: (filePaths: string[]) => Promise<Array<{
        file: string;
        success: boolean;
        message: string;
      }>>;

      extractChd: (chdPath: string, outputPath?: string) => Promise<{
        success: boolean;
        message: string;
      }>;

      getChdInfo: (chdPath: string) => Promise<{
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
      }>;

      verifyChd: (chdPath: string) => Promise<{
        valid: boolean;
        message: string;
      }>;

      checkChdmanAvailable: () => Promise<boolean>;

      setChdmanPath: () => Promise<string | null>;


      // ========================================
      // API Archives
      // ========================================
      archive: ArchiveAPI;


      // ========================================
      // API de matching
      // ========================================
      
      /**
       * Lance le processus de matching des ROMs.
       * @returns Les résultats du matching avec statistiques.
       */
      runMatching: () => Promise<MatchingResult>;
      
      /**
       * Récupère la liste des ROMs manquantes.
       * @returns La liste des ROMs manquantes.
       */
      getMissingRoms: () => Promise<Array<{
        datRomId: number;
        datRomName: string;
        gameName: string;
        matchType: string;
        matchScore: number;
        matchedBy: string[];
      }>>;
      
      /**
       * Récupère la liste des fichiers non matchés.
       * @returns La liste des fichiers extras.
       */
      getExtraFiles: () => Promise<Array<{
        id: number;
        file_name: string;
        file_path: string;
        size: number;
        type: string;
      }>>;
      
      /**
       * Exporte le rapport de matching en CSV.
       * @returns Le résultat de l'export.
       */
      exportMatchingReport: () => Promise<{ success: boolean; filePath: string } | null>;

      // ========================================
      // API de recherche
      // ========================================
      
      /**
       * Recherche globale dans la base de données.
       * @param query - Le terme de recherche.
       * @param scope - La portée de la recherche.
       * @returns Les résultats groupés par type.
       */
      searchGlobal: (query: string, scope?: 'all' | 'games' | 'files' | 'archives') => Promise<{
        games: any[];
        files: any[];
        archives: any[];
      }>;
      
      /**
       * Recherche dans les ROMs d'un jeu spécifique.
       * @param gameId - L'ID du jeu.
       * @param query - Le terme de recherche.
       * @returns La liste des ROMs correspondantes.
       */
      searchGameRoms: (gameId: number, query: string) => Promise<any[]>;

      // ========================================
      // API des paramètres
      // ========================================
      
      selectSettingsFolder: (folderType: string) => Promise<string | null>;
      getSettings: () => Promise<AppSettings>;
      updateSettings: (settings: AppSettings) => Promise<boolean>;
      resetSettings: () => Promise<AppSettings>;
      
      // ========================================
      // API des événements
      // ========================================
      
      onMenuAction: (callback: (action: string) => void) => void;
      onScanProgress: (callback: (data: any) => void) => void;
      onViewMode: (callback: (mode: string) => void) => void;
      
      // ========================================
      // API des logs
      // ========================================
      
      /**
       * Écrit un message dans les logs.
       * @param severity - Le niveau de sévérité (info, warning, error).
       * @param context - Le contexte du log.
       * @param message - Le message à logger.
       */
      writeLog: (severity: string, context: string, message: string) => Promise<void>;
      
      /**
       * Écoute les messages de log envoyés depuis le main process.
       * @param callback - La fonction appelée à chaque message de log.
       */
      onLogMessage: (callback: (data: LogMessage) => void) => void;
      
      /**
       * Récupère l'historique des fichiers de log.
       * @returns La liste des chemins des fichiers de log.
       */
      getLogHistory: () => Promise<string[]>;
    };
  }
}

export {};
