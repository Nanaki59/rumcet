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

// src/main/i18n.ts
// Chargement des traductions côté main process.
// Les fichiers locales/<lang>.json sont lus depuis la racine de l'application ;
// la langue de référence (complète) sert de repli pour les clés manquantes,
// ce qui permet d'ajouter des langues partiellement traduites.

import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import {
  flattenMessages,
  formatMessage,
  type Language,
  type LocaleMessages,
  type MessageParams,
  type NestedMessages
} from '../shared/i18nCore.js';

/** Langue de référence : son fichier doit contenir toutes les clés. */
const FALLBACK_LANGUAGE: Language = 'en';

let currentLanguage: Language = 'fr';
let messages: LocaleMessages = {};
// Dictionnaire anglais conservé à part : les fichiers de logs sont toujours
// écrits en anglais, quelle que soit la langue de l'interface.
let englishMessages: LocaleMessages = {};

function loadLocaleFile(lang: string): LocaleMessages {
  const filePath = path.join(app.getAppPath(), 'locales', `${lang}.json`);
  try {
    const nested = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as NestedMessages;
    return flattenMessages(nested);
  } catch (error) {
    console.error(`i18n: unable to load ${filePath}:`, error);
    return {};
  }
}

/** Charge (ou recharge) les traductions pour la langue demandée. */
export function initI18n(lang: Language): void {
  currentLanguage = lang;
  englishMessages = loadLocaleFile(FALLBACK_LANGUAGE);
  messages = lang === FALLBACK_LANGUAGE
    ? englishMessages
    : { ...englishMessages, ...loadLocaleFile(lang) };
}

/** Traduit une clé pointée, avec interpolation {nom}. Retourne la clé si absente. */
export function t(key: string, params?: MessageParams): string {
  const template = messages[key];
  return template !== undefined ? formatMessage(template, params) : key;
}

/**
 * Résout une clé contre le dictionnaire ANGLAIS, quelle que soit la langue de
 * l'UI. Utilisé pour les fichiers de logs (exploitables pour le support).
 * Si la clé est absente, elle est retournée telle quelle — permet de logger
 * du contenu brut (messages d'erreur, chemins) via le même canal.
 */
export function tEn(key: string, params?: MessageParams): string {
  const template = englishMessages[key];
  return template !== undefined ? formatMessage(template, params) : formatMessage(key, params);
}

export function getLanguage(): Language {
  return currentLanguage;
}

/** Dictionnaire aplati complet (repli déjà appliqué), envoyé au renderer. */
export function getMessages(): LocaleMessages {
  return messages;
}
