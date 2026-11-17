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

// src/shared/romNaming/index.ts
// Point d'entrée du parseur de noms de ROM. Logique pure partagée entre le main
// process (remplissage des métadonnées à l'import d'un DAT), le renderer (facettes
// de filtre, regroupement 1G1R) et les scripts Node de vérification.

export {
  parseTitle,
  normalizeForGrouping,
  type ParsedTitle,
  type ParseTitleOptions,
  type NamingMode,
  type VideoMode,
  type DevStatus
} from './parseTitle.js';

export {
  canonicalizeRegion,
  impliedLanguagesFor,
  CANONICAL_REGIONS,
  type RegionCode
} from './regions.js';

export {
  canonicalizeLanguage,
  parseLanguageList,
  languageDisplayName,
  CANONICAL_LANGUAGES,
  type LanguageCode
} from './languages.js';

export { multiDiscInfo, type MultiDiscInfo } from './multiDisc.js';

import { parseTitle, type NamingMode } from './parseTitle.js';

/**
 * Sérialise une liste de valeurs en CSV pour stockage SQLite.
 * Les colonnes `regions`, `languages` et `release_flags` de `games` utilisent ce
 * format : compact, indexable par `LIKE`, et trivial à relire côté renderer.
 */
export function serializeList(values: readonly string[]): string | null {
  return values.length > 0 ? values.join(',') : null;
}

/** Relit une colonne CSV produite par `serializeList()`. */
export function deserializeList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map(v => v.trim()).filter(v => v.length > 0);
}

/** Colonnes de métadonnées de nommage de la table `games` (schéma v2.1). */
export interface GameNamingColumns {
  base_title: string | null;
  regions: string | null;
  languages: string | null;
  video_mode: string | null;
  revision: string | null;
  revision_rank: number;
  dev_status: string | null;
  release_flags: string | null;
  disc_number: number | null;
  release_date: string | null;
}

/**
 * Calcule les colonnes de nommage d'un jeu à partir de son nom et de sa description.
 * Point unique de vérité partagé par l'import d'un DAT et par le rétro-remplissage de
 * la migration v2.1 — les deux DOIVENT produire exactement les mêmes valeurs.
 *
 * `group_key` n'est volontairement pas calculée ici : elle relève du regroupement 1G1R
 * et des clone lists, pas du parsing d'un titre isolé.
 */
export function buildGameNamingColumns(
  name: string,
  description: string | null | undefined,
  mode: NamingMode
): GameNamingColumns {
  const parsed = parseTitle(name, { mode, description: description ?? null });
  return {
    base_title: parsed.baseTitle || null,
    regions: serializeList(parsed.regions),
    languages: serializeList(parsed.languages),
    video_mode: parsed.videoMode,
    revision: parsed.revision,
    revision_rank: parsed.revisionRank,
    dev_status: parsed.devStatus,
    release_flags: serializeList(parsed.releaseFlags),
    disc_number: parsed.discNumber,
    release_date: parsed.releaseDate
  };
}

/**
 * Mode de parsing déduit du mode de set du DAT, tel que stocké dans
 * `metadata.dat_set_mode` par `detectDatSetMode()`. La valeur `'n/a'` signale un DAT
 * sans marqueur arcade, c'est-à-dire No-Intro ou Redump.
 */
export function namingModeFromSetMode(datSetMode: string | null | undefined): NamingMode {
  return datSetMode && datSetMode !== 'n/a' ? 'mame' : 'nointro';
}
