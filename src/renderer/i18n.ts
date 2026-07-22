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

// src/renderer/i18n.ts
// Traductions côté renderer. Le dictionnaire aplati (repli déjà appliqué)
// est récupéré du main process via IPC au chargement de chaque page.
//
// Textes statiques HTML : attributs data-i18n (textContent), data-i18n-html
// (innerHTML, pour les textes riches), data-i18n-title et data-i18n-placeholder.
// Textes dynamiques TS : fonction t('cle.pointee', { params }).

import { formatMessage, type MessageParams } from '../shared/i18nCore.js';

let messages: Record<string, string> = {};
let currentLanguage = 'fr';

export interface InitI18nOptions {
  /**
   * Appelé quand la langue change dans les paramètres, à la place du
   * rechargement de page par défaut. Permet un rafraîchissement à chaud
   * qui préserve l'état de la page (logs, base ouverte, sélection…) et
   * ne tue pas les traitements en cours (ex : fermeture différée de la
   * fenêtre paramètres après sauvegarde).
   */
  onLanguageChanged?: () => void | Promise<void>;
}

/**
 * Récupère les traductions depuis le main process et traduit le DOM.
 * À appeler (await) au tout début de l'initialisation de chaque page,
 * avant tout rendu de texte dynamique.
 */
export async function initI18n(options: InitI18nOptions = {}): Promise<void> {
  await refreshTranslations();
  window.api.onLanguageChanged(() => {
    if (options.onLanguageChanged) {
      void options.onLanguageChanged();
    } else {
      // Par défaut : recharger la page suffit (fenêtres sans état durable).
      window.location.reload();
    }
  });
}

/**
 * Re-télécharge le dictionnaire depuis le main process et retraduit le DOM
 * statique (attributs data-i18n*). Les zones dynamiques doivent être
 * re-rendues par l'appelant.
 */
export async function refreshTranslations(): Promise<void> {
  const result = await window.api.getI18n();
  messages = result.messages;
  currentLanguage = result.language;
  document.documentElement.lang = currentLanguage;
  applyDomI18n();
}

/** Traduit une clé pointée, avec interpolation {nom}. Retourne la clé si absente. */
export function t(key: string, params?: MessageParams): string {
  const template = messages[key];
  return template !== undefined ? formatMessage(template, params) : key;
}

export function getLanguage(): string {
  return currentLanguage;
}

/** Applique les attributs data-i18n* sur le DOM (ou un sous-arbre). */
export function applyDomI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n!);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.dataset.i18nHtml!);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle!);
  });
  root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder!);
  });
}
