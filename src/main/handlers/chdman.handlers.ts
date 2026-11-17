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

// src/main/handlers/chdman.handlers.ts
//
// Version de chdman utilisée (Paramètres → Outils externes) : état courant,
// liste des versions (embarquée + téléchargées), mise à jour depuis la dernière
// release MAME officielle (Windows uniquement) et suppression d'une version.

import { IpcMain, BrowserWindow } from 'electron';
import { archiveManager } from '../../helpers/archives/ArchiveManager.js';
import { settingsManager } from '../../helpers/settingsManager.js';
import { getCurrentChdmanPath, listChdmanVersions, resolveChdmanInfo } from '../../helpers/toolPaths.js';
import {
  deleteDownloadedChdman,
  downloadAndInstallChdman,
  fetchLatestMameRelease,
  isChdmanUpdateSupported
} from '../../helpers/chdmanUpdater.js';
import { sendLogToRenderer, writeLogFile } from '../utils/logger.js';
import type { ChdmanStatus } from '../../types/global.js';

async function getStatus(): Promise<ChdmanStatus> {
  const settings = settingsManager.getAll();
  const [current, versions] = await Promise.all([resolveChdmanInfo(settings), listChdmanVersions()]);
  return {
    current,
    versions: versions.map(({ id, version, source }) => ({ id, version, source })),
    selected: settings.chdmanVersion || 'latest',
    customPath: settings.chdmanPath || '',
    updateSupported: isChdmanUpdateSupported()
  };
}

export function registerChdmanHandlers(ipcMain: IpcMain, mainWindow: BrowserWindow): void {
  let updating = false;

  ipcMain.handle('chdman:get-info', () => getStatus());

  ipcMain.handle('chdman:check-update', async () => {
    try {
      const latest = await fetchLatestMameRelease();
      writeLogFile('info', 'chdman', 'logs.chdman.latestFound', { tag: latest.tag, version: latest.version });
      return { success: true, latest: { tag: latest.tag, version: latest.version, size: latest.size } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeLogFile('error', 'chdman', 'logs.chdman.checkError', { error: message });
      return { success: false, error: message };
    }
  });

  ipcMain.handle('chdman:update', async (event) => {
    if (updating) return { success: false, error: 'An update is already in progress' };
    if (!isChdmanUpdateSupported()) return { success: false, error: 'Unsupported platform' };
    updating = true;
    try {
      const release = await fetchLatestMameRelease();
      writeLogFile('info', 'chdman', 'logs.chdman.latestFound', { tag: release.tag, version: release.version });
      let lastPercent = -1;
      await downloadAndInstallChdman(release, (progress) => {
        if (event.sender.isDestroyed()) return;
        if (progress.step === 'extract') {
          event.sender.send('chdman:update-progress', { key: 'settings.tools.chdmanExtracting' });
          return;
        }
        const percent = progress.total > 0 ? Math.floor((progress.downloaded / progress.total) * 100) : -1;
        if (percent === lastPercent) return;
        lastPercent = percent;
        event.sender.send('chdman:update-progress', {
          key: 'settings.tools.chdmanDownloadProgress',
          params: { percent: Math.max(percent, 0), version: release.version }
        });
      }, (severity, key, params) => { void writeLogFile(severity, 'chdman', key, params); });
      await archiveManager.refreshChdmanPath(settingsManager.getAll());
      sendLogToRenderer(mainWindow, 'info', 'chdman', 'logs.chdman.updated', { version: release.version });
      return { success: true, version: release.version, status: await getStatus() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendLogToRenderer(mainWindow, 'error', 'chdman', 'logs.chdman.updateError', { error: message });
      return { success: false, error: message };
    } finally {
      updating = false;
    }
  });

  ipcMain.handle('chdman:delete-version', async (_event, tag: string) => {
    try {
      const target = (await listChdmanVersions()).find(entry => entry.id === tag && entry.source === 'downloaded');
      if (!target) return { success: false, error: `chdman version not found: ${tag}` };
      if (target.path === getCurrentChdmanPath()) return { success: false, inUse: true };

      await deleteDownloadedChdman(tag);
      if (settingsManager.get('chdmanVersion') === tag) {
        await settingsManager.updateSettings({ chdmanVersion: 'latest' });
      }
      await archiveManager.refreshChdmanPath(settingsManager.getAll());
      sendLogToRenderer(mainWindow, 'info', 'chdman', 'logs.chdman.deleted', { version: target.version || tag });
      return { success: true, status: await getStatus() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
