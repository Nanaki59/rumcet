// preload.ts - VERSION COMPLÈTE AVEC NOUVELLES APIs
import { contextBridge, ipcRenderer } from 'electron';

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

contextBridge.exposeInMainWorld('api', {
  // ========================================
  // API de boîtes de dialogue génériques
  // ========================================
  
  openFileDialog: (options?: {
    title?: string;
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    multiSelections?: boolean;
  }) => ipcRenderer.invoke('dialog:open-file', {
    ...options,
    properties: options?.multiSelections ? ['openFile', 'multiSelections'] : ['openFile']
  }),

  saveFileDialog: (options?: {
    title?: string;
    defaultPath?: string;
    defaultName?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }) => ipcRenderer.invoke('dialog:save-file', options),

  selectFolderDialog: (options?: {
    title?: string;
    defaultPath?: string;
    multiSelections?: boolean;
  }) => ipcRenderer.invoke('dialog:select-folder', options),

  showMessageBox: (options: any) => ipcRenderer.invoke('dialog:show-message', options),

  // ========================================
  // API Archives - Gestion complète et centralisée
  // ========================================

  archive: {
    // Détection et configuration des outils
    detectTools: () => 
      ipcRenderer.invoke('archive:detect-tools'),
    
    checkChdmanAvailable: () => 
      ipcRenderer.invoke('archive:check-chdman-available'),
    
    setChdmanPath: () => 
      ipcRenderer.invoke('archive:set-chdman-path'),
    
    set7ZipPath: () => 
      ipcRenderer.invoke('archive:set-7zip-path'),
    
    setRarToolPath: (toolType: 'unrar' | 'sevenZip' | 'winrar') => 
      ipcRenderer.invoke('archive:set-rar-tool-path', toolType),
    
    // Opérations sur archives
    list: (archivePath: string) => 
      ipcRenderer.invoke('archive:list', archivePath),
    
    extract: (archivePath: string, outputDir: string, files?: string[]) => 
      ipcRenderer.invoke('archive:extract', archivePath, outputDir, files),
    
    create: (files: string[], outputPath: string, settings?: any) => 
      ipcRenderer.invoke('archive:create', files, outputPath, settings),
    
    isArchive: (filePath: string) => 
      ipcRenderer.invoke('archive:is-archive', filePath),
    
    getFormat: (filePath: string) => 
      ipcRenderer.invoke('archive:get-format', filePath),
    
    // Conversions CHD
    convertToChdBatch: (filePaths: string[]) => 
      ipcRenderer.invoke('archive:convert-to-chd-batch', filePaths),

    clearArchiveComments: (archivePath: string) =>
      ipcRenderer.invoke('archive:clear-comments', archivePath),
  
    addFilesToArchive: (archivePath: string, files: string[], compressionLevel?: number) =>
      ipcRenderer.invoke('archive:add-files', archivePath, files, compressionLevel),
    
    deleteFilesFromArchive: (archivePath: string, files: string[]) =>
      ipcRenderer.invoke('archive:delete-files', archivePath, files),
    
    // Événements de progression
    onProgress: (callback: (event: any) => void) => {
      ipcRenderer.on('archive-progress', (_event, data) => callback(data));
    }
  },

  // ========================================
  // API Compatibilité des archives par système
  // ========================================

  archiveCompat: {
    // Obtenir la configuration de compatibilité pour un système
    getConfig: (systemId: string) => 
      ipcRenderer.invoke('archive-compat:get-config', systemId),
    
    // Vérifier si un format est supporté par un système
    checkFormat: (systemId: string, format: string) => 
      ipcRenderer.invoke('archive-compat:check-format', systemId, format),
    
    // Obtenir le format recommandé pour un système
    getRecommended: (systemId: string) => 
      ipcRenderer.invoke('archive-compat:get-recommended', systemId),
    
    // Obtenir tous les formats compatibles pour un système
    getAllCompatible: (systemId: string) => 
      ipcRenderer.invoke('archive-compat:get-all-compatible', systemId),
    
    // Obtenir la liste de tous les systèmes configurés
    getAllSystems: () => 
      ipcRenderer.invoke('archive-compat:get-all-systems'),
    
    // Configuration personnalisée
    getCustomConfig: (systemId: string) => 
      ipcRenderer.invoke('archive-compat:get-custom-config', systemId),
    
    saveCustomConfig: (systemId: string, config: any) => 
      ipcRenderer.invoke('archive-compat:save-custom-config', systemId, config),
    
    resetConfig: (systemId: string) => 
      ipcRenderer.invoke('archive-compat:reset-config', systemId)
  },

  // ========================================
  // API du workflow principal
  // ========================================

  selectDatFile: () => ipcRenderer.invoke('dat:select-file'),
  createDatabase: (datPath: string, clearExisting?: boolean) => ipcRenderer.invoke('database:create', datPath, clearExisting),
  loadDatFile: (datPath: string) => ipcRenderer.invoke('dat:load', datPath) as Promise<DatLoadResult>,
  // Phase 9 — DAT complémentaire (ex : ROMs + CHDs séparés)
  loadComplementaryDat: () => ipcRenderer.invoke('dat:load-complementary'),
  listDatSources: () => ipcRenderer.invoke('dat:list-sources'),
  updateDat: () => ipcRenderer.invoke('dat:update'),
  getDatUpdateReport: () => ipcRenderer.invoke('dat:get-update-report'),
  getGameDiff: (gameName: string) => ipcRenderer.invoke('dat:get-game-diff', gameName),
  getDisappearedGames: () => ipcRenderer.invoke('dat:get-disappeared-games'),
  selectRomFolders: () => ipcRenderer.invoke('roms:select-folders'),
  addRomsFolder: (folderPaths: string | string[], options?: { mode?: 'quick' | 'full' }) => ipcRenderer.invoke('roms:add', folderPaths, options),
  cancelRomScan: () => ipcRenderer.invoke('roms:cancel-scan'),
  forceCancelRomScan: () => ipcRenderer.invoke('roms:force-cancel-scan'),
  quickLoadDatabase: (datPath: string) => ipcRenderer.invoke('database:quick-load', datPath),
  
  // Nouvelles fonctions pour ouvrir/fermer une DB
  openDatabase: () => ipcRenderer.invoke('database:open') as Promise<DatabaseOpenResult | null>,
  closeDatabase: () => ipcRenderer.invoke('database:close'),

  // Métadonnées de la base
  getDbMetadata: (key: string) => ipcRenderer.invoke('database:get-metadata', key) as Promise<string | null>,
  setDbMetadata: (key: string, value: string) => ipcRenderer.invoke('database:set-metadata', key, value),

  // Dossier cible effectif (avec sous-dossier système si mode multi-système)
  getEffectiveValidatedFolder: () => ipcRenderer.invoke('database:get-effective-validated-folder') as Promise<string>,
  getDbFolderSettings: () => ipcRenderer.invoke('database:get-folder-settings'),
  setDbFolderSettings: (input: {
    targetFolder: string;
    targetSystemSubfolder: boolean;
    unmatchedFolder?: string;
    incompleteFolder?: string;
    tempFolder?: string;
  }) => ipcRenderer.invoke('database:set-folder-settings', input),

  // Fonction pour supprimer un dossier
  removeFolder: (folderPath: string) => ipcRenderer.invoke('roms:remove-folder', folderPath),
  deleteFolder: (folderPath: string): Promise<boolean> => ipcRenderer.invoke('folder:delete', folderPath),

  // Retirer un fichier de la base (sans toucher au fichier physique)
  removeFile: (filePath: string) => ipcRenderer.invoke('roms:remove-file', filePath),
  // Supprimer physiquement un fichier (corbeille)
  deleteFile: (filePath: string): Promise<boolean> => ipcRenderer.invoke('file:delete', filePath),

  // ========================================
  // API de données
  // ========================================

  listGames: (systemId?: number) => ipcRenderer.invoke('games:list', systemId),
  listRomsByGame: (gameId: number) => ipcRenderer.invoke('roms:list-by-game', gameId),
  listDependents: (gameId: number) => ipcRenderer.invoke('games:list-dependents', gameId),
  updateGameSelection: (gameId: number, isSelected: boolean) => ipcRenderer.invoke('games:update-selection', gameId, isSelected),
  updateGameSelectionBulk: (gameIds: number[], isSelected: boolean) => ipcRenderer.invoke('games:update-selection-bulk', gameIds, isSelected),
  resolveDependencies: () => ipcRenderer.invoke('dependencies:resolve'),
  listFolderFiles: (folderPath: string) => ipcRenderer.invoke('folder:list-files', folderPath),
  listFolderContents: (folderPath: string, viewMode?: 'hierarchical' | 'flat') => 
    ipcRenderer.invoke('folder:list-contents', folderPath, viewMode),
  getRootFolders: () => ipcRenderer.invoke('folders:get-roots'),

  // ========================================
  // API de matching
  // ========================================
  
  runMatching: () => ipcRenderer.invoke('matching:run'),
  getMissingRoms: () => ipcRenderer.invoke('matching:get-missing'),
  getGameMatchStatuses: () => ipcRenderer.invoke('matching:get-game-statuses'),
  getMatchesForGame: (gameId: number) => ipcRenderer.invoke('matching:get-matches-for-game', gameId),
  getExtraFiles: () => ipcRenderer.invoke('matching:get-extras'),
  getFilesMatchInfo: (fileIds: number[]) => ipcRenderer.invoke('matching:get-files-match-info', fileIds),
  exportMatchingReport: () => ipcRenderer.invoke('matching:export-report'),

  // ========================================
  // API de consolidation
  // ========================================

  runConsolidation: () => ipcRenderer.invoke('consolidation:run'),
  cancelConsolidation: () => ipcRenderer.invoke('consolidation:cancel'),
  forceCancelConsolidation: () => ipcRenderer.invoke('consolidation:force-cancel'),
  getConsolidationLog: () => ipcRenderer.invoke('consolidation:get-log'),
  onConsolidationProgress: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('consolidation-progress', handler);
    // Retourner une fonction pour retirer le listener
    return () => ipcRenderer.removeListener('consolidation-progress', handler);
  },

  // ========================================
  // API de recherche
  // ========================================
  
  searchGlobal: (query: string, scope?: 'all' | 'games' | 'files' | 'archives') => 
    ipcRenderer.invoke('search:global', query, scope || 'all'),
  searchGameRoms: (gameId: number, query: string) => 
    ipcRenderer.invoke('search:game-roms', gameId, query),

  // ========================================
  // API des paramètres utilisateur
  // ========================================

  selectSettingsFolder: (folderType: string) => ipcRenderer.invoke('settings:select-folder', folderType),
  getSettings: () => ipcRenderer.invoke('settings:get-all'),
  updateSettings: (settings: any) => ipcRenderer.invoke('settings:update', settings),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),

  // ========================================
  // API des profils de consolidation
  // ========================================

  profiles: {
    /** Profils et identifiant du profil courant. */
    list: () => ipcRenderer.invoke('profiles:list'),
    /** Change le profil courant (refusé pendant une consolidation). */
    setActive: (id: string) => ipcRenderer.invoke('profiles:set-active', id),
    /** Enregistre l'ensemble des profils (fenêtre des paramètres). */
    saveAll: (profiles: any[]) => ipcRenderer.invoke('profiles:save-all', profiles),
    /** Valeurs par défaut d'un profil intégré (réinitialisation). */
    getBuiltinDefaults: (id: string) => ipcRenderer.invoke('profiles:builtin-defaults', id),
    /** Les profils ou le profil courant ont changé (toutes fenêtres). */
    onChanged: (callback: () => void) => {
      ipcRenderer.on('profiles:changed', () => callback());
    }
  },

  // ========================================
  // API des clone lists (regroupement 1G1R)
  // ========================================

  cloneList: {
    /** État vis-à-vis de la base ouverte : fichier correspondant, application, dossier. */
    getStatus: () => ipcRenderer.invoke('clone-list:get-status'),
    /**
     * Synchronise (requête conditionnelle) puis applique la liste du DAT ouvert.
     * `force` ignore l'ETag connu pour retélécharger dans tous les cas.
     */
    sync: (options?: { force?: boolean }) => ipcRenderer.invoke('clone-list:sync', options),
    /** Retire les regroupements posés par une liste. */
    clear: () => ipcRenderer.invoke('clone-list:clear'),
    listLocal: () => ipcRenderer.invoke('clone-list:list-local')
  },

  // ========================================
  // API de téléchargement de DAT
  // ========================================

  getDownloadSystems: () => ipcRenderer.invoke('dat-download:get-systems'),
  getMameVersions: () => ipcRenderer.invoke('dat-download:get-mame-versions'),
  getPleasuredomeDats: () => ipcRenderer.invoke('dat-download:get-pleasuredome-dats'),
  downloadDat: (params: any) => ipcRenderer.invoke('dat-download:download', params),
  openDatPage: (params: any) => ipcRenderer.invoke('dat-download:open-page', params),
  openDatDownloadWindow: () => ipcRenderer.invoke('dat-download:open-window'),
  openSettingsWindow: (tab?: string) => ipcRenderer.invoke('settings:open-window', tab),
  selectDownloadFolder: (defaultPath?: string) => ipcRenderer.invoke('dat-download:select-folder', defaultPath),

  // ========================================
  // API chdman (version utilisée, mise à jour depuis les releases MAME)
  // ========================================

  chdman: {
    getInfo: () => ipcRenderer.invoke('chdman:get-info'),
    checkUpdate: () => ipcRenderer.invoke('chdman:check-update'),
    update: () => ipcRenderer.invoke('chdman:update'),
    deleteVersion: (tag: string) => ipcRenderer.invoke('chdman:delete-version', tag),
    onUpdateProgress: (callback: (progress: { key: string; params?: Record<string, string | number> }) => void) => {
      ipcRenderer.removeAllListeners('chdman:update-progress');
      ipcRenderer.on('chdman:update-progress', (_event, progress) => callback(progress));
    }
  },

  // ========================================
  // API registre des systèmes (mise à jour Recalbox)
  // ========================================

  systems: {
    getOverlay: () => ipcRenderer.invoke('systems:get-overlay'),
    listRecalboxTags: () => ipcRenderer.invoke('systems:list-recalbox-tags'),
    previewUpdate: (ref: string) => ipcRenderer.invoke('systems:preview-update', ref),
    applyUpdate: (ref: string, systemIds: string[]) => ipcRenderer.invoke('systems:apply-update', ref, systemIds),
    resetToBundled: () => ipcRenderer.invoke('systems:reset-to-bundled'),
    setUserDatSources: (systemId: string, sources: { noIntroId?: string; redumpSlug?: string } | null) =>
      ipcRenderer.invoke('systems:set-user-dat-sources', systemId, sources),
    onUpdated: (callback: () => void) => {
      ipcRenderer.on('systems:updated', () => callback());
    }
  },
  // Écran unifié de chargement DAT (primaire / complémentaire)
  getDatDownloadContext: () => ipcRenderer.invoke('dat-download:get-context'),
  selectLocalDat: () => ipcRenderer.invoke('dat-download:select-local-dat'),
  getDefaultDbPath: (datPath: string) => ipcRenderer.invoke('dat-download:get-default-db-path', datPath),
  browseDbPath: (suggestedPath?: string) => ipcRenderer.invoke('dat-download:browse-db-path', suggestedPath),
  loadDatUnified: (params: { datPath: string; dbPath?: string; overwrite?: boolean; folders?: any }) =>
    ipcRenderer.invoke('dat-download:load', params),
  onDatDownloadLoaded: (callback: (payload: any) => void) => {
    const listener = (_event: any, payload: any) => callback(payload);
    ipcRenderer.on('dat-download:loaded', listener);
    return () => ipcRenderer.removeListener('dat-download:loaded', listener);
  },

  // ========================================
  // API de téléchargement de ROMs
  // ========================================

  downloadRom: (gameIds: number[]) => ipcRenderer.invoke('rom-download:start', gameIds),
  downloadAllMissingRoms: () => ipcRenderer.invoke('rom-download:start-all-missing'),
  cancelRomDownload: () => ipcRenderer.invoke('rom-download:cancel'),
  forceCancelRomDownload: () => ipcRenderer.invoke('rom-download:force-cancel'),
  onRomDownloadProgress: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('rom-download-progress', handler);
    return () => ipcRenderer.removeListener('rom-download-progress', handler);
  },

  // ========================================
  // API des événements et logs
  // ========================================

  onMenuAction: (callback: (action: string) => void) => {
    ipcRenderer.on('menu-action', (_event, action) => callback(action));
  },

  onViewMode: (callback: (mode: string) => void) => {
    ipcRenderer.on('view-mode', (_event, mode) => callback(mode));
  },
  
  onScanProgress: (callback: (data: any) => void) => {
    // Un seul scan à la fois : les trois flux de scan (ajout de dossier, rescan,
    // dossier validé auto) ré-enregistrent leur handler avant chaque scan. Sans
    // nettoyage, les listeners s'accumulaient et chaque événement 'scan-progress'
    // était loggé N fois (triple-log observé). On retire les précédents avant d'ajouter.
    ipcRenderer.removeAllListeners('scan-progress');
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('scan-progress', handler);
    return () => ipcRenderer.removeListener('scan-progress', handler);
  },

  // ========================================
  // API de mise à jour du menu
  // ========================================

  updateMenuState: (state: { canLoadDat: boolean; canAddFolder: boolean; canCloseDatabase: boolean }) => {
    ipcRenderer.send('menu:update-state', state);
  },

  // ========================================
  // API i18n (traductions)
  // ========================================

  getI18n: () => ipcRenderer.invoke('i18n:get'),
  onLanguageChanged: (callback: (language: string) => void) => {
    ipcRenderer.on('i18n:language-changed', (_event, language) => callback(language));
  },

  writeLog: (severity: string, context: string, key: string, params?: Record<string, string | number>) =>
    ipcRenderer.invoke('log:write', severity, context, key, params),
  getLogHistory: () => ipcRenderer.invoke('log:get-history'),
  onLogMessage: (callback: (data: any) => void) => {
    ipcRenderer.on('log-message', (_event, data) => callback(data));
  }
});
