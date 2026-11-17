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

// src/shared/compatRules.ts
// Règles de base de la compatibilité par système : elles cochent/décochent les
// formats d'archive de tous les systèmes en une fois, à partir du registre.
// Ce ne sont pas des règles « vivantes » : le profil stocke le résultat, que
// l'utilisateur peut ensuite ajuster système par système.

import type { ArchiveFormat, SystemCompatibility } from '../helpers/settingsManager.js';
import { SYSTEMS, toSystemCompatibility, type SystemDefinition } from '../config/systems.js';

/**
 * - universal : formats supportés par TOUS les cores (fichiers bruts si aucun)
 * - recalbox  : formats supportés par au moins un core (supported + warning)
 * - master    : archivage — 7z et zip toujours, CHD si le système le supporte
 */
export type CompatRule = 'universal' | 'recalbox' | 'master';

export const COMPAT_RULES: CompatRule[] = ['universal', 'recalbox', 'master'];

export function isCompatRule(value: unknown): value is CompatRule {
  return typeof value === 'string' && (COMPAT_RULES as string[]).includes(value);
}

/** Formats cochés pour un système selon une règle. */
export function formatsForRule(sys: SystemDefinition, rule: CompatRule): ArchiveFormat[] {
  switch (rule) {
    case 'universal':
      return [...sys.supportedFormats];
    case 'recalbox':
      return [...new Set([...sys.supportedFormats, ...sys.warningFormats])];
    case 'master': {
      const chdCompatible = sys.supportedFormats.includes('chd') || sys.warningFormats.includes('chd');
      return chdCompatible ? ['7z', 'zip', 'chd'] : ['7z', 'zip'];
    }
  }
}

/** Entrée de compatibilité d'un système selon une règle. */
export function compatEntryForRule(sys: SystemDefinition, rule: CompatRule): SystemCompatibility {
  return { ...toSystemCompatibility(sys), supportedFormats: formatsForRule(sys, rule) };
}

/** Compatibilité de tous les systèmes du registre courant selon une règle. */
export function applyCompatRule(rule: CompatRule): SystemCompatibility[] {
  return SYSTEMS.map(sys => compatEntryForRule(sys, rule));
}
