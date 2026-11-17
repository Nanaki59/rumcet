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

// src/main/handlers/profiles.handlers.ts
// Profils de consolidation : liste, profil courant (fenêtre principale) et
// enregistrement groupé (fenêtre des paramètres).

import { IpcMain, BrowserWindow } from 'electron';
import { settingsManager, type ConsolidationProfile } from '../../helpers/settingsManager.js';
import { isConsolidationRunning } from './consolidation.handlers.js';
import { sendLogToRenderer } from '../utils/logger.js';
import { t } from '../i18n.js';

/** Nom affichable d'un profil (nom saisi, sinon nom traduit d'après l'id). */
export function profileDisplayName(profile: Pick<ConsolidationProfile, 'id' | 'name'>): string {
  return profile.name || t(`profiles.names.${profile.id}`);
}

function broadcastProfilesChanged(): void {
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) win.webContents.send('profiles:changed');
  });
}

export function registerProfilesHandlers(ipcMain: IpcMain, mainWindow: BrowserWindow): void {
  ipcMain.handle('profiles:list', () => settingsManager.listProfiles());

  ipcMain.handle('profiles:set-active', async (_event, id: string) => {
    // La consolidation lit ses paramètres au démarrage, mais changer de profil en
    // cours de route rendrait le récapitulatif et les logs trompeurs.
    if (isConsolidationRunning()) return { success: false, error: 'busy' };
    if (!(await settingsManager.setActiveProfile(id))) return { success: false, error: 'unknown' };

    const profile = settingsManager.listProfiles().profiles.find(p => p.id === id);
    if (profile) {
      sendLogToRenderer(mainWindow, 'info', 'settings', 'logs.profiles.activated', { profile: profileDisplayName(profile) });
    }
    broadcastProfilesChanged();
    return { success: true };
  });

  ipcMain.handle('profiles:save-all', async (_event, profiles: ConsolidationProfile[]) => {
    await settingsManager.replaceProfiles(profiles);
    broadcastProfilesChanged();
    return settingsManager.listProfiles();
  });

  ipcMain.handle('profiles:builtin-defaults', (_event, id: string) => settingsManager.getBuiltinProfileDefaults(id));
}
