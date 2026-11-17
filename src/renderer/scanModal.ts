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
// src/renderer/scanModal.ts
// Modale bloquante affichée pendant le scan de dossiers de ROMs : dossier et
// fichier en cours, barre de progression, temps écoulé, interruption normale
// (après le fichier en cours) ou forcée (fichier bloqué).

import { t } from './i18n.js';
import type { ScanMode, ScanProgressEvent, ScanStats } from '../types/global.js';

/** Délai après une demande d'interruption au bout duquel « Forcer l'arrêt » est proposé si le fichier en cours ne se termine pas */
const FORCE_STOP_DELAY_MS = 3000;

let scanRunning = false;

/** Un scan est-il en cours ? (les actions du menu de l'application sont alors ignorées) */
export function isScanRunning(): boolean {
  return scanRunning;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function createOverlay(): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay scan-modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content scan-modal">
      <div class="modal-header">
        <h2 class="scan-modal-title"></h2>
      </div>
      <div class="modal-body">
        <div class="scan-modal-mode"></div>
        <div class="scan-modal-row">
          <span class="scan-modal-label scan-folder-label"></span>
          <span class="scan-modal-value scan-folder"></span>
        </div>
        <div class="scan-modal-row">
          <span class="scan-modal-label scan-file-label"></span>
          <span class="scan-modal-value scan-file"></span>
        </div>
        <progress class="scan-progress-bar"></progress>
        <div class="scan-modal-stats">
          <span class="scan-count"></span>
          <span class="scan-unchanged"></span>
        </div>
        <div class="scan-modal-times">
          <span class="scan-elapsed"></span>
          <span class="scan-file-elapsed"></span>
        </div>
        <p class="scan-modal-hint"></p>
        <p class="scan-modal-stop-hint" hidden></p>
      </div>
      <div class="modal-footer">
        <button class="scan-force-btn" hidden></button>
        <button class="scan-cancel-btn"></button>
      </div>
    </div>
  `;
  return overlay;
}

/**
 * Lance le scan des dossiers (via `window.api.addRomsFolder`) en affichant la
 * modale ; la referme à la fin (succès, interruption ou erreur).
 */
export async function runScanWithModal(folders: string[], mode: ScanMode): Promise<ScanStats> {
  const overlay = createOverlay();
  const q = <T extends HTMLElement>(selector: string) => overlay.querySelector(selector) as T;

  const folderEl = q<HTMLSpanElement>('.scan-folder');
  const fileEl = q<HTMLSpanElement>('.scan-file');
  const bar = q<HTMLProgressElement>('.scan-progress-bar');
  const countEl = q<HTMLSpanElement>('.scan-count');
  const unchangedEl = q<HTMLSpanElement>('.scan-unchanged');
  const elapsedEl = q<HTMLSpanElement>('.scan-elapsed');
  const fileElapsedEl = q<HTMLSpanElement>('.scan-file-elapsed');
  const stopHint = q<HTMLParagraphElement>('.scan-modal-stop-hint');
  const cancelBtn = q<HTMLButtonElement>('.scan-cancel-btn');
  const forceBtn = q<HTMLButtonElement>('.scan-force-btn');

  q<HTMLHeadingElement>('.scan-modal-title').textContent = t('index.scanModal.title');
  q<HTMLDivElement>('.scan-modal-mode').textContent =
    mode === 'full' ? t('index.scanModal.modeFull') : t('index.scanModal.modeQuick');
  q<HTMLSpanElement>('.scan-folder-label').textContent = t('index.scanModal.folder');
  q<HTMLSpanElement>('.scan-file-label').textContent = t('index.scanModal.file');
  q<HTMLParagraphElement>('.scan-modal-hint').textContent = t('index.scanModal.hint');
  stopHint.textContent = t('index.scanModal.stopHint');
  cancelBtn.textContent = t('index.scanModal.cancel');
  forceBtn.textContent = t('index.scanModal.forceStop');
  folderEl.textContent = folders[0] || '';

  document.body.appendChild(overlay);

  const startedAt = Date.now();
  // Fichier en cours d'analyse (null entre deux fichiers ou pendant l'inventaire)
  let currentFileKey: string | null = null;
  let currentFileStartedAt = 0;
  let cancelRequested = false;
  let cancelRequestedAt = 0;
  let lastRoot = '';

  const refreshTimes = () => {
    const now = Date.now();
    elapsedEl.textContent = t('index.scanModal.elapsed', { time: formatDuration(now - startedAt) });
    if (currentFileKey) {
      const onFile = now - currentFileStartedAt;
      fileElapsedEl.textContent = onFile >= 1000 ? t('index.scanModal.fileElapsed', { time: formatDuration(onFile) }) : '';
      // Interruption demandée mais le fichier en cours ne se termine pas : proposer l'arrêt forcé
      if (cancelRequested && now - cancelRequestedAt >= FORCE_STOP_DELAY_MS) {
        forceBtn.hidden = false;
      }
    } else {
      fileElapsedEl.textContent = '';
    }
  };
  refreshTimes();
  const timer = window.setInterval(refreshTimes, 500);

  const onProgress = (p: ScanProgressEvent) => {
    if (p.rootPath !== lastRoot) {
      lastRoot = p.rootPath;
      const index = folders.indexOf(p.rootPath);
      if (folders.length > 1 && index >= 0) {
        q<HTMLDivElement>('.scan-modal-mode').textContent =
          `${mode === 'full' ? t('index.scanModal.modeFull') : t('index.scanModal.modeQuick')} — ${t('index.scanModal.folderCount', { index: index + 1, count: folders.length })}`;
      }
    }
    folderEl.textContent = p.folder || p.rootPath;
    folderEl.title = folderEl.textContent;

    if (p.phase === 'counting') {
      bar.removeAttribute('value'); // barre indéterminée
      fileEl.textContent = '';
      countEl.textContent = t('index.scanModal.counting', { count: p.current });
      unchangedEl.textContent = '';
      currentFileKey = null;
      return;
    }

    fileEl.textContent = p.file;
    fileEl.title = p.file;
    bar.max = Math.max(p.total, 1);
    // Un fichier « en cours » n'est pas encore compté comme traité
    bar.value = p.status === 'start' ? p.current - 1 : p.current;
    countEl.textContent = t('index.scanModal.progress', { current: p.current, total: p.total });

    const unchanged = p.unchangedCount ?? 0;
    unchangedEl.textContent = unchanged > 0 ? t('index.scanModal.unchanged', { count: unchanged }) : '';

    const key = `${p.rootPath}|${p.current}`;
    if (p.status === 'start') {
      if (currentFileKey !== key) {
        currentFileKey = key;
        currentFileStartedAt = Date.now();
      }
    } else {
      currentFileKey = null;
      forceBtn.hidden = true;
    }
    refreshTimes();
  };

  cancelBtn.addEventListener('click', async () => {
    if (cancelRequested) return;
    cancelRequested = true;
    cancelRequestedAt = Date.now();
    // Le scan s'arrêtera à la fin du fichier en cours ; l'arrêt forcé reste possible
    stopHint.hidden = false;
    cancelBtn.disabled = true;
    cancelBtn.textContent = t('index.scanModal.cancelling');
    refreshTimes();
    await window.api.cancelRomScan();
  });

  forceBtn.addEventListener('click', async () => {
    forceBtn.disabled = true;
    cancelRequested = true;
    cancelBtn.disabled = true;
    cancelBtn.textContent = t('index.scanModal.cancelling');
    await window.api.forceCancelRomScan();
  });

  const unsubscribe = window.api.onScanProgress(onProgress);
  scanRunning = true;
  try {
    return await window.api.addRomsFolder(folders, { mode });
  } finally {
    scanRunning = false;
    unsubscribe();
    window.clearInterval(timer);
    overlay.remove();
  }
}
