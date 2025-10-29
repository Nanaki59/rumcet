// preload.ts
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
  // API CHD
  // ========================================

  convertToChd: (filePaths: string[]) => 
    ipcRenderer.invoke('chd:convert-batch', filePaths),
    
  extractChd: (chdPath: string, outputPath?: string) => 
    ipcRenderer.invoke('chd:extract', chdPath, outputPath),
    
  getChdInfo: (chdPath: string) => 
    ipcRenderer.invoke('chd:info', chdPath),
    
  verifyChd: (chdPath: string) => 
    ipcRenderer.invoke('chd:verify', chdPath),
    
  checkChdmanAvailable: () => 
    ipcRenderer.invoke('chd:check-available'),
    
  setChdmanPath: () => 
    ipcRenderer.invoke('chd:set-path'),


  // ========================================
  // API Archives - Gestion complète des archives
  // ========================================

  archive: {
    // Création d'archives
    createArchive: (files: any[], outputPath: string, format?: 'zip' | '7z') =>
      ipcRenderer.invoke('archive:create', files, outputPath, format),
    
    createZip: (files: any[], outputPath: string) =>
      ipcRenderer.invoke('archive:createZip', files, outputPath),
    
    create7z: (files: any[], outputPath: string) =>
      ipcRenderer.invoke('archive:create7z', files, outputPath),
    
    // Ajout de fichiers à une archive existante
    addFiles: (archivePath: string, files: any[]) =>
      ipcRenderer.invoke('archive:addFiles', archivePath, files),
    
    // Suppression de fichiers d'une archive
    removeFiles: (archivePath: string, fileNames: string[]) =>
      ipcRenderer.invoke('archive:removeFiles', archivePath, fileNames),
    
    // Extraction de fichiers (avec option de suppression)
    extractFiles: (archivePath: string, fileNames: string[], outputDir: string, deleteAfterExtract?: boolean) =>
      ipcRenderer.invoke('archive:extractFiles', archivePath, fileNames, outputDir, deleteAfterExtract),
    
    // Lister le contenu d'une archive
    listContents: (archivePath: string) =>
      ipcRenderer.invoke('archive:listContents', archivePath),
    
    // Paramètres de compression
    updateSettings: (settings: any) =>
      ipcRenderer.invoke('archive:updateSettings', settings),
    
    getSettings: () =>
      ipcRenderer.invoke('archive:getSettings')
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

  writeLog: (severity: string, context: string, message: string) => 
    ipcRenderer.invoke('log:write', severity, context, message),
  getLogHistory: () => ipcRenderer.invoke('log:get-history'),
  onLogMessage: (callback: (data: any) => void) => {
    ipcRenderer.on('log-message', (_event, data) => callback(data));
  }
});
