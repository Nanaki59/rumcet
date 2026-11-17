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
// src/renderer/consolidationModal.ts
// Modale bloquante affichée pendant la consolidation, et pendant le téléchargement
// de ROMs (qui consolide chaque jeu complet) : jeu en cours et son étape, formats
// cibles étudiés (état en direct) et format retenu, progression globale,
// interruption normale (après le jeu en cours) ou forcée (jeu bloqué).

import { t } from './i18n.js';
import { formatDuration } from './scanModal.js';
import { escapeHtml } from './htmlEscape.js';
import type {
  ConsolidationFormatCandidate,
  ConsolidationProgress,
  ConsolidationResult,
  DownloadAttempt,
  RomDownloadProgress,
  RomDownloadResult
} from '../types/global.js';

/** Délai après une demande d'interruption au bout duquel « Forcer l'arrêt » est proposé si le jeu en cours ne se termine pas */
const FORCE_STOP_DELAY_MS = 3000;

/** Étapes de consolidation terminales : le jeu en cours est fini */
const FINAL_STEPS = new Set(['done', 'skipped', 'error', 'aborted']);

const STATUS_ICONS: Record<ConsolidationFormatCandidate['status'], string> = {
  pending: '⏳',
  running: '⚙️',
  done: '✔️',
  failed: '❌',
  skipped: '⏭️',
  rejected: '🚫',
  chosen: '⭐'
};

const ATTEMPT_ICONS: Record<DownloadAttempt['status'], string> = {
  pending: '⏳',
  running: '⬇️',
  extracting: '📦',
  verifying: '🔍',
  verified: '✔️',
  partial: '⚠️',
  mismatch: '🚫',
  notFound: '❔',
  failed: '❌',
  skipped: '⏭️'
};

let operationRunning = false;

/** Une consolidation (ou un téléchargement) est-elle en cours ? Les actions du menu sont alors ignorées. */
export function isConsolidationRunning(): boolean {
  return operationRunning;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatName(format: string): string {
  return format === 'raw' ? t('index.consolidationModal.formatRaw') : format.toUpperCase();
}

function renderFormats(formats: ConsolidationFormatCandidate[]): string {
  return formats.map(f => {
    const detail = f.note
      ? t(`index.consolidationModal.notes.${f.note}`)
      : (f.size !== undefined ? formatSize(f.size) : '');
    return `
      <tr class="consolidation-format consolidation-format-${f.status}">
        <td class="consolidation-format-name">${escapeHtml(formatName(f.format))}</td>
        <td class="consolidation-format-label" title="${escapeHtml(f.label || '')}">${escapeHtml(f.label || '')}</td>
        <td class="consolidation-format-status">${STATUS_ICONS[f.status]} ${escapeHtml(t(`index.consolidationModal.status.${f.status}`))}</td>
        <td class="consolidation-format-detail">${escapeHtml(detail)}</td>
      </tr>`;
  }).join('');
}

function renderAttempts(attempts: DownloadAttempt[]): string {
  return attempts.map(a => {
    let detail = '';
    if (a.status === 'running' && a.percent !== undefined) {
      detail = `${a.percent} %`;
    } else if (a.matched !== undefined && a.total !== undefined) {
      detail = t('index.downloadModal.verifiedCount', { matched: a.matched, total: a.total });
    } else if (a.note) {
      detail = t(`index.downloadModal.attemptNotes.${a.note}`);
    } else if (a.detail) {
      detail = a.detail;
    } else if (a.size !== undefined) {
      detail = formatSize(a.size);
    }
    // Même ordre que l'algorithme : pour chaque source, ses extensions par priorité.
    // La ligne « local » = fichiers récupérés lors d'un téléchargement précédent incomplet
    const ext = a.kind === 'local' ? '—' : `.${a.ext}`;
    const mode = a.kind === 'archive' ? t('index.downloadModal.kindArchive')
      : a.kind === 'file' ? t('index.downloadModal.kindFile')
      : t('index.downloadModal.kindLocal');
    const source = a.kind === 'local' ? t('index.downloadModal.localSource') : a.source;
    // Statut « en cours » ou « vérifié » : même mise en forme que le tableau des formats
    const rowStatus = a.status === 'verified' ? 'chosen'
      : (a.status === 'running' || a.status === 'extracting' || a.status === 'verifying') ? 'running'
      : (a.status === 'mismatch' || a.status === 'failed') ? 'failed'
      : (a.status === 'skipped' || a.status === 'notFound') ? 'skipped'
      : a.status;
    return `
      <tr class="consolidation-format consolidation-format-${rowStatus}">
        <td class="download-attempt-source" title="${escapeHtml(source)}">${escapeHtml(source)}</td>
        <td class="consolidation-format-name download-attempt-ext" title="${escapeHtml(mode)}">${escapeHtml(ext)}</td>
        <td class="consolidation-format-label" title="${escapeHtml(`${mode} — ${a.target}`)}">${escapeHtml(a.target)}</td>
        <td class="consolidation-format-status">${ATTEMPT_ICONS[a.status]} ${escapeHtml(t(`index.downloadModal.attemptStatus.${a.status}`))}</td>
        <td class="consolidation-format-detail" title="${escapeHtml(a.detail || '')}">${escapeHtml(detail)}</td>
      </tr>`;
  }).join('');
}

// ============================================
// MODALE GÉNÉRIQUE
// ============================================

/** État affiché par la modale */
interface OperationView {
  phaseText: string;
  /** Jeu N / Total ; absent = barre indéterminée (préparation) */
  current?: number;
  total?: number;
  /** Le jeu en cours est terminé (la barre le compte comme traité) */
  finished: boolean;
  countersText: string;
  game?: string;
  stepText?: string;
  stepClass?: string;
  stepTitle?: string;
  modeText?: string;
  /** Pourcentage de téléchargement du fichier en cours */
  downloadPercent?: number;
  /** Section tentatives de téléchargement du jeu en cours */
  attempts?: DownloadAttempt[];
  /** Section formats (consolidation du jeu en cours) */
  formats?: ConsolidationFormatCandidate[];
  chosenFormat?: string;
}

interface OperationModalConfig<P, R> {
  title: string;
  hint: string;
  stopHint: string;
  start: () => Promise<R>;
  subscribe: (callback: (progress: P) => void) => () => void;
  toView: (progress: P) => OperationView;
  cancel: () => Promise<void>;
  forceCancel: () => Promise<void>;
}

async function runOperationModal<P, R>(config: OperationModalConfig<P, R>): Promise<R> {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay scan-modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content scan-modal consolidation-modal">
      <div class="modal-header">
        <h2>${escapeHtml(config.title)}</h2>
      </div>
      <div class="modal-body">
        <div class="scan-modal-mode cm-phase"></div>
        <progress class="scan-progress-bar cm-bar"></progress>
        <div class="scan-modal-stats">
          <span class="scan-count cm-count"></span>
          <span class="cm-counters"></span>
        </div>
        <div class="consolidation-game cm-game"></div>
        <div class="consolidation-step">
          <span class="cm-step"></span>
          <span class="cm-mode"></span>
        </div>
        <div class="consolidation-download cm-download" hidden>
          <progress class="consolidation-download-bar cm-download-bar" max="100"></progress>
          <span class="cm-download-percent"></span>
        </div>
        <div class="cm-attempts-block" hidden>
          <div class="consolidation-formats-title">${escapeHtml(t('index.downloadModal.attempts'))}</div>
          <table class="consolidation-formats download-attempts">
            <thead><tr>
              <th class="download-attempt-source">${escapeHtml(t('index.downloadModal.columns.source'))}</th>
              <th class="download-attempt-ext">${escapeHtml(t('index.downloadModal.columns.ext'))}</th>
              <th>${escapeHtml(t('index.downloadModal.columns.target'))}</th>
              <th class="consolidation-format-status">${escapeHtml(t('index.downloadModal.columns.status'))}</th>
              <th class="consolidation-format-detail">${escapeHtml(t('index.downloadModal.columns.detail'))}</th>
            </tr></thead>
            <tbody class="cm-attempts"></tbody>
          </table>
        </div>
        <div class="cm-formats-block" hidden>
          <div class="consolidation-formats-title">${escapeHtml(t('index.consolidationModal.formats'))}</div>
          <table class="consolidation-formats"><tbody class="cm-formats"></tbody></table>
          <div class="consolidation-chosen cm-chosen"></div>
        </div>
        <div class="scan-modal-times">
          <span class="cm-elapsed"></span>
          <span class="cm-game-elapsed"></span>
        </div>
        <p class="scan-modal-hint">${escapeHtml(config.hint)}</p>
        <p class="scan-modal-stop-hint cm-stop-hint" hidden>${escapeHtml(config.stopHint)}</p>
      </div>
      <div class="modal-footer">
        <button class="scan-force-btn cm-force" hidden>${escapeHtml(t('index.consolidationModal.forceStop'))}</button>
        <button class="scan-cancel-btn cm-cancel">${escapeHtml(t('index.consolidationModal.cancel'))}</button>
      </div>
    </div>
  `;
  const q = <T extends HTMLElement>(selector: string) => overlay.querySelector(selector) as T;
  const phaseEl = q<HTMLDivElement>('.cm-phase');
  const bar = q<HTMLProgressElement>('.cm-bar');
  const countEl = q<HTMLSpanElement>('.cm-count');
  const countersEl = q<HTMLSpanElement>('.cm-counters');
  const gameEl = q<HTMLDivElement>('.cm-game');
  const stepEl = q<HTMLSpanElement>('.cm-step');
  const modeEl = q<HTMLSpanElement>('.cm-mode');
  const downloadEl = q<HTMLDivElement>('.cm-download');
  const downloadBar = q<HTMLProgressElement>('.cm-download-bar');
  const downloadPercentEl = q<HTMLSpanElement>('.cm-download-percent');
  const attemptsBlock = q<HTMLDivElement>('.cm-attempts-block');
  const attemptsEl = q<HTMLTableSectionElement>('.cm-attempts');
  const formatsBlock = q<HTMLDivElement>('.cm-formats-block');
  const formatsEl = q<HTMLTableSectionElement>('.cm-formats');
  const chosenEl = q<HTMLDivElement>('.cm-chosen');
  const elapsedEl = q<HTMLSpanElement>('.cm-elapsed');
  const gameElapsedEl = q<HTMLSpanElement>('.cm-game-elapsed');
  const stopHint = q<HTMLParagraphElement>('.cm-stop-hint');
  const cancelBtn = q<HTMLButtonElement>('.cm-cancel');
  const forceBtn = q<HTMLButtonElement>('.cm-force');

  phaseEl.textContent = t('index.consolidationModal.phases.preparing');
  document.body.appendChild(overlay);

  const startedAt = Date.now();
  let currentGameKey: string | null = null;
  let currentGameStartedAt = 0;
  let gameInProgress = false;
  let cancelRequested = false;
  let cancelRequestedAt = 0;

  const refreshTimes = () => {
    const now = Date.now();
    elapsedEl.textContent = t('index.consolidationModal.elapsed', { time: formatDuration(now - startedAt) });
    gameElapsedEl.textContent = gameInProgress && now - currentGameStartedAt >= 1000
      ? t('index.consolidationModal.gameElapsed', { time: formatDuration(now - currentGameStartedAt) })
      : '';
    // Interruption demandée mais le jeu en cours ne se termine pas : proposer l'arrêt forcé
    if (cancelRequested && gameInProgress && now - cancelRequestedAt >= FORCE_STOP_DELAY_MS) {
      forceBtn.hidden = false;
    }
  };
  refreshTimes();
  const timer = window.setInterval(refreshTimes, 500);

  const render = (view: OperationView) => {
    phaseEl.textContent = view.phaseText;
    countersEl.textContent = view.countersText;

    if (view.current === undefined || !view.total) {
      bar.removeAttribute('value'); // barre indéterminée
      countEl.textContent = '';
    } else {
      bar.max = Math.max(view.total, 1);
      // Un jeu « en cours » n'est pas encore compté comme traité
      bar.value = view.finished ? view.current : view.current - 1;
      countEl.textContent = t('index.consolidationModal.gameCount', { current: view.current, total: view.total });
    }

    if (view.game) {
      const key = `${view.current}|${view.game}`;
      if (key !== currentGameKey) {
        currentGameKey = key;
        currentGameStartedAt = Date.now();
      }
    }
    gameInProgress = !!view.game && !view.finished;
    if (!gameInProgress) forceBtn.hidden = true;

    gameEl.textContent = view.game || '';
    gameEl.title = view.game || '';
    stepEl.textContent = view.stepText || '';
    stepEl.className = `cm-step ${view.stepClass || ''}`;
    stepEl.title = view.stepTitle || '';
    modeEl.textContent = view.modeText || '';

    downloadEl.hidden = view.downloadPercent === undefined;
    if (view.downloadPercent !== undefined) {
      downloadBar.value = view.downloadPercent;
      downloadPercentEl.textContent = `${view.downloadPercent} %`;
    }

    attemptsBlock.hidden = !view.attempts || view.attempts.length === 0;
    if (view.attempts) attemptsEl.innerHTML = renderAttempts(view.attempts);

    formatsBlock.hidden = !view.formats;
    if (view.formats) {
      formatsEl.innerHTML = renderFormats(view.formats);
      chosenEl.textContent = view.chosenFormat
        ? t('index.consolidationModal.chosen', { format: formatName(view.chosenFormat) })
        : t('index.consolidationModal.chosenPending');
      chosenEl.classList.toggle('consolidation-chosen-set', !!view.chosenFormat);
    }
    refreshTimes();
  };

  cancelBtn.addEventListener('click', async () => {
    if (cancelRequested) return;
    cancelRequested = true;
    cancelRequestedAt = Date.now();
    // L'opération s'arrêtera à la fin du jeu en cours ; l'arrêt forcé reste possible
    stopHint.hidden = false;
    cancelBtn.disabled = true;
    cancelBtn.textContent = t('index.consolidationModal.cancelling');
    refreshTimes();
    await config.cancel();
  });

  forceBtn.addEventListener('click', async () => {
    forceBtn.disabled = true;
    await config.forceCancel();
  });

  const unsubscribe = config.subscribe(progress => render(config.toView(progress)));
  operationRunning = true;
  try {
    return await config.start();
  } finally {
    operationRunning = false;
    unsubscribe();
    window.clearInterval(timer);
    overlay.remove();
  }
}

/** Partie « consolidation du jeu » commune aux deux opérations */
function consolidationDetails(p: {
  step?: ConsolidationProgress['step'];
  mode?: ConsolidationProgress['mode'];
  formats?: ConsolidationFormatCandidate[];
  chosenFormat?: string;
  error?: string;
}): Pick<OperationView, 'stepText' | 'stepClass' | 'stepTitle' | 'modeText' | 'formats' | 'chosenFormat'> {
  return {
    stepText: p.step ? t(`index.consolidationModal.steps.${p.step}`) : '',
    stepClass: `consolidation-step-${p.step || 'none'}`,
    stepTitle: p.step === 'error' && p.error ? p.error : '',
    modeText: p.mode ? t(`index.consolidationModal.modes.${p.mode}`) : '',
    formats: p.formats || [],
    chosenFormat: p.chosenFormat
  };
}

// ============================================
// CONSOLIDATION
// ============================================

/**
 * Lance la consolidation (via `window.api.runConsolidation`) en affichant la
 * modale ; la referme à la fin (succès, interruption ou erreur).
 */
export function runConsolidationWithModal(): Promise<ConsolidationResult> {
  return runOperationModal<ConsolidationProgress, ConsolidationResult>({
    title: t('index.consolidationModal.title'),
    hint: t('index.consolidationModal.hint'),
    stopHint: t('index.consolidationModal.stopHint'),
    start: () => window.api.runConsolidation(),
    subscribe: callback => window.api.onConsolidationProgress(callback),
    cancel: () => window.api.cancelConsolidation(),
    forceCancel: () => window.api.forceCancelConsolidation(),
    toView: p => {
      const countersText = t('index.consolidationModal.counters', {
        consolidated: p.consolidated ?? 0,
        errored: p.errored ?? 0,
        skipped: p.skipped ?? 0
      });
      if (p.phase !== 'consolidating') {
        // Hors jeux (préparation, nettoyage, fin) : le message de l'étape est plus précis que la phase
        return {
          phaseText: p.phase === 'complete' ? t('index.consolidationModal.phases.complete') : t(p.key, p.params),
          current: p.phase === 'preparing' ? undefined : p.totalGames,
          total: p.phase === 'preparing' ? undefined : p.totalGames,
          finished: true,
          countersText
        };
      }
      return {
        phaseText: t('index.consolidationModal.phases.consolidating'),
        current: p.currentGameIndex,
        total: p.totalGames,
        finished: !!p.step && FINAL_STEPS.has(p.step),
        countersText,
        game: p.currentGame,
        ...consolidationDetails(p)
      };
    }
  });
}

// ============================================
// TÉLÉCHARGEMENT DE ROMS (+ consolidation des jeux complets)
// ============================================

/**
 * Lance un téléchargement de ROMs (un jeu ou tous les manquants) en affichant
 * la modale : étape de téléchargement, puis détail de la consolidation du jeu.
 */
export function runRomDownloadWithModal(start: () => Promise<RomDownloadResult>): Promise<RomDownloadResult> {
  return runOperationModal<RomDownloadProgress, RomDownloadResult>({
    title: t('index.downloadModal.title'),
    hint: t('index.downloadModal.hint'),
    stopHint: t('index.downloadModal.stopHint'),
    start,
    subscribe: callback => window.api.onRomDownloadProgress(callback),
    cancel: () => window.api.cancelRomDownload(),
    forceCancel: () => window.api.forceCancelRomDownload(),
    toView: p => {
      const countersText = t('index.downloadModal.counters', {
        consolidated: p.consolidated ?? 0,
        failed: p.failed ?? 0
      });
      if (p.phase === 'preparing' || p.phase === 'complete') {
        return {
          phaseText: t(`index.downloadModal.phases.${p.phase}`),
          current: p.phase === 'complete' ? p.totalGames : undefined,
          total: p.phase === 'complete' ? p.totalGames : undefined,
          finished: true,
          countersText
        };
      }

      const base = {
        current: p.currentGameIndex,
        total: p.totalGames,
        countersText,
        game: p.currentGame,
        // Les tentatives restent visibles pendant la consolidation du jeu
        attempts: p.attempts
      };
      if (p.phase === 'consolidating') {
        return {
          ...base,
          phaseText: t('index.downloadModal.phases.consolidating'),
          finished: !!p.step && FINAL_STEPS.has(p.step),
          ...consolidationDetails(p)
        };
      }
      return {
        ...base,
        phaseText: t('index.downloadModal.phases.downloadingGames'),
        // « incomplet » : le jeu est fini (stocké dans le dossier des ROMs incomplètes)
        finished: p.phase === 'incomplete',
        stepText: t(`index.downloadModal.steps.${p.phase}`, {
          source: p.currentSource || '',
          ext: p.currentExtension || '',
          ...(p.params || {})
        }),
        stepClass: p.phase === 'incomplete' ? 'consolidation-step-aborted' : '',
        // Pourcentage connu seulement si le serveur annonce la taille du fichier
        downloadPercent: p.phase === 'downloading' ? p.downloadPercent : undefined
      };
    }
  });
}
