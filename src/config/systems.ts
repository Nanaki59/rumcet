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

// src/config/systems.ts
// Registre central des systèmes.
//
// Les données embarquées sont générées dans systemsData.ts (npm run sync-systems).
// L'utilisateur peut actualiser la partie Recalbox (systèmes, métadonnées, formats)
// à la demande depuis un tag Recalbox (Paramètres → Compatibilité) : la surcharge
// est stockée dans <userData>/systems-recalbox.json et appliquée au démarrage via
// applySystemsOverlay(), dans le main process comme dans chaque renderer.
// Les données maintenues dans Rumcet (patterns de détection, datRawFormats, sources
// DAT) restent celles embarquées.
//
// SYSTEMS est muté en place : les modules qui l'importent voient la surcharge.

import type { ArchiveFormat, SystemCompatibility } from '../helpers/settingsManager.js';
import { computeExtraRawFormats, type RecalboxSystemData } from '../shared/recalboxSystems.js';
import { BUNDLED_SYSTEMS, DAT_DETECTION_ORDER } from './systemsData.js';

export interface DatSourceConfig {
  'no-intro'?: { id: string };
  'redump'?: { slug: string };
  recommended?: 'no-intro' | 'redump';
}

/** Famille de règles de matching/consolidation d'un système (voir src/helpers/systemProfiles). */
export type SystemProfileKind = 'arcade' | 'disc' | 'cartridge';

export interface SystemDefinition {
  systemId: string;
  fullname: string;
  manufacturer: string | null;
  type: string | null;
  /**
   * Famille de profil système (règles de matching/consolidation). Optionnel :
   * si absent, il est inféré (arcade si type='arcade', sinon 'cartridge').
   * À renseigner explicitement pour les systèmes disque optique ('disc').
   */
  profile?: SystemProfileKind;
  releaseDate: string | null;
  /** Formats archive supportés par tous les cores de l'émulateur. */
  supportedFormats: ArchiveFormat[];
  /** Formats archive supportés par certains cores seulement (à éviter si possible). */
  warningFormats: ArchiveFormat[];
  /** Formats archive non supportés par les cores. */
  unsupportedFormats: ArchiveFormat[];
  /** Extensions canoniques listées dans les DATs (ex: 'bin', 'cue' pour PSX). */
  datRawFormats: string[];
  /** Extensions supplémentaires acceptées par les émulateurs au-delà des DATs (ex: 'iso', 'pbp', 'ecm' pour PSX). */
  extraRawFormats: string[];
  /** Patterns regex testés contre le <header><name> du DAT pour identifier le système. */
  datNamePatterns: RegExp[];
  /** Sources publiques de DAT pour ce système. */
  datSources?: DatSourceConfig;
  /** Système absent des données embarquées, ajouté par une mise à jour Recalbox. */
  addedByUpdate?: boolean;
}

/** Surcharge persistée dans <userData>/systems-recalbox.json. */
export interface SystemsOverlay {
  /** Tag (ou branche) Recalbox d'où proviennent les données. */
  recalboxRef: string | null;
  /** Date ISO de la dernière mise à jour appliquée. */
  fetchedAt: string | null;
  /** Données Recalbox retenues par l'utilisateur. */
  systems: RecalboxSystemData[];
  /**
   * Sources DAT associées manuellement par l'utilisateur, pour les systèmes
   * qui n'en ont pas dans les données embarquées (ex : systèmes ajoutés par
   * une mise à jour). Conservées d'une mise à jour à l'autre.
   */
  userDatSources: Record<string, DatSourceConfig>;
}

const BUNDLED_BY_ID = new Map<string, SystemDefinition>(BUNDLED_SYSTEMS.map(s => [s.systemId, s]));

export const SYSTEMS: SystemDefinition[] = [];
const SYSTEMS_BY_ID = new Map<string, SystemDefinition>();
let currentOverlay: SystemsOverlay | null = null;

/** Applique des données Recalbox sur une définition embarquée (ou crée un nouveau système). */
export function mergeRecalboxData(base: SystemDefinition | undefined, data: RecalboxSystemData): SystemDefinition {
  const datRawFormats = base?.datRawFormats ?? [];
  const merged: SystemDefinition = {
    systemId: data.systemId,
    fullname: data.fullname,
    manufacturer: data.manufacturer,
    type: data.type,
    releaseDate: data.releaseDate,
    supportedFormats: [...data.supportedFormats],
    warningFormats: [...data.warningFormats],
    unsupportedFormats: [...data.unsupportedFormats],
    datRawFormats,
    extraRawFormats: computeExtraRawFormats(data.emulatorRawFormats, datRawFormats),
    datNamePatterns: base?.datNamePatterns ?? []
  };
  if (base?.profile) merged.profile = base.profile;
  if (base?.datSources) merged.datSources = base.datSources;
  if (!base) merged.addedByUpdate = true;
  return merged;
}

/**
 * Remplace le registre courant par : données embarquées + surcharge Recalbox.
 * `null` = retour aux données embarquées. Un système embarqué n'est jamais retiré.
 */
export function applySystemsOverlay(overlay: SystemsOverlay | null): void {
  currentOverlay = overlay;

  const merged = new Map<string, SystemDefinition>(BUNDLED_BY_ID);
  for (const data of overlay?.systems ?? []) {
    merged.set(data.systemId, mergeRecalboxData(BUNDLED_BY_ID.get(data.systemId), data));
  }
  for (const [systemId, datSources] of Object.entries(overlay?.userDatSources ?? {})) {
    const sys = merged.get(systemId);
    if (sys && !BUNDLED_BY_ID.get(systemId)?.datSources) {
      merged.set(systemId, { ...sys, datSources });
    }
  }

  // Même ordre que le générateur (tri par défaut, code unit)
  const sorted = [...merged.values()].sort((a, b) => (a.systemId < b.systemId ? -1 : a.systemId > b.systemId ? 1 : 0));
  SYSTEMS.splice(0, SYSTEMS.length, ...sorted);
  SYSTEMS_BY_ID.clear();
  for (const sys of SYSTEMS) SYSTEMS_BY_ID.set(sys.systemId, sys);
}

applySystemsOverlay(null);

/** Surcharge actuellement appliquée (null = données embarquées). */
export function getSystemsOverlay(): SystemsOverlay | null {
  return currentOverlay;
}

/** Définition embarquée d'un système (sans surcharge), ou undefined. */
export function getBundledSystem(systemId: string): SystemDefinition | undefined {
  return BUNDLED_BY_ID.get(systemId);
}

/** Valeurs de compatibilité archive par défaut, dérivées du registre courant. */
export function getDefaultSystemCompatibility(): SystemCompatibility[] {
  return SYSTEMS.map(s => toSystemCompatibility(s));
}

export function toSystemCompatibility(s: SystemDefinition): SystemCompatibility {
  return {
    systemId: s.systemId,
    systemName: s.fullname,
    category: s.manufacturer ?? 'Autres',
    subcategory: s.type ?? undefined,
    supportedFormats: [...s.supportedFormats],
    warningFormats: [...s.warningFormats],
    unsupportedFormats: [...s.unsupportedFormats]
  };
}

/** Détecte un système à partir du nom du DAT (header <name>). Retourne null si aucun match. */
export function detectSystemFromDatName(datName: string): SystemDefinition | null {
  for (const systemId of DAT_DETECTION_ORDER) {
    const sys = SYSTEMS_BY_ID.get(systemId);
    if (!sys) continue;
    for (const pattern of sys.datNamePatterns) {
      if (pattern.test(datName)) return sys;
    }
  }
  return null;
}

/** Retourne un système par son systemId, ou null s'il n'existe pas. */
export function getSystemById(systemId: string): SystemDefinition | null {
  return SYSTEMS_BY_ID.get(systemId) ?? null;
}

/**
 * Famille de profil d'un système. Priorité : champ `profile` explicite du registre ;
 * sinon inférence — 'arcade' si type='arcade', 'cartridge' par défaut. Un système
 * inconnu retombe sur 'cartridge' (comportement générique).
 */
export function getSystemProfileKind(systemId: string): SystemProfileKind {
  const sys = getSystemById(systemId);
  if (sys?.profile) return sys.profile;
  return sys?.type === 'arcade' ? 'arcade' : 'cartridge';
}

/** Retourne tous les systèmes connus. */
export function getAllSystems(): SystemDefinition[] {
  return SYSTEMS;
}

/** Groupe les systèmes par manufacturer puis par type (utile pour la modale de sélection). */
export function getSystemsGrouped(): Map<string, Map<string, SystemDefinition[]>> {
  const grouped = new Map<string, Map<string, SystemDefinition[]>>();
  for (const sys of SYSTEMS) {
    const manufacturer = sys.manufacturer ?? 'Autres';
    const type = sys.type ?? 'autres';
    if (!grouped.has(manufacturer)) grouped.set(manufacturer, new Map());
    const byType = grouped.get(manufacturer)!;
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)!.push(sys);
  }
  return grouped;
}
