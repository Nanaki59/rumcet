/*
 * RUMCET - ROM's Ultimate Manager, Conversion and Editor Tool
 * Copyright (C) 2025 Nanaki59
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// src/main/main.ts

import { app, BrowserWindow, Menu, ipcMain, shell, dialog, MenuItemConstructorOptions } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { settingsManager } from '../helpers/settingsManager.js';
import { initI18n, t, tEn, getLanguage, getMessages } from './i18n.js';
import { logManager } from '../helpers/logManager.js';
import { databaseService } from './services/database.service.js';
import { sendLogToRenderer } from './utils/logger.js';
import fs from 'fs/promises';

// Import des handlers
import { registerArchiveHandlers } from './handlers/archive.handlers.js';
import { registerDatabaseHandlers } from './handlers/database.handlers.js';
import { registerDatHandlers } from './handlers/dat.handlers.js';
import { registerDialogHandlers } from './handlers/dialog.handlers.js';
import { registerRomsHandlers } from './handlers/roms.handlers.js';
import { registerMatchingHandlers } from './handlers/matching.handlers.js';
import { registerNavigationHandlers } from './handlers/navigation.handlers.js';
import { registerSettingsHandlers } from './handlers/settings.handlers.js';
import { registerSearchHandlers } from './handlers/search.handlers.js';
import { registerConsolidationHandlers } from './handlers/consolidation.handlers.js';
import { registerDatDownloadHandlers } from './handlers/datDownload.handlers.js';
import { registerRomDownloadHandlers } from './handlers/romDownload.handlers.js';

// Définition de __dirname pour les modules ES6
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Variables globales
let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let datDownloadWindow: BrowserWindow | null = null;

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
    }
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

function createDatDownloadWindow(): void {
  if (datDownloadWindow) {
    datDownloadWindow.focus();
    return;
  }

  datDownloadWindow = new BrowserWindow({
    width: 860,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    parent: mainWindow!,
    modal: true,
    webPreferences: {
      preload: path.join(__dirname, '../../preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  datDownloadWindow.loadFile(path.join(__dirname, '../renderer/datDownload.html'));

  datDownloadWindow.on('closed', () => {
    datDownloadWindow = null;
  });
}

// ==========================================
// Menu de l'application
// ==========================================

// État du menu (pour synchronisation avec le renderer)
let menuState = {
  canLoadDat: false,
  canAddFolder: false,
  canCloseDatabase: false
};

function createMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: t('menu.file.label'),
      submenu: [
        {
          label: t('menu.file.openDatabase'),
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            mainWindow?.webContents.send('menu-action', 'open-database');
          }
        },
        {
          label: t('menu.file.downloadDat'),
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => {
            createDatDownloadWindow();
          }
        },
        { type: 'separator' },
        {
          id: 'load-dat',
          label: t('menu.file.loadDat'),
          accelerator: 'CmdOrCtrl+D',
          enabled: menuState.canLoadDat,
          click: () => {
            mainWindow?.webContents.send('menu-action', 'load-dat');
          }
        },
        {
          id: 'add-folder',
          label: t('menu.file.addFolder'),
          accelerator: 'CmdOrCtrl+R',
          enabled: menuState.canAddFolder,
          click: () => {
            mainWindow?.webContents.send('menu-action', 'add-folder');
          }
        },
        { type: 'separator' },
        {
          id: 'close-database',
          label: t('menu.file.closeDatabase'),
          accelerator: 'CmdOrCtrl+Shift+Q',
          enabled: menuState.canCloseDatabase,
          click: () => {
            mainWindow?.webContents.send('menu-action', 'close-database');
          }
        },
        { type: 'separator' },
        {
          label: t('menu.file.quit'),
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: t('menu.analysis.label'),
      submenu: [
        {
          label: t('menu.analysis.matchRoms'),
          accelerator: 'CmdOrCtrl+M',
          click: () => {
            mainWindow?.webContents.send('menu-action', 'match-roms');
          }
        },
        { type: 'separator' },
        {
          label: t('menu.analysis.showMissing'),
          click: () => {
            mainWindow?.webContents.send('menu-action', 'show-missing');
          }
        },
        {
          label: t('menu.analysis.showExtras'),
          click: () => {
            mainWindow?.webContents.send('menu-action', 'show-extras');
          }
        },
        { type: 'separator' },
        {
          label: t('menu.analysis.exportReport'),
          click: () => {
            mainWindow?.webContents.send('menu-action', 'export-report');
          }
        }
      ]
    },
    {
      label: t('menu.view.label'),
      submenu: [
        {
          label: t('menu.view.hierarchical'),
          type: 'radio',
          checked: true,
          click: () => {
            mainWindow?.webContents.send('view-mode', 'hierarchical');
          }
        },
        {
          label: t('menu.view.flat'),
          type: 'radio',
          click: () => {
            mainWindow?.webContents.send('view-mode', 'flat');
          }
        }
      ]
    },
    {
      label: t('menu.edit.label'),
      submenu: [
        { label: t('menu.edit.undo'), accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: t('menu.edit.redo'), accelerator: 'CmdOrCtrl+Y', role: 'redo' },
        { type: 'separator' },
        { label: t('menu.edit.cut'), accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: t('menu.edit.copy'), accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: t('menu.edit.paste'), accelerator: 'CmdOrCtrl+V', role: 'paste' }
      ]
    },
    {
      label: t('menu.tools.label'),
      submenu: [
        {
          label: t('menu.tools.settings'),
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            createSettingsWindow();
          }
        },
        { type: 'separator' },
        {
          label: t('menu.tools.devTools'),
          accelerator: 'F12',
          click: () => {
            mainWindow?.webContents.toggleDevTools();
          }
        }
      ]
    },
    {
      label: t('menu.help.label'),
      submenu: [
        {
          label: t('menu.help.documentation'),
          click: () => {
            shell.openExternal('https://github.com/Nanaki59/rumcet');
          }
        },
        { type: 'separator' },
        {
          label: t('menu.help.about'),
          click: () => {
            dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: t('menu.help.aboutTitle'),
              message: 'RUMCET v1.0.0',
              detail: t('menu.help.aboutDetail'),
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
  ipcMain.handle('log:write', async (_event, severity: string, context: string, key: string, params?: Record<string, string | number>) => {
    // Écrire UNIQUEMENT dans le fichier, PAS d'envoi au renderer ici
    // sinon on crée une boucle infinie.
    // Le fichier est toujours résolu en anglais (clé inconnue → écrite telle quelle).
    await logManager.writeFormatted(severity, context, tEn(key, params));
  });

  ipcMain.handle('log:get-history', async () => {
    return await logManager.getLogHistory();
  });
}

// Handler pour mettre à jour l'état du menu
function registerMenuHandlers(): void {
  ipcMain.on('menu:update-state', (_event, state: { canLoadDat: boolean; canAddFolder: boolean; canCloseDatabase: boolean }) => {
    menuState = state;
    createMenu(); // Recréer le menu avec le nouvel état
  });
}

// ==========================================
// Handlers IPC pour l'i18n
// ==========================================

function registerI18nHandlers(): void {
  // Dictionnaire de traductions demandé par chaque page au chargement
  ipcMain.handle('i18n:get', () => ({
    language: getLanguage(),
    messages: getMessages()
  }));
}

/**
 * Appelé quand la langue change dans les paramètres : recharge les
 * traductions, reconstruit le menu et notifie toutes les fenêtres
 * (qui se rechargent pour re-rendre leurs textes).
 */
function handleLanguageChanged(language: 'fr' | 'en'): void {
  initI18n(language);
  createMenu();
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('i18n:language-changed', language);
  });
}

function registerDatDownloadWindowHandlers(): void {
  ipcMain.handle('dat-download:open-window', () => {
    createDatDownloadWindow();
  });

  ipcMain.handle('dat-download:select-folder', async () => {
    const result = await dialog.showOpenDialog(datDownloadWindow || mainWindow!, {
      properties: ['openDirectory'],
      title: t('dialogs.selectDestinationFolder')
    });
    return result.canceled ? null : result.filePaths[0];
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
    console.log('chdman.exe already present');
  } catch {
    // Le fichier n'existe pas, essayer de le copier
    const chdmanSource = path.join(__dirname, '../../resources/chdman.exe');
    try {
      await fs.access(chdmanSource);
      await fs.copyFile(chdmanSource, chdmanDest);
      console.log('chdman.exe copied successfully');
    } catch (error) {
      console.log('chdman.exe not found in resources, the user will need to configure it');
    }
  }
}

/**
 * Capture les console.log/warn/error du process main (helpers inclus) vers le
 * fichier de logs, en plus de la console. Ces lignes techniques ne sont PAS
 * envoyées au panneau du renderer — elles servent au support/débogage.
 * Garde anti-réentrance : si l'écriture fichier logge elle-même en console,
 * on n'écrit pas une seconde fois (pas de boucle).
 */
function setupConsoleCapture(): void {
  const levels: Array<{ method: 'log' | 'warn' | 'error'; level: string }> = [
    { method: 'log', level: 'debug' },
    { method: 'warn', level: 'warning' },
    { method: 'error', level: 'error' }
  ];

  let capturing = false;
  for (const { method, level } of levels) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);
      // Garde synchrone contre la ré-entrance (les erreurs internes du
      // LogManager passent par rawConsoleError et n'arrivent jamais ici).
      if (capturing) return;
      capturing = true;
      try {
        const line = args
          .map(a => (typeof a === 'string' ? a : a instanceof Error ? `${a.message}\n${a.stack}` : JSON.stringify(a)))
          .join(' ');
        void logManager.writeFormatted(level, 'console', line).catch(() => {});
      } finally {
        capturing = false;
      }
    };
  }
}

async function initializeApp(): Promise<void> {
  // Initialiser le fichier de logs, puis capturer les console.* vers ce fichier
  await logManager.initialize();
  setupConsoleCapture();

  // Charger les paramètres
  await settingsManager.load();

  // Charger les traductions AVANT la création du menu et des fenêtres
  initI18n(settingsManager.get('language'));

  // Créer la fenêtre principale
  createMainWindow();

  // Enregistrer tous les handlers IPC
  if (mainWindow) {
    registerArchiveHandlers(ipcMain, mainWindow);
    registerDatabaseHandlers(ipcMain, mainWindow);
    registerDatHandlers(ipcMain, mainWindow);
    registerDialogHandlers(ipcMain, mainWindow);
    registerRomsHandlers(ipcMain, mainWindow);
    registerMatchingHandlers(ipcMain, mainWindow);
    registerConsolidationHandlers(ipcMain, mainWindow);
    registerNavigationHandlers(ipcMain);
    registerSettingsHandlers(ipcMain, mainWindow, handleLanguageChanged);
    registerSearchHandlers(ipcMain);
    registerDatDownloadHandlers(() => mainWindow);
    registerDatDownloadWindowHandlers();
    registerRomDownloadHandlers(ipcMain, mainWindow);
    registerLogHandlers();
    registerMenuHandlers();
    registerI18nHandlers();
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
      console.log('Database closed cleanly');
    } catch (error) {
      console.error('Error while closing the database:', error);
    }
  }
  
  // Fermer les logs
  await logManager.close();
});

export { mainWindow };
