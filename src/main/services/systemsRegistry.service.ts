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

// src/main/services/systemsRegistry.service.ts
// Persistance de la surcharge Recalbox du registre des systèmes
// (<userData>/systems-recalbox.json). Chargée au démarrage AVANT les paramètres,
// pour que le backfill de systemCompatibility voie les systèmes ajoutés.

import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { applySystemsOverlay, type DatSourceConfig, type SystemsOverlay } from '../../config/systems.js';
import type { RecalboxSystemData } from '../../shared/recalboxSystems.js';

const OVERLAY_FILE = 'systems-recalbox.json';

function overlayPath(): string {
  return path.join(app.getPath('userData'), OVERLAY_FILE);
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');

function isValidSystemData(d: any): d is RecalboxSystemData {
  return d && typeof d.systemId === 'string' && typeof d.fullname === 'string'
    && isStringArray(d.supportedFormats) && isStringArray(d.warningFormats)
    && isStringArray(d.unsupportedFormats) && isStringArray(d.emulatorRawFormats);
}

function isValidDatSources(d: any): d is DatSourceConfig {
  return d && typeof d === 'object'
    && (d['no-intro'] === undefined || typeof d['no-intro']?.id === 'string')
    && (d['redump'] === undefined || typeof d['redump']?.slug === 'string');
}

/** Lit et valide le fichier ; les entrées invalides sont ignorées. null si absent/illisible. */
async function readOverlayFile(): Promise<SystemsOverlay | null> {
  let raw: string;
  try {
    raw = await fs.readFile(overlayPath(), 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    const userDatSources: Record<string, DatSourceConfig> = {};
    for (const [id, ds] of Object.entries(parsed.userDatSources ?? {})) {
      if (isValidDatSources(ds)) userDatSources[id] = ds;
    }
    return {
      recalboxRef: typeof parsed.recalboxRef === 'string' ? parsed.recalboxRef : null,
      fetchedAt: typeof parsed.fetchedAt === 'string' ? parsed.fetchedAt : null,
      systems: Array.isArray(parsed.systems) ? parsed.systems.filter(isValidSystemData) : [],
      userDatSources
    };
  } catch (error) {
    console.warn(`Invalid ${OVERLAY_FILE}, using bundled systems:`, error);
    return null;
  }
}

/** Charge la surcharge au démarrage et l'applique au registre du main process. */
export async function loadSystemsOverlay(): Promise<void> {
  const overlay = await readOverlayFile();
  applySystemsOverlay(overlay);
  if (overlay) {
    console.log(`Systems overlay loaded: Recalbox ${overlay.recalboxRef ?? '-'}, ${overlay.systems.length} system(s), ${Object.keys(overlay.userDatSources).length} DAT association(s)`);
  }
}

/**
 * Enregistre et applique une surcharge. Une surcharge vide (aucun système ni
 * association) supprime le fichier : retour aux données embarquées.
 */
export async function saveSystemsOverlay(overlay: SystemsOverlay): Promise<void> {
  const isEmpty = overlay.systems.length === 0 && Object.keys(overlay.userDatSources).length === 0;
  if (isEmpty) {
    await fs.rm(overlayPath(), { force: true });
    applySystemsOverlay(null);
    return;
  }
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(overlayPath(), JSON.stringify(overlay, null, 2), 'utf8');
  applySystemsOverlay(overlay);
}
