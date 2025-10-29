// src/main/main.ts
import { app, BrowserWindow, Menu, ipcMain, shell, dialog, MenuItemConstructorOptions } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { settingsManager } from '../helpers/settingsManager.js';
import { logManager } from '../helpers/logManager.js';
import { databaseService } from './services/database.service.js';
import { sendLogToRenderer } from './utils/logger.js';
import fs from 'fs/promises';

// Import des handlers
import { registerChdHandlers } from './handlers/chd.handlers.js';
import { registerDatabaseHandlers } from './handlers/database.handlers.js';
import { registerDatHandlers } from './handlers/dat.handlers.js';
import { registerDialogHandlers } from './handlers/dialog.handlers.js';
import { registerRomsHandlers } from './handlers/roms.handlers.js';
import { registerMatchingHandlers } from './handlers/matching.handlers.js';
import { registerNavigationHandlers } from './handlers/navigation.handlers.js';
import { registerSettingsHandlers } from './handlers/settings.handlers.js';
import { registerSearchHandlers } from './handlers/search.handlers.js';

// Définition de __dirname pour les modules ES6
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Variables globales
let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;

// ==========================================
// Création des fenêtres
// ==========================================

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, '../../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.on('did-fail-load', (_event, _errorCode, errorDescription) => {
    console.error(`Failed to load: ${errorDescription}`);
  });

  mainWindow.webContents.on('preload-error', (_event, _preloadPath, error) => {
    console.error(`Preload error: ${error}`);
  });

  createMenu();
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  registerDialogHandlers(ipcMain, mainWindow);
}

function createSettingsWindow(): void {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 700,
    height: 600,
    parent: mainWindow!,
    modal: true,
    webPreferences: {
      preload: path.join(__dirname, '../../preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, '../renderer/settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// ==========================================
// Menu de l'application
// ==========================================

function createMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Fichier',
      submenu: [
        {
          label: 'Nouvelle base de données...',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            mainWindow?.webContents.send('menu-action', 'new-database');
          }
        },
        {
          label: 'Ouvrir base de données...',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            mainWindow?.webContents.send('menu-action', 'open-database');
          }
        },
        { type: 'separator' },
        {
          label: 'Charger DAT/XML',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            mainWindow?.webContents.send('menu-action', 'load-dat');
          }
        },
        {
          label: 'Ajouter dossier ROMs',
          accelerator: 'CmdOrCtrl+D',
          click: () => {
            mainWindow?.webContents.send('menu-action', 'add-folder');
          }
        },
        { type: 'separator' },
        {
          label: 'Fermer base de données',
          click: () => {
            mainWindow?.webContents.send('menu-action', 'close-database');
          }
        },
        { type: 'separator' },
        {
          label: 'Quitter',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Analyse',
      submenu: [
        {
          label: 'Matcher les ROMs',
          accelerator: 'CmdOrCtrl+M',
          click: () => {
            mainWindow?.webContents.send('menu-action', 'match-roms');
          }
        },
        { type: 'separator' },
        {
          label: 'Afficher les ROMs manquantes',
          click: () => {
            mainWindow?.webContents.send('menu-action', 'show-missing');
          }
        },
        {
          label: 'Afficher les fichiers non matchés',
          click: () => {
            mainWindow?.webContents.send('menu-action', 'show-extras');
          }
        },
        { type: 'separator' },
        {
          label: 'Exporter le rapport de matching...',
          click: () => {
            mainWindow?.webContents.send('menu-action', 'export-report');
          }
        }
      ]
    },
    {
      label: 'Affichage',
      submenu: [
        {
          label: 'Vue hiérarchique',
          type: 'radio',
          checked: true,
          click: () => {
            mainWindow?.webContents.send('view-mode', 'hierarchical');
          }
        },
        {
          label: 'Vue à plat',
          type: 'radio',
          click: () => {
            mainWindow?.webContents.send('view-mode', 'flat');
          }
        }
      ]
    },
    {
      label: 'Édition',
      submenu: [
        { label: 'Annuler', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Rétablir', accelerator: 'CmdOrCtrl+Y', role: 'redo' },
        { type: 'separator' },
        { label: 'Couper', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Copier', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Coller', accelerator: 'CmdOrCtrl+V', role: 'paste' }
      ]
    },
    {
      label: 'Outils',
      submenu: [
        {
          label: 'Paramètres',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            createSettingsWindow();
          }
        },
        { type: 'separator' },
        {
          label: 'Outils de développement',
          accelerator: 'F12',
          click: () => {
            mainWindow?.webContents.toggleDevTools();
          }
        }
      ]
    },
    {
      label: 'Aide',
      submenu: [
        {
          label: 'Documentation',
          click: () => {
            shell.openExternal('https://github.com/Nanaki59/rumcet');
          }
        },
        { type: 'separator' },
        {
          label: 'À propos',
          click: () => {
            dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: 'À propos de RUMCET',
              message: 'RUMCET v1.0.0',
              detail: "ROM's Ultimate Manager, Conversion and Editor Tool\n\nDéveloppé par Nanaki59",
              buttons: ['OK']
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ==========================================
// Handlers IPC pour les logs
// ==========================================

function registerLogHandlers(): void {
  ipcMain.handle('log:write', async (_event, severity: string, context: string, message: string) => {
    // Écrire UNIQUEMENT dans le fichier, PAS d'envoi au renderer ici
    // sinon on crée une boucle infinie
    await logManager.writeFormatted(severity, context, message);
  });

  ipcMain.handle('log:get-history', async () => {
    return await logManager.getLogHistory();
  });
}

// ==========================================
// Initialisation de l'application
// ==========================================

async function setupTools() {
  const toolsDir = path.join(app.getPath('userData'), 'tools');
  const chdmanDest = path.join(toolsDir, 'chdman.exe');
  
  // Créer le dossier tools s'il n'existe pas
  await fs.mkdir(toolsDir, { recursive: true });
  
  // Si chdman n'existe pas, le copier depuis les ressources
  try {
    await fs.access(chdmanDest);
    console.log('chdman.exe déjà présent');
  } catch {
    // Le fichier n'existe pas, essayer de le copier
    const chdmanSource = path.join(__dirname, '../../resources/chdman.exe');
    try {
      await fs.access(chdmanSource);
      await fs.copyFile(chdmanSource, chdmanDest);
      console.log('chdman.exe copié avec succès');
    } catch (error) {
      console.log('chdman.exe non trouvé dans les ressources, l\'utilisateur devra le configurer');
    }
  }
}

async function initializeApp(): Promise<void> {
  // Initialiser les logs AVANT de rediriger console.log
  await logManager.initialize();
  
  // Sauvegarder les fonctions originales
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  
  // NE PAS rediriger console.log/error/warn pour éviter les boucles
  // Les logs de console restent dans la console uniquement
  
  // Charger les paramètres
  await settingsManager.load();
  
  // Créer la fenêtre principale
  createMainWindow();

  // Enregistrer tous les handlers IPC
  if (mainWindow) {
    registerChdHandlers(ipcMain, mainWindow);
    registerDatabaseHandlers(ipcMain, mainWindow);
    registerDatHandlers(ipcMain, mainWindow);
    registerRomsHandlers(ipcMain, mainWindow);
    registerMatchingHandlers(ipcMain, mainWindow);
    registerNavigationHandlers(ipcMain);
    registerSettingsHandlers(ipcMain, mainWindow);
    registerSearchHandlers(ipcMain);
    registerLogHandlers();
  }
}

// ==========================================
// Événements de l'application
// ==========================================

app.whenReady().then(async () => {
  await setupTools();  // Appeler setupTools ici
  await initializeApp();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

app.on('before-quit', async () => {
  // Fermer la base de données
  if (databaseService.getDatabase()) {
    try {
      await databaseService.closeDatabase();
      console.log('Base de données fermée proprement');
    } catch (error) {
      console.error('Erreur lors de la fermeture de la base:', error);
    }
  }
  
  // Fermer les logs
  await logManager.close();
});

export { mainWindow };
