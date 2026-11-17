// src/main/handlers/dialog.handlers.ts

import { IpcMain, dialog, BrowserWindow } from 'electron';

export function registerDialogHandlers(ipcMain: IpcMain, mainWindow: BrowserWindow) {
  
  // Handler pour ouvrir un fichier
  ipcMain.handle('dialog:open-file', async (_event, options?: {
    title?: string;
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    multiSelections?: boolean;
  }) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: options?.title || 'Sélectionner un fichier',
      defaultPath: options?.defaultPath,
      filters: options?.filters || [
        { name: 'Tous les fichiers', extensions: ['*'] }
      ],
      properties: options?.multiSelections ? ['openFile', 'multiSelections'] : ['openFile']
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return null;
    }

    // Si multiSelections est false, retourner une seule string, sinon un tableau
    return options?.multiSelections ? result.filePaths : result.filePaths[0];
  });

  // Handler pour sélectionner un dossier
  ipcMain.handle('dialog:select-folder', async (event, options?: {
    title?: string;
    defaultPath?: string;
    multiSelections?: boolean;
  }) => {
    // Rattacher le dialogue à la fenêtre appelante (ex. écran de chargement DAT),
    // sinon il s'ouvre derrière elle, attaché à la fenêtre principale
    const parent = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const result = await dialog.showOpenDialog(parent, {
      title: options?.title || 'Sélectionner un dossier',
      defaultPath: options?.defaultPath,
      properties: options?.multiSelections 
        ? ['openDirectory', 'multiSelections'] 
        : ['openDirectory']
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return null;
    }

    // Si multiSelections est false, retourner une seule string, sinon un tableau
    return options?.multiSelections ? result.filePaths : result.filePaths[0];
  });

  // Handler pour sauvegarder un fichier
  ipcMain.handle('dialog:save-file', async (_event, options?: {
    title?: string;
    defaultPath?: string;
    defaultName?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: options?.title || 'Enregistrer sous',
      defaultPath: options?.defaultPath 
        ? (options.defaultName 
          ? `${options.defaultPath}/${options.defaultName}` 
          : options.defaultPath)
        : options?.defaultName,
      filters: options?.filters || [
        { name: 'Tous les fichiers', extensions: ['*'] }
      ]
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    return result.filePath;
  });

  // Handler pour afficher une boîte de dialogue
  ipcMain.handle('dialog:show-message', async (_event, options: {
    type: 'none' | 'info' | 'error' | 'question' | 'warning';
    title: string;
    message: string;
    detail?: string;
    buttons?: string[];
    defaultId?: number;
    cancelId?: number;
    noLink?: boolean;
  }) => {
    return await dialog.showMessageBox(mainWindow, options);
  });
  
  // Handler pour afficher une boîte de dialogue d'erreur
  ipcMain.handle('dialog:show-error', async (_event, title: string, content: string) => {
    dialog.showErrorBox(title, content);
  });
}
