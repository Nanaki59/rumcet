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

// src/main/handlers/systems.handlers.ts
//
// Mise à jour à la demande du registre des systèmes depuis un tag Recalbox
// (Paramètres → Compatibilité) et association manuelle de sources DAT pour
// les systèmes qui n'en ont pas. Rien n'est automatique : l'utilisateur choisit
// la version, consulte l'aperçu des différences et coche ce qu'il applique.
// Aucune requête n'est faite vers DAT-o-Matic (risque de bannissement IP).

import { IpcMain, BrowserWindow } from 'electron';
import {
  getBundledSystem,
  getSystemById,
  getSystemsOverlay,
  mergeRecalboxData,
  type DatSourceConfig,
  type SystemDefinition,
  type SystemsOverlay
} from '../../config/systems.js';
import { fetchRecalboxSystems, fetchRecalboxTags } from '../../helpers/recalboxGitlab.js';
import { settingsManager, type SystemCompatibility } from '../../helpers/settingsManager.js';
import type { RecalboxSystemData } from '../../shared/recalboxSystems.js';
import { saveSystemsOverlay } from '../services/systemsRegistry.service.js';
import { sendLogToRenderer } from '../utils/logger.js';
import type { SystemUpdateChange, SystemUpdateDiff, SystemUpdateField, SystemsUpdatePreview, SystemsUpdateApplyResult } from '../../types/global.js';

const COMPARED_FIELDS: SystemUpdateField[] = [
  'fullname', 'manufacturer', 'type', 'releaseDate',
  'supportedFormats', 'warningFormats', 'unsupportedFormats', 'extraRawFormats'
];

const NEW_SYSTEM_FIELDS: SystemUpdateField[] = ['type', 'releaseDate', 'supportedFormats', 'warningFormats', 'extraRawFormats'];

/** Dernier aperçu téléchargé, réutilisé à l'application (évite de re-solliciter GitLab). */
let lastFetch: { ref: string; systems: RecalboxSystemData[] } | null = null;

function emptyOverlay(): SystemsOverlay {
  return { recalboxRef: null, fetchedAt: null, systems: [], userDatSources: {} };
}

function sameValue(a: string | string[] | null, b: string | string[] | null): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
  }
  return (a ?? null) === (b ?? null);
}

function sameFormats(a: string[] | undefined, b: string[]): boolean {
  return sameValue(a ?? [], b);
}

function computeDiff(data: RecalboxSystemData, userCompat: SystemCompatibility[]): SystemUpdateDiff | null {
  const current = getSystemById(data.systemId);
  const candidate = mergeRecalboxData(getBundledSystem(data.systemId), data);

  const changes: SystemUpdateChange[] = [];
  if (current) {
    for (const field of COMPARED_FIELDS) {
      const before = current[field as keyof SystemDefinition] as string | string[] | null;
      const after = candidate[field as keyof SystemDefinition] as string | string[] | null;
      if (!sameValue(before, after)) changes.push({ field, before, after });
    }
    if (changes.length === 0) return null;
  } else {
    // Nouveau système : pas d'avant, on présente ses caractéristiques
    for (const field of NEW_SYSTEM_FIELDS) {
      const after = candidate[field as keyof SystemDefinition] as string | string[] | null;
      if (after && (!Array.isArray(after) || after.length > 0)) changes.push({ field, before: null, after });
    }
  }

  const userEntry = userCompat.find(c => c.systemId.toLowerCase() === data.systemId.toLowerCase());
  const customized = !!current && !!userEntry && !sameFormats(userEntry.supportedFormats, current.supportedFormats);

  return {
    systemId: data.systemId,
    fullname: candidate.fullname,
    manufacturer: candidate.manufacturer,
    type: candidate.type,
    status: current ? 'changed' : 'new',
    changes,
    customized
  };
}

function broadcastSystemsUpdated(): void {
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) win.webContents.send('systems:updated');
  });
}

export function registerSystemsHandlers(ipcMain: IpcMain, mainWindow: BrowserWindow): void {
  ipcMain.handle('systems:get-overlay', () => getSystemsOverlay());

  ipcMain.handle('systems:list-recalbox-tags', async () => {
    try {
      return { success: true, tags: await fetchRecalboxTags() };
    } catch (error: any) {
      sendLogToRenderer(mainWindow, 'error', 'settings', 'logs.systemsUpdate.tagsError', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('systems:preview-update', async (_event, ref: string): Promise<SystemsUpdatePreview> => {
    if (!ref) return { success: false, error: 'No Recalbox version selected' };
    try {
      sendLogToRenderer(mainWindow, 'info', 'settings', 'logs.systemsUpdate.fetching', { ref });
      const systems = await fetchRecalboxSystems(ref);
      lastFetch = { ref, systems };

      const userCompat: SystemCompatibility[] = settingsManager.get('systemCompatibility') ?? [];
      const diffs: SystemUpdateDiff[] = [];
      let unchangedCount = 0;
      for (const data of systems) {
        const diff = computeDiff(data, userCompat);
        if (diff) diffs.push(diff);
        else unchangedCount++;
      }

      sendLogToRenderer(mainWindow, 'info', 'settings', 'logs.systemsUpdate.previewReady', {
        ref,
        added: diffs.filter(d => d.status === 'new').length,
        changed: diffs.filter(d => d.status === 'changed').length
      });
      return { success: true, ref, diffs, unchangedCount };
    } catch (error: any) {
      sendLogToRenderer(mainWindow, 'error', 'settings', 'logs.systemsUpdate.fetchError', { ref, error: error.message });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('systems:apply-update', async (_event, ref: string, systemIds: string[]): Promise<SystemsUpdateApplyResult> => {
    try {
      if (!lastFetch || lastFetch.ref !== ref) {
        lastFetch = { ref, systems: await fetchRecalboxSystems(ref) };
      }
      const accepted = new Set(systemIds);
      const fetchedById = new Map(lastFetch.systems.map(s => [s.systemId, s]));

      // Surcharge : précédente + systèmes acceptés (les autres gardent leur valeur actuelle)
      const previous = getSystemsOverlay() ?? emptyOverlay();
      const bySystem = new Map(previous.systems.map(s => [s.systemId, s]));
      for (const id of accepted) {
        const data = fetchedById.get(id);
        if (data) bySystem.set(id, data);
      }
      await saveSystemsOverlay({
        recalboxRef: ref,
        fetchedAt: new Date().toISOString(),
        systems: [...bySystem.values()],
        userDatSources: previous.userDatSources
      });

      // Compatibilité : dans chaque profil, les systèmes acceptés reprennent les
      // formats donnés par la règle du profil (calculée sur le registre à jour)
      const acceptedIds = [...accepted].filter(id => !!getSystemById(id));
      await settingsManager.applySystemsUpdateToProfiles(acceptedIds);

      sendLogToRenderer(mainWindow, 'info', 'settings', 'logs.systemsUpdate.applied', { ref, count: accepted.size });
      broadcastSystemsUpdated();
      return { success: true, systemIds: acceptedIds };
    } catch (error: any) {
      sendLogToRenderer(mainWindow, 'error', 'settings', 'logs.systemsUpdate.applyError', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  /**
   * Retour aux données embarquées. Les réglages de compatibilité de l'utilisateur
   * ne sont pas modifiés ; les associations DAT manuelles sont conservées.
   */
  ipcMain.handle('systems:reset-to-bundled', async () => {
    try {
      const previous = getSystemsOverlay() ?? emptyOverlay();
      await saveSystemsOverlay({ ...emptyOverlay(), userDatSources: previous.userDatSources });
      sendLogToRenderer(mainWindow, 'info', 'settings', 'logs.systemsUpdate.reset');
      broadcastSystemsUpdated();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('systems:set-user-dat-sources', async (
    _event,
    systemId: string,
    sources: { noIntroId?: string; redumpSlug?: string } | null
  ) => {
    try {
      if (!getSystemById(systemId)) return { success: false, error: `Unknown system: ${systemId}` };
      if (getBundledSystem(systemId)?.datSources) {
        return { success: false, error: `System ${systemId} already has bundled DAT sources` };
      }

      const noIntroId = sources?.noIntroId?.trim() || '';
      const redumpSlug = sources?.redumpSlug?.trim().toLowerCase() || '';
      if (noIntroId && !/^\d+$/.test(noIntroId)) return { success: false, error: 'invalid-nointro-id' };
      if (redumpSlug && !/^[a-z0-9-]+$/.test(redumpSlug)) return { success: false, error: 'invalid-redump-slug' };

      const previous = getSystemsOverlay() ?? emptyOverlay();
      const userDatSources = { ...previous.userDatSources };
      if (!noIntroId && !redumpSlug) {
        delete userDatSources[systemId];
      } else {
        const config: DatSourceConfig = { recommended: redumpSlug ? 'redump' : 'no-intro' };
        if (noIntroId) config['no-intro'] = { id: noIntroId };
        if (redumpSlug) config['redump'] = { slug: redumpSlug };
        userDatSources[systemId] = config;
      }
      await saveSystemsOverlay({ ...previous, userDatSources });
      broadcastSystemsUpdated();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
