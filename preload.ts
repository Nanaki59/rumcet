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
  }) => ipcRenderer.invoke('dialog:select-folders', {
    ...options,
    properties: options?.multiSelections ? ['openDirectory', 'multiSelections'] : ['openDirectory']
  }),

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
  selectRomFolders: () => ipcRenderer.invoke('roms:select-folders'),
  addRomsFolder: (folderPaths: string | string[]) => ipcRenderer.invoke('roms:add', folderPaths),
  quickLoadDatabase: (datPath: string) => ipcRenderer.invoke('database:quick-load', datPath),
  
  // Nouvelles fonctions pour ouvrir/fermer une DB
  openDatabase: () => ipcRenderer.invoke('database:open') as Promise<DatabaseOpenResult | null>,
  closeDatabase: () => ipcRenderer.invoke('database:close'),

  // Fonction pour supprimer un dossier
  removeFolder: (folderPath: string) => ipcRenderer.invoke('roms:remove-folder', folderPath),
  deleteFolder: (folderPath: string): Promise<boolean> => ipcRenderer.invoke('folder:delete', folderPath),

  // ========================================
  // API de données
  // ========================================

  listGames: (systemId?: number) => ipcRenderer.invoke('games:list', systemId),
  listRomsByGame: (gameId: number) => ipcRenderer.invoke('roms:list-by-game', gameId),
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
  exportMatchingReport: () => ipcRenderer.invoke('matching:export-report'),

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
  // API des événements et logs
  // ========================================

  onMenuAction: (callback: (action: string) => void) => {
    ipcRenderer.on('menu-action', (_event, action) => callback(action));
  },

  onViewMode: (callback: (mode: string) => void) => {
    ipcRenderer.on('view-mode', (_event, mode) => callback(mode));
  },
  
  onScanProgress: (callback: (data: any) => void) => {
    ipcRenderer.on('scan-progress', (_event, data) => callback(data));
  },

  // ========================================
  // API de mise à jour du menu
  // ========================================

  updateMenuState: (state: { canLoadDat: boolean; canAddFolder: boolean; canCloseDatabase: boolean }) => {
    ipcRenderer.send('menu:update-state', state);
  },

  writeLog: (severity: string, context: string, message: string) =>
    ipcRenderer.invoke('log:write', severity, context, message),
  getLogHistory: () => ipcRenderer.invoke('log:get-history'),
  onLogMessage: (callback: (data: any) => void) => {
    ipcRenderer.on('log-message', (_event, data) => callback(data));
  }
});
