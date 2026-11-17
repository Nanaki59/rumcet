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

  /**
   * Récupère une liste si elle a changé à la source.
   *
   * Requête conditionnelle : l'ETag de la version locale est renvoyé en
   * `If-None-Match`, et un 304 signifie « rien de neuf » pour quelques centaines
   * d'octets. C'est ce qui permet de vérifier la fraîcheur à chaque chargement de
   * DAT sans peser sur la source ni sur le temps de démarrage.
   *
   * `force` ignore l'ETag : utilisé par la mise à jour manuelle, quand l'utilisateur
   * veut être certain d'avoir la dernière version.
   */
  async function fetchIfChanged(target: string, force: boolean): Promise<{
    status: 'updated' | 'unchanged'; variants?: number;
  }> {
    const settings = settingsManager.get('cloneLists')!;
    const folder = cloneListsFolder();
    await fs.mkdir(folder, { recursive: true });
    const destination = path.join(folder, target);

    const knownEtag = force ? undefined : settings.etags?.[target];
    // Un ETag sans fichier local serait un cache menteur : on redemande tout.
    let hasLocal = true;
    try { await fs.access(destination); } catch { hasLocal = false; }

    const headers: Record<string, string> = { 'User-Agent': 'RUMCET' };
    if (knownEtag && hasLocal) headers['If-None-Match'] = knownEtag;

    const response = await fetch(settings.sourceUrl + encodeURIComponent(target), { headers });
    if (response.status === 304) return { status: 'unchanged' };
    if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}): ${target}`);

    const body = await response.text();
    // Validation avant écriture : mieux vaut garder l'ancien fichier qu'en écrire un
    // corrompu, qui échouerait plus tard au moment de l'application.
    const parsed = JSON.parse(body);
    if (!parsed || !Array.isArray(parsed.variants)) {
      throw new Error(`Downloaded file is not a clone list: ${target}`);
    }
    await fs.writeFile(destination, body, 'utf-8');

    const etag = response.headers.get('etag');
    const current = settingsManager.get('cloneLists')!;
    settingsManager.set('cloneLists', {
      ...current,
      lastDownload: new Date().toISOString(),
      etags: { ...(current.etags ?? {}), ...(etag ? { [target]: etag } : {}) }
    });

    return { status: 'updated', variants: parsed.variants.length };
  }

  /**
   * Synchronise puis applique la liste correspondant au DAT ouvert.
   * Point d'entrée unique : appelé au chargement d'un DAT et par la mise à jour
   * manuelle. Tolère l'absence de réseau — la liste locale reste appliquée.
   */
  ipcMain.handle('clone-list:sync', async (_event, options?: { force?: boolean }) => {
    const force = options?.force === true;
    const log = (severity: 'info' | 'warning' | 'error', key: string, params?: Record<string, unknown>) =>
      sendLogToRenderer(mainWindow, severity, 'dat', key, params as any);

    const database = databaseService.getDatabase();
    if (!database) return { success: false, error: 'no-database' };

    const datSetMode = await getMetadata(database, 'dat_set_mode');
    if (datSetMode && datSetMode !== 'n/a') return { success: false, error: 'arcade' };

    const datName = await getMetadata(database, 'dat_name');
    if (!datName) return { success: false, error: 'no-dat' };

    const sourceUrl = settingsManager.get('cloneLists')?.sourceUrl;
    let target = matchCloneListFile(datName, await localFileNames());
    let networkError: string | null = null;

    // Résolution du nom distant seulement si rien ne correspond localement, ou si
    // l'utilisateur force : l'énumération du dépôt est la partie coûteuse.
    try {
      if ((!target || force) && sourceUrl) {
        log('info', 'logs.cloneList.listing');
        const remote = matchCloneListFile(datName, await remoteFileNames(sourceUrl));
        if (remote) target = remote;
      }
      if (target && sourceUrl) {
        const outcome = await fetchIfChanged(target, force);
        if (outcome.status === 'updated') {
          log('info', 'logs.cloneList.downloaded', { file: target, variants: outcome.variants ?? 0 });
        } else {
          log('info', 'logs.cloneList.upToDate', { file: target });
        }
      }
    } catch (error: any) {
      // Motif explicite plutôt qu'un message brut : l'utilisateur doit pouvoir
      // distinguer une panne réseau d'un fichier corrompu à la source.
      networkError = error?.message || String(error);
      const cause = String(networkError);
      if (/HTTP 4\d\d/.test(cause)) {
        log('warning', 'logs.cloneList.httpError', { file: target ?? datName, error: cause });
      } else if (/not a clone list|JSON/i.test(cause)) {
        log('warning', 'logs.cloneList.invalidRemote', { file: target ?? datName, error: cause });
      } else {
        log('warning', 'logs.cloneList.unreachable', { error: cause });
      }
    }

    if (!target) {
      log('warning', 'logs.cloneList.noMatch', { dat: datName });
      return { success: false, error: 'no-match', datName };
    }

    // Lecture du fichier local : distincte du réseau, et distincte de l'application.
    let list;
    try {
      list = await readCloneListFile(path.join(cloneListsFolder(), target));
    } catch (error: any) {
      log('error', 'logs.cloneList.unreadable', {
        file: target, error: error?.message || String(error)
      });
      return { success: false, error: 'unreadable' };
    }

    if (networkError) log('info', 'logs.cloneList.usingLocal', { file: target });

    let report;
    try {
      report = await applyCloneList(database, list);
    } catch (error: any) {
      log('error', 'logs.cloneList.applyFailed', {
        file: target, error: error?.message || String(error)
      });
      return { success: false, error: 'apply-failed' };
    }

    await setMetadata(database, 'clone_list_applied_at', new Date().toISOString());
    await setMetadata(database, 'clone_list_applied_name', report.listName);

    log('info', 'logs.cloneList.applied', {
      list: report.listName, games: report.gamesGrouped, variants: report.variantsMatched
    });
    if (report.categoriesOverridden > 0) {
      log('info', 'logs.cloneList.categories', { count: report.categoriesOverridden });
    }
    if (report.unmatchedSearchTerms > 0) {
      log('info', 'logs.cloneList.unmatched', { count: report.unmatchedSearchTerms });
    }
    return { success: true, report, offline: networkError !== null };
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
