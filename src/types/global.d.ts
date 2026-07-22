// src/types/global.d.ts

export type ArchiveFormat = '7z' | 'zip' | 'chd';
export type CompressionLevel = 'fastest' | 'normal' | 'maximum';
export type CleanupScope = 'used-only' | 'all-matched';
export type RarTool = '7zip' | 'winrar' | 'unrar';
export type Theme = 'light' | 'dark';
export type Language = 'fr' | 'en';

// Manufacturer (ex: 'Sony', 'Nintendo', 'Sega', 'Atari'...). Aligné sur le registre central src/config/systems.ts.
export type SystemCategory = string;
// Type de plateforme tel que défini par Recalbox (console, handheld, arcade, computer).
export type SystemSubcategory = string;

// Interface pour la compatibilité des systèmes
export interface SystemCompatibility {
  systemId: string;
  systemName: string;
  category: SystemCategory;
  subcategory?: SystemSubcategory;
  supportedFormats: ArchiveFormat[];
  warningFormats?: ArchiveFormat[];
  unsupportedFormats?: ArchiveFormat[];
}

// Interface principale des paramètres de l'application
export interface AppSettings {
  // ========================================
  // ONGLET GÉNÉRAL - Interface
  // ========================================
  theme: Theme;
  language: Language;
  
  // ========================================
  // ONGLET GÉNÉRAL - Démarrage
  // ========================================
  autoScanOnStartup: boolean;
  
  // ========================================
  // ONGLET DOSSIERS - Dossiers par défaut
  // ========================================
  defaultDatFolder: string;
  defaultDatabaseFolder: string;
  defaultRomsFolder: string;
  unmatchedRomsFolder: string;
  validatedRomsFolder: string;
  validatedRomsMultiSystem?: boolean;
  tempExtractionFolder: string;

  // ========================================
  // ONGLET CONSOLIDATION - Nettoyage
  // ========================================
  cleanSourceAfterConsolidation: boolean;
  cleanupScope: CleanupScope;
  protectFilesForUnselectedGames: boolean;

  // ========================================
  // ONGLET ARCADE (MAME)
  // ========================================
  arcadeTargetSetMode?: 'split' | 'non-merged' | 'merged';
  /** Ranger les sets BIOS dans un sous-dossier bios/ (DAT MAME). */
  arcadeSeparateBios?: boolean;
  /** Ranger chaque CHD dans un sous-dossier au nom du jeu (DAT MAME). */
  arcadeChdSubfolder?: boolean;
  /** Créer un .zip vide pour les jeux CHD-only (visibilité Recalbox). */
  arcadeChdEmptyZip?: boolean;

  // ========================================
  // ONGLET GÉNÉRAL - Mise à jour DAT
  // ========================================
  autoSelectNewGames: boolean;

  // ========================================
  // ONGLET GÉNÉRAL - Téléchargement DAT (No-Intro defaults)
  // ========================================
  noIntroDefaults?: NoIntroFormParams;

  // ========================================
  // ONGLET TÉLÉCHARGEMENT - Sources et extensions
  // ========================================
  downloadSources?: DownloadSource[];
  downloadExtensions?: string[];
  downloadSystemExtensions?: SystemDownloadExtensions[];
  incompleteRomsFolder?: string;

  // ========================================
  // ONGLET ARCHIVES - Niveau de compression
  // ========================================
  compressionLevel: CompressionLevel;
  
  // ========================================
  // ONGLET ARCHIVES - Ordre de priorité des formats
  // ========================================
  archiveFormatPriority: ArchiveFormat[];
  
  // ========================================
  // ONGLET ARCHIVES - Options avancées
  // ========================================
  recreateArchivesIfNeeded: boolean;
  useBestCompression: boolean;
  solidArchive: boolean;
  multithreading: boolean;
  
  // ========================================
  // ONGLET OUTILS EXTERNES
  // ========================================
  sevenZipPath?: string;
  winrarPath?: string;
  unrarPath?: string;
  chdmanPath?: string;
  useEmbeddedChdman?: boolean;
  rarToolPriority?: RarTool[];
  
  // ========================================
  // ONGLET COMPATIBILITÉ - Compatibilité archives par système
  // ========================================
  systemCompatibility?: SystemCompatibility[];
  
  // ========================================
  // VERSION DES PARAMÈTRES (pour migrations futures)
  // ========================================
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

// Rapport de comparaison entre ancienne et nouvelle version du DAT
export interface DatUpdateReport {
  success: boolean;
  datInfo: {
    name: string;
    description: string;
    version: string;
    date: string;
    author: string;
    homepage: string;
    url: string;
  };
  previousVersion: string;
  previousName: string;
  comparison: {
    newGames: number;
    modifiedGames: number;
    unchangedGames: number;
    disappearedGames: number;
    disappeared: Array<{ name: string; description: string; category: string }>;
  };
}

// Interface pour le résultat de mise à jour DAT (inclut aussi les totaux d'import)
export interface DatUpdateResult extends DatUpdateReport {
  gamesCount: number;
  romsCount: number;
}

// Interface pour le diff ROM d'un jeu
export interface GameDiffResult {
  added: Array<{ name: string; size: number; crc32: string; md5: string; sha1: string }>;
  removed: Array<{ name: string; size: number; crc32: string; md5: string; sha1: string }>;
  changed: Array<{
    name: string;
    old: { name: string; size: number; crc32: string; md5: string; sha1: string };
    new: { name: string; size: number; crc32: string; md5: string; sha1: string };
  }>;
}

// Interface pour un jeu disparu
export interface DisappearedGame {
  id: number;
  name: string;
  description: string;
  category: string;
  is_selected: number;
  roms: Array<{ name: string; size: number; crc32: string }>;
}

// Interfaces pour le téléchargement de fichiers DAT
export interface DatSystemInfo {
  name: string;
  sources: Array<{
    type: 'no-intro' | 'redump';
    id: string;
    recommended: boolean;
  }>;
}

export interface MameVersion {
  version: string;
  date?: string;
  isLatest?: boolean;
  recalboxTag?: string;
  downloadUrl: string;
}

export interface NoIntroFormParams {
  includeBios: boolean;
  includeProto: boolean;
  includeBeta: boolean;
  includeDemo: boolean;
  includeSample: boolean;
}

export interface DatDownloadParams {
  type: 'system' | 'mame' | 'pleasuredome';
  source?: 'no-intro' | 'redump';
  systemId?: string;
  mameVersion?: string;
  /** Pleasuredome : URL directe de l'archive DAT à télécharger. */
  url?: string;
  destFolder: string;
  noIntroParams?: NoIntroFormParams;
}

export interface DatDownloadResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

/** Une entrée DAT listée sur la page MAME de Pleasuredome. */
export interface PleasuredomeDatEntry {
  /** Libellé lisible, ex : "MAME 0.288 ROMs (split)". */
  name: string;
  /** URL absolue de l'archive (zip) contenant le DAT. */
  url: string;
}

// ========================================
// INTERFACES POUR LE TÉLÉCHARGEMENT DE ROMS
// ========================================

export type DownloadExtensionSource = 'global' | 'sysCompressed' | 'datRaw' | 'extraRaw' | 'manual';

export interface DownloadExtensionEntry {
  ext: string;
  source: DownloadExtensionSource;
  isArchive: boolean;
}

export interface ExtensionPickerData {
  activeExtensions: DownloadExtensionEntry[];
}

export interface DownloadSource {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  systems?: DownloadSourceSystem[];
}

export interface DownloadSourceSystem {
  systemId: string;
  subfolder?: string;
  /** Si défini, surcharge la résolution globale pour ce couple source × système. */
  override?: ExtensionPickerData;
}

export type SystemDownloadExtensions = { systemId: string } & ExtensionPickerData;

export interface RomDownloadProgress {
  phase: 'preparing' | 'local-search' | 'downloading' | 'extracting' | 'hashing' | 'matching' | 'consolidating' | 'incomplete' | 'complete';
  currentGame?: string;
  currentGameIndex: number;
  totalGames: number;
  currentSource?: string;
  currentExtension?: string;
  downloadPercent?: number;
  /** Clé i18n du message (résolue dans la langue de l'UI par le renderer). */
  key: string;
  /** Paramètres d'interpolation {nom} de la clé. */
  params?: Record<string, string | number>;
}

export interface RomDownloadGameResult {
  gameName: string;
  success: boolean;
  sourcesUsed?: string[];
  error?: string;
}

export interface RomDownloadResult {
  stats: { totalGames: number; downloaded: number; matched: number; consolidated: number; failed: number };
  results: RomDownloadGameResult[];
}

// Interface pour l'ouverture d'une base de données existante
export interface DatabaseOpenResult {
  success: boolean;
  dbPath: string;
  datPath: string | null;
  gamesCount: number;
  romsCount: number;
  hasMatching: boolean;
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
  /** Clé i18n du message (ou texte brut si la clé n'existe pas dans les dictionnaires). */
  key: string;
  /** Paramètres d'interpolation {nom} de la clé. */
  params?: Record<string, string | number>;
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
  
  // Méthodes pour la configuration des outils
  detectTools: () => Promise<{ sevenZip: string | null; winrar: string | null; unrar: string | null }>;
  checkChdmanAvailable: () => Promise<boolean>;
  set7ZipPath: () => Promise<string | null>;
  setChdmanPath: () => Promise<string | null>;
  setRarToolPath: (toolType: 'unrar' | 'sevenZip' | 'winrar') => Promise<string | null>;
}

// Interface pour l'API de compatibilité des archives
export interface ArchiveCompatAPI {
  getConfig: (systemId: string) => Promise<{
    recommended: string;
    fullySupported: string[];
    partiallySupported?: Array<{
      format: string;
      warning: string;
      emulators?: string[];
    }>;
    notSupported: string[];
  }>;
  checkFormat: (systemId: string, format: string) => Promise<boolean>;
  getRecommended: (systemId: string) => Promise<string>;
  getAllCompatible: (systemId: string) => Promise<string[]>;
  getAllSystems: () => Promise<string[]>;
  getCustomConfig: (systemId: string) => Promise<any>;
  saveCustomConfig: (systemId: string, config: any) => Promise<boolean>;
  resetConfig: (systemId: string) => Promise<any>;
}


// ========================================
// INTERFACES POUR LA CONSOLIDATION
// ========================================

export interface ConsolidationProgress {
  phase: 'preparing' | 'consolidating' | 'moving-unmatched' | 'complete';
  currentGame?: string;
  currentGameIndex: number;
  totalGames: number;
  /** Clé i18n du message (résolue dans la langue de l'UI par le renderer). */
  key: string;
  /** Paramètres d'interpolation {nom} de la clé. */
  params?: Record<string, string | number>;
}

export interface ConsolidationResult {
  stats: {
    totalGamesProcessed: number;
    gamesConsolidated: number;
    gamesSkipped: number;
    gamesErrored: number;
    romsExtracted: number;
    archivesCreated: number;
    unmatchedFilesMoved: number;
  };
  errors: Array<{ gameName: string; error: string }>;
}

// ========================================
// INTERFACES POUR LE MATCHING
// ========================================

/**
 * Interface pour un match de ROM individuel
 */
export interface RomMatch {
  datRomId: number;
  datRomName: string;
  gameName: string;
  gameId: number;
  scannedFileId?: number;          // Fichier physique (loose ou archive)
  scannedFileName?: string;
  scannedFilePath?: string;
  archiveContentId?: number;       // Renseigné si le match vient d'un contenu d'archive
  archiveFileName?: string;
  archiveType?: string;            // 'zip', '7z', 'rar', 'iso', 'cso', 'chd', ou undefined pour fichiers loose
  archiveIsPerfect: boolean;       // L'archive contient toutes les ROMs du jeu
}

/**
 * Interface pour le statut de matching d'un jeu complet
 */
export interface GameMatchStatus {
  gameId: number;
  gameName: string;
  totalRoms: number;
  matchedRoms: number;
  status: 'complete' | 'partial' | 'missing'; // ✅ | ⚠️ | ❌
}

/**
 * Interface pour les statistiques globales de matching
 */
export interface MatchingStats {
  totalGames: number;
  completeGames: number;
  partialGames: number;
  missingGames: number;
  totalDatRoms: number;
  matchedRoms: number;
  missingRoms: number;
  extraFiles: number;
}

/**
 * Interface pour les résultats de matching
 */
export interface MatchingResult {
  matches: RomMatch[];
  gameStatuses: GameMatchStatus[];
  stats: MatchingStats;
}

/**
 * Interface pour les contenus de dossiers
 */
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

// ========================================
// DÉCLARATION GLOBALE DES API POUR ETENDRE L'INTERFACE WINDOW
// ========================================
declare global {
  interface Window {
    // ========================================
    // API GÉNÉRIQUES (window.api)
    // ========================================
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
      // API de gestion des bases de données et DAT
      // ========================================
      
      /**
       * Etape 1 - Sélectionne un fichier DAT/XML et retourne son chemin.
       * @returns Le chemin du fichier DAT sélectionné ou null si annulé.
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
       * Phase 9 — Charge un DAT complémentaire pour étendre la DB active (typiquement
       * un DAT CHDs qui vient s'ajouter à un DAT ROMs déjà chargé, ou un pack BIOS,
       * homebrew, etc.). Ouvre un dialog de sélection de fichier. Les jeux
       * déjà présents en DB voient uniquement leurs ROMs manquantes ajoutées ;
       * les nouveaux jeux sont créés. Retourne un résumé de ce qui a été ajouté,
       * ou null si l'utilisateur a annulé le dialog.
       */
      loadComplementaryDat: () => Promise<{
        success: boolean;
        datPath: string;
        datName: string;
        datVersion: string | null;
        gamesCount: number;
        romsCount: number;
        disksCount: number;
        relationshipsCount: number;
        sourceId: number;
      } | null>;

      /**
       * Phase 9 — Liste des sources DAT chargées dans la DB courante (primaire + complémentaires).
       */
      listDatSources: () => Promise<Array<{
        id: number;
        file_path: string | null;
        role: 'primary' | 'complementary';
        dat_name: string | null;
        dat_description: string | null;
        dat_version: string | null;
        dat_set_mode: string | null;
        games_added: number;
        roms_added: number;
        loaded_at: string;
      }>>;

      /**
       * Mettre à jour le DAT : snapshot, import nouveau DAT, comparaison.
       */
      updateDat: () => Promise<DatUpdateResult | null>;
      getDatUpdateReport: () => Promise<DatUpdateReport | null>;

      /**
       * Obtenir le détail des différences de ROMs pour un jeu modifié.
       */
      getGameDiff: (gameName: string) => Promise<GameDiffResult>;

      /**
       * Obtenir la liste des jeux disparus après une mise à jour DAT.
       */
      getDisappearedGames: () => Promise<DisappearedGame[]>;

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
       * Lire une métadonnée de la base de données.
       */
      getDbMetadata: (key: string) => Promise<string | null>;

      /**
       * Écrire une métadonnée dans la base de données.
       */
      setDbMetadata: (key: string, value: string) => Promise<void>;

      /**
       * Retourne le dossier cible effectif pour les ROMs validées.
       * Si l'option "Dossier multi-système" est activée et qu'un system_id est défini,
       * retourne validatedRomsFolder/<systemId> (et crée le sous-dossier).
       * Sinon retourne validatedRomsFolder tel quel.
       */
      getEffectiveValidatedFolder: () => Promise<string>;

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

      /** Retire un fichier de la base de données (sans toucher au fichier physique). */
      removeFile: (filePath: string) => Promise<{ success: boolean }>;

      /** Supprime physiquement un fichier (le déplace vers la corbeille) + retire de la base. */
      deleteFile: (filePath: string) => Promise<boolean>;

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
       * Met à jour la sélection d'un jeu.
       * @param gameId - L'ID du jeu.
       * @param isSelected - true pour sélectionner, false pour désélectionner.
       */
      updateGameSelection: (gameId: number, isSelected: boolean) => Promise<void>;

      /**
       * Met à jour la sélection de plusieurs jeux.
       * @param gameIds - Les IDs des jeux.
       * @param isSelected - true pour sélectionner, false pour désélectionner.
       */
      updateGameSelectionBulk: (gameIds: number[], isSelected: boolean) => Promise<void>;

      /**
       * Résout les dépendances arcade selon le mode cible du settings.
       * Retourne les IDs auto-sélectionnés (parents, BIOS, devices requis par
       * les jeux user-sélectionnés) avec leurs raisons d'inclusion.
       */
      resolveDependencies: () => Promise<{
        autoIds: number[];
        reasons: Record<number, Array<{ type: string; requiredBy: number; requiredByName: string }>>;
        targetMode?: 'split' | 'non-merged' | 'merged';
      }>;

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
      // API de gestion des archives (NOUVELLES MÉTHODES)
      // ========================================
      
      /**
       * Efface les commentaires d'une archive (ZIP uniquement).
       * @param archivePath - Le chemin de l'archive.
       * @returns Un objet avec le statut de succès.
       */
      clearArchiveComments: (archivePath: string) => Promise<{ success: boolean; error?: string }>;
      
      /**
       * Ajoute des fichiers à une archive existante (ZIP, 7z).
       * @param archivePath - Le chemin de l'archive.
       * @param files - Les chemins des fichiers à ajouter.
       * @param compressionLevel - Le niveau de compression optionnel (0-9).
       * @returns Un objet avec le statut de succès.
       */
      addFilesToArchive: (archivePath: string, files: string[], compressionLevel?: number) => Promise<{ success: boolean; error?: string }>;
      
      /**
       * Supprime des fichiers d'une archive existante (ZIP, 7z).
       * @param archivePath - Le chemin de l'archive.
       * @param files - Les noms des fichiers à supprimer (chemins relatifs dans l'archive).
       * @returns Un objet avec le statut de succès.
       */
      deleteFilesFromArchive: (archivePath: string, files: string[]) => Promise<{ success: boolean; error?: string }>;
      
      // ========================================
      // API de compatibilité des archives
      // ========================================
      archiveCompat: ArchiveCompatAPI;


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
      getMissingRoms: () => Promise<RomMatch[]>;
      
      /**
       * Récupère les statuts de matching pour tous les jeux.
       * @returns La liste des statuts par jeu.
       */
      getGameMatchStatuses: () => Promise<GameMatchStatus[]>;

      /**
       * Récupère les matches d'un jeu spécifique depuis la base de données.
       * Ne relance PAS le matching complet.
       * @param gameId - L'ID du jeu.
       * @returns La liste des matches pour ce jeu.
       */
      getMatchesForGame: (gameId: number) => Promise<RomMatch[]>;
      
      /**
       * Récupère la liste des fichiers non matchés.
       * @returns La liste des fichiers extras.
       */
      /**
       * Récupère les infos de matching pour une liste de fichiers scannés.
       * @param fileIds - Les IDs des fichiers scannés.
       * @returns Un objet indexé par fileId avec les matches loose et archive.
       */
      getFilesMatchInfo: (fileIds: number[]) => Promise<Record<number, {
        looseMatches: Array<{ gameId: number; gameName: string; datRomName: string }>;
        archiveGames: Array<{
          gameId: number;
          gameName: string;
          matchedRoms: number;
          totalRoms: number;
          isPerfect: boolean;
        }>;
        matchedContents: Record<string, Array<{ gameId: number; gameName: string }>>;
      }>>;

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
      // API de consolidation
      // ========================================

      /**
       * Étape 6 - Lance la consolidation des ROMs.
       */
      runConsolidation: () => Promise<ConsolidationResult>;

      /**
       * Récupère le log de consolidation.
       */
      getConsolidationLog: () => Promise<any[]>;

      /**
       * Écoute les événements de progression de la consolidation.
       */
      onConsolidationProgress: (callback: (data: ConsolidationProgress) => void) => () => void;

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
      onScanProgress: (callback: (data: any) => void) => (() => void);
      onViewMode: (callback: (mode: string) => void) => void;

      // ========================================
      // API de téléchargement de DAT
      // ========================================

      getDownloadSystems: () => Promise<DatSystemInfo[]>;
      getMameVersions: () => Promise<MameVersion[]>;
      getPleasuredomeDats: () => Promise<PleasuredomeDatEntry[]>;
      downloadDat: (params: DatDownloadParams) => Promise<DatDownloadResult>;
      openDatPage: (params: DatDownloadParams) => Promise<DatDownloadResult>;
      openDatDownloadWindow: () => Promise<void>;
      selectDownloadFolder: () => Promise<string | null>;

      /**
       * Écran unifié de chargement DAT — contexte : base ouverte ou non
       * (détermine le mode primaire vs complémentaire), infos de la base active,
       * dossier DAT par défaut.
       */
      getDatDownloadContext: () => Promise<{
        dbOpen: boolean;
        dbPath: string | null;
        datName: string | null;
        defaultDatFolder: string;
      }>;
      /** Dialog de sélection d'un fichier DAT/XML local. */
      selectLocalDat: () => Promise<string | null>;
      /** Chemin .sqlite proposé automatiquement à partir du chemin du DAT. */
      getDefaultDbPath: (datPath: string) => Promise<string | null>;
      /** Dialog « Enregistrer sous » pour personnaliser le chemin de la base. */
      browseDbPath: (suggestedPath?: string) => Promise<string | null>;
      /**
       * Flux unifié : crée la base + charge le DAT (primaire) si aucune base
       * n'est ouverte, sinon fusionne en complémentaire dans la base active.
       * Peut retourner { fileExists: true } si la base cible existe déjà et
       * qu'overwrite n'a pas été confirmé.
       */
      loadDatUnified: (params: { datPath: string; dbPath?: string; overwrite?: boolean }) => Promise<any>;
      /** Événement émis vers la fenêtre principale après un chargement réussi. */
      onDatDownloadLoaded: (callback: (payload: any) => void) => () => void;

      // ========================================
      // API de téléchargement de ROMs
      // ========================================

      downloadRom: (gameIds: number[]) => Promise<RomDownloadResult>;
      downloadAllMissingRoms: () => Promise<RomDownloadResult>;
      cancelRomDownload: () => Promise<void>;
      onRomDownloadProgress: (callback: (data: RomDownloadProgress) => void) => () => void;

      // ========================================
      // API de mise à jour du menu
      // ========================================

      /**
       * Met à jour l'état des entrées du menu.
       * @param state - L'état des entrées du menu.
       */
      updateMenuState: (state: { canLoadDat: boolean; canAddFolder: boolean; canCloseDatabase: boolean }) => void;
      
      // ========================================
      // API i18n (traductions)
      // ========================================

      /**
       * Récupère la langue courante et le dictionnaire de traductions aplati
       * (clés pointées, repli déjà appliqué côté main).
       */
      getI18n: () => Promise<{ language: 'fr' | 'en'; messages: Record<string, string> }>;

      /**
       * Écoute le changement de langue (déclenché par la sauvegarde des paramètres).
       * @param callback - Appelé avec le code de la nouvelle langue.
       */
      onLanguageChanged: (callback: (language: string) => void) => void;

      // ========================================
      // API des logs
      // ========================================

      /**
       * Écrit un message dans les logs.
       * @param severity - Le niveau de sévérité (info, warning, error).
       * @param context - Le contexte du log.
       * @param message - Le message à logger.
       */
      writeLog: (severity: string, context: string, key: string, params?: Record<string, string | number>) => Promise<void>;
      
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
