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

// src/shared/i18nCore.ts
// Fonctions pures partagées entre le main process et le renderer.
// Les traductions vivent dans locales/<lang>.json (JSON imbriqué par domaine),
// aplaties en clés pointées ("menu.file.openDatabase") au chargement.

export type Language = 'fr' | 'en';

/** Structure brute d'un fichier locales/<lang>.json */
export interface NestedMessages {
  [key: string]: string | NestedMessages;
}

/** Dictionnaire aplati : "section.sousSection.cle" → "texte" */
export type LocaleMessages = Record<string, string>;

/** Paramètres d'interpolation acceptés par t() */
export type MessageParams = Record<string, string | number>;

/** Aplati un JSON de traductions imbriqué en clés pointées. */
export function flattenMessages(nested: NestedMessages, prefix = ''): LocaleMessages {
  const flat: LocaleMessages = {};
  for (const [key, value] of Object.entries(nested)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      flat[fullKey] = value;
    } else {
      Object.assign(flat, flattenMessages(value, fullKey));
    }
  }
  return flat;
}

/** Remplace les jetons {nom} d'un modèle par les valeurs fournies. */
export function formatMessage(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    name in params ? String(params[name]) : match
  );
}
