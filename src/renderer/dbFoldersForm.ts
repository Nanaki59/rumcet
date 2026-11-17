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
// src/renderer/dbFoldersForm.ts
// Formulaire des dossiers propres à une base : dossier cible (+ sous-dossier
// système) et, dans une section repliée, les dossiers de travail (non
// référencées, incomplètes, temporaire). Partagé par l'écran de chargement DAT
// et la modale « Dossiers de la base » de la fenêtre principale.

import { t } from './i18n.js';
import type { DbFolderInput, DbFolderSettingsInfo } from '../types/global.js';
import { escapeHtml } from './htmlEscape.js';

export interface DbFoldersForm {
  /** Valeurs saisies (champs avancés vides = paramètre global) */
  getValues(): DbFolderInput;
  /** Dossier cible effectif prévisible (sous-dossier système inclus si le système est connu) */
  getEffectiveTarget(): string;
  /** Appelé à chaque modification */
  onChange(callback: () => void): void;
}

function joinPath(base: string, child: string): string {
  const sep = base.includes('\\') ? '\\' : '/';
  return base.replace(/[\\/]+$/, '') + sep + child;
}

/**
 * Construit le formulaire dans `container` à partir des valeurs courantes.
 * @param info Valeurs de la base (ou paramètres globaux si aucune base n'est ouverte)
 */
export function renderDbFoldersForm(container: HTMLElement, info: DbFolderSettingsInfo): DbFoldersForm {
  const advancedField = (id: string, labelKey: string, value: string, globalValue: string) => `
    <label class="dbf-label" for="${id}">${escapeHtml(t(labelKey))}</label>
    <div class="dbf-path-row">
      <input type="text" id="${id}" class="dbf-input" value="${escapeHtml(value)}" data-default="${escapeHtml(globalValue)}"
             placeholder="${escapeHtml(t('dbFolders.defaultPlaceholder', { path: globalValue || '—' }))}">
      <button type="button" class="dbf-btn dbf-browse" data-target="${id}">${escapeHtml(t('common.browse'))}</button>
      <button type="button" class="dbf-btn dbf-clear" data-target="${id}" title="${escapeHtml(t('dbFolders.clear'))}">✕</button>
    </div>
  `;

  const hasAdvancedOverride = !!(info.unmatchedFolder || info.incompleteFolder || info.tempFolder);

  container.innerHTML = `
    <div class="dbf">
      <label class="dbf-label" for="dbf-target">${escapeHtml(t('dbFolders.targetLabel'))}</label>
      <div class="dbf-path-row">
        <input type="text" id="dbf-target" class="dbf-input" value="${escapeHtml(info.targetFolder)}">
        <button type="button" class="dbf-btn dbf-browse" data-target="dbf-target">${escapeHtml(t('common.browse'))}</button>
      </div>
      <label class="dbf-checkbox">
        <input type="checkbox" id="dbf-system-subfolder" ${info.targetSystemSubfolder ? 'checked' : ''}>
        <span>${escapeHtml(t('dbFolders.systemSubfolder'))}</span>
      </label>
      <p class="dbf-info">${escapeHtml(t('dbFolders.systemSubfolderInfo'))}</p>
      <p class="dbf-effective"></p>

      <details class="dbf-advanced" ${hasAdvancedOverride ? 'open' : ''}>
        <summary>${escapeHtml(t('dbFolders.advancedTitle'))}</summary>
        <p class="dbf-info">${escapeHtml(t('dbFolders.advancedInfo'))}</p>
        ${advancedField('dbf-unmatched', 'dbFolders.unmatched', info.unmatchedFolder, info.globals.unmatchedRomsFolder)}
        ${advancedField('dbf-incomplete', 'dbFolders.incomplete', info.incompleteFolder, info.globals.incompleteRomsFolder)}
        ${advancedField('dbf-temp', 'dbFolders.temp', info.tempFolder, info.globals.tempExtractionFolder)}
      </details>
    </div>
  `;

  const input = (id: string) => container.querySelector(`#${id}`) as HTMLInputElement;
  const listeners: Array<() => void> = [];
  const effectiveEl = container.querySelector('.dbf-effective') as HTMLParagraphElement;

  const form: DbFoldersForm = {
    getValues: () => ({
      targetFolder: input('dbf-target').value.trim(),
      targetSystemSubfolder: input('dbf-system-subfolder').checked,
      unmatchedFolder: input('dbf-unmatched').value.trim(),
      incompleteFolder: input('dbf-incomplete').value.trim(),
      tempFolder: input('dbf-temp').value.trim()
    }),
    getEffectiveTarget: () => {
      const { targetFolder, targetSystemSubfolder } = form.getValues();
      return targetFolder && targetSystemSubfolder && info.systemId ? joinPath(targetFolder, info.systemId) : targetFolder;
    },
    onChange: (callback) => listeners.push(callback)
  };

  const changed = () => {
    // Le dossier effectif n'est connu que si le système l'est (base ouverte avec system_id)
    const effective = form.getEffectiveTarget();
    const showEffective = !!effective && effective !== form.getValues().targetFolder;
    effectiveEl.textContent = showEffective ? t('dbFolders.effective', { path: effective }) : '';
    effectiveEl.hidden = !showEffective;
    listeners.forEach(listener => listener());
  };

  container.querySelectorAll<HTMLInputElement>('input').forEach(el => {
    el.addEventListener('input', changed);
    el.addEventListener('change', changed);
  });

  container.querySelectorAll<HTMLButtonElement>('.dbf-browse').forEach(btn => {
    btn.addEventListener('click', async () => {
      const target = input(btn.dataset.target!);
      const chosen = await window.api.selectFolderDialog({
        title: t('dbFolders.browseTitle'),
        defaultPath: target.value || target.dataset.default || undefined
      });
      const folder = Array.isArray(chosen) ? chosen[0] : chosen;
      if (folder) {
        target.value = folder;
        changed();
      }
    });
  });

  container.querySelectorAll<HTMLButtonElement>('.dbf-clear').forEach(btn => {
    btn.addEventListener('click', () => {
      input(btn.dataset.target!).value = '';
      changed();
    });
  });

  changed();
  return form;
}
