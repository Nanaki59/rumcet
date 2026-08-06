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

// src/main/handlers/cloneList.handlers.ts
//
// Téléchargement et application des clone lists. La source est un réglage : RUMCET
// consomme des données maintenues ailleurs, et doit pouvoir changer de dépôt sans
// modification de code si celui retenu s'arrête.

import { IpcMain, BrowserWindow, app } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { settingsManager } from '../../helpers/settingsManager.js';
import { databaseService } from '../services/database.service.js';
import { getMetadata, setMetadata } from '../../database/init.js';
import { applyCloneList, readCloneListFile, matchCloneListFile } from '../../helpers/cloneLists.js';
import { sendLogToRenderer } from '../utils/logger.js';

/** Dossier local effectif de dépôt des listes. */
function cloneListsFolder(): string {
  const configured = settingsManager.get('cloneLists')?.folder;
  return configured && configured.trim()
    ? configured
    : path.join(app.getPath('userData'), 'clonelists');
}

/** Noms de fichiers .json présents localement. */
async function localFileNames(): Promise<string[]> {
  try {
    const entries = await fs.readdir(cloneListsFolder());
    return entries.filter(f => f.toLowerCase().endsWith('.json'));
  } catch {
    return [];
  }
}

/**
 * Liste les fichiers disponibles à la source.
 * L'URL configurée pointe le dossier de fichiers bruts ; l'énumération passe par
 * l'API GitHub quand la source est GitHub, seul cas où un index est disponible.
 */
async function remoteFileNames(sourceUrl: string): Promise<string[]> {
  const match = sourceUrl.match(
    /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.*)$/i
  );
  if (!match) {
    throw new Error(
      'Automatic listing is only supported for raw.githubusercontent.com sources. ' +
      'Place the .json files manually in the clone lists folder for any other source.'
    );
  }
  const [, owner, repo, ref, dir] = match;
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${dir.replace(/\/$/, '')}?ref=${ref}`;

  const response = await fetch(apiUrl, {
    headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'RUMCET' }
  });
  if (!response.ok) {
    throw new Error(`Listing failed (HTTP ${response.status})`);
  }
  const entries = await response.json() as Array<{ name: string; type: string }>;
  return entries.filter(e => e.type === 'file' && e.name.toLowerCase().endsWith('.json'))
                .map(e => e.name);
}

export function registerCloneListHandlers(ipcMain: IpcMain, mainWindow: BrowserWindow) {

  // État vis-à-vis de la base ouverte : quelle liste correspond, est-elle présente ?
  ipcMain.handle('clone-list:get-status', async () => {
    const database = databaseService.getDatabase();
    const datName = database ? await getMetadata(database, 'dat_name') : null;
    const datSetMode = database ? await getMetadata(database, 'dat_set_mode') : null;
    const local = await localFileNames();
    const matched = datName ? matchCloneListFile(datName, local) : null;

    let appliedAt: string | null = null;
    let appliedList: string | null = null;
    if (database) {
      appliedAt = await getMetadata(database, 'clone_list_applied_at');
      appliedList = await getMetadata(database, 'clone_list_applied_name');
    }

    return {
      folder: cloneListsFolder(),
      datName,
      // Les DAT arcade portent déjà leurs relations parent/clone : une clone list
      // n'y apporterait rien et ne doit pas être proposée.
      isArcade: !!(datSetMode && datSetMode !== 'n/a'),
      localCount: local.length,
      matchedFile: matched,
      appliedAt,
      appliedList,
      lastDownload: settingsManager.get('cloneLists')?.lastDownload ?? null
    };
  });

  // Téléchargement. Sans argument, télécharge la liste correspondant au DAT ouvert.
  ipcMain.handle('clone-list:download', async (_event, fileName?: string) => {
    const settings = settingsManager.get('cloneLists');
    const sourceUrl = settings?.sourceUrl;
    if (!sourceUrl) throw new Error('No clone list source configured');

    const folder = cloneListsFolder();
    await fs.mkdir(folder, { recursive: true });

    let target = fileName;
    if (!target) {
      const database = databaseService.getDatabase();
      const datName = database ? await getMetadata(database, 'dat_name') : null;
      if (!datName) throw new Error('No DAT loaded: cannot determine which list to download');
      sendLogToRenderer(mainWindow, 'info', 'dat', 'logs.cloneList.listing');
      target = matchCloneListFile(datName, await remoteFileNames(sourceUrl)) ?? undefined;
      if (!target) {
        sendLogToRenderer(mainWindow, 'warning', 'dat', 'logs.cloneList.noMatch', { dat: datName });
        return { success: false, error: 'no-match', datName };
      }
    }

    const url = sourceUrl + encodeURIComponent(target);
    const response = await fetch(url, { headers: { 'User-Agent': 'RUMCET' } });
    if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}): ${target}`);
    const body = await response.text();

    // Validation avant écriture : mieux vaut aucun fichier qu'un fichier corrompu
    // qui échouerait silencieusement à l'application.
    const parsed = JSON.parse(body);
    if (!parsed || !Array.isArray(parsed.variants)) {
      throw new Error(`Downloaded file is not a clone list: ${target}`);
    }

    const destination = path.join(folder, target);
    await fs.writeFile(destination, body, 'utf-8');

    settingsManager.set('cloneLists', {
      ...settingsManager.get('cloneLists')!,
      lastDownload: new Date().toISOString()
    });

    sendLogToRenderer(mainWindow, 'info', 'dat', 'logs.cloneList.downloaded', {
      file: target,
      variants: parsed.variants.length
    });
    return { success: true, fileName: target, variants: parsed.variants.length, path: destination };
  });

  // Application à la base ouverte.
  ipcMain.handle('clone-list:apply', async (_event, fileName?: string) => {
    const database = databaseService.getDatabase();
    if (!database) throw new Error('No database open');

    const datSetMode = await getMetadata(database, 'dat_set_mode');
    if (datSetMode && datSetMode !== 'n/a') {
      return { success: false, error: 'arcade' };
    }

    let target = fileName;
    if (!target) {
      const datName = await getMetadata(database, 'dat_name');
      target = (datName ? matchCloneListFile(datName, await localFileNames()) : null) ?? undefined;
    }
    if (!target) return { success: false, error: 'no-local-match' };

    const list = await readCloneListFile(path.join(cloneListsFolder(), target));
    const report = await applyCloneList(database, list);

    await setMetadata(database, 'clone_list_applied_at', new Date().toISOString());
    await setMetadata(database, 'clone_list_applied_name', report.listName);

    sendLogToRenderer(mainWindow, 'info', 'dat', 'logs.cloneList.applied', {
      list: report.listName,
      games: report.gamesGrouped,
      variants: report.variantsMatched
    });
    if (report.unmatchedSearchTerms > 0) {
      sendLogToRenderer(mainWindow, 'info', 'dat', 'logs.cloneList.unmatched', {
        count: report.unmatchedSearchTerms
      });
    }
    return { success: true, report };
  });

  // Retrait des regroupements posés par une liste (retour au titre normalisé seul).
  ipcMain.handle('clone-list:clear', async () => {
    const database = databaseService.getDatabase();
    if (!database) throw new Error('No database open');
    await database.run('UPDATE games SET group_key = NULL WHERE group_key IS NOT NULL');
    await setMetadata(database, 'clone_list_applied_at', '');
    await setMetadata(database, 'clone_list_applied_name', '');
    sendLogToRenderer(mainWindow, 'info', 'dat', 'logs.cloneList.cleared');
    return { success: true };
  });

  // Fichiers présents localement, pour un choix manuel.
  ipcMain.handle('clone-list:list-local', async () => ({
    folder: cloneListsFolder(),
    files: await localFileNames()
  }));
}
