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

// src/shared/recalboxSystems.ts
// Parsing pur des system.ini de Recalbox (package/recalbox-romfs2/systems/<id>/system.ini).
// Partagé entre le script de build (scripts/generateSystems.mjs, via dist/) et la
// mise à jour des systèmes à la demande dans l'application (main process).
// Aucune dépendance Node/Electron : utilisable des deux côtés.

import type { ArchiveFormat } from '../helpers/settingsManager.js';

export const RECALBOX_GITLAB_API = 'https://gitlab.com/api/v4';
export const RECALBOX_PROJECT_ID = 'recalbox%2Frecalbox';
export const RECALBOX_SYSTEMS_PATH = 'package/recalbox-romfs2/systems';

/** Entrées Recalbox qui ne sont pas de vrais systèmes de jeu. */
export const EXCLUDED_RECALBOX_SYSTEMS = new Set(['.templates', '2048', '240ptestsuite']);

/**
 * Types Recalbox conservés (les autres comme 'port', 'engine', 'virtual',
 * 'fantasy' sont des ports de jeux ou consoles fantasy non ROM-based).
 */
export const KEPT_TYPES = new Set(['console', 'computer', 'handheld', 'arcade']);

/** Formats archive pris en compte par RUMCET. */
export const TARGET_FORMATS: ArchiveFormat[] = ['chd', '7z', 'zip'];

/** Données d'un système issues uniquement de Recalbox (sans les données maintenues dans Rumcet). */
export interface RecalboxSystemData {
  systemId: string;
  fullname: string;
  manufacturer: string | null;
  type: string | null;
  releaseDate: string | null;
  supportedFormats: ArchiveFormat[];
  warningFormats: ArchiveFormat[];
  unsupportedFormats: ArchiveFormat[];
  /** Toutes les extensions acceptées par les cores, hors containers d'archive. */
  emulatorRawFormats: string[];
}

export interface ParsedSystemIni {
  fullname: string | null;
  manufacturer: string | null;
  type: string | null;
  releaseDate: string | null;
  extensionsPerCore: Set<string>[];
}

export function parseSystemIni(content: string): ParsedSystemIni {
  const result: ParsedSystemIni = {
    fullname: null,
    manufacturer: null,
    type: null,
    releaseDate: null,
    extensionsPerCore: []
  };

  const scalarKeys = {
    fullname: 'fullname',
    manufacturer: 'manufacturer',
    type: 'type',
    releaseDate: 'release.date'
  } as const;

  for (const [resultKey, iniKey] of Object.entries(scalarKeys) as Array<[keyof typeof scalarKeys, string]>) {
    const escaped = iniKey.replace(/\./g, '\\.');
    const re = new RegExp(`^\\s*${escaped}\\s*=\\s*"?([^"\\r\\n]*?)"?\\s*$`, 'm');
    const m = content.match(re);
    if (m) result[resultKey] = m[1].trim();
  }

  // Extensions par core (une ligne extensions = "..." par section [emulator.X])
  // Les tokens ont la forme ".ext" ou ".ext!" (suffixe ! = archive front-end)
  const extRe = /^\s*extensions\s*=\s*"([^"\r\n]+)"\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = extRe.exec(content)) !== null) {
    const tokens = m[1].split(/\s+/).map(e => e.trim()).filter(Boolean);
    const exts = new Set<string>();
    for (const tok of tokens) {
      if (tok.includes('=') || tok.startsWith('*')) continue;
      const norm = tok.replace(/^\./, '').replace(/!$/, '').toLowerCase();
      if (/^[a-z0-9]+$/.test(norm)) exts.add(norm);
    }
    if (exts.size > 0) result.extensionsPerCore.push(exts);
  }

  return result;
}

/**
 * Classe les formats archive : supporté par tous les cores, par certains
 * seulement (warning), ou par aucun.
 */
export function classifyFormats(extensionsPerCore: Set<string>[]): Pick<RecalboxSystemData, 'supportedFormats' | 'warningFormats' | 'unsupportedFormats'> {
  if (extensionsPerCore.length === 0) {
    return { supportedFormats: [], warningFormats: [], unsupportedFormats: [...TARGET_FORMATS] };
  }

  const supported: ArchiveFormat[] = [];
  const warning: ArchiveFormat[] = [];
  const unsupported: ArchiveFormat[] = [];
  for (const fmt of TARGET_FORMATS) {
    const presence = extensionsPerCore.map(s => s.has(fmt));
    if (presence.every(p => p)) supported.push(fmt);
    else if (presence.some(p => p)) warning.push(fmt);
    else unsupported.push(fmt);
  }
  return { supportedFormats: supported, warningFormats: warning, unsupportedFormats: unsupported };
}

/**
 * Construit les données Recalbox d'un système depuis son system.ini.
 * Retourne null si le type n'est pas conservé (port, engine, fantasy…).
 */
export function buildRecalboxSystemData(systemId: string, iniContent: string): RecalboxSystemData | null {
  const parsed = parseSystemIni(iniContent);
  if (parsed.type && !KEPT_TYPES.has(parsed.type)) return null;

  const rawExtensions = new Set<string>();
  for (const coreExts of parsed.extensionsPerCore) {
    for (const ext of coreExts) {
      // Exclure les containers d'archive (gérés séparément)
      if ((TARGET_FORMATS as string[]).includes(ext)) continue;
      rawExtensions.add(ext);
    }
  }

  return {
    systemId,
    fullname: parsed.fullname || systemId,
    manufacturer: parsed.manufacturer,
    type: parsed.type,
    releaseDate: parsed.releaseDate,
    ...classifyFormats(parsed.extensionsPerCore),
    emulatorRawFormats: [...rawExtensions].sort()
  };
}

/**
 * Extensions supplémentaires acceptées par les émulateurs au-delà des DATs
 * (évite le doublon avec les datRawFormats maintenus dans Rumcet).
 */
export function computeExtraRawFormats(emulatorRawFormats: string[], datRawFormats: string[]): string[] {
  const datRawSet = new Set(datRawFormats);
  return emulatorRawFormats.filter(e => !datRawSet.has(e)).sort();
}
