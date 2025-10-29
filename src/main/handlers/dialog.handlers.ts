// src/main/handlers/dialog.handlers.ts

import { IpcMain, dialog, BrowserWindow } from 'electron';

export function registerDialogHandlers(ipcMain: IpcMain, mainWindow: BrowserWindow) {
  
  // Handler pour afficher une boîte de dialogue
  ipcMain.handle('dialog:show-message', async (_event, options) => {
    return await dialog.showMessageBox(mainWindow, options);
  });
  
  // Handler pour afficher une boîte de dialogue d'erreur
  ipcMain.handle('dialog:show-error', async (_event, title: string, content: string) => {
    dialog.showErrorBox(title, content);
  });
}
