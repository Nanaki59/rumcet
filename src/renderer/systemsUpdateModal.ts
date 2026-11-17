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

// src/renderer/systemsUpdateModal.ts
// Modale d'aperçu d'une mise à jour des systèmes depuis un tag Recalbox :
// systèmes nouveaux / modifiés, détail champ par champ, sélection de ce qui est
// appliqué. Les systèmes dont l'utilisateur a personnalisé les formats sont
// décochés par défaut.

import { t } from './i18n.js';
import { escapeHtml } from './htmlEscape.js';
import type { SystemUpdateChange, SystemUpdateDiff, SystemsUpdateApplyResult } from '../types/global.js';

function systemLabel(diff: SystemUpdateDiff): string {
  return diff.manufacturer ? `${diff.manufacturer} - ${diff.fullname}` : diff.fullname;
}

/** Valeur scalaire ou liste ; pour une liste, met en évidence ajouts et retraits. */
function renderChange(change: SystemUpdateChange): string {
  const label = escapeHtml(t(`settings.systemsUpdate.fields.${change.field}`));
  if (Array.isArray(change.before) || Array.isArray(change.after)) {
    const before = new Set(Array.isArray(change.before) ? change.before : []);
    const after = new Set(Array.isArray(change.after) ? change.after : []);
    const tags: string[] = [];
    for (const v of [...new Set([...before, ...after])].sort()) {
      const cls = !before.has(v) ? 'added' : !after.has(v) ? 'removed' : 'kept';
      tags.push(`<span class="su-tag su-${cls}">${escapeHtml(v)}</span>`);
    }
    return `<div class="su-change"><span class="su-field">${label}</span>${tags.join('') || '—'}</div>`;
  }
  const after = escapeHtml(String(change.after ?? '—'));
  // Nouveau système : pas de valeur précédente à barrer
  if (change.before === null) {
    return `<div class="su-change"><span class="su-field">${label}</span><span class="su-added-text">${after}</span></div>`;
  }
  const before = escapeHtml(String(change.before));
  return `<div class="su-change"><span class="su-field">${label}</span><span class="su-removed-text">${before}</span> → <span class="su-added-text">${after}</span></div>`;
}

function renderRow(diff: SystemUpdateDiff): string {
  const checked = diff.customized ? '' : 'checked';
  const badge = diff.customized
    ? `<span class="su-badge" title="${escapeHtml(t('settings.systemsUpdate.customizedTitle'))}">${escapeHtml(t('settings.systemsUpdate.customized'))}</span>`
    : '';
  const details = diff.changes.map(renderChange).join('');
  return `
    <label class="su-row">
      <input type="checkbox" data-system-id="${escapeHtml(diff.systemId)}" ${checked}>
      <div class="su-row-body">
        <div class="su-row-title">${escapeHtml(systemLabel(diff))} <code>${escapeHtml(diff.systemId)}</code> ${badge}</div>
        ${details}
      </div>
    </label>`;
}

/**
 * Télécharge l'aperçu pour `ref`, laisse l'utilisateur choisir, applique.
 * Résout avec le résultat de l'application, ou null si annulé / rien à appliquer.
 */
export function openSystemsUpdateModal(ref: string): Promise<SystemsUpdateApplyResult | null> {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'su-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'su-dialog';
    dialog.innerHTML = `
      <h3>${escapeHtml(t('settings.systemsUpdate.modalTitle', { ref }))}</h3>
      <div class="su-content"><p class="su-loading">${escapeHtml(t('settings.systemsUpdate.loading', { ref }))}</p></div>
      <div class="su-actions"><button class="btn-secondary" data-action="cancel">${escapeHtml(t('common.cancel'))}</button></div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const content = dialog.querySelector('.su-content') as HTMLDivElement;
    const actions = dialog.querySelector('.su-actions') as HTMLDivElement;
    let closed = false;
    const close = (result: SystemsUpdateApplyResult | null) => {
      if (closed) return;
      closed = true;
      overlay.remove();
      resolve(result);
    };
    actions.querySelector('[data-action="cancel"]')!.addEventListener('click', () => close(null));

    void window.api.systems.previewUpdate(ref).then(preview => {
      if (closed) return;

      if (!preview.success || !preview.diffs) {
        content.innerHTML = `<p class="su-error">${escapeHtml(t('settings.systemsUpdate.fetchError', { error: preview.error ?? '' }))}</p>`;
        return;
      }

      const added = preview.diffs.filter(d => d.status === 'new');
      const changed = preview.diffs.filter(d => d.status === 'changed');

      if (preview.diffs.length === 0) {
        content.innerHTML = `<p>${escapeHtml(t('settings.systemsUpdate.upToDate', { ref, count: preview.unchangedCount ?? 0 }))}</p>`;
        return;
      }

      const sections: string[] = [
        `<p class="su-summary">${escapeHtml(t('settings.systemsUpdate.summary', {
          added: added.length,
          changed: changed.length,
          unchanged: preview.unchangedCount ?? 0
        }))}</p>`
      ];
      if (changed.some(d => d.customized)) {
        sections.push(`<p class="su-note">${escapeHtml(t('settings.systemsUpdate.customizedNote'))}</p>`);
      }
      if (added.length > 0) {
        sections.push(`<h4>${escapeHtml(t('settings.systemsUpdate.sectionNew', { count: added.length }))}</h4>`);
        sections.push(`<p class="su-note">${escapeHtml(t('settings.systemsUpdate.newSystemsNote'))}</p>`);
        sections.push(added.map(renderRow).join(''));
      }
      if (changed.length > 0) {
        sections.push(`<h4>${escapeHtml(t('settings.systemsUpdate.sectionChanged', { count: changed.length }))}</h4>`);
        sections.push(changed.map(renderRow).join(''));
      }
      content.innerHTML = sections.join('');

      actions.innerHTML = `
        <button class="btn-secondary" data-action="check-all">${escapeHtml(t('settings.systemsUpdate.checkAll'))}</button>
        <button class="btn-secondary" data-action="uncheck-all">${escapeHtml(t('settings.systemsUpdate.uncheckAll'))}</button>
        <span class="su-spacer"></span>
        <button class="btn-secondary" data-action="cancel">${escapeHtml(t('common.cancel'))}</button>
        <button class="btn-primary" data-action="apply"></button>
      `;
      const checkboxes = Array.from(content.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-system-id]'));
      const applyBtn = actions.querySelector('[data-action="apply"]') as HTMLButtonElement;
      const refreshApply = () => {
        const count = checkboxes.filter(c => c.checked).length;
        applyBtn.textContent = t('settings.systemsUpdate.apply', { count });
        applyBtn.disabled = count === 0;
      };
      checkboxes.forEach(c => c.addEventListener('change', refreshApply));
      refreshApply();

      actions.querySelector('[data-action="cancel"]')!.addEventListener('click', () => close(null));
      actions.querySelector('[data-action="check-all"]')!.addEventListener('click', () => {
        checkboxes.forEach(c => { c.checked = true; });
        refreshApply();
      });
      actions.querySelector('[data-action="uncheck-all"]')!.addEventListener('click', () => {
        checkboxes.forEach(c => { c.checked = false; });
        refreshApply();
      });
      applyBtn.addEventListener('click', async () => {
        const systemIds = checkboxes.filter(c => c.checked).map(c => c.dataset.systemId!);
        actions.querySelectorAll('button').forEach(b => { b.disabled = true; });
        const result = await window.api.systems.applyUpdate(ref, systemIds);
        if (!result.success) {
          content.insertAdjacentHTML('afterbegin', `<p class="su-error">${escapeHtml(t('settings.systemsUpdate.applyError', { error: result.error ?? '' }))}</p>`);
          actions.querySelectorAll('button').forEach(b => { b.disabled = false; });
          return;
        }
        close(result);
      });
    });
  });
}
