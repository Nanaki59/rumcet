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
 */

// src/renderer/extensionPicker.ts
//
// Composant UI partagé : sélecteur d'extensions de téléchargement à tags
// réordonnables (drag & drop), zone "Actives" + zone "Disponibles" (pool) +
// ajout d'extensions manuelles. Utilisé pour la configuration globale par
// système ET pour les overrides par source × système.

import { t } from './i18n.js';

export type DownloadExtensionSource = 'global' | 'sysCompressed' | 'datRaw' | 'extraRaw' | 'manual';

export interface DownloadExtensionEntry {
  ext: string;
  source: DownloadExtensionSource;
  isArchive: boolean;
}

export interface ExtensionPickerData {
  activeExtensions: DownloadExtensionEntry[];
}

/**
 * Extensions traitées comme des images CD/DVD (≈ archives).
 * Quand on les trouve dans extraRaw, on les marque isArchive=true et on les positionne
 * APRÈS les datRaw mais AVANT les autres extraRaw "bruts".
 */
const CD_IMAGE_EXTS = new Set(['iso', 'pbp', 'cso', 'img', 'ccd']);

export interface ExtensionPickerSources {
  global: string[];
  sysCompressed: string[];
  datRaw: string[];
  extraRaw: string[];
}

export interface ExtensionPickerOptions {
  container: HTMLElement;
  data: ExtensionPickerData;
  sources: ExtensionPickerSources;
  onChange: (newData: ExtensionPickerData) => void;
  /** Optionnel : si fourni, le composant affichera un bouton "↺" qui appelle ce callback. */
  onReset?: () => void;
}

// Métadonnées d'affichage par source. Le libellé est une clé i18n résolue au
// rendu (les traductions ne sont pas encore chargées au moment de l'import).
const SOURCE_META: Record<DownloadExtensionSource, { letter: string; labelKey: string; cssClass: string; defaultIsArchive: boolean }> = {
  global:        { letter: 'G', labelKey: 'extPicker.sourceGlobal',        cssClass: 'ext-tag-global',        defaultIsArchive: true },
  sysCompressed: { letter: 'S', labelKey: 'extPicker.sourceSysCompressed', cssClass: 'ext-tag-syscompressed', defaultIsArchive: true },
  datRaw:        { letter: 'D', labelKey: 'extPicker.sourceDatRaw',        cssClass: 'ext-tag-dat',           defaultIsArchive: false },
  extraRaw:      { letter: 'E', labelKey: 'extPicker.sourceExtraRaw',      cssClass: 'ext-tag-extra',         defaultIsArchive: false },
  manual:        { letter: 'M', labelKey: 'extPicker.sourceManual',        cssClass: 'ext-tag-manual',        defaultIsArchive: true }
};

/**
 * Calcule la liste des extensions du pool : toutes les extensions source-dérivées
 * qui ne sont pas actuellement dans activeExtensions.
 *
 * Dédup par extension à travers toutes les catégories selon la priorité :
 *   global > sysCompressed > datRaw > extraRaw
 * Si l'extension est déjà dans active (peu importe la catégorie), elle est ignorée.
 * Pour les `extraRaw`, isArchive=true uniquement pour les "images CD/DVD" (iso, pbp, cso, img, ccd).
 */
function computePool(data: ExtensionPickerData, sources: ExtensionPickerSources): DownloadExtensionEntry[] {
  const activeExts = new Set(data.activeExtensions.map(e => e.ext));
  const seen = new Set<string>(activeExts);
  const pool: DownloadExtensionEntry[] = [];

  const addFrom = (source: DownloadExtensionSource, exts: string[]) => {
    for (const raw of exts) {
      const ext = (raw || '').replace(/^\./, '').toLowerCase().trim();
      if (!ext || seen.has(ext)) continue;
      seen.add(ext);
      const isArchive = source === 'extraRaw'
        ? CD_IMAGE_EXTS.has(ext)
        : SOURCE_META[source].defaultIsArchive;
      pool.push({ ext, source, isArchive });
    }
  };

  addFrom('global', sources.global);
  addFrom('sysCompressed', sources.sysCompressed);
  addFrom('datRaw', sources.datRaw);
  addFrom('extraRaw', sources.extraRaw);
  return pool;
}

/**
 * Initialise une ExtensionPickerData par défaut.
 *
 * Active par défaut, dans l'ordre :
 *   1. G (extensions globales archives)
 *   2. S (formats compressés du système, archives)
 *   3. D (formats sans compression listés dans le DAT, raw)
 *   4. E (images CD/DVD : iso, pbp, cso, img, ccd) en mode archive
 *
 * Les autres extensions extraRaw (.exe, .toc, .ecm…) restent dans le pool (pas
 * assez courantes pour être actives par défaut).
 *
 * Dédup par extension à travers les catégories : une extension présente à un
 * niveau supérieur (G > S > D > E) n'est pas re-listée.
 */
export function buildDefaultPickerData(sources: ExtensionPickerSources): ExtensionPickerData {
  const active: DownloadExtensionEntry[] = [];
  const seen = new Set<string>();
  const addCat = (source: DownloadExtensionSource, exts: string[], isArchive: boolean) => {
    for (const raw of exts) {
      const ext = (raw || '').replace(/^\./, '').toLowerCase().trim();
      if (!ext || seen.has(ext)) continue;
      seen.add(ext);
      active.push({ ext, source, isArchive });
    }
  };
  addCat('global', sources.global, true);
  addCat('sysCompressed', sources.sysCompressed, true);
  addCat('datRaw', sources.datRaw, false);
  // Pour extraRaw : seulement les images CD/DVD (en mode archive) sont actives par défaut.
  const cdImageExtras = sources.extraRaw.filter(e =>
    CD_IMAGE_EXTS.has((e || '').replace(/^\./, '').toLowerCase())
  );
  addCat('extraRaw', cdImageExtras, true);
  return { activeExtensions: active };
}

/**
 * Rendu du composant. Vide d'abord le container et reconstruit l'UI.
 */
export function renderExtensionPicker(opts: ExtensionPickerOptions): void {
  const { container, data, sources, onChange, onReset } = opts;
  container.innerHTML = '';
  container.classList.add('extension-picker');

  // ─── Zone "Actives" ─────────────────────────────────────────────
  const activeWrapper = document.createElement('div');
  activeWrapper.className = 'extpicker-section';
  const activeHeader = document.createElement('div');
  activeHeader.className = 'extpicker-header';
  const activeLabel = document.createElement('span');
  activeLabel.className = 'extpicker-label';
  activeLabel.textContent = t('extPicker.activeLabel');
  activeHeader.appendChild(activeLabel);
  if (onReset) {
    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn-reset-system';
    resetBtn.title = t('extPicker.resetTitle');
    resetBtn.textContent = '↺';
    resetBtn.addEventListener('click', onReset);
    activeHeader.appendChild(resetBtn);
  }
  activeWrapper.appendChild(activeHeader);

  const activeZone = document.createElement('div');
  activeZone.className = 'extpicker-zone extpicker-zone-active';
  activeZone.dataset.dropTarget = 'active';

  if (data.activeExtensions.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'extpicker-empty';
    empty.textContent = t('extPicker.emptyActive');
    activeZone.appendChild(empty);
  } else {
    data.activeExtensions.forEach((entry, idx) => {
      activeZone.appendChild(buildActiveTag(entry, idx, data, onChange));
    });
  }
  activeWrapper.appendChild(activeZone);
  container.appendChild(activeWrapper);

  // Drag & drop reorder dans la zone active
  setupActiveDragDrop(activeZone, data, onChange);

  // ─── Zone "Disponibles" (pool) ──────────────────────────────────
  const pool = computePool(data, sources);
  const poolWrapper = document.createElement('div');
  poolWrapper.className = 'extpicker-section';
  const poolHeader = document.createElement('span');
  poolHeader.className = 'extpicker-label';
  poolHeader.textContent = t('extPicker.poolLabel');
  poolWrapper.appendChild(poolHeader);

  const poolZone = document.createElement('div');
  poolZone.className = 'extpicker-zone extpicker-zone-pool';
  if (pool.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'extpicker-empty';
    empty.textContent = t('extPicker.emptyPool');
    poolZone.appendChild(empty);
  } else {
    for (const entry of pool) {
      poolZone.appendChild(buildPoolTag(entry, data, onChange));
    }
  }
  poolWrapper.appendChild(poolZone);
  container.appendChild(poolWrapper);

  // ─── Champ "Ajouter une extension manuelle" ─────────────────────
  const manualWrapper = document.createElement('div');
  manualWrapper.className = 'extpicker-section';
  const manualLabel = document.createElement('span');
  manualLabel.className = 'extpicker-label';
  manualLabel.textContent = t('extPicker.manualLabel');
  manualWrapper.appendChild(manualLabel);

  const manualRow = document.createElement('div');
  manualRow.className = 'extpicker-manual-row';

  const manualInput = document.createElement('input');
  manualInput.type = 'text';
  manualInput.placeholder = t('extPicker.manualPlaceholder');
  manualInput.className = 'extpicker-manual-input';

  const modeBtn = document.createElement('button');
  modeBtn.type = 'button';
  modeBtn.className = 'extpicker-mode-btn';
  modeBtn.dataset.isArchive = '1';
  modeBtn.textContent = '📦';
  modeBtn.title = t('extPicker.modeArchiveTitle');
  modeBtn.addEventListener('click', () => {
    const isArchive = modeBtn.dataset.isArchive !== '1';
    modeBtn.dataset.isArchive = isArchive ? '1' : '0';
    modeBtn.textContent = isArchive ? '📦' : '📄';
    modeBtn.title = isArchive
      ? t('extPicker.modeArchiveTitle')
      : t('extPicker.modeRawTitle');
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn-primary';
  addBtn.textContent = t('extPicker.addBtn');
  addBtn.addEventListener('click', () => {
    const raw = manualInput.value.trim();
    if (!raw) return;
    const isArchive = modeBtn.dataset.isArchive === '1';
    const toAdd = raw.split(',').map(s => s.trim().replace(/^\./, '').toLowerCase()).filter(Boolean);
    for (const ext of toAdd) {
      // Anti-doublon (même ext déjà manuelle dans active)
      if (data.activeExtensions.some(a => a.source === 'manual' && a.ext === ext)) continue;
      data.activeExtensions.push({ ext, source: 'manual', isArchive });
    }
    manualInput.value = '';
    onChange(data);
  });

  manualInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addBtn.click();
    }
  });

  manualRow.appendChild(manualInput);
  manualRow.appendChild(modeBtn);
  manualRow.appendChild(addBtn);
  manualWrapper.appendChild(manualRow);
  container.appendChild(manualWrapper);
}

/**
 * Construit un tag pour la zone active : lettre cliquable (toggle isArchive),
 * extension, croix pour retirer.
 */
function buildActiveTag(
  entry: DownloadExtensionEntry,
  index: number,
  data: ExtensionPickerData,
  onChange: (d: ExtensionPickerData) => void
): HTMLElement {
  const meta = SOURCE_META[entry.source];
  const tag = document.createElement('span');
  tag.className = `extpicker-tag ${meta.cssClass}`;
  tag.draggable = true;
  tag.dataset.index = String(index);
  tag.dataset.source = entry.source;
  tag.dataset.ext = entry.ext;

  // Lettre + mode (encadré différent selon archive/raw)
  const letter = document.createElement('button');
  letter.type = 'button';
  letter.className = `extpicker-letter ${entry.isArchive ? 'mode-archive' : 'mode-raw'}`;
  letter.textContent = meta.letter;
  letter.title = entry.isArchive
    ? t('extPicker.toggleToRawTitle', { source: t(meta.labelKey) })
    : t('extPicker.toggleToArchiveTitle', { source: t(meta.labelKey) });
  letter.addEventListener('click', (e) => {
    e.stopPropagation();
    entry.isArchive = !entry.isArchive;
    onChange(data);
  });
  tag.appendChild(letter);

  const text = document.createElement('span');
  text.className = 'extpicker-text';
  text.textContent = '.' + entry.ext;
  tag.appendChild(text);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'extpicker-remove';
  close.textContent = '×';
  close.title = entry.source === 'manual'
    ? t('extPicker.removeManualTitle')
    : t('extPicker.removePoolTitle');
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    data.activeExtensions.splice(index, 1);
    onChange(data);
  });
  tag.appendChild(close);

  return tag;
}

/**
 * Construit un tag pour le pool : clic sur le tag (ou sur le +) pour ajouter à
 * la liste active. Pas de croix : on ne peut pas masquer une extension du pool.
 */
function buildPoolTag(
  entry: DownloadExtensionEntry,
  data: ExtensionPickerData,
  onChange: (d: ExtensionPickerData) => void
): HTMLElement {
  const meta = SOURCE_META[entry.source];
  const tag = document.createElement('span');
  tag.className = `extpicker-tag extpicker-tag-pool ${meta.cssClass}`;
  tag.title = t('extPicker.poolTagTitle', { source: t(meta.labelKey) });
  tag.addEventListener('click', () => {
    data.activeExtensions.push({ ...entry });
    onChange(data);
  });

  const letter = document.createElement('span');
  letter.className = `extpicker-letter ${entry.isArchive ? 'mode-archive' : 'mode-raw'}`;
  letter.textContent = meta.letter;
  tag.appendChild(letter);

  const text = document.createElement('span');
  text.className = 'extpicker-text';
  text.textContent = '.' + entry.ext;
  tag.appendChild(text);

  const plus = document.createElement('span');
  plus.className = 'extpicker-add';
  plus.textContent = '+';
  tag.appendChild(plus);

  return tag;
}

/**
 * Drag & drop pour réordonner les tags dans la zone active.
 * Utilise l'API HTML5 native drag & drop.
 */
function setupActiveDragDrop(
  zone: HTMLElement,
  data: ExtensionPickerData,
  onChange: (d: ExtensionPickerData) => void
): void {
  let draggedIndex: number | null = null;

  zone.querySelectorAll<HTMLElement>('.extpicker-tag').forEach(tag => {
    tag.addEventListener('dragstart', (e) => {
      draggedIndex = parseInt(tag.dataset.index || '-1', 10);
      tag.classList.add('dragging');
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });

    tag.addEventListener('dragend', () => {
      tag.classList.remove('dragging');
      draggedIndex = null;
    });

    tag.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      tag.classList.add('drop-target');
    });

    tag.addEventListener('dragleave', () => {
      tag.classList.remove('drop-target');
    });

    tag.addEventListener('drop', (e) => {
      e.preventDefault();
      tag.classList.remove('drop-target');
      if (draggedIndex === null) return;
      const targetIndex = parseInt(tag.dataset.index || '-1', 10);
      if (targetIndex < 0 || targetIndex === draggedIndex) return;

      const [moved] = data.activeExtensions.splice(draggedIndex, 1);
      data.activeExtensions.splice(targetIndex, 0, moved);
      onChange(data);
    });
  });
}
