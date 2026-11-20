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

// src/shared/profileKeys.ts
// Répartition des paramètres entre « global » et « profil de consolidation ».
// Partagé par le main process (stockage) et le renderer (fenêtre des paramètres).

/**
 * Clés de paramètres portées par un profil de consolidation (onglets Compression,
 * Compatibilité par système, Multi-disques, Nettoyage, Arcade et 1G1R). Toutes les autres clés
 * sont globales : identiques quel que soit le profil courant.
 */
export const PROFILE_KEYS = [
  // Compression
  'compressionLevel',
  'recreateArchivesIfNeeded',
  'archiveFormatPriority',
  'useBestCompression',
  'solidArchive',
  'multithreading',
  // Compatibilité par système
  'systemCompatibility',
  // Multi-disques
  'generateM3u',
  // Nettoyage
  'cleanSourceAfterConsolidation',
  'cleanupScope',
  'protectFilesForUnselectedGames',
  'moveUnmatchedFiles',
  'unmatchedInReadOnlyArchives',
  // Arcade
  'arcadeTargetSetMode',
  'arcadeSeparateBios',
  'arcadeChdEmptyZip',
  // 1G1R
  'oneGameOneRom'
] as const;

export type ProfileKey = typeof PROFILE_KEYS[number];

const PROFILE_KEY_SET: ReadonlySet<string> = new Set(PROFILE_KEYS);

export function isProfileKey(key: string): key is ProfileKey {
  return PROFILE_KEY_SET.has(key);
}

/** Identifiants des profils intégrés (modifiables, non supprimables). */
export const BUILTIN_PROFILE_IDS = ['universal', 'recalbox', 'master'] as const;
export type BuiltinProfileId = typeof BUILTIN_PROFILE_IDS[number];

/** Profil créé à la migration à partir des réglages existants. */
export const CUSTOM_PROFILE_ID = 'custom';

/**
 * Sépare un objet de paramètres en partie globale et partie profil.
 * Les valeurs sont recopiées telles quelles (pas de clonage profond).
 */
export function splitProfileSettings<T extends Record<string, any>>(
  settings: T
): { global: Record<string, any>; profile: Record<string, any> } {
  const global: Record<string, any> = {};
  const profile: Record<string, any> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (isProfileKey(key)) profile[key] = value;
    else global[key] = value;
  }
  return { global, profile };
}
