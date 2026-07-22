// src/renderer/index.ts

import { displayMatchingReport, initMatchingUI, displayInitialReport } from './matchingUI.js';
import { initI18n, refreshTranslations, t } from './i18n.js';
import { setupConsoleCapture } from './consoleCapture.js';

// Capturer les console.* de cette page vers le fichier de logs dès le chargement
setupConsoleCapture();

// État de l'application
let currentDatPath: string | null = null;
let currentDbPath: string | null = null;
let currentDatInfo: {
  name: string;
  description: string;
  version: string;
  date: string;
  author: string;
  homepage: string;
  url: string;
} | null = null;
let loadedFolders: FolderInfo[] = [];
let selectedElement: { type: 'dat' | 'folder', value: string } | null = null;
let viewMode: 'hierarchical' | 'flat' = 'hierarchical';
let currentRootFolder: string | null = null;  // Variable pour stocker le dossier racine actuel
let currentFolderPath: string | null = null;
let breadcrumbPath: string[] = [];

// Variables pour la recherche
let searchTimeout: NodeJS.Timeout | null = null;
let currentSearchQuery: string = '';
let currentSearchScope: 'all' | 'games' | 'files' | 'archives' = 'all';
let originalContent: HTMLElement[] = [];

// Variables pour le groupement et le filtrage
let currentGroupBy: 'none' | 'category' | 'letter' | 'match-status' | 'selection' | 'change-status' = 'none';
let activeFilters: Set<string> = new Set();
let activeMatchFilters: Set<string> = new Set();
let activeSelectionFilters: Set<string> = new Set();
let activeChangeFilters: Set<string> = new Set();
// Phase 3.5 — filtres arcade
let activeChdFilters: Set<string> = new Set();
let activeDriverFilters: Set<string> = new Set();
// Filtres spécifiques MAME : 'bios' (le jeu est un set BIOS) et 'chd-no-rom'
// (jeu avec un CHD mais aucune ROM — disque orphelin).
let activeMameFilters: Set<string> = new Set();
// Phase 3.5 — résolution des dépendances : IDs auto-sélectionnés et raisons (tooltips).
let autoSelectedIds: Set<number> = new Set();
let autoSelectedReasons: Record<number, Array<{ type: string; requiredBy: number; requiredByName: string }>> = {};
// État persistant des groupes repliés dans la vue DAT groupée (survit aux
// re-renders déclenchés par les toggles de sélection / cascade de dépendances).
// Clé : groupKey du groupement courant. Vidé quand le mode de groupement change.
const collapsedGameGroups = new Set<string>();
// Phase 3bis-B — mode cible de visualisation (split / non-merged / merged) lu depuis settings.
// Détermine si les clones doivent être fusionnés dans le parent (merged) ou affichés
// séparément (split / non-merged), et le libellé des badges de type ROM.
let currentTargetSetMode: 'split' | 'non-merged' | 'merged' = 'split';
let allGames: GameInfo[] = [];
let matchingComplete = false;
let targetFolderPath: string | null = null; // Dossier cible pour cette session (peut différer des paramètres globaux)
let categoryCounts: Map<string, number> = new Map();
let matchStatusCounts: Map<string, number> = new Map();

// Types pour l'application
interface GameInfo {
  id: number;
  name: string;
  description?: string;
  category?: string;
  is_selected?: number;
  match_status?: 'complete' | 'partial' | 'missing';
  change_status?: 'new' | 'modified' | 'unchanged' | 'disappeared' | null;
  is_disappeared?: boolean;
  system_id?: number;
  // Phase 3.5 — métadonnées arcade
  is_bios?: number;
  is_device?: number;
  driver_status?: string | null;
  has_chd?: number;
  parent_name_ref?: string | null;
  // Phase 4 — nombre de ROMs « fichiers » (is_disk = 0). Les CHD ne sont pas comptés ici.
  rom_count?: number;
  // Nombre de disques CHD (is_disk = 1) liés au jeu. La visibilité d'un jeu se base
  // sur rom_count + disk_count > 0 (un disque orphelin reste visible).
  disk_count?: number;
  // Phase 3bis-B — flags dérivés en mémoire (pas en DB)
  hasParentInDb?: boolean;
  cloneCount?: number;
}

interface RomInfo {
  id: number;
  game_id: number;
  name: string;
  size?: number;
  crc32?: string;
  md5?: string;
  sha1?: string;
  // Phase 3bis — métadonnées arcade pour badges de type ROM
  merge_name?: string | null;
  is_disk?: number;
  // Phase 3bis-B — annotation locale ajoutée par la vue merged pour signaler
  // qu'une ROM provient d'un clone du jeu parent affiché.
  _sourceCloneName?: string;
}

interface FolderInfo {
  path: string;
  fileCount: number;
}

interface FolderContent {
  folders: any[];
  files: any[];
}

// Types de log
type LogSeverity = 'error' | 'info' | 'warning';
type LogContext = 'application' | 'archive' | 'audio' | 'chd' | 'dat' | 'database' | 'demo' | 'download' | 'educational' | 'extra' | 'folder' | 'game' | 'match' | 'multimedia' | 'network' | 'otherfile' | 'preproduction' | 'romfile' | 'search' | 'settings' | 'video' | 'welcome';
type LogState = 'cancel' | 'cleanable' | 'complete' | 'count' | 'deleted' | 'found' | 'loading' | 'missing' | 'question' | 'select' | 'success' | 'sync' | 'waiting' | 'warning';

interface LogOptions {
  severity?: LogSeverity;
  context?: LogContext;
  state?: LogState;
  /** Paramètres d'interpolation {nom} de la clé i18n. */
  params?: Record<string, string | number>;
}

interface IconSystem {
  severity: Record<LogSeverity, string>;
  context: Record<LogContext, string>;
  state: Record<LogState, string>;
}

const icons: IconSystem = {
  severity: {
    error: '🚨',    // Could be : 🚨, ❌
    info: 'ℹ️',
    warning: '⚠️'
  },
  context: {
    application: '💻',
    archive: '📦',
    audio: '🎵',    // Could be : 🎧
    chd: '💿',
    dat: '📖',
    database: '🗄️',
    demo: '🧪',
    download: '⬇️',
    educational: '🎓',
    extra: '➕',
    folder: '📂',
    game: '🎮',
    match: '🎯',
    multimedia: '⏯️',
    network: '🌐',
    otherfile: '📄',
    preproduction: '👷',
    romfile: '💾',
    search: '🔍',
    settings: '⚙️',
    video: '🎬',    // Could be : 🎞️, 🎥
    welcome: '👋'
  },
  state: {
    cancel: '🔙',
    cleanable: '🫟',  // Could be : 💦, 💥, ⛔
    complete: '🟩',
    count: '🧮',
    deleted: '❌',  // Could be : ⚰️, 👻, ❌
    found: '☑️',    // Could be : ✔️
    loading: '⏳',
    missing: '👻',  // Could be : ⚰️, 👻, ❌, ✖️
    question: '❓',
    select: '🖱️',
    success: '✅',
    sync: '🔄',
    waiting: '⏸️',
    warning: '⚠️'
  }
};

// Fonction de log avec icônes.
// `key` est une clé i18n (résolue via t() pour le panneau, dans la langue de
// l'UI) ; le fichier de log est écrit côté main en ANGLAIS via la même clé.
// Une clé inconnue est affichée/écrite telle quelle (contenu brut).
function log(key: string, options: LogOptions = {}, isFromMain: boolean = false): void {
  const { severity = 'info', context, state, params } = options;

  const logDiv = document.getElementById('log');
  if (logDiv) {
    const timestamp = new Date().toLocaleTimeString();
    const div = document.createElement('div');
    div.className = `log-${severity}`;

    let finalMessage = `[${timestamp}] ${icons.severity[severity]}`;

    if (context && icons.context[context]) {
      finalMessage += ` ${icons.context[context]}`;
    }

    if (state && icons.state[state]) {
      finalMessage += ` ${icons.state[state]}`;
    }

    finalMessage += ` ${t(key, params)}`;

    div.textContent = finalMessage;
    logDiv.appendChild(div);
    logDiv.scrollTop = logDiv.scrollHeight;

    // Mettre à jour le dernier message dans le header (visible quand replié)
    const lastMsg = document.getElementById('log-last-message');
    if (lastMsg) {
      lastMsg.textContent = finalMessage;
      lastMsg.className = `log-last-message log-${severity}`;
    }

    // IMPORTANT: Ne PAS appeler writeLog si le message vient du main process :
    // il a déjà été écrit dans le fichier par sendLogToRenderer (sinon doublon).
    if (!isFromMain) {
      window.api.writeLog(severity, context || 'ui', key, params).catch((err: Error) => {
        console.error('Error while writing the log:', err);
      });
    }
  }
}

// Menu contextuel
function setupContextMenu() {
  const contextMenu = document.getElementById('context-menu');
  if (!contextMenu) return;

  // Cacher le menu au clic ailleurs
  document.addEventListener('click', () => {
    contextMenu.style.display = 'none';
  });
}

// Attacher les handlers du menu contextuel (appelé à chaque ouverture car le contenu est dynamique)
function attachContextMenuHandlers(contextMenu: HTMLElement) {
  // Handler pour supprimer physiquement (corbeille)
  document.getElementById('ctx-delete-folder-physical')?.addEventListener('click', async () => {
    const target = (contextMenu as any).targetElement;
    if (target && target.dataset.path) {
      await handleDeleteFolder(target.dataset.path);
    }
  });

  // Handler pour supprimer un dossier de la base
  document.getElementById('ctx-delete-folder-database')?.addEventListener('click', async () => {
    const target = (contextMenu as any).targetElement;
    if (target && target.dataset.path) {
      const confirmed = confirm(t('index.confirm.removeFolderFromDb', { path: target.dataset.path }));
      if (confirmed) {
        try {
          await window.api.removeFolder(target.dataset.path);
          log('logs.folder.removedFromDb', { params: { path: target.dataset.path }, context: 'folder', state: 'deleted' });

          // Retirer de la liste
          loadedFolders = loadedFolders.filter(f => f.path !== target.dataset.path);
          updateLeftSidebar();
        } catch (error) {
          log('logs.folder.deleteError', { params: { error: String(error) }, severity: 'error', context: 'folder' });
        }
      }
    }
  });

  // Handler pour actualiser
  document.getElementById('ctx-refresh-folder')?.addEventListener('click', async () => {
    const target = (contextMenu as any).targetElement;
    if (target && target.dataset.path) {
      await rescanFolder(target.dataset.path);
    }
  });

  // Handler pour définir comme dossier cible
  document.getElementById('ctx-set-target')?.addEventListener('click', async () => {
    const target = (contextMenu as any).targetElement;
    if (target && target.dataset.path) {
      targetFolderPath = target.dataset.path;
      // Persister dans la base de données
      await window.api.setDbMetadata('target_folder', target.dataset.path);
      log('logs.folder.targetSet', { params: { path: target.dataset.path }, context: 'folder', state: 'success' });
      updateLeftSidebar();
    }
  });
}

// Ferme tous les menus contextuels (statique + dynamiques) pour éviter la superposition
function closeDynamicContextMenus() {
  document.querySelectorAll('.dynamic-context-menu').forEach(m => m.remove());
  const staticMenu = document.getElementById('context-menu');
  if (staticMenu) staticMenu.style.display = 'none';
}

// Menu contextuel pour le DAT
async function showDatContextMenu(event: MouseEvent) {
  // Retirer tout menu contextuel dynamique déjà ouvert pour éviter la superposition
  closeDynamicContextMenus();

  // Vérifier s'il existe un rapport de mise à jour consultable
  let hasUpdateReport = false;
  try {
    const previousVersion = await window.api.getDbMetadata('dat_previous_version');
    hasUpdateReport = !!previousVersion;
  } catch {
    hasUpdateReport = false;
  }

  const menu = document.createElement('div');
  menu.className = 'context-menu dynamic-context-menu';
  menu.style.position = 'fixed';
  menu.style.display = 'block';
  menu.style.left = event.pageX + 'px';
  menu.style.top = event.pageY + 'px';
  menu.style.zIndex = '1000';

  const reportClass = hasUpdateReport ? 'context-menu-item' : 'context-menu-item disabled';
  const reportTitle = hasUpdateReport
    ? t('index.datMenu.showReportTitleAvailable')
    : t('index.datMenu.showReportTitleNone');

  menu.innerHTML = `
    <div class="context-menu-item" id="ctx-update-dat">${t('index.datMenu.update')}</div>
    <div class="${reportClass}" id="ctx-show-dat-report" title="${reportTitle}">${t('index.datMenu.showReport')}</div>
  `;

  document.body.appendChild(menu);

  menu.querySelector('#ctx-update-dat')?.addEventListener('click', async () => {
    menu.remove();
    await handleDatUpdate();
  });

  if (hasUpdateReport) {
    menu.querySelector('#ctx-show-dat-report')?.addEventListener('click', async () => {
      menu.remove();
      await showLastDatUpdateReport();
    });
  }

  const closeMenu = () => {
    menu.remove();
    document.removeEventListener('click', closeMenu);
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

// ============================================
// MENU CONTEXTUEL JEU — TÉLÉCHARGEMENT
// ============================================

function showGameContextMenu(event: MouseEvent, game: GameInfo) {
  // Retirer tout menu contextuel dynamique déjà ouvert pour éviter la superposition
  closeDynamicContextMenus();

  const menu = document.createElement('div');
  menu.className = 'context-menu dynamic-context-menu';
  menu.style.position = 'fixed';
  menu.style.display = 'block';
  menu.style.left = event.pageX + 'px';
  menu.style.top = event.pageY + 'px';
  menu.style.zIndex = '1000';

  const matchStatus = game.match_status || 'missing';
  const isMissingOrPartial = matchStatus === 'missing' || matchStatus === 'partial';

  let menuHtml = '';
  if (isMissingOrPartial) {
    menuHtml += `<div class="context-menu-item" id="ctx-download-rom">&#11015; ${t('index.gameMenu.downloadRom')}</div>`;
  }
  menuHtml += `<div class="context-menu-item" id="ctx-download-all-missing">&#11015; ${t('index.gameMenu.downloadAllMissing')}</div>`;

  menu.innerHTML = menuHtml;
  document.body.appendChild(menu);

  menu.querySelector('#ctx-download-rom')?.addEventListener('click', () => {
    menu.remove();
    startRomDownload([game.id]);
  });

  menu.querySelector('#ctx-download-all-missing')?.addEventListener('click', () => {
    menu.remove();
    startAllMissingRomDownload();
  });

  const closeMenu = () => {
    menu.remove();
    document.removeEventListener('click', closeMenu);
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

async function startRomDownload(gameIds: number[]) {
  const removeListener = window.api.onRomDownloadProgress((progress) => {
    if (progress.phase === 'complete') {
      log(progress.key, { params: progress.params, context: 'download', state: 'success' });
    } else if (progress.phase === 'incomplete') {
      log(progress.key, { params: progress.params, context: 'download', state: 'warning' });
    } else {
      log(progress.key, { params: progress.params, context: 'download', state: 'loading' });
    }
  });
  try {
    const result = await window.api.downloadRom(gameIds);
    const hasFailures = result.stats.failed > 0;
    log('logs.download.done',
      { params: { consolidated: result.stats.consolidated, failed: result.stats.failed }, context: 'download', state: hasFailures ? 'warning' : 'success' });

    if (result.stats.consolidated > 0) {
      await refreshTargetAndMatching();
    }
  } catch (error: any) {
    log('logs.download.error', { params: { error: error.message }, severity: 'error', context: 'download' });
  } finally {
    removeListener();
  }
}

async function startAllMissingRomDownload() {
  const removeListener = window.api.onRomDownloadProgress((progress) => {
    if (progress.phase === 'complete') {
      log(progress.key, { params: progress.params, context: 'download', state: 'success' });
    } else if (progress.phase === 'incomplete') {
      log(progress.key, { params: progress.params, context: 'download', state: 'warning' });
    } else {
      log(progress.key, { params: progress.params, context: 'download', state: 'loading' });
    }
  });
  try {
    const result = await window.api.downloadAllMissingRoms();
    const hasFailures = result.stats.failed > 0;
    log('logs.download.done',
      { params: { consolidated: result.stats.consolidated, failed: result.stats.failed }, context: 'download', state: hasFailures ? 'warning' : 'success' });

    if (result.stats.consolidated > 0) {
      await refreshTargetAndMatching();
    }
  } catch (error: any) {
    log('logs.download.error', { params: { error: error.message }, severity: 'error', context: 'download' });
  } finally {
    removeListener();
  }
}

// Recharge et affiche le dernier rapport de mise à jour DAT depuis la base
async function showLastDatUpdateReport() {
  try {
    const report = await window.api.getDatUpdateReport();
    if (!report) {
      log('logs.dat.noUpdateReport', { context: 'dat', state: 'waiting' });
      return;
    }
    showDatUpdateReport(report);
  } catch (error) {
    log('logs.dat.reportLoadError', { params: { error: error instanceof Error ? error.message : String(error) }, severity: 'error', context: 'dat' });
  }
}

// Gestion de la mise à jour du DAT
async function handleDatUpdate() {
  try {
    log('logs.dat.updating', { context: 'dat', state: 'loading' });

    const result = await window.api.updateDat();
    if (!result) {
      log('logs.dat.updateCancelled', { context: 'dat', state: 'cancel' });
      return;
    }

    // Mettre à jour l'état local
    currentDatInfo = result.datInfo || null;
    matchingComplete = false; // Le matching est invalidé

    updateLeftSidebar();
    updateWorkflowButtons();

    const comp = result.comparison;

    // Afficher le rapport de mise à jour dans une modale
    showDatUpdateReport(result);

    log('logs.dat.updated', { params: { name: result.datInfo.name, version: result.datInfo.version }, context: 'dat', state: 'success' });
    log('logs.dat.updateStats', { params: { newGames: comp.newGames, modified: comp.modifiedGames, unchanged: comp.unchangedGames, disappeared: comp.disappearedGames }, context: 'dat', state: 'count' });

    // Rafraîchir le volet central
    if (selectedElement) {
      await updateCenterContent(selectedElement.type, selectedElement.value);
    }
  } catch (error) {
    log('logs.dat.updateError', { params: { error: error instanceof Error ? error.message : String(error) }, severity: 'error', context: 'dat' });
  }
}

// Afficher le rapport de mise à jour DAT dans une modale
function showDatUpdateReport(result: any) {
  const comp = result.comparison;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  overlay.innerHTML = `
    <div class="modal-content large">
      <div class="modal-header">
        <h2>${t('index.datUpdate.title')}</h2>
        <button class="close-modal">&times;</button>
      </div>
      <div class="modal-body">
        <div style="font-size: 13px; color: #7f8c8d; margin-bottom: 16px;">
          ${result.previousName} v${result.previousVersion} &rarr; ${result.datInfo.name} v${result.datInfo.version}
        </div>

        <div class="dat-update-stats">
          <div class="dat-update-stat stat-new">
            <span class="stat-value">${comp.newGames}</span>
            <span class="stat-label">${t('index.datUpdate.new')}</span>
          </div>
          <div class="dat-update-stat stat-modified">
            <span class="stat-value">${comp.modifiedGames}</span>
            <span class="stat-label">${t('index.datUpdate.modified')}</span>
          </div>
          <div class="dat-update-stat stat-unchanged">
            <span class="stat-value">${comp.unchangedGames}</span>
            <span class="stat-label">${t('index.datUpdate.unchanged')}</span>
          </div>
          <div class="dat-update-stat stat-disappeared">
            <span class="stat-value">${comp.disappearedGames}</span>
            <span class="stat-label">${t('index.datUpdate.disappeared')}</span>
          </div>
        </div>

        ${comp.disappearedGames > 0 ? `
          <div class="dat-update-section">
            <h4>${t('index.datUpdate.disappearedGames', { count: comp.disappearedGames })}</h4>
            <div class="dat-update-game-list">
              ${comp.disappeared.map((g: any) => `
                <div class="game-entry">
                  ${g.name}
                  ${g.category ? `<span class="game-category">${g.category}</span>` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <div style="margin-top: 16px; font-size: 13px; color: #7f8c8d;">
          ${t('index.datUpdate.matchingInvalidated')}
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-close-modal">${t('common.closeWindow')}</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeModal = () => overlay.remove();
  overlay.querySelector('.close-modal')?.addEventListener('click', closeModal);
  overlay.querySelector('.btn-close-modal')?.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
}

// Afficher le détail des différences de ROMs pour un jeu
async function showGameDiffDetail(gameName: string) {
  try {
    const diff = await window.api.getGameDiff(gameName);

    if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
      return; // Pas de diff
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    let tableRows = '';

    for (const rom of diff.added) {
      tableRows += `<tr class="diff-added">
        <td>${t('index.gameDiff.added')}</td><td>${rom.name}</td><td>${rom.size || ''}</td><td>${rom.crc32 || ''}</td>
      </tr>`;
    }
    for (const rom of diff.removed) {
      tableRows += `<tr class="diff-removed">
        <td>${t('index.gameDiff.removed')}</td><td>${rom.name}</td><td>${rom.size || ''}</td><td>${rom.crc32 || ''}</td>
      </tr>`;
    }
    for (const c of diff.changed) {
      tableRows += `<tr class="diff-changed">
        <td>${t('index.gameDiff.changed')}</td><td>${c.name}</td>
        <td>${c.old.size || ''} &rarr; ${c.new.size || ''}</td>
        <td>${c.old.crc32 || ''} &rarr; ${c.new.crc32 || ''}</td>
      </tr>`;
    }

    overlay.innerHTML = `
      <div class="modal-content large">
        <div class="modal-header">
          <h2>${t('index.gameDiff.title', { game: gameName })}</h2>
          <button class="close-modal">&times;</button>
        </div>
        <div class="modal-body">
          <div style="font-size: 13px; color: #7f8c8d; margin-bottom: 12px;">
            ${t('index.gameDiff.summary', { added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length })}
          </div>
          <table class="rom-diff-table">
            <thead><tr><th>${t('index.gameDiff.colStatus')}</th><th>${t('index.gameDiff.colFile')}</th><th>${t('index.gameDiff.colSize')}</th><th>CRC32</th></tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
        <div class="modal-footer">
          <button class="btn-close-modal">${t('common.closeWindow')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const closeModal = () => overlay.remove();
    overlay.querySelector('.close-modal')?.addEventListener('click', closeModal);
    overlay.querySelector('.btn-close-modal')?.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
  } catch (error) {
    log('logs.dat.diffError', { params: { error: String(error) }, severity: 'error', context: 'dat' });
  }
}

// Rafraîchissement post-consolidation/téléchargement.
// La consolidation enregistre désormais directement en base les fichiers produits
// (scanned_files + archive_contents + rom_matches) et nettoie les entrées obsolètes.
// On évite donc le rescan complet du dossier cible et le re-matching, pour un gain
// de performance significatif. On se contente de rafraîchir l'UI.
async function refreshTargetAndMatching() {
  try {
    // Rafraîchir la sidebar (compteurs des dossiers)
    const rootFolders = await window.api.getRootFolders();
    loadedFolders = rootFolders;
    updateLeftSidebar();

    matchingComplete = true;
    updateWorkflowButtons();

    if (typeof displayMatchingReport === 'function') {
      await displayMatchingReport('matching-report');
    }

    if (selectedElement) {
      await updateCenterContent(selectedElement.type, selectedElement.value);
    }

    log('logs.match.uiRefreshed', { context: 'match', state: 'success' });
  } catch (error) {
    log('logs.match.refreshError', { params: { error: String(error) }, severity: 'error', context: 'match' });
  }
}

async function rescanFolder(folderPath: string) {
  try {
    log('logs.folder.rescanStart', { params: { path: folderPath }, context: 'folder', state: 'loading' });

    const progressHandler = (data: any) => {
      if (data.fileName) {
        log('logs.romfile.scanning', { params: { file: data.fileName }, context: 'romfile', state: 'loading' });
      }
    };

    window.api.onScanProgress(progressHandler);

    const stats = await window.api.addRomsFolder(folderPath);
    log('logs.folder.rescanDone', { params: { count: stats.length }, context: 'folder', state: 'success' });

    // Rafraîchir les compteurs dans la sidebar
    const rootFolders = await window.api.getRootFolders();
    loadedFolders = rootFolders;
    updateLeftSidebar();

    // Rafraîchir l'affichage si c'est le dossier actuel
    if (currentFolderPath === folderPath) {
      await updateCenterContent('folder', folderPath);
    }
  } catch (error) {
    log('logs.folder.rescanError', { params: { error: String(error) }, severity: 'error', context: 'folder' });
  }
}

// Fonction pour afficher le menu contextuel
function showContextMenu(event: MouseEvent, element: HTMLElement, options: { isSubfolder?: boolean } = {}) {
  event.preventDefault();
  event.stopPropagation();

  // Fermer tout menu contextuel dynamique déjà ouvert (DAT, jeu)
  document.querySelectorAll('.dynamic-context-menu').forEach(m => m.remove());

  const contextMenu = document.getElementById('context-menu');
  if (!contextMenu) return;

  (contextMenu as any).targetElement = element;

  const folderPath = element.dataset.path;
  const isTarget = folderPath !== null && folderPath === targetFolderPath;

  // Construire le menu dynamiquement.
  // Sous-dossier : seulement "Retirer de la base" + "Supprimer le dossier".
  // Dossier racine : "Re-scanner" + "Définir comme cible" (si pas déjà cible) + suppressions.
  let menuHtml = '';
  if (!options.isSubfolder) {
    menuHtml += `<div id="ctx-refresh-folder" class="context-menu-item">${t('index.contextMenu.rescan')}</div>`;
    if (!isTarget) {
      menuHtml += `<div id="ctx-set-target" class="context-menu-item">${t('index.contextMenu.setTarget')}</div>`;
    }
  }
  if (!isTarget) {
    menuHtml += `<div id="ctx-delete-folder-database" class="context-menu-item">${t('index.contextMenu.removeFromDb')}</div>`;
    menuHtml += `<div id="ctx-delete-folder-physical" class="context-menu-item danger">${t('index.contextMenu.deletePhysical')}</div>`;
  }

  if (!menuHtml) return;

  contextMenu.innerHTML = menuHtml;

  contextMenu.style.display = 'block';
  contextMenu.style.left = event.pageX + 'px';
  contextMenu.style.top = event.pageY + 'px';

  // Attacher les handlers après l'insertion du HTML
  attachContextMenuHandlers(contextMenu);
}

// Ajouter un bouton pour la conversion CHD dans le menu contextuel des fichiers
async function showFileContextMenu(event: MouseEvent, file: any) {
  event.preventDefault();
  event.stopPropagation();

  // Fermer tout autre menu contextuel
  closeDynamicContextMenus();

  const menu = document.createElement('div');
  menu.className = 'context-menu dynamic-context-menu';
  menu.style.position = 'fixed';
  menu.style.display = 'block';
  menu.style.left = event.pageX + 'px';
  menu.style.top = event.pageY + 'px';
  menu.style.zIndex = '1000';

  const ext = (file.fileName || '').split('.').pop()?.toLowerCase();

  // CD/ISO → conversion CHD
  if (['cue', 'gdi', 'toc', 'nrg', 'iso', 'bin'].includes(ext)) {
    menu.innerHTML += `<div class="context-menu-item" id="ctx-convert-chd">${t('index.fileMenu.convertChd')}</div>`;
  }

  // CHD → extraction / vérif / infos
  if (ext === 'chd') {
    menu.innerHTML += `<div class="context-menu-item" id="ctx-extract-chd">${t('index.fileMenu.extractChd')}</div>`;
    menu.innerHTML += `<div class="context-menu-item" id="ctx-verify-chd">${t('index.fileMenu.verifyChd')}</div>`;
    menu.innerHTML += `<div class="context-menu-item" id="ctx-info-chd">${t('index.fileMenu.infoChd')}</div>`;
  }

  // Toujours : retirer de la base + supprimer (corbeille)
  menu.innerHTML += `<div class="context-menu-item" id="ctx-remove-file">${t('index.fileMenu.removeFromDb')}</div>`;
  menu.innerHTML += `<div class="context-menu-item danger" id="ctx-delete-file">${t('index.fileMenu.deleteFile')}</div>`;

  document.body.appendChild(menu);

  // Handlers CHD
  menu.querySelector('#ctx-convert-chd')?.addEventListener('click', () => {
    menu.remove();
    (window as any).convertToChd?.(file.filePath);
  });
  menu.querySelector('#ctx-extract-chd')?.addEventListener('click', () => {
    menu.remove();
    (window as any).extractChd?.(file.filePath);
  });
  menu.querySelector('#ctx-verify-chd')?.addEventListener('click', () => {
    menu.remove();
    (window as any).verifyChdFile?.(file.filePath);
  });
  menu.querySelector('#ctx-info-chd')?.addEventListener('click', () => {
    menu.remove();
    (window as any).showChdInfo?.(file.filePath);
  });

  // Handler "Retirer de la base"
  menu.querySelector('#ctx-remove-file')?.addEventListener('click', async () => {
    menu.remove();
    const confirmed = confirm(t('index.confirm.removeFile', { file: file.fileName }));
    if (!confirmed) return;
    try {
      await window.api.removeFile(file.filePath);
      log('logs.folder.fileRemovedFromDb', { params: { file: file.fileName }, context: 'folder', state: 'deleted' });
      if (currentFolderPath) await updateFolderContent(currentFolderPath);
    } catch (error) {
      log('logs.folder.removeError', { params: { error: String(error) }, severity: 'error', context: 'folder' });
    }
  });

  // Handler "Supprimer (corbeille)"
  menu.querySelector('#ctx-delete-file')?.addEventListener('click', async () => {
    menu.remove();
    const result = await window.api.showMessageBox({
      type: 'warning',
      title: t('index.confirm.deleteFileTitle'),
      message: t('index.confirm.deleteFileMessage', { file: file.fileName }),
      detail: t('index.confirm.deleteFileDetail'),
      buttons: [t('common.cancel'), t('index.confirm.moveToTrash')],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    if (result.response !== 1) return;
    try {
      await window.api.deleteFile(file.filePath);
      log('logs.folder.fileDeleted', { params: { file: file.fileName }, context: 'folder', state: 'deleted' });
      if (currentFolderPath) await updateFolderContent(currentFolderPath);
    } catch (error) {
      log('logs.folder.deleteError', { params: { error: String(error) }, severity: 'error', context: 'folder' });
    }
  });

  // Fermer le menu au clic ailleurs
  const closeMenu = () => {
    menu.remove();
    document.removeEventListener('click', closeMenu);
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

// Gestion de la vue (hiérarchique vs plate)
function setupViewControls() {
  const viewControls = document.getElementById('view-controls');
  const radios = document.querySelectorAll('input[name="view-mode"]');
  
  radios.forEach(radio => {
    radio.addEventListener('change', async (e) => {
      const target = e.target as HTMLInputElement;
      viewMode = target.value as 'hierarchical' | 'flat';
      
      // Rafraîchir l'affichage si on est dans un dossier
      if (currentFolderPath) {
        await updateFolderContent(currentFolderPath);
      }
    });
  });
}

// Gestion du fil d'Ariane
function updateBreadcrumb(path: string) {
  const breadcrumbDiv = document.getElementById('breadcrumb');
  if (!breadcrumbDiv) return;
  
  // Si on n'a pas de dossier racine défini, le définir
  if (!currentRootFolder) {
    currentRootFolder = path;
  }
  
  // Calculer le chemin relatif par rapport au dossier racine
  let relativePath = path;
  if (path.startsWith(currentRootFolder)) {
    relativePath = path.substring(currentRootFolder.length);
    // Retirer le slash du début s'il existe
    if (relativePath.startsWith('/') || relativePath.startsWith('\\')) {
      relativePath = relativePath.substring(1);
    }
  }
  
  // Construire le fil d'Ariane
  const rootName = currentRootFolder;
  const pathParts = relativePath ? relativePath.split(/[\\\/]/).filter(p => p) : [];
  
  breadcrumbDiv.style.display = 'block';
  breadcrumbDiv.innerHTML = '';
  
  // Ajouter le dossier racine (toujours cliquable)
  const rootItem = document.createElement('span');
  rootItem.className = 'breadcrumb-item';
  rootItem.textContent = rootName;
  rootItem.addEventListener('click', () => {
    updateFolderContent(currentRootFolder!);
  });
  breadcrumbDiv.appendChild(rootItem);
  
  // Ajouter les sous-dossiers
  let currentPath = currentRootFolder;
  pathParts.forEach((part, index) => {
    // Ajouter le séparateur
    const separator = document.createElement('span');
    separator.className = 'breadcrumb-separator';
    separator.textContent = '>';
    breadcrumbDiv.appendChild(separator);
    
    // Construire le chemin complet pour ce niveau
    currentPath = path.substring(0, path.indexOf(part) + part.length);
    
    // Ajouter l'élément du fil d'Ariane
    const item = document.createElement('span');
    item.className = 'breadcrumb-item';
    item.textContent = part;
    
    // Seuls les dossiers intermédiaires sont cliquables, pas le dernier
    if (index < pathParts.length - 1) {
      const pathToNavigate = currentPath;
      item.addEventListener('click', () => {
        updateFolderContent(pathToNavigate);
      });
    } else {
      item.classList.add('disabled');
    }
    
    breadcrumbDiv.appendChild(item);
  });
}

// Mise à jour du bandeau d'information de la base de données
async function updateDbInfoBanner() {
  const dbSystem = document.getElementById('db-info-system');
  const dbPath = document.getElementById('db-info-path');
  const dbModeLabel = document.getElementById('db-info-mode-label');
  const dbMode = document.getElementById('db-info-mode');
  const dbSetModeLabel = document.getElementById('db-info-set-mode-label');
  const dbSetMode = document.getElementById('db-info-set-mode');
  const dbChdLabel = document.getElementById('db-info-chd-label');
  const dbChd = document.getElementById('db-info-chd');

  if (!dbPath || !dbSystem) return;

  // Helper pour afficher/masquer le mode DAT.
  // `inferred = true` indique que le mode a été déduit du nom du header
  // (DAT Pleasuredome strippé de cloneof/romof) : on affiche un ⚠️ pour
  // signaler que les fonctionnalités arcade avancées ne marcheront pas.
  const setModeVisibility = (mode: string | null, inferred: boolean = false) => {
    const display = mode && mode !== 'n/a' ? '' : 'none';
    if (dbModeLabel) dbModeLabel.style.display = display;
    if (dbMode) dbMode.style.display = display;
    if (dbMode && mode && mode !== 'n/a') {
      const labelMap: Record<string, { txt: string; title: string }> = {
        'split':      { txt: 'Split',      title: t('index.datMode.splitTitle') },
        'non-merged': { txt: 'Non-merged', title: t('index.datMode.nonMergedTitle') },
        'merged':     { txt: 'Merged',     title: t('index.datMode.mergedTitle') },
        'unknown':    { txt: t('common.unknown'), title: t('index.datMode.unknownTitle') }
      };
      const info = labelMap[mode] || { txt: mode, title: t('index.datMode.genericTitle', { mode }) };
      const inferredSuffix = inferred ? ' ⚠️' : '';
      const inferredNote = inferred ? '\n\n' + t('index.datMode.inferredNote') : '';
      dbMode.textContent = info.txt + inferredSuffix;
      dbMode.title = info.title + inferredNote;
    }
  };

  // Helper pour afficher/masquer la présence de CHD.
  // - `visible = false` : masque (pas de DB ouverte).
  // - Sinon : affiche "Oui" ou "Non" selon la présence de CHD dans le DAT.
  const setChdVisibility = (gamesWithDisks: number, totalDisks: number, visible: boolean = true) => {
    const display = visible ? '' : 'none';
    if (dbChdLabel) dbChdLabel.style.display = display;
    if (dbChd) dbChd.style.display = display;
    if (dbChd && visible) {
      if (gamesWithDisks > 0) {
        dbChd.textContent = t('common.yes');
        dbChd.title = t('index.chdInfo.hasDisksTitle', { disks: totalDisks, games: gamesWithDisks });
      } else {
        dbChd.textContent = t('common.no');
        dbChd.title = t('index.chdInfo.noDisksTitle');
      }
    }
  };

  // Helper pour afficher/masquer le mode du set scanné
  const setSetModeVisibility = (mode: string | null) => {
    const display = mode && mode !== 'n/a' ? '' : 'none';
    if (dbSetModeLabel) dbSetModeLabel.style.display = display;
    if (dbSetMode) dbSetMode.style.display = display;
    if (dbSetMode && mode && mode !== 'n/a') {
      const labelMap: Record<string, { txt: string; title: string }> = {
        'split':      { txt: 'Split',      title: t('index.setMode.splitTitle') },
        'non-merged': { txt: 'Non-merged', title: t('index.setMode.nonMergedTitle') },
        'merged':     { txt: 'Merged',     title: t('index.setMode.mergedTitle') },
        'unknown':    { txt: t('common.unknown'), title: t('index.setMode.unknownTitle') }
      };
      const info = labelMap[mode] || { txt: mode, title: t('index.setMode.genericTitle', { mode }) };
      dbSetMode.textContent = info.txt;
      dbSetMode.title = info.title;
    }
  };

  if (currentDbPath) {
    dbPath.textContent = currentDbPath;
    dbPath.title = currentDbPath;

    // Récupérer le système et le mode DAT depuis les metadata
    try {
      const systemName = await window.api.getDbMetadata('system_name');
      const systemId = await window.api.getDbMetadata('system_id');
      const datSetMode = await window.api.getDbMetadata('dat_set_mode');
      const datModeInferred = (await window.api.getDbMetadata('dat_set_mode_inferred')) === 'true';
      const scannedSetMode = await window.api.getDbMetadata('scanned_set_mode');
      const gamesWithDisks = parseInt(await window.api.getDbMetadata('dat_games_with_disks') || '0', 10);
      const totalDisks = parseInt(await window.api.getDbMetadata('dat_total_disks') || '0', 10);
      setModeVisibility(datSetMode, datModeInferred);
      setSetModeVisibility(scannedSetMode);
      setChdVisibility(gamesWithDisks, totalDisks);

      if (systemName && systemId) {
        dbSystem.textContent = `${systemName} (${systemId})`;
        dbSystem.title = t('index.systemInfo.title', { name: systemName, id: systemId });
        (dbSystem as HTMLElement).style.color = '';
        (dbSystem as HTMLElement).style.fontStyle = '';
      } else {
        dbSystem.textContent = t('index.systemInfo.toDefine');
        dbSystem.title = t('index.systemInfo.noSystemTitle');
        (dbSystem as HTMLElement).style.color = '#e67e22';
        (dbSystem as HTMLElement).style.fontStyle = 'italic';
        // Déclencher la modale de sélection manuelle (bloquante)
        await openSystemSelectionModal();
      }
    } catch {
      dbSystem.textContent = '';
      setModeVisibility(null);
      setSetModeVisibility(null);
      setChdVisibility(0, 0, false);
    }
  } else {
    // Vider les champs quand il n'y a pas de base de données
    dbSystem.textContent = '';
    dbSystem.title = '';
    dbPath.textContent = '';
    dbPath.title = '';
    setModeVisibility(null);
    setSetModeVisibility(null);
    setChdVisibility(0, 0, false);
  }
}

// Ouvre la modale de sélection système. Ne se ferme que sur "Valider" avec un système choisi.
async function openSystemSelectionModal(): Promise<void> {
  const modal = document.getElementById('system-selection-modal') as HTMLElement;
  const dropdown = document.getElementById('system-selection-dropdown') as HTMLSelectElement;
  const validateBtn = document.getElementById('system-selection-validate') as HTMLButtonElement;
  if (!modal || !dropdown || !validateBtn) return;

  // Importer dynamiquement le registre central
  const { getSystemsGrouped } = await import('../config/systems.js');
  const grouped = getSystemsGrouped();

  // Construire la liste : <optgroup label="Manufacturer (type)"><option value="systemId">Fullname</option></optgroup>
  dropdown.innerHTML = '';
  // Manufacturer triés alphabétiquement
  const sortedManufacturers = [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [manufacturer, byType] of sortedManufacturers) {
    const sortedTypes = [...byType.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [type, systems] of sortedTypes) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = `${manufacturer} — ${type}`;
      for (const sys of [...systems].sort((a, b) => a.fullname.localeCompare(b.fullname))) {
        const opt = document.createElement('option');
        opt.value = sys.systemId;
        opt.textContent = sys.fullname;
        optgroup.appendChild(opt);
      }
      dropdown.appendChild(optgroup);
    }
  }

  return new Promise<void>((resolve) => {
    validateBtn.disabled = true;
    dropdown.value = '';

    const onChange = () => {
      validateBtn.disabled = !dropdown.value;
    };
    dropdown.addEventListener('change', onChange);

    const onValidate = async () => {
      if (!dropdown.value) return;
      const systemId = dropdown.value;
      const selectedOpt = dropdown.options[dropdown.selectedIndex];
      const fullname = selectedOpt.textContent || systemId;

      try {
        await window.api.setDbMetadata('system_id', systemId);
        await window.api.setDbMetadata('system_name', fullname);
        log('logs.dat.systemSetManually', { params: { name: fullname, id: systemId }, context: 'dat', state: 'success' });

        // Si l'option "Dossier multi-système" est active, recalculer le dossier cible
        // effectif (qui inclut maintenant le sous-dossier du système) et l'ajouter à
        // la base. Le dossier parent éventuellement ajouté à la création reste tel quel.
        const settings = await window.api.getSettings();
        if (settings.validatedRomsMultiSystem) {
          try {
            const newEffective = await window.api.getEffectiveValidatedFolder();
            if (newEffective && newEffective !== targetFolderPath) {
              targetFolderPath = newEffective;
              await window.api.setDbMetadata('target_folder', newEffective);
              log('logs.folder.targetUpdated', { params: { path: newEffective }, context: 'folder', state: 'loading' });
              const stats = await window.api.addRomsFolder(newEffective);
              log('logs.folder.targetScanned', { params: { count: stats.length }, context: 'folder', state: 'success' });
              const rootFolders = await window.api.getRootFolders();
              loadedFolders = rootFolders;
              updateLeftSidebar();
              updateWorkflowButtons();
            }
          } catch (folderError: any) {
            log('logs.folder.targetUpdateError', { params: { error: String(folderError?.message || folderError) }, severity: 'warning', context: 'folder' });
          }
        }
      } catch (error: any) {
        log('logs.dat.systemSaveError', { params: { error: String(error?.message || error) }, severity: 'error', context: 'dat' });
      }

      // Fermer la modale et rafraîchir le bandeau
      modal.style.display = 'none';
      dropdown.removeEventListener('change', onChange);
      validateBtn.removeEventListener('click', onValidate);
      await updateDbInfoBanner();
      resolve();
    };
    validateBtn.addEventListener('click', onValidate);

    // Bloquer la touche Escape
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    modal.addEventListener('keydown', onKeyDown, true);

    modal.style.display = 'flex';
    dropdown.focus();
  });
}

// Fonction centralisée pour mettre à jour l'état des boutons workflow et des menus
function updateWorkflowButtons() {
  const elements = {
    datLoad: document.getElementById('dat-load') as HTMLButtonElement,
    romAddFolder: document.getElementById('rom-add-folder') as HTMLButtonElement,
    romAddFolderSidebar: document.getElementById('rom-add-folder-sidebar') as HTMLButtonElement,
    matchRoms: document.getElementById('match-roms') as HTMLButtonElement,
    consolidateRoms: document.getElementById('consolidate-roms') as HTMLButtonElement
  };

  // Logique de mise à jour basée sur l'état de l'application

  // Bouton "Charger DAT/XML" : toujours disponible.
  // Sans base → charge un DAT primaire (crée la base). Avec base → DAT complémentaire.
  if (elements.datLoad) {
    elements.datLoad.disabled = false;
  }

  // Boutons "Ajouter dossier ROMs" : disponibles si une base est ouverte avec un DAT chargé
  const canAddRoms = currentDbPath !== null && currentDatInfo !== null;
  if (elements.romAddFolder) {
    elements.romAddFolder.disabled = !canAddRoms;
  }
  if (elements.romAddFolderSidebar) {
    elements.romAddFolderSidebar.disabled = !canAddRoms;
  }

  // Bouton "Matcher les ROMs" : disponible si des dossiers de ROMs ont été ajoutés
  if (elements.matchRoms) {
    elements.matchRoms.disabled = !(canAddRoms && loadedFolders.length > 0);
  }

  // Bouton "Consolider les ROMs" : disponible si le matching a été effectué
  if (elements.consolidateRoms) {
    elements.consolidateRoms.disabled = !matchingComplete;
  }

  // Mettre à jour l'état des entrées du menu principal.
  // Charger un DAT est toujours possible : sans base → primaire (création),
  // avec base → complémentaire (fusion).
  const canLoadDat = true;
  const canCloseDatabase = currentDbPath !== null; // On peut fermer la DB si une DB est ouverte

  window.api.updateMenuState({
    canLoadDat,
    canAddFolder: canAddRoms,
    canCloseDatabase
  });
}

// Réinitialisation de l'interface
function resetInterface() {
  currentDatPath = null;
  currentDbPath = null;
  currentDatInfo = null;
  loadedFolders = [];
  selectedElement = null;
  currentFolderPath = null;
  currentRootFolder = null; // Réinitialiser le dossier racine
  breadcrumbPath = [];
  matchingComplete = false;
  targetFolderPath = null;

  // Purger l'état mémoire de la vue DAT — sans ça, la barre de filtres/groupement
  // restée câblée sur allGames re-affichait la liste des jeux de la base fermée
  // au moindre clic sur un filtre ou le select de groupement.
  allGames = [];
  categoryCounts = new Map();
  matchStatusCounts = new Map();
  autoSelectedIds = new Set();
  autoSelectedReasons = {};
  collapsedGameGroups.clear();
  activeFilters.clear();
  activeMatchFilters.clear();
  activeSelectionFilters.clear();
  activeChangeFilters.clear();
  activeChdFilters.clear();
  activeDriverFilters.clear();
  activeMameFilters.clear();

  // Masquer les barres liées à la vue DAT (réaffichées au prochain chargement)
  const groupFilterBar = document.getElementById('group-filter-bar');
  if (groupFilterBar) groupFilterBar.style.display = 'none';
  const selectAllBar = document.getElementById('select-all-bar');
  if (selectAllBar) selectAllBar.style.display = 'none';
  const searchBar = document.getElementById('search-bar');
  if (searchBar) searchBar.style.display = 'none';
  const activeFiltersBar = document.getElementById('active-filters-bar');
  if (activeFiltersBar) activeFiltersBar.classList.remove('visible');

  // Vider les dropdowns de filtres (reconstruits au prochain chargement)
  for (const id of ['category-filters-container', 'match-status-filters-container',
                    'selection-filters-container', 'change-status-filters-container',
                    'chd-filters-container', 'driver-status-filters-container',
                    'mame-filters-container']) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  }

  // Réinitialiser le compteur global et le volet de détails
  const counters = document.getElementById('global-counters');
  if (counters) counters.innerHTML = '';
  const detailView = document.getElementById('detail-view');
  if (detailView) {
    detailView.innerHTML = `
      <div class="detail-header">${t('index.details.header')}</div>
      <div style="padding: 10px; color: #7f8c8d;">
        ${t('index.details.empty')}
      </div>
    `;
  }

  // Masquer le bandeau d'info DB
  updateDbInfoBanner();

  const elements = {
    datLoad: document.getElementById('dat-load') as HTMLButtonElement,
    romAddFolder: document.getElementById('rom-add-folder') as HTMLButtonElement,
    romAddFolderSidebar: document.getElementById('rom-add-folder-sidebar') as HTMLButtonElement,
    matchRoms: document.getElementById('match-roms') as HTMLButtonElement,
    consolidateRoms: document.getElementById('consolidate-roms') as HTMLButtonElement
  };

  if (elements.datLoad) elements.datLoad.disabled = false;
  if (elements.romAddFolder) elements.romAddFolder.disabled = true;
  if (elements.romAddFolderSidebar) elements.romAddFolderSidebar.disabled = true;
  if (elements.matchRoms) elements.matchRoms.disabled = true;
  if (elements.consolidateRoms) elements.consolidateRoms.disabled = true;

  updateLeftSidebar();

  const gameList = document.getElementById('game-list');
  if (gameList) {
    gameList.innerHTML = `
      <div style="padding: 40px; text-align: center; color: #7f8c8d;">
        <h3>${t('index.welcome.title')}</h3>
        <p style="margin-top: 20px;">${t('index.welcome.intro')}</p>
        <ol style="text-align: left; display: inline-block; margin-top: 10px;">
          <li>${t('index.welcomeReset.step1')}</li>
          <li>${t('index.welcomeReset.step2')}</li>
          <li>${t('index.welcomeReset.step3')}</li>
          <li>${t('index.welcomeReset.step4')}</li>
        </ol>
      </div>
    `;
  }

  const breadcrumb = document.getElementById('breadcrumb');
  if (breadcrumb) breadcrumb.style.display = 'none';

  const viewControls = document.getElementById('view-controls');
  if (viewControls) viewControls.style.display = 'none';
}

// Mise à jour du volet gauche
function updateLeftSidebar() {
  const datList = document.getElementById('dat-list');
  const folderList = document.getElementById('folder-list');

  // Section "Fichier DAT" - afficher uniquement les informations du DAT
  if (datList) {
    datList.innerHTML = '';
    if (currentDatPath && currentDatInfo) {
      const div = document.createElement('div');
      div.className = 'sidebar-item';

      const datFileName = currentDatPath.split(/[\\\/]/).pop() || t('index.datDetails.fallbackName');

      div.innerHTML = `
        <div class="dat-header" style="display: flex; justify-content: space-between; align-items: center; font-weight: 600; margin-bottom: 5px;">
          <span>${datFileName}</span>
          <button class="dat-toggle-btn collapsed" title="${t('index.datDetails.toggleTitle')}">
            <span class="chevron">▲</span>
          </button>
        </div>
        <div class="dat-details collapsed" style="font-size: 11px; color: #7f8c8d; line-height: 1.4;">
          ${currentDatInfo.name ? `<div><strong>${t('index.datDetails.name')}</strong> ${currentDatInfo.name}</div>` : ''}
          ${currentDatInfo.description ? `<div><strong>${t('index.datDetails.description')}</strong> ${currentDatInfo.description}</div>` : ''}
          ${currentDatInfo.version ? `<div><strong>${t('index.datDetails.version')}</strong> ${currentDatInfo.version}</div>` : ''}
          ${currentDatInfo.date ? `<div><strong>${t('index.datDetails.date')}</strong> ${currentDatInfo.date}</div>` : ''}
          ${currentDatInfo.author ? `<div><strong>${t('index.datDetails.author')}</strong> ${currentDatInfo.author}</div>` : ''}
          ${currentDatInfo.homepage ? `<div><strong>Homepage:</strong> ${currentDatInfo.homepage}</div>` : ''}
          ${currentDatInfo.url ? `<div><strong>URL:</strong> ${currentDatInfo.url}</div>` : ''}
        </div>
      `;

      // Gestion du clic sur le bouton chevron
      const toggleBtn = div.querySelector('.dat-toggle-btn') as HTMLButtonElement;
      const detailsDiv = div.querySelector('.dat-details') as HTMLDivElement;

      toggleBtn?.addEventListener('click', (e) => {
        e.stopPropagation(); // Empêcher la sélection du sidebar-item
        toggleBtn.classList.toggle('collapsed');
        detailsDiv.classList.toggle('collapsed');
      });

      // Gestion du clic sur l'élément (sauf le bouton)
      div.addEventListener('click', (e) => {
        if (!(e.target as HTMLElement).closest('.dat-toggle-btn')) {
          selectSidebarItem(div, 'dat', currentDbPath!);
        }
      });

      // Menu contextuel sur le DAT
      div.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showDatContextMenu(e);
      });

      datList.appendChild(div);
    }
  }
  
  if (folderList) {
    folderList.innerHTML = '';
    loadedFolders.forEach(folder => {
      const div = document.createElement('div');
      const isTarget = targetFolderPath !== null && folder.path === targetFolderPath;
      div.className = 'sidebar-item' + (isTarget ? ' target-folder' : '');
      div.dataset.type = 'folder';
      div.dataset.path = folder.path;

      const parts = folder.path.replace(/\\/g, '/').split('/');
      const name = parts.pop() || folder.path;
      const parentPath = parts.join('/');
      const badge = isTarget ? `<span class="target-folder-badge">${t('index.folders.targetBadge')}</span>` : '';
      div.innerHTML = `
        <div class="folder-header" style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 11px; color: #7f8c8d; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${folder.path}">${parentPath}/</div>
            <div style="font-weight: 600; margin-bottom: 2px;">${name}${badge}</div>
            <div style="font-size: 11px; color: #7f8c8d;">${t('index.folders.filesCount', { count: folder.fileCount })}</div>
          </div>
          <button class="folder-remove-btn" title="${t('index.folders.removeTitle')}">×</button>
        </div>
      `;

      // Gestion du clic sur le bouton de suppression
      const removeBtn = div.querySelector('.folder-remove-btn') as HTMLButtonElement;
      removeBtn?.addEventListener('click', async (e) => {
        e.stopPropagation(); // Empêcher la sélection du sidebar-item

        // Ne pas permettre la suppression du dossier cible
        if (targetFolderPath !== null && folder.path === targetFolderPath) return;

        const confirmed = confirm(t('index.confirm.removeFolderFromDb', { path: folder.path }));
        if (confirmed) {
          try {
            await window.api.removeFolder(folder.path);
            log('logs.folder.removedFromDb', { params: { path: folder.path }, context: 'folder', state: 'deleted' });

            // Retirer de la liste
            loadedFolders = loadedFolders.filter(f => f.path !== folder.path);
            updateLeftSidebar();

            // Mettre à jour l'état des boutons workflow
            updateWorkflowButtons();
          } catch (error) {
            log('logs.folder.removeError', { params: { error: error instanceof Error ? error.message : String(error) }, severity: 'error', context: 'folder' });
          }
        }
      });

      // Clic gauche pour sélectionner (sauf sur le bouton)
      div.addEventListener('click', (e) => {
        if (!(e.target as HTMLElement).closest('.folder-remove-btn')) {
          selectSidebarItem(div, 'folder', folder.path);
        }
      });

      // Clic droit pour menu contextuel
      div.addEventListener('contextmenu', (e) => showContextMenu(e, div));

      folderList.appendChild(div);
    });
  }

  //displayInitialReport(0, 0);
  initMatchingUI();
}

// Sélection d'un élément dans le volet gauche
function selectSidebarItem(element: HTMLElement, type: 'dat' | 'folder', path: string) {
  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.classList.remove('active');
  });
  
  element.classList.add('active');
  selectedElement = { type, value: path };
  
  // Si c'est un dossier, définir comme dossier racine
  if (type === 'folder') {
    currentRootFolder = path;
  }
  
  updateCenterContent(type, path);
}

// ============================================================================
// GESTION DES SECTIONS REPLIABLES (COLLAPSE)
// ============================================================================

function setupCollapsibleSections() {
  const collapseButtons = document.querySelectorAll('.collapse-btn');
  
  collapseButtons.forEach(button => {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const targetId = button.getAttribute('data-target');
      if (!targetId) return;
      
      const targetElement = document.getElementById(targetId);
      if (!targetElement) return;
      
      // Toggle les classes
      button.classList.toggle('collapsed');
      targetElement.classList.toggle('collapsed');
      
      // Sauvegarder l'état dans localStorage
      const isCollapsed = targetElement.classList.contains('collapsed');
      localStorage.setItem(`section-${targetId}-collapsed`, isCollapsed.toString());
    });
  });
  
  // Restaurer l'état sauvegardé
  collapseButtons.forEach(button => {
    const targetId = button.getAttribute('data-target');
    if (!targetId) return;
    
    const savedState = localStorage.getItem(`section-${targetId}-collapsed`);
    if (savedState === 'true') {
      const targetElement = document.getElementById(targetId);
      if (targetElement) {
        button.classList.add('collapsed');
        targetElement.classList.add('collapsed');
      }
    }
  });
}

// Mise à jour du contenu central
async function updateCenterContent(type: 'dat' | 'folder', path: string) {
  const gameList = document.getElementById('game-list');
  if (!gameList) return;
  
  gameList.innerHTML = `<div style="padding: 20px; text-align: center;">${t('common.loading')}</div>`;

  try {
    if (type === 'dat') {
      const games = await window.api.listGames();

      // Charger les statuts de matching et les merger dans les jeux
      try {
        const statuses = await window.api.getGameMatchStatuses();
        const statusMap = new Map<number, string>();
        for (const s of statuses) {
          statusMap.set(s.gameId, s.status);
        }
        for (const game of games) {
          const status = statusMap.get(game.id);
          game.match_status = status as GameInfo['match_status'];
        }
      } catch {
        // Matching pas encore effectué, pas de statut
      }

      // Charger les jeux disparus s'il y a eu une mise à jour du DAT
      const hasChangeStatus = games.some((g: GameInfo) => g.change_status);
      if (hasChangeStatus) {
        try {
          const disappeared = await window.api.getDisappearedGames();
          for (const dg of disappeared) {
            games.push({
              id: -(dg.id || 0), // ID négatif pour éviter les conflits
              name: dg.name,
              description: dg.description || undefined,
              category: dg.category || undefined,
              is_selected: dg.is_selected ?? 0,
              change_status: 'disappeared',
              is_disappeared: true
            });
          }
        } catch {
          // Pas de jeux disparus ou table inexistante
        }
      }

      // Phase 4 — Masquer les entrées du DAT qui n'ont ni ROM ni disque (devices
      // logiques type i8085/tms9928a, certains BIOS exotiques). Sans intérêt
      // dans la liste car non matchables et non consolidables. Elles restent
      // en DB pour la cascade de dépendances (resolveDependencies les traverse
      // toujours via game_relationships).
      // On garde en revanche les jeux avec seulement un CHD (disque orphelin),
      // qui doivent rester consultables et filtrables.
      const visibleGames = games.filter((g: GameInfo) => ((g.rom_count ?? 0) + (g.disk_count ?? 0)) > 0);
      const hiddenCount = games.length - visibleGames.length;
      if (hiddenCount > 0) {
        console.log(`[games:list] ${hiddenCount} ROM-less entry(ies) hidden from the list (empty devices, etc.)`);
      }

      // Sauvegarder les jeux et recalculer les compteurs (sans effacer les filtres actifs)
      allGames = visibleGames;
      categoryCounts = extractCategoryCounts(visibleGames);
      matchStatusCounts = extractMatchStatusCounts(visibleGames);

      // Phase 3bis-B : pré-calculer hasParentInDb + cloneCount (utilisés en vue merged)
      // et rafraîchir le mode cible depuis settings.
      computeParentCloneRelations(allGames);
      await refreshTargetSetMode();

      // Résoudre les dépendances arcade (parents/BIOS/devices auto-requis selon le mode cible)
      await refreshDependencyResolution();

      // Nettoyer les filtres qui ne correspondent plus aux données actuelles
      // (basés sur visibleGames car les entrées sans ROM sont masquées de la liste).
      for (const f of activeFilters) {
        if (!categoryCounts.has(f)) activeFilters.delete(f);
      }
      for (const f of activeMatchFilters) {
        if (!matchStatusCounts.has(f)) activeMatchFilters.delete(f);
      }
      // Nettoyer les filtres d'évolution DAT (invalides si pas de change_status)
      const hasChangeData = visibleGames.some((g: GameInfo) => g.change_status);
      if (!hasChangeData) {
        activeChangeFilters.clear();
      } else {
        const validStatuses = new Set(visibleGames.map((g: GameInfo) => g.change_status).filter(Boolean) as string[]);
        for (const f of activeChangeFilters) {
          if (!validStatuses.has(f)) activeChangeFilters.delete(f);
        }
      }
      // Nettoyer les filtres de sélection (basés sur visibleGames)
      for (const f of activeSelectionFilters) {
        if (f === 'selected' && !visibleGames.some((g: GameInfo) => g.is_selected !== 0 && !g.is_disappeared)) activeSelectionFilters.delete(f);
        if (f === 'unselected' && !visibleGames.some((g: GameInfo) => g.is_selected === 0 && !g.is_disappeared)) activeSelectionFilters.delete(f);
        // 'auto' nettoyé après refreshDependencyResolution car dépend de autoSelectedIds
      }

      // Générer les filtres (en restaurant l'état actif)
      generateCategoryFilters();
      generateMatchStatusFilters();
      generateSelectionFilters();
      generateChangeStatusFilters();
      generateChdFilter();
      generateDriverStatusFilter();
      generateMameFilter();

      // Restaurer la valeur du select de groupement
      const groupBySelect = document.getElementById('group-by') as HTMLSelectElement;
      if (groupBySelect) groupBySelect.value = currentGroupBy;

      // Afficher les jeux
      applyFiltersAndGrouping();

      // Afficher la barre de groupement/filtrage et la barre de sélection
      const groupFilterBar = document.getElementById('group-filter-bar');
      if (groupFilterBar) groupFilterBar.style.display = 'block';
      const selectAllBar = document.getElementById('select-all-bar');
      if (selectAllBar) selectAllBar.style.display = 'flex';
      updateGroupFilterSummary();

      // Masquer les contrôles de vue et le breadcrumb
      const viewControls = document.getElementById('view-controls');
      if (viewControls) viewControls.style.display = 'none';
      const breadcrumb = document.getElementById('breadcrumb');
      if (breadcrumb) breadcrumb.style.display = 'none';

      // Afficher la barre de recherche pour les jeux DAT
      const searchBar = document.getElementById('search-bar');
      if (searchBar) {
        searchBar.style.display = 'flex';
        // Mettre le scope sur "Jeux DAT" automatiquement
        const searchScope = document.getElementById('search-scope') as HTMLSelectElement;
        if (searchScope) {
          searchScope.value = 'games';
        }
      }
    } else {
      currentFolderPath = path;
      await updateFolderContent(path);

      // Masquer la barre de groupement/filtrage, les filtres actifs et la barre de sélection pour les dossiers
      const groupFilterBar = document.getElementById('group-filter-bar');
      if (groupFilterBar) groupFilterBar.style.display = 'none';
      const activeFiltersBar = document.getElementById('active-filters-bar');
      if (activeFiltersBar) activeFiltersBar.classList.remove('visible');
      const selectAllBar = document.getElementById('select-all-bar');
      if (selectAllBar) selectAllBar.style.display = 'none';

      // Afficher les contrôles de vue
      const viewControls = document.getElementById('view-controls');
      if (viewControls) viewControls.style.display = 'flex';

      // Afficher la barre de recherche pour les dossiers
      const searchBar = document.getElementById('search-bar');
      if (searchBar) {
        searchBar.style.display = 'flex';
        // Mettre le scope sur "Fichiers ROMs" automatiquement
        const searchScope = document.getElementById('search-scope') as HTMLSelectElement;
        if (searchScope) {
          searchScope.value = 'files';
        }
      }
    }
    
    // Réinitialiser la recherche quand on change de contexte
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    const searchClear = document.getElementById('search-clear') as HTMLButtonElement;
    if (searchInput && searchClear) {
      searchInput.value = '';
      currentSearchQuery = '';
      searchClear.style.display = 'none';
      originalContent = []; // Réinitialiser le contenu original sauvegardé
    }
  } catch (error) {
    gameList.innerHTML = `<div style="padding: 20px; color: #e74c3c;">${t('common.errorWithDetail', { error: String(error) })}</div>`;
  }
}

/*async function updateCenterContent(type: 'dat' | 'folder', path: string) {
  const gameList = document.getElementById('game-list');
  if (!gameList) return;
  
  gameList.innerHTML = `<div style="padding: 20px; text-align: center;">${t('common.loading')}</div>`;
  
  try {
    if (type === 'dat') {
      const games = await window.api.listGames();
      displayGames(games);
      
      // Masquer les contrôles de vue et le breadcrumb
      const viewControls = document.getElementById('view-controls');
      if (viewControls) viewControls.style.display = 'none';
      const breadcrumb = document.getElementById('breadcrumb');
      if (breadcrumb) breadcrumb.style.display = 'none';
    } else {
      currentFolderPath = path;
      await updateFolderContent(path);
      
      // Afficher les contrôles de vue
      const viewControls = document.getElementById('view-controls');
      if (viewControls) viewControls.style.display = 'flex';
    }
  } catch (error) {
    gameList.innerHTML = `<div style="padding: 20px; color: #e74c3c;">${t('common.errorWithDetail', { error: String(error) })}</div>`;
  }
}*/

// Mise à jour du contenu d'un dossier
async function updateFolderContent(path: string) {
  const gameList = document.getElementById('game-list');
  if (!gameList) return;
  
  currentFolderPath = path;
  updateBreadcrumb(path);
  
  try {
    const content = await window.api.listFolderContents(path, viewMode);
    
    gameList.innerHTML = '';
    
    if (content.folders.length === 0 && content.files.length === 0) {
      gameList.innerHTML = `<div style="padding: 20px; text-align: center; color: #7f8c8d;">${t('index.folderView.empty')}</div>`;
      return;
    }
    
    // En vue hiérarchique, afficher les sous-dossiers
    if (viewMode === 'hierarchical') {
      content.folders.forEach((folder: any) => {
        const item = document.createElement('div');
        item.className = 'list-item folder';
        // Définir dataset.path AVANT le rendu pour que showContextMenu puisse le lire
        item.dataset.path = folder.path;
        item.innerHTML = `
          <div>
            <div class="list-item-name">📁 ${folder.name}</div>
            <div class="list-item-info">${t('index.folders.filesCount', { count: folder.fileCount })}</div>
          </div>
        `;

        item.addEventListener('click', () => {
          updateFolderContent(folder.path);
        });

        item.addEventListener('contextmenu', (e) => {
          showContextMenu(e, item, { isSubfolder: true });
        });

        gameList.appendChild(item);
      });
    }
    
    // Afficher les fichiers
    if (content.files.length > 0) {
      // Récupérer les infos de matching pour tous les fichiers du dossier
      const fileIds = content.files.map((f: any) => f.id).filter(Boolean);
      let matchInfoMap: Record<number, any> = {};
      if (fileIds.length > 0 && matchingComplete) {
        try {
          matchInfoMap = await window.api.getFilesMatchInfo(fileIds);
        } catch { /* ignore */ }
      }
      displayFiles(content.files, matchInfoMap);
    } else if (viewMode === 'flat') {
      // En vue à plat, si pas de fichiers, afficher un message
      gameList.innerHTML = `<div style="padding: 20px; text-align: center; color: #7f8c8d;">${t('index.folderView.noFilesFlat')}</div>`;
    }
  } catch (error) {
    gameList.innerHTML = `<div style="padding: 20px; color: #e74c3c;">${t('common.errorWithDetail', { error: String(error) })}</div>`;
  }
}

// Récupérer l'icône de catégorie d'un jeu
function getIconGameCategory(category: string | undefined) {
  let icon = icons.state['question'];

  if (category === 'Games') {
    icon = icons.context['game'];
  } else if (category === 'Demos' || category === 'Coverdiscs') {
    icon = icons.context['demo'];
  } else if (category === 'Bonus Discs' || category === 'Add-Ons') {
    icon = icons.context['extra'];
  } else if (category === 'Applications') {
    icon = icons.context['application'];
  } else if (category === 'Audio') {
    icon = icons.context['audio'];
  } else if (category === 'Multimedia') {
    icon = icons.context['multimedia'];
  } else if (category === 'Video') {
    icon = icons.context['video'];
  } else if (category === 'Educational') {
    icon = icons.context['educational'];
  } else if (category === 'Preproduction') {
    icon = icons.context['preproduction'];
  }

  return icon;
}

// Affichage des jeux
// Ligne d'info « contenu de l'archive » : nombre de ROMs (fichiers) et, pour les
// DAT MAME, nombre de disques CHD liés. Les CHD ne sont pas comptés comme des ROMs.
// Le compteur de disques n'est affiché que si le jeu en possède au moins un.
function getGameContentInfoHtml(game: GameInfo): string {
  const romCount = game.rom_count ?? 0;
  const diskCount = game.disk_count ?? 0;
  const romPart = `📄 ${t('index.gamesView.fileCount', { count: romCount })}`;
  const diskPart = diskCount > 0
    ? ` &nbsp;·&nbsp; 💿 ${t('index.gamesView.diskCount', { count: diskCount })}`
    : '';
  return `<div class="list-item-info">${romPart}${diskPart}</div>`;
}

function displayGames(games: GameInfo[]) {
  const gameList = document.getElementById('game-list');
  if (!gameList) return;

  // Préserver la position de scroll à travers les re-renders
  const savedScrollTop = gameList.scrollTop;

  gameList.innerHTML = '';
  gameList.classList.remove('has-groups');

  if (games.length === 0) {
    gameList.innerHTML = `<div style="padding: 20px; text-align: center;">${t('index.gamesView.noGames')}</div>`;
    return;
  }

  //const icon = icons.context['game'];
  //const icon = icons.state['question'];
  //let icon = icons.state['question'];

  games.forEach(game => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.dataset.gameId = game.id.toString();

    /*if (game.category === 'Games') {
      icon = icons.context['game'];
    } else if (game.category === 'Demos' || game.category === 'Coverdiscs') {
      icon = icons.context['demo'];
    } else if (game.category === 'Bonus Discs' || game.category === 'Add-Ons') {
      icon = icons.context['extra'];
    } else if (game.category === 'Applications') {
      icon = icons.context['application'];
    } else if (game.category === 'Audio') {
      icon = icons.context['audio'];
    } else if (game.category === 'Multimedia') {
      icon = icons.context['multimedia'];
    } else if (game.category === 'Video') {
      icon = icons.context['video'];
    } else if (game.category === 'Educational') {
      icon = icons.context['educational'];
    } else if (game.category === 'Preproduction') {
      icon = icons.context['preproduction'];
    }*/
    let icon = getIconGameCategory(game.category);

    const isDisappeared = !!game.is_disappeared;
    const isUserSelected = !isDisappeared && game.is_selected !== 0;
    const isAuto = autoSelectedIds.has(game.id) && !isUserSelected;
    const isChecked = isUserSelected || isAuto;
    const lockBadge = isAuto
      ? `<span class="auto-lock-badge" title="${formatAutoReasons(game.id).replace(/"/g, '&quot;')}">🔒</span> `
      : '';
    // Phase 3bis-B : en vue merged, afficher le nombre de clones fusionnés.
    const cloneBadge = (currentTargetSetMode === 'merged' && (game.cloneCount || 0) > 0)
      ? ` <span class="clone-count-badge" title="${t('index.gamesView.cloneBadgeTitle', { count: game.cloneCount! })}">🌀 +${game.cloneCount}</span>`
      : '';

    item.innerHTML = `
      <input type="checkbox" class="game-checkbox" data-game-id="${game.id}" ${isChecked ? 'checked' : ''} ${isDisappeared || isAuto ? 'disabled' : ''}>
      <div style="flex: 1; min-width: 0;">
        <div class="list-item-name">${lockBadge}${icon} ${game.name}${cloneBadge}${getChangeStatusBadgeHtml(game)}</div>
        ${game.description ? `<div class="list-item-info">${game.description}</div>` : ''}
        ${game.category ? `<div class="list-item-info"><strong>${t('index.gamesView.categoryLabel')}</strong> ${game.category}</div>` : ''}
        ${getGameContentInfoHtml(game)}
      </div>
      ${isDisappeared ? '' : getMatchStatusBadgeHtml(game)}
    `;

    if (isDisappeared) {
      item.classList.add('disappeared');
    } else if (isAuto) {
      item.classList.add('auto-selected');
    } else if (!isChecked) {
      item.classList.add('deselected');
    }

    // Checkbox click handler (pas pour les jeux disparus ni auto-sélectionnés)
    if (!isDisappeared && !isAuto) {
      const checkbox = item.querySelector('.game-checkbox') as HTMLInputElement;
      checkbox.addEventListener('click', async (e) => {
        e.stopPropagation();
        const selected = checkbox.checked;
        game.is_selected = selected ? 1 : 0;
        item.classList.toggle('deselected', !selected);
        await window.api.updateGameSelection(game.id, selected);
        // Recalculer la cascade : un changement de sélection peut faire apparaître
        // ou disparaître des auto-sélections de parents / BIOS / devices.
        await refreshDependencyResolution();
        applyFiltersAndGrouping();
        updateSelectAllCheckbox();
        generateSelectionFilters();
      });
    }

    // Clic sur le badge "MODIFIÉ" → afficher le détail des changements
    const changeBadge = item.querySelector('.change-status-badge.status-modified') as HTMLElement;
    if (changeBadge) {
      changeBadge.style.cursor = 'pointer';
      changeBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        showGameDiffDetail(game.name);
      });
    }

    if (!isDisappeared) {
      item.addEventListener('click', () => selectGame(item, game));
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showGameContextMenu(e, game);
      });
    }
    gameList.appendChild(item);
  });

  // Restaurer la position de scroll (préservée en début de fonction)
  gameList.scrollTop = savedScrollTop;

  updateSelectAllCheckbox();
}

// Extraction des catégories et comptage
function extractCategoryCounts(games: GameInfo[]): Map<string, number> {
  const counts = new Map<string, number>();

  games.forEach(game => {
    const category = game.category || t('index.filters.uncategorized');
    counts.set(category, (counts.get(category) || 0) + 1);
  });

  return counts;
}

// Création d'un dropdown de filtrage avec checkboxes
function createFilterDropdown(
  containerId: string,
  label: string,
  items: Array<{ key: string; displayName: string; count: number }>,
  activeSet: Set<string>,
  onChangeCallback: () => void
) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '';

  if (items.length === 0) return;

  const dropdown = document.createElement('div');
  dropdown.className = 'filter-dropdown';

  const activeCount = activeSet.size;
  const btn = document.createElement('button');
  btn.className = 'filter-dropdown-btn';
  btn.type = 'button';
  btn.innerHTML = `
    ${label}${activeCount > 0 ? ` <span class="filter-active-count">(${activeCount})</span>` : ''}
    <span class="chevron">▼</span>
  `;

  const menu = document.createElement('div');
  menu.className = 'filter-dropdown-menu';

  function updateBtnCount() {
    const newCount = activeSet.size;
    const countSpan = btn.querySelector('.filter-active-count');
    if (newCount > 0) {
      if (countSpan) {
        countSpan.textContent = `(${newCount})`;
      } else {
        const span = document.createElement('span');
        span.className = 'filter-active-count';
        span.textContent = `(${newCount})`;
        btn.insertBefore(span, btn.querySelector('.chevron'));
      }
    } else if (countSpan) {
      countSpan.remove();
    }
  }

  items.forEach(item => {
    const labelEl = document.createElement('label');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = item.key;
    checkbox.checked = activeSet.has(item.key);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'filter-item-name';
    nameSpan.innerHTML = item.displayName;

    const countSpan = document.createElement('span');
    countSpan.className = 'filter-item-count';
    countSpan.textContent = String(item.count);

    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        activeSet.add(item.key);
      } else {
        activeSet.delete(item.key);
      }
      updateBtnCount();
      onChangeCallback();
    });

    labelEl.appendChild(checkbox);
    labelEl.appendChild(nameSpan);
    labelEl.appendChild(countSpan);
    menu.appendChild(labelEl);
  });

  // Empêcher la fermeture du dropdown quand on clique dans le menu
  menu.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    // Fermer les autres dropdowns ouverts
    document.querySelectorAll('.filter-dropdown-menu.open').forEach(m => {
      if (m !== menu) m.classList.remove('open');
    });
    menu.classList.toggle('open');
  });

  dropdown.appendChild(btn);
  dropdown.appendChild(menu);
  container.appendChild(dropdown);
}

// Fermer les dropdowns en cliquant en dehors
document.addEventListener('click', () => {
  document.querySelectorAll('.filter-dropdown-menu.open').forEach(m => m.classList.remove('open'));
});

// Génération du dropdown de filtrage par catégorie
function generateCategoryFilters() {
  const sortedCategories = Array.from(categoryCounts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const items = sortedCategories.map(([category, count]) => ({
    key: category,
    displayName: category,
    count
  }));

  createFilterDropdown('category-filters-container', 'Catégorie', items, activeFilters, () => {
    applyFiltersAndGrouping();
    updateGroupFilterSummary();
  });
}

// Labels et icônes pour les statuts de matching.
// Fonction (et non constante) : les traductions ne sont pas encore chargées à l'import du module.
function matchStatusLabel(status: string): string {
  return t(`index.matchStatus.${status}`);
}

const matchStatusIcons: Record<string, string> = {
  'unknown': '❓',
  'missing': '❌',
  'partial': '⚠️',
  'complete': '✅'
};

const matchStatusOrder = ['complete', 'partial', 'missing', 'unknown'];

function getMatchStatusBadgeHtml(game: GameInfo): string {
  const status = getGameMatchStatus(game);
  const icon = matchStatusIcons[status];
  const label = matchStatusLabel(status);
  return `<span class="match-status-badge status-${status}">${icon} ${label}</span>`;
}

function getChangeStatusBadgeHtml(game: GameInfo): string {
  if (!game.change_status || game.change_status === 'unchanged') return '';
  const labels: Record<string, string> = {
    'new': t('index.changeBadge.new'),
    'modified': t('index.changeBadge.modified'),
    'disappeared': t('index.changeBadge.disappeared')
  };
  const label = labels[game.change_status] || '';
  if (!label) return '';
  let html = `<span class="change-status-badge status-${game.change_status}" data-game-name="${game.name.replace(/"/g, '&quot;')}">${label}</span>`;
  // Pour les jeux disparus, afficher l'ancien statut de sélection
  if (game.is_disappeared && game.is_selected) {
    html += '<span class="was-selected-badge">ÉTAIT SÉLECTIONNÉ</span>';
  }
  return html;
}

// Extraction des compteurs par statut de matching
function extractMatchStatusCounts(games: GameInfo[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const status of matchStatusOrder) {
    counts.set(status, 0);
  }
  games.forEach(game => {
    const status = game.match_status || 'unknown';
    counts.set(status, (counts.get(status) || 0) + 1);
  });
  return counts;
}

// Génération du dropdown de filtrage par statut de matching
function generateMatchStatusFilters() {
  const items = matchStatusOrder.map(status => ({
    key: status,
    displayName: `${matchStatusIcons[status]} ${matchStatusLabel(status)}`,
    count: matchStatusCounts.get(status) || 0
  }));

  createFilterDropdown('match-status-filters-container', t('index.filters.matching'), items, activeMatchFilters, () => {
    applyFiltersAndGrouping();
    updateGroupFilterSummary();
  });
}

// Génération du dropdown de filtrage par statut de sélection
function generateSelectionFilters() {
  // Trois états distincts :
  // - 'selected'   : l'utilisateur a coché le jeu (is_selected = 1)
  // - 'auto'       : auto-coché par cascade arcade (BIOS/parent/device requis)
  // - 'unselected' : ni l'un ni l'autre
  const userSelectedCount = allGames.filter(g => g.is_selected !== 0).length;
  const autoCount = allGames.filter(g => g.is_selected === 0 && autoSelectedIds.has(g.id)).length;
  const unselectedCount = allGames.length - userSelectedCount - autoCount;

  const items: Array<{ key: string; displayName: string; count: number }> = [
    { key: 'selected',   displayName: `✅ ${t('index.selectionStatus.selected')}`, count: userSelectedCount },
  ];
  // N'afficher l'entrée auto-cascade que si elle est non vide (DAT non-arcade
  // n'a jamais d'auto-sélection, on évite une entrée toujours à 0).
  if (autoCount > 0) {
    items.push({ key: 'auto', displayName: `🔒 ${t('index.selectionStatus.auto')}`, count: autoCount });
  }
  items.push({ key: 'unselected', displayName: `⬜ ${t('index.selectionStatus.unselected')}`, count: unselectedCount });

  createFilterDropdown('selection-filters-container', t('index.filters.groupSelection'), items, activeSelectionFilters, () => {
    applyFiltersAndGrouping();
    updateGroupFilterSummary();
  });
}

// Génération du dropdown de filtrage par évolution DAT
function generateChangeStatusFilters() {
  const hasAnyChangeStatus = allGames.some(g => g.change_status);
  if (!hasAnyChangeStatus) {
    // Pas de données d'évolution, masquer le filtre
    const container = document.getElementById('change-status-filters-container');
    if (container) container.innerHTML = '';
    return;
  }

  const newCount = allGames.filter(g => g.change_status === 'new').length;
  const modifiedCount = allGames.filter(g => g.change_status === 'modified').length;
  const unchangedCount = allGames.filter(g => g.change_status === 'unchanged').length;
  const disappearedCount = allGames.filter(g => g.change_status === 'disappeared').length;

  const items = [
    { key: 'new', displayName: `🆕 ${t('index.changeStatus.new')}`, count: newCount },
    { key: 'modified', displayName: `✏️ ${t('index.changeStatus.modified')}`, count: modifiedCount },
    { key: 'unchanged', displayName: `⏸️ ${t('index.changeStatus.unchanged')}`, count: unchangedCount },
    { key: 'disappeared', displayName: `❌ ${t('index.changeStatus.disappeared')}`, count: disappearedCount }
  ];

  createFilterDropdown('change-status-filters-container', t('index.filters.groupChangeStatus'), items, activeChangeFilters, () => {
    applyFiltersAndGrouping();
    updateGroupFilterSummary();
  });
}

// Recalcule l'ensemble des jeux auto-sélectionnés (parents/BIOS/devices requis par
// au moins un jeu user-sélectionné, selon le mode cible des settings).
// À appeler après chaque chargement de jeux et après chaque modification de sélection.
// Phase 3bis-B — Rafraîchit le mode cible de visualisation depuis les settings.
// À appeler après chaque chargement de jeux pour que la vue reflète le réglage courant.
async function refreshTargetSetMode(): Promise<void> {
  try {
    const settings = await window.api.getSettings();
    const m = (settings && (settings as any).arcadeTargetSetMode) || 'split';
    currentTargetSetMode = (m === 'merged' || m === 'non-merged' || m === 'split') ? m : 'split';
  } catch {
    currentTargetSetMode = 'split';
  }
}

// Phase 3bis-B — Calcule les flags dérivés hasParentInDb + cloneCount sur allGames.
// Indispensable pour le filtrage en vue merged (masquer les clones dont le parent
// est présent en DB) et l'affichage du badge "+N clones" sur les parents.
function computeParentCloneRelations(games: GameInfo[]): void {
  const byName = new Map<string, GameInfo>();
  for (const g of games) byName.set(g.name, g);

  for (const g of games) {
    g.hasParentInDb = !!(g.parent_name_ref && byName.has(g.parent_name_ref));
    g.cloneCount = 0;
  }
  for (const g of games) {
    if (g.hasParentInDb && g.parent_name_ref) {
      const parent = byName.get(g.parent_name_ref);
      if (parent) parent.cloneCount = (parent.cloneCount || 0) + 1;
    }
  }
}

async function refreshDependencyResolution() {
  try {
    const result = await window.api.resolveDependencies();
    autoSelectedIds = new Set(result.autoIds || []);
    autoSelectedReasons = result.reasons || {};
  } catch (error) {
    console.error('Error while resolving dependencies:', error);
    autoSelectedIds = new Set();
    autoSelectedReasons = {};
  }
  // Si plus aucun jeu n'est auto-sélectionné, on retire le filtre 'auto' s'il
  // était actif (sinon la liste se vide et l'utilisateur ne comprend pas).
  if (autoSelectedIds.size === 0 && activeSelectionFilters.has('auto')) {
    activeSelectionFilters.delete('auto');
  }
}

// Formate les raisons d'auto-sélection en chaîne de texte pour les tooltips.
function formatAutoReasons(gameId: number): string {
  const reasons = autoSelectedReasons[gameId];
  if (!reasons || reasons.length === 0) return t('index.autoReasons.autoSelected');

  const typeLabel = (type: string): string => {
    if (type === 'cloneof') return t('index.autoReasons.parentOfClone');
    if (type === 'romof') return t('index.autoReasons.biosOf');
    if (type === 'device_ref') return t('index.autoReasons.deviceRequiredBy');
    return type;
  };

  // Dé-dupliquer (un BIOS peut être requis par plusieurs clones)
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const r of reasons) {
    const key = `${r.type}|${r.requiredBy}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const who = r.requiredByName || t('index.autoReasons.gameNumber', { id: r.requiredBy });
    lines.push(`• ${typeLabel(r.type)} « ${who} »`);
    if (lines.length >= 5) {
      const remaining = reasons.length - lines.length;
      if (remaining > 0) lines.push(`• ${t('index.autoReasons.andOthers', { count: remaining })}`);
      break;
    }
  }
  return `${t('index.autoReasons.header')}\n${lines.join('\n')}`;
}

// Génération du dropdown de filtrage par présence de CHD (DAT arcade uniquement).
function generateChdFilter() {
  const container = document.getElementById('chd-filters-container');
  if (!container) return;

  const withChd = allGames.filter(g => !!g.has_chd).length;
  const withoutChd = allGames.length - withChd;

  // Si le DAT ne contient aucun CHD, masquer le filtre (pas pertinent).
  if (withChd === 0) {
    container.innerHTML = '';
    return;
  }

  const items = [
    { key: 'with-chd', displayName: `💿 ${t('index.filters.withDisk')}`, count: withChd },
    { key: 'without-chd', displayName: `— ${t('index.filters.withoutDisk')}`, count: withoutChd }
  ];

  createFilterDropdown('chd-filters-container', t('index.filters.disks'), items, activeChdFilters, () => {
    applyFiltersAndGrouping();
    updateGroupFilterSummary();
  });
}

// Génération du dropdown de filtres spécifiques MAME :
//  - BIOS       : le « jeu » est un set BIOS partagé (games.is_bios).
//  - CHD sans ROM : jeu possédant un CHD mais aucune ROM (disque orphelin, pour
//                 lequel on peut générer une archive vide). Pertinent surtout avec
//                 les DAT CHD Pleasuredome ; les DAT Progettosnaps ne listent pas
//                 ces jeux (disques sans ROM absents du DAT principal).
function generateMameFilter() {
  const container = document.getElementById('mame-filters-container');
  if (!container) return;

  const biosCount = allGames.filter(g => !!g.is_bios).length;
  const chdNoRomCount = allGames.filter(g => !!g.has_chd && (g.rom_count ?? 0) === 0).length;

  // Si le DAT ne comporte ni BIOS ni disque orphelin (DAT non MAME), masquer.
  if (biosCount === 0 && chdNoRomCount === 0) {
    container.innerHTML = '';
    return;
  }

  const items = [
    { key: 'bios',       displayName: `🧠 ${t('index.filters.bios')}`,      count: biosCount },
    { key: 'chd-no-rom', displayName: `💿 ${t('index.filters.chdNoRom')}`, count: chdNoRomCount }
  ];

  createFilterDropdown('mame-filters-container', t('index.filters.mame'), items, activeMameFilters, () => {
    applyFiltersAndGrouping();
    updateGroupFilterSummary();
  });
}

// Génération du dropdown de filtrage par qualité d'émulation (DAT MAMEDev brut + Progettosnaps).
function generateDriverStatusFilter() {
  const container = document.getElementById('driver-status-filters-container');
  if (!container) return;

  const goodCount = allGames.filter(g => g.driver_status === 'good').length;
  const imperfectCount = allGames.filter(g => g.driver_status === 'imperfect').length;
  const preliminaryCount = allGames.filter(g => g.driver_status === 'preliminary').length;

  // Si le DAT ne porte pas d'info de driver_status (Pleasuredome / Logiqx classique),
  // masquer le filtre.
  if (goodCount + imperfectCount + preliminaryCount === 0) {
    container.innerHTML = '';
    return;
  }

  const items = [
    { key: 'good',        displayName: '🟢 Good',        count: goodCount },
    { key: 'imperfect',   displayName: '🟡 Imperfect',   count: imperfectCount },
    { key: 'preliminary', displayName: '🔴 Preliminary', count: preliminaryCount }
  ];

  createFilterDropdown('driver-status-filters-container', t('index.filters.emulation'), items, activeDriverFilters, () => {
    applyFiltersAndGrouping();
    updateGroupFilterSummary();
  });
}

// Récupère le statut effectif d'un jeu (pour le filtrage)
function getGameMatchStatus(game: GameInfo): string {
  return game.match_status || 'unknown';
}

// Application des filtres et du groupement
function applyFiltersAndGrouping() {
  let filteredGames = allGames;

  // Phase 3bis-B : en vue merged, les clones disparaissent de la liste — ils sont
  // affichés via leur parent (avec badge +N clones et leurs ROMs spécifiques inlinées
  // dans la vue ROM du parent). Filtré AVANT les autres filtres pour ne pas fausser
  // les compteurs des dropdowns (qui dépendent de allGames, pas de filteredGames).
  if (currentTargetSetMode === 'merged') {
    filteredGames = filteredGames.filter(g => !g.hasParentInDb);
  }

  // Appliquer les filtres de catégorie
  if (activeFilters.size > 0) {
    filteredGames = filteredGames.filter(game => {
      const category = game.category || t('index.filters.uncategorized');
      return activeFilters.has(category);
    });
  }

  // Appliquer les filtres de statut de matching
  if (activeMatchFilters.size > 0) {
    filteredGames = filteredGames.filter(game => {
      return activeMatchFilters.has(getGameMatchStatus(game));
    });
  }

  // Appliquer les filtres de sélection (3 valeurs : selected / auto / unselected).
  // - 'selected'   : l'utilisateur a coché (is_selected = 1)
  // - 'auto'       : auto-coché par cascade (uniquement si pas user-sélectionné)
  // - 'unselected' : ni l'un ni l'autre
  if (activeSelectionFilters.size > 0) {
    filteredGames = filteredGames.filter(game => {
      const isUserSelected = game.is_selected !== 0;
      const isAuto = !isUserSelected && autoSelectedIds.has(game.id);
      if (activeSelectionFilters.has('selected') && isUserSelected) return true;
      if (activeSelectionFilters.has('auto') && isAuto) return true;
      if (activeSelectionFilters.has('unselected') && !isUserSelected && !isAuto) return true;
      return false;
    });
  }

  // Appliquer les filtres d'évolution DAT
  // Les jeux disparus sont masqués par défaut, visibles uniquement si le filtre est actif
  if (activeChangeFilters.size > 0) {
    filteredGames = filteredGames.filter(game => {
      return activeChangeFilters.has(game.change_status || '');
    });
  } else {
    filteredGames = filteredGames.filter(game => game.change_status !== 'disappeared');
  }

  // Appliquer les filtres de présence de CHD
  if (activeChdFilters.size > 0) {
    filteredGames = filteredGames.filter(game => {
      const hasChd = !!game.has_chd;
      if (activeChdFilters.has('with-chd') && hasChd) return true;
      if (activeChdFilters.has('without-chd') && !hasChd) return true;
      return false;
    });
  }

  // Appliquer les filtres de qualité d'émulation (driver_status)
  if (activeDriverFilters.size > 0) {
    filteredGames = filteredGames.filter(game => {
      return game.driver_status ? activeDriverFilters.has(game.driver_status) : false;
    });
  }

  // Appliquer les filtres spécifiques MAME (BIOS, CHD sans ROM). Logique OR
  // au sein du dropdown : un jeu passe s'il satisfait l'un des critères actifs.
  if (activeMameFilters.size > 0) {
    filteredGames = filteredGames.filter(game => {
      if (activeMameFilters.has('bios') && !!game.is_bios) return true;
      if (activeMameFilters.has('chd-no-rom') && !!game.has_chd && (game.rom_count ?? 0) === 0) return true;
      return false;
    });
  }

  // Mettre à jour les compteurs globaux
  updateGlobalCounters(filteredGames.length, allGames.filter(g => !g.is_disappeared).length);

  // Afficher les jeux avec ou sans groupement
  if (currentGroupBy === 'none') {
    displayGames(filteredGames);
  } else {
    displayGroupedGames(filteredGames);
  }
}

// Mise à jour des compteurs globaux
function updateGlobalCounters(displayed: number, total: number) {
  const counterDiv = document.getElementById('global-counters');
  if (!counterDiv) return;

  //counterDiv.innerHTML = `Affiché${displayed > 1 ? 's' : ''} : <strong>${displayed}</strong> 👁️ / <strong>${total}</strong>`;
  counterDiv.innerHTML = `👁️ <strong>${displayed}</strong> / <strong>${total}</strong>`;
}

// Affichage des jeux groupés
function displayGroupedGames(games: GameInfo[]) {
  const gameList = document.getElementById('game-list');
  if (!gameList) return;

  // Préserver la position de scroll (les re-renders déclenchés par les toggles
  // de sélection ne doivent pas ramener la liste en haut)
  const savedScrollTop = gameList.scrollTop;

  gameList.innerHTML = '';
  gameList.classList.add('has-groups');

  if (games.length === 0) {
    gameList.innerHTML = `<div style="padding: 20px; text-align: center;">${t('index.gamesView.noGames')}</div>`;
    gameList.classList.remove('has-groups');
    return;
  }

  // Grouper les jeux
  const groups = new Map<string, GameInfo[]>();

  games.forEach(game => {
    let groupKey: string;

    if (currentGroupBy === 'category') {
      groupKey = game.category || t('index.filters.uncategorized');
    } else if (currentGroupBy === 'letter') {
      groupKey = game.name.charAt(0).toUpperCase();
      if (!/[A-Z]/.test(groupKey)) {
        groupKey = '#';
      }
    } else if (currentGroupBy === 'match-status') {
      groupKey = getGameMatchStatus(game);
    } else if (currentGroupBy === 'selection') {
      groupKey = game.is_selected !== 0 ? 'selected' : 'unselected';
    } else if (currentGroupBy === 'change-status') {
      groupKey = game.change_status || 'unchanged';
    } else {
      groupKey = 'Tous';
    }

    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)!.push(game);
  });

  // Trier les groupes
  const sortedGroups = Array.from(groups.entries()).sort((a, b) => {
    if (currentGroupBy === 'letter') {
      if (a[0] === '#') return 1;
      if (b[0] === '#') return -1;
    }
    if (currentGroupBy === 'match-status') {
      return matchStatusOrder.indexOf(a[0]) - matchStatusOrder.indexOf(b[0]);
    }
    if (currentGroupBy === 'selection') {
      const selectionOrder = ['selected', 'unselected'];
      return selectionOrder.indexOf(a[0]) - selectionOrder.indexOf(b[0]);
    }
    if (currentGroupBy === 'change-status') {
      const changeOrder = ['new', 'modified', 'unchanged', 'disappeared'];
      return changeOrder.indexOf(a[0]) - changeOrder.indexOf(b[0]);
    }
    return a[0].localeCompare(b[0]);
  });

  // Afficher chaque groupe
  sortedGroups.forEach(([groupKey, groupGames]) => {
    // Nom d'affichage du groupe
    const selectionLabelsMap: Record<string, string> = {
      'selected': `✅ ${t('index.selectionStatus.selected')}`,
      'unselected': `⬜ ${t('index.selectionStatus.unselected')}`
    };
    const changeStatusLabelsMap: Record<string, string> = {
      'new': `🆕 ${t('index.changeStatus.new')}`,
      'modified': `✏️ ${t('index.changeStatus.modified')}`,
      'unchanged': `⏸️ ${t('index.changeStatus.unchanged')}`,
      'disappeared': `❌ ${t('index.changeStatus.disappeared')}`
    };
    const groupName = currentGroupBy === 'match-status'
      ? `${matchStatusIcons[groupKey]} ${matchStatusLabel(groupKey)}`
      : currentGroupBy === 'selection'
      ? selectionLabelsMap[groupKey]
      : currentGroupBy === 'change-status'
      ? (changeStatusLabelsMap[groupKey] || groupKey)
      : groupKey;
    // Trier les jeux par nom dans chaque groupe
    groupGames.sort((a, b) => a.name.localeCompare(b.name));

    const groupDiv = document.createElement('div');
    groupDiv.className = 'game-group';
    // Restaurer l'état replié persistant (survit aux re-renders)
    if (collapsedGameGroups.has(groupKey)) {
      groupDiv.classList.add('collapsed');
    }

    const headerDiv = document.createElement('div');
    headerDiv.className = 'game-group-header';

    const selectableGames = groupGames.filter(g => !g.is_disappeared);
    const groupSelectedCount = selectableGames.filter(g => g.is_selected !== 0).length;
    const groupAllSelected = selectableGames.length > 0 && groupSelectedCount === selectableGames.length;
    const groupSomeSelected = groupSelectedCount > 0 && !groupAllSelected;

    headerDiv.innerHTML = `
      <span class="group-chevron">▼</span>
      <input type="checkbox" class="group-checkbox" ${groupAllSelected ? 'checked' : ''}>
      <span class="group-header-label">${groupName}</span>
      <span class="count group-count">✔️ ${groupSelectedCount} / ${groupGames.length}</span>
    `;

    const groupCheckbox = headerDiv.querySelector('.group-checkbox') as HTMLInputElement;
    if (groupSomeSelected) groupCheckbox.indeterminate = true;

    // Toggle replier/déplier avec persistance dans collapsedGameGroups
    const toggleCollapse = () => {
      const nowCollapsed = groupDiv.classList.toggle('collapsed');
      if (nowCollapsed) collapsedGameGroups.add(groupKey);
      else collapsedGameGroups.delete(groupKey);
    };

    // Clic sur le chevron → replier/déplier le groupe
    const chevron = headerDiv.querySelector('.group-chevron') as HTMLElement;
    chevron.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCollapse();
    });

    // Fonction commune pour toggler la sélection du groupe (exclut les jeux disparus)
    async function toggleGroupSelection(forceState?: boolean) {
      const isSelected = forceState !== undefined ? forceState : !groupCheckbox.checked;
      groupCheckbox.checked = isSelected;
      groupCheckbox.indeterminate = false;

      const gameIds = selectableGames.map(g => g.id);
      if (gameIds.length > 0) {
        await window.api.updateGameSelectionBulk(gameIds, isSelected);
      }
      selectableGames.forEach(g => g.is_selected = isSelected ? 1 : 0);

      // Recalculer la cascade puis re-rendre. Indispensable pour libérer les
      // BIOS/parents auto-sélectionnés quand le groupe est entièrement déselectionné.
      await refreshDependencyResolution();
      applyFiltersAndGrouping();

      updateSelectAllCheckbox();
      updateSelectionCounter();
      generateSelectionFilters();
    }

    groupCheckbox.addEventListener('click', async (e) => {
      e.stopPropagation();
      await toggleGroupSelection(groupCheckbox.checked);
    });

    // Clic sur l'en-tête du groupe → plier/déplier (sauf checkbox)
    headerDiv.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT') return; // déjà géré par le checkbox
      toggleCollapse();
    });

    groupDiv.appendChild(headerDiv);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'game-group-content';

    groupGames.forEach(game => {
      const item = document.createElement('div');
      item.className = 'list-item';
      item.dataset.gameId = game.id.toString();

      const icon = getIconGameCategory(game.category);

      const isDisappeared = !!game.is_disappeared;
      const isUserSelected = !isDisappeared && game.is_selected !== 0;
      const isAuto = autoSelectedIds.has(game.id) && !isUserSelected;
      const isChecked = isUserSelected || isAuto;
      const lockBadge = isAuto
        ? `<span class="auto-lock-badge" title="${formatAutoReasons(game.id).replace(/"/g, '&quot;')}">🔒</span> `
        : '';
      const cloneBadge = (currentTargetSetMode === 'merged' && (game.cloneCount || 0) > 0)
        ? ` <span class="clone-count-badge" title="${t('index.gamesView.cloneBadgeTitle', { count: game.cloneCount! })}">🌀 +${game.cloneCount}</span>`
        : '';

      item.innerHTML = `
        <input type="checkbox" class="game-checkbox" data-game-id="${game.id}" ${isChecked ? 'checked' : ''} ${isDisappeared || isAuto ? 'disabled' : ''}>
        <div style="flex: 1; min-width: 0;">
          <div class="list-item-name">${lockBadge}${icon} ${game.name}${cloneBadge}${getChangeStatusBadgeHtml(game)}</div>
          ${game.description ? `<div class="list-item-info">${game.description}</div>` : ''}
          ${game.category ? `<div class="list-item-info"><strong>${t('index.gamesView.categoryLabel')}</strong> ${game.category}</div>` : ''}
          ${getGameContentInfoHtml(game)}
        </div>
        ${isDisappeared ? '' : getMatchStatusBadgeHtml(game)}
      `;

      if (isDisappeared) {
        item.classList.add('disappeared');
      } else if (isAuto) {
        item.classList.add('auto-selected');
      } else if (!isChecked) {
        item.classList.add('deselected');
      }

      if (!isDisappeared && !isAuto) {
        const checkbox = item.querySelector('.game-checkbox') as HTMLInputElement;
        checkbox.addEventListener('click', async (e) => {
          e.stopPropagation();
          const selected = checkbox.checked;
          game.is_selected = selected ? 1 : 0;
          item.classList.toggle('deselected', !selected);
          await window.api.updateGameSelection(game.id, selected);
          // Recalculer la cascade : un changement de sélection peut faire apparaître
          // ou disparaître des auto-sélections.
          await refreshDependencyResolution();
          applyFiltersAndGrouping();
          updateGroupCheckboxes();
          updateSelectAllCheckbox();
          generateSelectionFilters();
        });
      }

      // Clic sur le badge "MODIFIÉ" → détail des changements
      const changeBadge = item.querySelector('.change-status-badge.status-modified') as HTMLElement;
      if (changeBadge) {
        changeBadge.style.cursor = 'pointer';
        changeBadge.addEventListener('click', (e) => {
          e.stopPropagation();
          showGameDiffDetail(game.name);
        });
      }

      if (!isDisappeared) {
        item.addEventListener('click', () => selectGame(item, game));
        item.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          showGameContextMenu(e, game);
        });
      }
      contentDiv.appendChild(item);
    });

    groupDiv.appendChild(contentDiv);
    gameList.appendChild(groupDiv);
  });

  // Restaurer la position de scroll (préservée en début de fonction)
  gameList.scrollTop = savedScrollTop;

  updateSelectAllCheckbox();
}

// Retourne les jeux actuellement affichés (après filtrage)
function getDisplayedGames(): GameInfo[] {
  let result = allGames;
  if (activeFilters.size > 0) {
    result = result.filter(game => {
      const category = game.category || t('index.filters.uncategorized');
      return activeFilters.has(category);
    });
  }
  if (activeMatchFilters.size > 0) {
    result = result.filter(game => activeMatchFilters.has(getGameMatchStatus(game)));
  }
  if (activeSelectionFilters.size > 0) {
    result = result.filter(game => {
      const isSelected = game.is_selected !== 0;
      if (activeSelectionFilters.has('selected') && isSelected) return true;
      if (activeSelectionFilters.has('unselected') && !isSelected) return true;
      return false;
    });
  }
  // Appliquer les filtres d'évolution DAT
  if (activeChangeFilters.size > 0) {
    result = result.filter(game => activeChangeFilters.has(game.change_status || ''));
  } else {
    result = result.filter(game => game.change_status !== 'disappeared');
  }
  // Filtres arcade (CHD, qualité d'émulation, MAME) — doivent être reflétés ici
  // pour que « Tout sélectionner » n'agisse que sur les jeux réellement affichés.
  if (activeChdFilters.size > 0) {
    result = result.filter(game => {
      const hasChd = !!game.has_chd;
      if (activeChdFilters.has('with-chd') && hasChd) return true;
      if (activeChdFilters.has('without-chd') && !hasChd) return true;
      return false;
    });
  }
  if (activeDriverFilters.size > 0) {
    result = result.filter(game => game.driver_status ? activeDriverFilters.has(game.driver_status) : false);
  }
  if (activeMameFilters.size > 0) {
    result = result.filter(game => {
      if (activeMameFilters.has('bios') && !!game.is_bios) return true;
      if (activeMameFilters.has('chd-no-rom') && !!game.has_chd && (game.rom_count ?? 0) === 0) return true;
      return false;
    });
  }
  return result;
}

// Mise à jour de la checkbox "Tout sélectionner" en fonction des jeux affichés
function updateSelectAllCheckbox() {
  const selectAllCheckbox = document.getElementById('select-all-checkbox') as HTMLInputElement;
  if (!selectAllCheckbox) return;

  const allCheckboxes = document.querySelectorAll('.game-checkbox') as NodeListOf<HTMLInputElement>;
  // Exclure les checkboxes désactivées (jeux disparus)
  const checkboxes = Array.from(allCheckboxes).filter(cb => !cb.disabled);
  if (checkboxes.length === 0) return;

  const checkedCount = checkboxes.filter(cb => cb.checked).length;

  if (checkedCount === 0) {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
  } else if (checkedCount === checkboxes.length) {
    selectAllCheckbox.checked = true;
    selectAllCheckbox.indeterminate = false;
  } else {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = true;
  }

  updateSelectionCounter();
}

// Mise à jour du compteur de jeux sélectionnés
function updateSelectionCounter() {
  const counterSpan = document.getElementById('selection-counter');
  if (!counterSpan) return;

  const realGames = allGames.filter(g => !g.is_disappeared);
  const selectedCount = realGames.filter(g => g.is_selected !== 0).length;
  counterSpan.textContent = `✔️ ${selectedCount} / ${realGames.length}`;
}

// Mise à jour des checkboxes de groupes
function updateGroupCheckboxes() {
  const groupDivs = document.querySelectorAll('.game-group');
  groupDivs.forEach(groupDiv => {
    const groupCheckbox = groupDiv.querySelector('.group-checkbox') as HTMLInputElement;
    if (!groupCheckbox) return;

    const allGameCheckboxes = groupDiv.querySelectorAll('.game-checkbox') as NodeListOf<HTMLInputElement>;
    const selectableCheckboxes = Array.from(allGameCheckboxes).filter(cb => !cb.disabled);
    const checkedCount = selectableCheckboxes.filter(cb => cb.checked).length;

    if (selectableCheckboxes.length === 0 || checkedCount === 0) {
      groupCheckbox.checked = false;
      groupCheckbox.indeterminate = false;
    } else if (checkedCount === selectableCheckboxes.length) {
      groupCheckbox.checked = true;
      groupCheckbox.indeterminate = false;
    } else {
      groupCheckbox.checked = false;
      groupCheckbox.indeterminate = true;
    }

    // Mettre à jour le compteur du groupe
    const countSpan = groupDiv.querySelector('.group-count');
    if (countSpan) {
      countSpan.textContent = `✔️ ${checkedCount} / ${allGameCheckboxes.length} `;
    }
  });
}

// Affichage des fichiers
function displayFiles(files: any[], matchInfoMap: Record<number, any> = {}) {
  const gameList = document.getElementById('game-list');
  if (!gameList) return;

  if (files.length === 0 && gameList.children.length === 0) {
    gameList.innerHTML = `<div style="padding: 20px; text-align: center; color: #7f8c8d;">${t('index.folderView.noFiles')}</div>`;
    return;
  }

  files.forEach(file => {
    const item = document.createElement('div');
    item.className = 'list-item';

    const icon = file.isArchive ? '📦' : '💾';
    const size = formatFileSize(file.size);

    // En vue à plat, afficher le chemin relatif avec style
    let displayNameHTML = `${icon} ${file.fileName}`;
    if (viewMode === 'flat' && currentRootFolder && file.filePath) {
      // Calculer le chemin relatif depuis le dossier racine
      let relativePath = file.filePath;
      if (relativePath.startsWith(currentRootFolder)) {
        relativePath = relativePath.substring(currentRootFolder.length);
        if (relativePath.startsWith('/') || relativePath.startsWith('\\')) {
          relativePath = relativePath.substring(1);
        }

        // Normaliser les séparateurs en backslash pour Windows
        relativePath = relativePath.replace(/\//g, '\\');

        // Si le fichier est dans un sous-dossier, afficher le chemin avec style
        const lastSeparator = relativePath.lastIndexOf('\\');
        if (lastSeparator !== -1) {
          const folderPath = relativePath.substring(0, lastSeparator + 1); // Inclure le backslash
          const fileName = relativePath.substring(lastSeparator + 1);
          // La partie dossier en gris, le nom de fichier en noir normal
          displayNameHTML = `${icon} <span style="color: #7f8c8d;">${folderPath}</span>${fileName}`;
        } else {
          displayNameHTML = `${icon} ${file.fileName}`;
        }
      }
    }

    // Badges de matching pour la vue dossier
    let matchBadge = '';
    let multiBadge = '';
    const matchInfo = file.id ? matchInfoMap[file.id] : null;
    if (matchInfo && matchingComplete) {
      if (file.isArchive) {
        const matchedContents: Record<string, any[]> = matchInfo.matchedContents || {};
        const matchedContentCount = Object.keys(matchedContents).length;
        const totalContentCount = file.contents?.length || 0;
        if (matchedContentCount > 0 && matchedContentCount >= totalContentCount && totalContentCount > 0) {
          matchBadge = `<span class="match-status-badge status-complete">✅ ${t('index.fileBadges.matched')}</span>`;
        } else if (matchedContentCount > 0) {
          matchBadge = `<span class="match-status-badge status-partial">⚠️ ${t('index.matchStatus.partial')}</span>`;
        } else {
          matchBadge = `<span class="match-status-badge status-missing">❌ ${t('index.fileBadges.notMatched')}</span>`;
        }
        // Multi-jeux : au moins un fichier de l'archive sert à plusieurs jeux
        const hasMultiGame = Object.values(matchedContents).some((games: any[]) => games.length > 1);
        if (hasMultiGame) {
          multiBadge = `<span class="match-status-badge" style="background-color: rgba(52,152,219,0.1); color: #2980b9;">🔀 ${t('index.fileBadges.multiGame')}</span>`;
        }
      } else if (matchInfo.looseMatches.length > 0) {
        matchBadge = `<span class="match-status-badge status-complete">✅ ${t('index.fileBadges.matched')}</span>`;
        // Multi-jeux : le fichier loose sert à plusieurs jeux
        const distinctGames = new Set(matchInfo.looseMatches.map((m: any) => m.gameId));
        if (distinctGames.size > 1) {
          multiBadge = `<span class="match-status-badge" style="background-color: rgba(52,152,219,0.1); color: #2980b9;">🔀 ${t('index.fileBadges.multiGame')}</span>`;
        }
      } else {
        matchBadge = `<span class="match-status-badge status-missing">❌ ${t('index.fileBadges.notMatched')}</span>`;
      }
    }

    item.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <div style="min-width: 0; flex: 1;">
          <div class="list-item-name">${displayNameHTML}</div>
          <div class="list-item-info">${size}</div>
        </div>
        <div style="display: flex; gap: 4px; flex-shrink: 0;">
          ${multiBadge}${matchBadge}
        </div>
      </div>
    `;

    item.addEventListener('click', () => selectFile(item, file, matchInfo));
    item.addEventListener('contextmenu', (e) => showFileContextMenu(e, file));
    gameList.appendChild(item);
  });
}

// Sélection d'un jeu
async function selectGame(element: HTMLElement, game: GameInfo) {
  document.querySelectorAll('.list-item').forEach(item => {
    item.classList.remove('selected');
  });
  element.classList.add('selected');
  
  const detailView = document.getElementById('detail-view');
  if (!detailView) return;
  
  let icon = getIconGameCategory(game.category);

  detailView.innerHTML = `
    <div class="detail-header">${icon} ${game.name}</div>
    <div style="padding: 10px;">${t('index.details.loadingRoms')}</div>
  `;
  
  try {
    const [roms, matches] = await Promise.all([
      window.api.listRomsByGame(game.id),
      window.api.getMatchesForGame(game.id).catch(() => [])
    ]);

    // Phase 3bis-B : en vue merged, étendre la liste des ROMs du parent avec
    // les ROMs SPÉCIFIQUES de ses clones (celles sans merge_name, car les
    // ROMs partagées sont déjà dans le parent). Chaque ROM ajoutée est annotée
    // avec le nom du clone d'origine pour affichage du badge "🌀 Clone (X)".
    let romsForView: RomInfo[] = roms;
    let matchesForView: any[] = matches;
    if (currentTargetSetMode === 'merged' && (game.cloneCount || 0) > 0) {
      const clones = allGames.filter(g => g.parent_name_ref === game.name);
      const [clonesRomsArrays, clonesMatchesArrays] = await Promise.all([
        Promise.all(clones.map(c => window.api.listRomsByGame(c.id))),
        // Bug fix : fetch les matches de chaque clone pour que le badge de match
        // s'affiche correctement en vue merged (sans ça, les ROMs des clones
        // apparaissaient ❌ Non matché même quand leur .zip clone existe).
        Promise.all(clones.map(c => window.api.getMatchesForGame(c.id).catch(() => [])))
      ]);

      const extras: RomInfo[] = [];
      for (let i = 0; i < clones.length; i++) {
        const cloneName = clones[i].name;
        for (const r of clonesRomsArrays[i] as RomInfo[]) {
          if (r.merge_name) continue; // déjà incluse comme ROM partagée du parent
          extras.push({ ...r, _sourceCloneName: cloneName });
        }
      }
      romsForView = [...roms, ...extras];
      matchesForView = [...matches, ...clonesMatchesArrays.flat()];
    }

    displayRomDetails(game, romsForView, matchesForView);
  } catch (error) {
    detailView.innerHTML += `<div style="color: #e74c3c;">${t('common.errorWithDetail', { error: String(error) })}</div>`;
  }
}

// Sélection d'un fichier
function selectFile(element: HTMLElement, file: any, matchInfo?: any) {
  document.querySelectorAll('.list-item').forEach(item => {
    item.classList.remove('selected');
  });
  element.classList.add('selected');

  const detailView = document.getElementById('detail-view');
  if (!detailView) return;

  if (file.isArchive && file.contents) {
    displayArchiveContents(file, matchInfo);
  } else {
    displayFileDetails(file, matchInfo);
  }
}

// Phase 3bis — Calcule le badge d'ORIGINE d'une ROM (indépendant du fait que
// ce soit un disque ou un fichier). Catégorise selon la provenance arcade :
//   - 🌀 Clone    : ROM spécifique à un clone fusionné dans le parent (vue merged)
//   - 🧠 BIOS     : ROM d'un set BIOS (le jeu lui-même est is_bios)
//   - ⚙️ Device   : ROM d'un device (le jeu lui-même est is_device)
//   - 🔗 Héritée / 📎 Inlinée : ROM partagée avec le parent (merge_name), selon la vue
//   - 📦 Propre   : ROM spécifique au jeu
function getRomOriginBadge(rom: RomInfo, game: GameInfo): string {
  // Phase 3bis-B : vue merged — ROM inlinée depuis un clone du parent affiché.
  if (rom._sourceCloneName && currentTargetSetMode === 'merged') {
    const cn = rom._sourceCloneName;
    return `<span class="rom-type-badge type-clone" title="ROM spécifique au clone « ${cn} », fusionnée dans l'archive du parent en vue merged">🌀 Clone (${cn})</span>`;
  }
  if (game.is_bios) {
    return `<span class="rom-type-badge type-bios" title="${t('index.romBadges.biosTitle')}">🧠 BIOS</span>`;
  }
  if (game.is_device) {
    return `<span class="rom-type-badge type-device" title="${t('index.romBadges.deviceTitle')}">⚙️ Device</span>`;
  }
  if (rom.merge_name) {
    const parentName = game.parent_name_ref || 'parent';
    // Phase 3bis-B : en vue non-merged la ROM partagée est considérée comme
    // "auto-incluse" dans le clone (chaque clone est autonome). Label différent
    // pour refléter la sémantique de la vue.
    if (currentTargetSetMode === 'non-merged') {
      const title = t('index.romBadges.inlinedTitle', { parent: parentName });
      return `<span class="rom-type-badge type-inlined" title="${title.replace(/"/g, '&quot;')}">📎 ${t('index.romBadges.inlined')}</span>`;
    }
    // Vue split (par défaut) : badge "Héritée"
    const title = t('index.romBadges.inheritedTitle', { parent: parentName, mergeName: rom.merge_name });
    return `<span class="rom-type-badge type-inherited" title="${title.replace(/"/g, '&quot;')}">🔗 ${t('index.romBadges.inherited')}</span>`;
  }
  return `<span class="rom-type-badge type-own" title="${t('index.romBadges.ownTitle')}">📦 ${t('index.romBadges.own')}</span>`;
}

// Phase 3bis — Badge(s) de type d'une ROM : l'origine (toujours) + le marqueur
// disque 💿 en supplément si l'entrée vient d'une balise <disk> (CHD). Un disque
// affiche donc DEUX badges, ex : « 📦 Propre 💿 Disque » ou « 🔗 Héritée 💿 Disque ».
function getRomTypeBadge(rom: RomInfo, game: GameInfo): string {
  const origin = getRomOriginBadge(rom, game);
  if (rom.is_disk) {
    const disk = `<span class="rom-type-badge type-disk" title="${t('index.romBadges.diskTitle')}">💿 ${t('index.romBadges.disk')}</span>`;
    return `${origin} ${disk}`;
  }
  return origin;
}

// Affichage des détails d'une ROM
function displayRomDetails(game: GameInfo, roms: RomInfo[], matches: any[] = []) {
  const detailView = document.getElementById('detail-view');
  if (!detailView) return;

  // Créer un map datRomId → liste de tous les matches pour cette ROM
  const allMatchesMap = new Map<number, any[]>();
  for (const m of matches) {
    if (!allMatchesMap.has(m.datRomId)) allMatchesMap.set(m.datRomId, []);
    allMatchesMap.get(m.datRomId)!.push(m);
  }

  let icon = getIconGameCategory(game.category);

  // Statut global du jeu
  const statusBadge = getMatchStatusBadgeHtml(game);

  let html = `<div class="detail-header">${icon} ${game.name}</div>`;
  html += `
    <div style="padding: 10px; font-size: 12px;">
      <div style="margin-bottom: 10px;">
        <strong>${t('index.romDetails.category')}</strong> ${icon} ${game.category || t('index.filters.uncategorized')}
      </div>
      <div style="margin-bottom: 10px;">
        <strong>${t('index.romDetails.matching')}</strong> ${statusBadge}
      </div>
      <div style="margin-top: 15px;">
        <strong>${t('index.romDetails.romFiles')}</strong> (${roms.length})
      </div>
    </div>`;

  if (roms.length === 0) {
    html += `<div style="padding: 10px;">${t('index.romDetails.noRoms')}</div>`;
  } else {
    const matchingDone = game.match_status !== undefined;

    roms.forEach(rom => {
      const romMatches = allMatchesMap.get(rom.id) || [];
      const isFound = romMatches.length > 0;

      let statusIcon: string, statusClass: string, statusLabel: string;
      if (!matchingDone) {
        statusIcon = '❓';
        statusClass = 'rom-unknown';
        statusLabel = t('index.romStatus.unknown');
      } else if (isFound) {
        statusIcon = '✅';
        statusClass = 'rom-found';
        statusLabel = t('index.romStatus.found');
      } else {
        statusIcon = '❌';
        statusClass = 'rom-missing';
        statusLabel = t('index.romStatus.missing');
      }

      // Compter les fichiers loose et les archives distinctes
      let matchSummary = '';
      if (isFound && matchingDone) {
        const looseCount = romMatches.filter((m: any) => !m.archiveContentId).length;
        const archiveIds = new Set(romMatches.filter((m: any) => m.archiveContentId).map((m: any) => m.scannedFileId));
        const archiveCount = archiveIds.size;

        const parts: string[] = [];
        if (looseCount > 0) parts.push(t('index.romDetails.looseFiles', { count: looseCount }));
        if (archiveCount > 0) parts.push(t('index.romDetails.archives', { count: archiveCount }));
        if (parts.length > 0) {
          matchSummary = `<div class="file-hash"><strong>${t('index.romDetails.sources')}</strong> ${parts.join(', ')}</div>`;
        }
      }

      const typeBadge = getRomTypeBadge(rom, game);

      // Affichage de l'origine de la ROM en détail, selon le mode de vue :
      //  - Vue merged + ROM venant d'un clone   → 🌀 Clone : <clone_name>
      //  - Vue non-merged + ROM avec merge_name → 📎 Inlinée depuis : <parent> → <merge_name>
      //  - Vue split + ROM avec merge_name      → 🔗 Hérité de : <parent> → <merge_name>
      let inheritedFrom = '';
      if (rom._sourceCloneName && currentTargetSetMode === 'merged') {
        inheritedFrom = `<div class="file-hash"><strong>🌀 ${t('index.romDetails.cloneLabel')}</strong> ${rom._sourceCloneName}</div>`;
      } else if (rom.merge_name && game.parent_name_ref) {
        if (currentTargetSetMode === 'non-merged') {
          inheritedFrom = `<div class="file-hash"><strong>📎 ${t('index.romDetails.inlinedFrom')}</strong> ${game.parent_name_ref} → ${rom.merge_name}</div>`;
        } else {
          inheritedFrom = `<div class="file-hash"><strong>🔗 ${t('index.romDetails.inheritedFrom')}</strong> ${game.parent_name_ref} → ${rom.merge_name}</div>`;
        }
      }

      html += `
        <div class="file-item ${statusClass}">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
            <div style="flex: 1; min-width: 0;">${rom.name} ${typeBadge}</div>
            <span class="rom-status-badge ${statusClass}">${statusIcon} ${statusLabel}</span>
          </div>
          ${rom.size ? `<div style="font-size: 12px; color: #7f8c8d;"><strong>${t('index.romDetails.size')}</strong> ${formatFileSize(rom.size)}</div>` : ''}
          ${rom.crc32 ? `<div class="file-hash"><strong>CRC32 :</strong> ${rom.crc32.toUpperCase()}</div>` : ''}
          ${rom.md5 ? `<div class="file-hash"><strong>MD5 :</strong> ${rom.md5.toUpperCase()}</div>` : ''}
          ${rom.sha1 ? `<div class="file-hash"><strong>SHA1 :</strong> ${rom.sha1.toUpperCase()}</div>` : ''}
          ${inheritedFrom}
          ${matchSummary}
        </div>
      `;
    });
  }

  detailView.innerHTML = html;
}

// Affichage du contenu d'une archive
function displayArchiveContents(file: any, matchInfo?: any) {
  const detailView = document.getElementById('detail-view');
  if (!detailView) return;

  const hasMatchData = matchInfo && matchingComplete;
  const matchedContents: Record<string, Array<{ gameId: number; gameName: string }>> = matchInfo?.matchedContents || {};
  const matchedContentCount = Object.keys(matchedContents).length;
  const totalContentCount = file.contents?.length || 0;

  // Badge global de l'archive
  let archiveBadge = '';
  if (hasMatchData) {
    if (matchedContentCount > 0 && matchedContentCount >= totalContentCount && totalContentCount > 0) {
      archiveBadge = `<span class="match-status-badge status-complete">✅ ${t('index.fileBadges.matched')}</span>`;
    } else if (matchedContentCount > 0) {
      archiveBadge = `<span class="match-status-badge status-partial">⚠️ ${t('index.matchStatus.partial')}</span>`;
    } else {
      archiveBadge = `<span class="match-status-badge status-missing">❌ ${t('index.fileBadges.notMatched')}</span>`;
    }
  }

  let html = `<div class="detail-header">📦 ${file.fileName}</div>`;
  html += `
    <div style="padding: 10px; font-size: 12px;">
      <div style="margin-bottom: 10px;">
        <strong>${t('index.romDetails.size')}</strong> ${formatFileSize(file.size)}
      </div>
      <div style="margin-bottom: 10px;">
        <strong>${t('index.romDetails.path')}</strong><br>
        <span>${file.filePath}</span>
      </div>
      <div style="margin-bottom: 10px;">
        <strong>${t('index.romDetails.type')}</strong> ${file.archiveType?.toUpperCase()}
      </div>
      ${archiveBadge ? `<div style="margin-bottom: 10px;"><strong>${t('index.romDetails.matching')}</strong> ${archiveBadge}</div>` : ''}
      <div style="margin-top: 15px;">
        <strong>${t('index.romDetails.archiveContents')}</strong> (${t('matching.filesCount', { count: totalContentCount })})
      </div>
    </div>`;

  if (file.contents && file.contents.length > 0) {
    file.contents.forEach((content: any) => {
      const contentGames = matchedContents[content.fileName] || [];
      const isMatched = contentGames.length > 0;

      let statusClass = '';
      let statusBadge = '';
      let multiGameBadge = '';
      let gameInfo = '';
      if (hasMatchData) {
        statusClass = isMatched ? 'rom-found' : 'rom-missing';
        const statusIcon = isMatched ? '✅' : '❌';
        const statusLabel = isMatched ? t('index.fileBadges.matched') : t('index.fileBadges.notMatched');
        statusBadge = `<span class="rom-status-badge ${statusClass}">${statusIcon} ${statusLabel}</span>`;

        if (isMatched) {
          const gameNames = contentGames.map((g: any) => g.gameName);
          gameInfo = `<div class="file-hash"><strong>${t('index.romDetails.games')}</strong> ${gameNames.join(', ')}</div>`;
          if (gameNames.length > 1) {
            multiGameBadge = `<span class="rom-status-badge" style="background-color: rgba(52,152,219,0.1); color: #2980b9;">🔀 ${t('index.fileBadges.multiGame')}</span>`;
          }
        }
      }

      html += `
        <div class="file-item ${statusClass}">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>${content.fileName}</div>
            <div style="display: flex; gap: 4px;">${multiGameBadge}${statusBadge}</div>
          </div>
          ${content.size ? `<div style="font-size: 12px; color: #7f8c8d;"><strong>${t('index.romDetails.size')}</strong> ${formatFileSize(content.size)}</div>` : ''}
          ${content.hashes?.crc32 ? `<div class="file-hash"><strong>CRC32 :</strong> ${content.hashes.crc32}</div>` : ''}
          ${content.hashes?.md5 ? `<div class="file-hash"><strong>MD5 :</strong> ${content.hashes.md5}</div>` : ''}
          ${content.hashes?.sha1 ? `<div class="file-hash"><strong>SHA1 :</strong> ${content.hashes.sha1}</div>` : ''}
          ${gameInfo}
        </div>
      `;
    });
  } else {
    html += `<div style="padding: 10px;">${t('index.romDetails.emptyArchive')}</div>`;
  }

  detailView.innerHTML = html;
}

// Affichage des détails d'un fichier
function displayFileDetails(file: any, matchInfo?: any) {
  const parts = file.fileName.split('.');
  const fileExtension = parts.length > 1 ? parts[parts.length - 1] : '';

  const detailView = document.getElementById('detail-view');
  if (!detailView) return;

  const hasMatchData = matchInfo && matchingComplete;
  const looseMatches: Array<{ gameId: number; gameName: string; datRomName: string }> = matchInfo?.looseMatches || [];
  const isMatched = looseMatches.length > 0;

  // Badge de matching
  let matchBadge = '';
  if (hasMatchData) {
    matchBadge = isMatched
      ? `<span class="match-status-badge status-complete">✅ ${t('index.fileBadges.matched')}</span>`
      : `<span class="match-status-badge status-missing">❌ ${t('index.fileBadges.notMatched')}</span>`;
  }

  let html = `<div class="detail-header">💾 ${file.fileName}</div>`;
  html += `
    <div style="padding: 10px; font-size: 12px;">
      <div style="margin-bottom: 10px;">
        <strong>${t('index.romDetails.size')}</strong> ${formatFileSize(file.size)}
      </div>
      <div style="margin-bottom: 10px;">
        <strong>${t('index.romDetails.path')}</strong><br>
        <span>${file.filePath}</span>
      </div>
      <div style="margin-bottom: 10px;">
        <strong>${t('index.romDetails.type')}</strong> ${fileExtension.toUpperCase()}
      </div>
      ${matchBadge ? `<div style="margin-bottom: 10px;"><strong>${t('index.romDetails.matching')}</strong> ${matchBadge}</div>` : ''}
      <div style="margin-top: 15px;">
        <strong>${t('index.romDetails.hashes')}</strong>
      </div>
    </div>`;

  if (file.hashes) {
    const statusClass = hasMatchData ? (isMatched ? 'rom-found' : 'rom-missing') : '';
    const statusBadge = hasMatchData
      ? `<span class="rom-status-badge ${statusClass}">${isMatched ? `✅ ${t('index.fileBadges.matched')}` : `❌ ${t('index.fileBadges.notMatched')}`}</span>`
      : '';

    // Noms des jeux pour lesquels ce fichier sert
    let gameInfo = '';
    let multiGameBadge = '';
    if (hasMatchData && isMatched) {
      const gameNames = [...new Set(looseMatches.map(m => m.gameName))];
      gameInfo = `<div class="file-hash"><strong>${t('index.romDetails.games')}</strong> ${gameNames.join(', ')}</div>`;
      if (gameNames.length > 1) {
        multiGameBadge = `<span class="rom-status-badge" style="background-color: rgba(52,152,219,0.1); color: #2980b9;">🔀 ${t('index.fileBadges.multiGame')}</span>`;
      }
    }

    html += `
      <div class="file-item ${statusClass}">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>${file.fileName}</div>
          <div style="display: flex; gap: 4px;">${multiGameBadge}${statusBadge}</div>
        </div>
        <div style="font-size: 12px; color: #7f8c8d;"><strong>${t('index.romDetails.size')}</strong> ${formatFileSize(file.size)}</div>
        <div class="file-hash"><strong>CRC32 :</strong> ${file.hashes.crc32}</div>
        <div class="file-hash"><strong>MD5 :</strong> ${file.hashes.md5}</div>
        <div class="file-hash"><strong>SHA1 :</strong> ${file.hashes.sha1}</div>
        ${gameInfo}
      </div>
    `;
  }

  detailView.innerHTML = html;
}

// Formatage de la taille
function formatFileSize(bytes: number): string {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Gestion du redimensionnement
function initSplitters() {
  const splitters = document.querySelectorAll('.splitter');
  
  splitters.forEach((splitter, index) => {
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;
    let targetElement: HTMLElement | null = null;
    
    splitter.addEventListener('mousedown', (e: Event) => {
      const mouseEvent = e as MouseEvent;
      isResizing = true;
      startX = mouseEvent.clientX;
      
      if (index === 0) {
        targetElement = document.querySelector('.sidebar-left');
      } else if (index === 1) {
        targetElement = document.querySelector('.sidebar-right');
      }
      
      if (targetElement) {
        startWidth = targetElement.offsetWidth;
      }
      
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (!isResizing || !targetElement) return;
      
      let diff = e.clientX - startX;
      if (index === 1) diff = -diff;
      
      const newWidth = startWidth + diff;
      const minWidth = 150;
      const maxWidth = 500;
      
      if (newWidth >= minWidth && newWidth <= maxWidth) {
        targetElement.style.width = newWidth + 'px';
      }
    });
    
    document.addEventListener('mouseup', () => {
      isResizing = false;
      targetElement = null;
      document.body.style.cursor = 'default';
    });
  });
}


// ============================================================================
// Fonctions pour la gestion CHD (pour le menu contextuel)
// La logique métier est gérée par chdmanHandler.ts
// ============================================================================

async function convertToChd(filePath: string) {
  try {
    log('logs.chd.converting', { params: { file: getBasename(filePath) }, context: 'chd', state: 'loading' });
    const results = await window.api.convertToChd([filePath]);
    
    if (results[0]?.success) {
      log('logs.chd.convertDone', { params: { message: results[0].message }, context: 'chd', state: 'success' });
      if (currentFolderPath) await updateFolderContent(currentFolderPath);
    } else {
      log('logs.chd.convertFailed', { params: { error: results[0]?.message || t('common.unknownError') }, severity: 'error', context: 'chd' });
    }
  } catch (error) {
    log('common.errorWithDetail', { params: { error: String(error) }, severity: 'error', context: 'chd' });
  }
}

async function extractChd(filePath: string) {
  try {
    log('logs.chd.extracting', { params: { file: getBasename(filePath) }, context: 'archive', state: 'loading' });
    const result = await window.api.extractChd(filePath);
    
    if (result?.success) {
      log(result.message, { context: 'archive', state: 'success' });
      if (currentFolderPath) await updateFolderContent(currentFolderPath);
    }
  } catch (error) {
    log('common.errorWithDetail', { params: { error: String(error) }, severity: 'error', context: 'archive' });
  }
}

async function verifyChdFile(filePath: string) {
  try {
    log('logs.chd.verifying', { params: { file: getBasename(filePath) }, context: 'romfile', state: 'loading' });
    const result = await window.api.verifyChd(filePath);
    
    log(result.message, { 
      severity: result.valid ? 'info' : 'warning', 
      context: 'romfile',
      state: result.valid ? 'success' : 'missing'
    });
  } catch (error) {
    log('common.errorWithDetail', { params: { error: String(error) }, severity: 'error', context: 'romfile' });
  }
}

async function showChdInfo(filePath: string) {
  try {
    const info = await window.api.getChdInfo(filePath);
    
    showModal(t('index.chdModal.title'), `
      <div style="padding: 20px;">
        <p><strong>${t('index.chdModal.file')}</strong> ${getBasename(filePath)}</p>
        <p><strong>${t('index.chdModal.version')}</strong> ${info.version || 'N/A'}</p>
        <p><strong>${t('index.chdModal.logicalSize')}</strong> ${info.logicalSize ? formatFileSize(info.logicalSize) : 'N/A'}</p>
        <p><strong>${t('index.chdModal.compression')}</strong> ${info.compression || 'N/A'}</p>
        <p><strong>SHA1 :</strong> ${info.sha1 || 'N/A'}</p>
        <p><strong>MD5 :</strong> ${info.md5 || 'N/A'}</p>
      </div>
    `);
  } catch (error) {
    log('common.errorWithDetail', { params: { error: String(error) }, severity: 'error', context: 'romfile' });
  }
}


// ============================================================================
// Fonctions de matching
// ============================================================================

async function runMatching() {
  const btn = document.getElementById('match-roms') as HTMLButtonElement;
  if (!btn) return;
  
  try {
    // Désactiver le bouton pendant le matching
    btn.disabled = true;
    btn.textContent = t('index.matchingRun.inProgress');

    log('logs.match.launching', { context: 'match', state: 'loading' });

    const result = await window.api.runMatching();

    // Mettre à jour le rapport dans le volet gauche
    if (typeof displayMatchingReport === 'function') {
      await displayMatchingReport('matching-report');
    }

    // Afficher une popup de succès
    alert(t('index.matchingRun.doneAlert', {
      complete: result.stats.completeGames,
      partial: result.stats.partialGames,
      missing: result.stats.missingGames,
      total: result.stats.totalGames,
      matchedRoms: result.stats.matchedRoms,
      totalRoms: result.stats.totalDatRoms
    }));
    
    matchingComplete = true;
    updateWorkflowButtons();
    log('logs.match.success', { context: 'match', state: 'success' });

    // Le matching a calculé le mode du set scanné → rafraîchir le bandeau
    await updateDbInfoBanner();

    // Rafraîchir le volet central si un contenu est affiché
    if (selectedElement) {
      await updateCenterContent(selectedElement.type, selectedElement.value);
    }
  } catch (error) {
    log('logs.match.error', { params: { error: String(error) }, severity: 'error', context: 'match' });
    alert(t('index.matchingRun.errorAlert'));
  } finally {
    // Réactiver le bouton
    btn.disabled = false;
    btn.textContent = t('index.workflow.match');
  }
}

async function runConsolidation() {
  const btn = document.getElementById('consolidate-roms') as HTMLButtonElement;
  if (!btn) return;

  // Récupérer les paramètres pour le récapitulatif
  const settings = await window.api.getSettings();

  // Construire le récapitulatif des options
  const compressionLabels: Record<string, string> = {
    'fastest': t('index.consolidation.compressionFastest'),
    'normal': t('index.consolidation.compressionNormal'),
    'maximum': t('index.consolidation.compressionMaximum')
  };
  const cleanupScopeLabels: Record<string, string> = {
    'used-only': t('settings.cleanup.scopeUsedOnly'),
    'all-matched': t('settings.cleanup.scopeAllMatched')
  };

  const lines: string[] = [];

  // --- Archives ---
  lines.push(t('index.consolidation.sectionArchives'));
  if (settings.useBestCompression) {
    lines.push(`  • ${t('index.consolidation.bestCompressionMode')}`);
  } else {
    const formats = settings.archiveFormatPriority?.join(' > ') || '7z > zip';
    lines.push(`  • ${t('index.consolidation.formatPriority', { formats })}`);
  }
  lines.push(`  • ${t('index.consolidation.compression', { level: compressionLabels[settings.compressionLevel] || settings.compressionLevel })}`);
  if (settings.recreateArchivesIfNeeded) {
    lines.push(`  • ${t('index.consolidation.recreateArchives')}`);
  } else {
    lines.push(`  • ${t('index.consolidation.directCopy')}`);
  }
  if (settings.solidArchive) lines.push(`  • ${t('index.consolidation.solidArchive')}`);
  if (settings.multithreading) lines.push(`  • ${t('index.consolidation.multithreading')}`);

  // --- Dossiers ---
  lines.push('');
  lines.push(t('index.consolidation.sectionFolders'));
  lines.push(`  • ${t('index.consolidation.targetFolder', { folder: settings.validatedRomsFolder || t('index.consolidation.notConfigured') })}`);
  if (settings.cleanSourceAfterConsolidation && settings.unmatchedRomsFolder) {
    lines.push(`  • ${t('index.consolidation.unmatchedFolder', { folder: settings.unmatchedRomsFolder })}`);
  }

  // --- Nettoyage ---
  lines.push('');
  lines.push(t('index.consolidation.sectionCleanup'));
  if (settings.cleanSourceAfterConsolidation) {
    lines.push(`  • ${t('index.consolidation.cleanupEnabled')}`);
    lines.push(`  • ${t('index.consolidation.cleanupScope', { scope: cleanupScopeLabels[settings.cleanupScope] || settings.cleanupScope })}`);
    if (settings.protectFilesForUnselectedGames) {
      lines.push(`  • ${t('index.consolidation.protectionOn')}`);
    } else {
      lines.push(`  • ${t('index.consolidation.protectionOff')}`);
    }
  } else {
    lines.push(`  • ${t('index.consolidation.cleanupDisabled')}`);
  }

  // Boîte de dialogue de confirmation
  const confirmResult = await window.api.showMessageBox({
    type: 'question',
    title: t('index.consolidation.confirmTitle'),
    message: t('index.consolidation.confirmMessage'),
    detail: lines.join('\n'),
    buttons: [t('index.consolidation.confirmButton'), t('common.cancel')],
    defaultId: 0,
    cancelId: 1
  });

  if (confirmResult.response !== 0) return;

  try {
    btn.disabled = true;
    btn.textContent = t('index.consolidation.inProgress');

    log('logs.consolidation.launching', { context: 'match', state: 'loading' });

    const removeListener = window.api.onConsolidationProgress((progress) => {
      if (progress.phase === 'complete') {
        log(progress.key, { params: progress.params, context: 'match', state: 'success' });
      } else {
        log(progress.key, { params: progress.params, context: 'match', state: 'loading' });
      }
    });

    const result = await window.api.runConsolidation();

    alert(t('index.consolidation.doneAlert', {
      games: result.stats.gamesConsolidated,
      archives: result.stats.archivesCreated,
      unmatched: result.stats.unmatchedFilesMoved,
      errors: result.stats.gamesErrored
    }));

    log('logs.consolidation.finished', { context: 'match', state: 'success' });
    removeListener();

    // Rafraîchissement automatique du dossier cible + rematching
    if (result.stats.gamesConsolidated > 0) {
      await refreshTargetAndMatching();
    }
  } catch (error) {
    log('logs.consolidation.runError', { params: { error: String(error) }, severity: 'error', context: 'match' });
    alert(t('index.consolidation.errorAlert'));
  } finally {
    btn.disabled = false;
    btn.textContent = t('index.workflow.consolidate');
  }
}

async function showMissingRoms() {
  try {
    const missing = await window.api.getMissingRoms();
    
    if (missing.length === 0) {
      showModal(t('matching.missingRoms'), `<div style="padding: 20px; text-align: center;">${t('index.missingModal.none')}</div>`);
      return;
    }
    
    const content = missing.map(m => 
      `<div style="padding: 8px; border-bottom: 1px solid #eee;">
        <strong style="color: #2c3e50;">${m.gameName}</strong><br>
        <span style="color: #7f8c8d; font-size: 13px;">📀 ${m.datRomName}</span>
      </div>`
    ).join('');
    
    showModal(t('index.missingModal.title', { count: missing.length }), content);
  } catch (error) {
    log('logs.match.missingRomsError', { params: { error: String(error) }, severity: 'error', context: 'match' });
  }
}

async function showExtraFiles() {
  try {
    const extras = await window.api.getExtraFiles();
    
    if (extras.length === 0) {
      showModal(t('index.extrasModal.header'), `<div style="padding: 20px; text-align: center;">${t('index.extrasModal.none')}</div>`);
      return;
    }
    
    const content = extras.map(e => 
      `<div style="padding: 8px; border-bottom: 1px solid #eee;">
        <span style="color: #2c3e50;">📁 ${e.file_name}</span><br>
        <span style="color: #7f8c8d; font-size: 12px;">${formatFileSize(e.size)}</span>
      </div>`
    ).join('');
    
    showModal(t('index.extrasModal.title', { count: extras.length }), content);
  } catch (error) {
    log('logs.match.extrasError', { params: { error: String(error) }, severity: 'error', context: 'match' });
  }
}

async function exportReport() {
  try {
    const result = await window.api.exportMatchingReport();
    if (result && result.success) {
      log('logs.match.reportExported', { params: { path: result.filePath }, context: 'match', state: 'success' });
      showModal(t('index.exportModal.title'), `
        <div style="padding: 20px; text-align: center;">
          <p>${t('index.exportModal.success')}</p>
          <p style="margin-top: 10px; font-size: 13px; color: #7f8c8d;">
            ${result.filePath}
          </p>
        </div>
      `);
    }
  } catch (error) {
    log('logs.match.exportError', { params: { error: String(error) }, severity: 'error', context: 'match' });
  }
}

function showModal(title: string, content: string) {
  const modal = document.getElementById('modal');
  const modalHeader = document.getElementById('modal-header');
  const modalBody = document.getElementById('modal-body');
  
  if (modal && modalHeader && modalBody) {
    modalHeader.textContent = title;
    modalBody.innerHTML = content;
    modal.style.display = 'block';
  }
}

// Handlers d'ouverture/fermeture de DB
async function openExistingDatabase() {
  try {
    log('logs.database.opening', { context: 'database', state: 'question' });

    const result = await window.api.openDatabase();

    if (result && result.success) {
      resetInterface();

      currentDbPath = result.dbPath;
      currentDatPath = result.datPath;
      currentDatInfo = result.datInfo || null;

      // Mettre à jour le bandeau d'info DB
      updateDbInfoBanner();

      log('logs.database.opened', { params: { path: result.dbPath }, context: 'database', state: 'success' });
      log('logs.database.gamesFound', { params: { count: result.gamesCount }, context: 'game', state: 'count' });
      log('logs.database.romsReferenced', { params: { count: result.romsCount }, context: 'romfile', state: 'count' });

      if (result.folders && result.folders.length > 0) {
        loadedFolders = result.folders;
        log('logs.database.foldersFound', { params: { count: result.folders.length }, context: 'folder', state: 'count' });
      }

      // Restaurer le dossier cible depuis la métadonnée de la base
      const savedTargetFolder = await window.api.getDbMetadata('target_folder');
      if (savedTargetFolder) {
        targetFolderPath = savedTargetFolder;
      }

      // Mettre à jour l'état des boutons workflow en fonction de l'état réel de la base de données
      updateWorkflowButtons();

      updateLeftSidebar();

      // Vérifier si un matching a déjà été effectué et afficher le rapport approprié
      if (result.hasMatching) {
        matchingComplete = true;
        updateWorkflowButtons();
        // Afficher le rapport complet depuis la base
        await displayMatchingReport();
        log('logs.match.reportLoaded', { context: 'match', state: 'success' });
      } else if (result.gamesCount > 0) {
        // Afficher le rapport initial (tous manquants)
        await displayInitialReport(result.gamesCount, result.romsCount);
        log('logs.match.initialReport', { context: 'match', state: 'waiting' });
      }

      const datList = document.getElementById('dat-list');
      if (datList && datList.firstElementChild) {
        (datList.firstElementChild as HTMLElement).click();
      }
    } else {
      log('logs.database.openCancelled', { context: 'database', state: 'cancel' });
    }
  } catch (error) {
    log('common.errorWithDetail', { params: { error: error instanceof Error ? error.message : String(error) }, severity: 'error', context: 'database' });
  }
}

async function closeDatabase() {
  try {
    const closed = await window.api.closeDatabase();
    if (closed) {
      log('logs.database.closed', { context: 'database', state: 'complete' });
      resetInterface();

      // Mettre à jour l'état des boutons workflow et des menus après fermeture
      updateWorkflowButtons();
    }
  } catch (error) {
    log('logs.database.closeError', { params: { error: error instanceof Error ? error.message : String(error) }, severity: 'error', context: 'database' });
  }
}

// Initialisation de la recherche
function setupSearch() {
  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  const searchScope = document.getElementById('search-scope') as HTMLSelectElement;
  const searchClear = document.getElementById('search-clear') as HTMLButtonElement;
  
  if (!searchInput || !searchScope || !searchClear) return;
  
  // Gestion de la saisie avec debounce
  searchInput.addEventListener('input', (e) => {
    const query = (e.target as HTMLInputElement).value;
    currentSearchQuery = query;
    
    // Afficher/masquer le bouton clear
    searchClear.style.display = query ? 'block' : 'none';
    
    // Debounce de 300ms
    if (searchTimeout) clearTimeout(searchTimeout);
    
    if (query.length >= 2) {
      searchTimeout = setTimeout(() => performSearch(query, currentSearchScope), 300);
    } else if (query.length === 0) {
      restoreOriginalContent();
    }
  });
  
  // Changement de scope
  searchScope.addEventListener('change', (e) => {
    currentSearchScope = (e.target as HTMLSelectElement).value as any;
    if (currentSearchQuery.length >= 2) {
      performSearch(currentSearchQuery, currentSearchScope);
    }
  });
  
  // Bouton clear
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    currentSearchQuery = '';
    searchClear.style.display = 'none';
    restoreOriginalContent();
  });
}

// Effectuer la recherche
async function performSearch(query: string, scope: 'all' | 'games' | 'files' | 'archives') {
  const gameList = document.getElementById('game-list');
  if (!gameList) return;
  
  // Sauvegarder le contenu original si ce n'est pas déjà fait
  if (originalContent.length === 0) {
    originalContent = Array.from(gameList.children) as HTMLElement[];
  }
  
  try {
    // Afficher un indicateur de chargement
    gameList.innerHTML = `<div style="padding: 20px; text-align: center;">${t('index.searchView.inProgress')}</div>`;

    const results = await window.api.searchGlobal(query, scope);

    // Afficher les résultats
    displaySearchResults(results, query);
  } catch (error) {
    gameList.innerHTML = `<div style="padding: 20px; color: #e74c3c;">${t('index.searchView.error', { error: String(error) })}</div>`;
  }
}

// Afficher les résultats de recherche
function displaySearchResults(results: any, query: string) {
  const gameList = document.getElementById('game-list');
  if (!gameList) return;
  
  gameList.innerHTML = '';
  
  const totalResults = results.games.length + results.files.length + results.archives.length;
  
  if (totalResults === 0) {
    gameList.innerHTML = `
      <div style="padding: 20px; text-align: center; color: #7f8c8d;">
        ${t('index.searchView.noResults', { query: `<strong>${escapeHtml(query)}</strong>` })}
      </div>
    `;
    return;
  }
  
  // Créer un conteneur pour les résultats
  const container = document.createElement('div');
  container.style.padding = '10px';
  
  // Afficher les jeux trouvés
  if (results.games.length > 0) {
    const gamesSection = document.createElement('div');
    gamesSection.innerHTML = `
      <h4 style="color: #2c3e50; margin: 10px 0; padding: 5px; border-bottom: 2px solid #3498db;">
        🎮 ${t('index.searchView.gamesSection', { count: results.games.length })}
      </h4>
    `;
    
    results.games.forEach((game: any) => {
      const item = document.createElement('div');
      item.className = 'list-item search-match';
      item.innerHTML = `
        <div>
          <div class="list-item-name">${highlightText(game.name, query)}</div>
          ${game.description ? `<div class="list-item-info">${highlightText(game.description, query)}</div>` : ''}
          <div class="list-item-info">${t('index.searchView.romCount', { count: game.rom_count })}</div>
        </div>
      `;
      item.addEventListener('click', () => selectGame(item, game));
      gamesSection.appendChild(item);
    });
    
    container.appendChild(gamesSection);
  }
  
  // Afficher les fichiers trouvés
  if (results.files.length > 0) {
    const filesSection = document.createElement('div');
    filesSection.innerHTML = `
      <h4 style="color: #2c3e50; margin: 20px 0 10px 0; padding: 5px; border-bottom: 2px solid #27ae60;">
        💾 ${t('index.searchView.filesSection', { count: results.files.length })}
      </h4>
    `;
    
    results.files.forEach((file: any) => {
      const item = document.createElement('div');
      item.className = 'list-item search-match';
      const icon = file.is_archive ? '📦' : '💾';
      item.innerHTML = `
        <div>
          <div class="list-item-name">${icon} ${highlightText(file.file_name, query)}</div>
          <div class="list-item-info" style="font-size: 11px; color: #95a5a6;">
            ${file.folder_path}
          </div>
        </div>
        <div class="list-item-info">${formatFileSize(file.size)}</div>
      `;
      item.addEventListener('click', () => {
        // Naviguer vers le dossier contenant le fichier
        selectFolderAndFile(file.folder_path, file.file_name);
      });
      filesSection.appendChild(item);
    });
    
    container.appendChild(filesSection);
  }
  
  // Afficher les contenus d'archives trouvés
  if (results.archives.length > 0) {
    const archivesSection = document.createElement('div');
    archivesSection.innerHTML = `
      <h4 style="color: #2c3e50; margin: 20px 0 10px 0; padding: 5px; border-bottom: 2px solid #e67e22;">
        📦 ${t('index.searchView.archivesSection', { count: results.archives.length })}
      </h4>
    `;
    
    results.archives.forEach((archive: any) => {
      const item = document.createElement('div');
      item.className = 'list-item search-match';
      item.innerHTML = `
        <div>
          <div class="list-item-name">📄 ${highlightText(archive.file_name, query)}</div>
          <div class="list-item-info" style="font-size: 11px;">
            ${t('index.searchView.inArchive', { archive: archive.archive_name })}
          </div>
          <div class="list-item-info" style="font-size: 11px; color: #95a5a6;">
            ${archive.archive_path}
          </div>
        </div>
        <div class="list-item-info">${formatFileSize(archive.size)}</div>
      `;
      archivesSection.appendChild(item);
    });
    
    container.appendChild(archivesSection);
  }
  
  gameList.appendChild(container);
}

// Surligner le texte recherché
function highlightText(text: string, query: string): string {
  if (!text) return '';
  
  const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
  return text.replace(regex, '<span class="search-highlight">$1</span>');
}

// Échapper les caractères spéciaux pour regex
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Échapper HTML
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Restaurer le contenu original
function restoreOriginalContent() {
  const gameList = document.getElementById('game-list');
  if (!gameList || originalContent.length === 0) return;
  
  gameList.innerHTML = '';
  originalContent.forEach(child => gameList.appendChild(child));
  originalContent = [];
}

// Naviguer vers un dossier et sélectionner un fichier
async function selectFolderAndFile(folderPath: string, fileName: string) {
  // Trouver le dossier racine correspondant
  const rootFolders = loadedFolders.map(f => f.path);
  const matchingRoot = rootFolders.find(root => folderPath.startsWith(root));
  
  if (matchingRoot) {
    // Sélectionner le dossier racine dans le volet gauche
    const folderItems = document.querySelectorAll('.sidebar-item[data-type="folder"]');
    folderItems.forEach(item => {
      if ((item as HTMLElement).dataset.path === matchingRoot) {
        (item as HTMLElement).click();
      }
    });
    
    // Si le fichier n'est pas dans le dossier racine, naviguer vers le sous-dossier
    if (folderPath !== matchingRoot) {
      await updateFolderContent(folderPath);
    }
    
    // TODO: Surligner le fichier trouvé dans la liste
    setTimeout(() => {
      const fileItems = document.querySelectorAll('.list-item');
      fileItems.forEach(item => {
        if (item.textContent?.includes(fileName)) {
          item.classList.add('selected');
          item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    }, 100);
  }
}

function getBasename(filePath: string): string {
  return filePath.split(/[\\\/]/).pop() || filePath;
}

// Remplacer la fonction handleDeleteFolder par :
async function handleDeleteFolder(folderPath: string): Promise<void> {
  const folderName = getBasename(folderPath);
  const result = await window.api.showMessageBox({
    type: 'warning',
    title: t('index.confirm.deleteFolderTitle'),
    message: t('index.confirm.deleteFolderMessage', { folder: folderName }),
    detail: t('index.confirm.deleteFolderDetail'),
    buttons: [t('common.cancel'), t('index.confirm.moveToTrash')],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
  
  if (result.response === 1) {
    try {
      // Appeler la nouvelle fonction pour supprimer physiquement
      const deleted = await window.api.deleteFolder(folderPath);
      
      if (deleted) {
        // Supprimer aussi de la base de données
        await window.api.removeFolder(folderPath);
        
        // Rafraîchir l'affichage
        const rootFolders = await window.api.getRootFolders();
        loadedFolders = rootFolders;
        updateLeftSidebar();
        
        // Afficher un message de succès
        log('logs.folder.folderTrashedNamed', { params: { folder: folderName }, context: 'folder', state: 'deleted' });
      }
    } catch (error) {
      console.error('Error while deleting:', error);
      await window.api.showMessageBox({
        type: 'error',
        title: t('common.error'),
        message: t('index.confirm.deleteFolderError'),
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

// Récupération des éléments du DOM
const datLoadButton = document.getElementById('dat-load') as HTMLButtonElement;
const romAddFolderButton = document.getElementById('rom-add-folder') as HTMLButtonElement;
const romAddFolderButtonSidebar = document.getElementById('rom-add-folder-sidebar') as HTMLButtonElement;
const matchRomsButton = document.getElementById('match-roms') as HTMLButtonElement;
const consolidateRomsButton = document.getElementById('consolidate-roms') as HTMLButtonElement;

// Étape 1 — « Charger DAT/XML » : ouvre l'écran unifié de chargement.
// L'écran gère : fichier local ou téléchargement, création automatique de la
// base (mode primaire) ou fusion (mode complémentaire si une base est ouverte).
datLoadButton?.addEventListener('click', () => {
  window.api.openDatDownloadWindow();
});

/**
 * Post-traitement après un chargement PRIMAIRE réussi depuis l'écran unifié :
 * même logique que l'ancien flux « Créer base de données » (bandeau, sidebar,
 * rapport initial, auto-ajout du dossier de ROMs validées).
 */
async function handlePrimaryDatLoaded(payload: {
  dbPath: string;
  datPath?: string;
  gamesCount: number;
  romsCount: number;
  datInfo?: any;
}) {
  log('logs.database.created', { params: { path: payload.dbPath }, context: 'database', state: 'success' });
  log('logs.database.gamesImported', { params: { count: payload.gamesCount }, context: 'game', state: 'count' });
  log('logs.database.romsReferenced', { params: { count: payload.romsCount }, context: 'romfile', state: 'count' });

  currentDatPath = payload.datPath || null;
  currentDbPath = payload.dbPath;
  currentDatInfo = payload.datInfo || null;

  // Mettre à jour le bandeau d'info DB
  updateDbInfoBanner();
  updateLeftSidebar();
  updateWorkflowButtons();

  // Afficher le rapport initial
  if (payload.gamesCount > 0) {
    await displayInitialReport(payload.gamesCount, payload.romsCount);
    log('logs.match.reportInitialized', { context: 'match', state: 'waiting' });
  }

  // Auto-ajouter le dossier de ROMs validées s'il est configuré
  // (avec sous-dossier système si l'option multi-système est activée)
  const settings = await window.api.getSettings();
  if (settings.validatedRomsFolder) {
    const effectiveFolder = await window.api.getEffectiveValidatedFolder();
    targetFolderPath = effectiveFolder;
    await window.api.setDbMetadata('target_folder', effectiveFolder);
    try {
      log('logs.folder.targetChecking', { params: { path: effectiveFolder }, context: 'folder', state: 'loading' });

      const progressHandler = (data: any) => {
        if (data.fileName) {
          const icon = data.isArchive ? '📦' : '💾';
          log('logs.romfile.scanningIcon', { params: { icon, file: data.fileName }, context: 'romfile', state: 'loading' });
        }
      };
      window.api.onScanProgress(progressHandler);

      const stats = await window.api.addRomsFolder(effectiveFolder);

      if (stats.length > 0) {
        log('logs.folder.targetAdded', { params: { count: stats.length }, context: 'folder', state: 'success' });
      } else {
        log('logs.folder.targetAddedEmpty', { context: 'folder', state: 'success' });
      }

      // Rafraîchir la liste des dossiers
      const rootFolders = await window.api.getRootFolders();
      loadedFolders = rootFolders;
      updateLeftSidebar();
      updateWorkflowButtons();
    } catch (folderError) {
      log('logs.folder.targetAddError', { params: { error: folderError instanceof Error ? folderError.message : String(folderError) }, severity: 'warning', context: 'folder' });
    }
  }

  log('logs.folder.readyForFolders', { context: 'folder', state: 'waiting' });
}

// Notification depuis l'écran unifié : un DAT a été chargé (primaire ou complémentaire)
window.api.onDatDownloadLoaded(async (payload: any) => {
  try {
    if (payload?.mode === 'complementary') {
      log('logs.dat.complementaryLoaded', { params: { name: payload.datName, version: payload.datVersion || t('logs.dat.noVersion') }, context: 'dat', state: 'success' });
      log('logs.dat.complementaryStats', { params: { games: payload.gamesCount, roms: payload.romsCount, disks: payload.disksCount, relationships: payload.relationshipsCount }, context: 'dat', state: 'count' });
      // Rafraîchir bandeau (compteurs CHD peuvent avoir bougé) + volet central
      await updateDbInfoBanner();
      if (selectedElement) {
        await updateCenterContent(selectedElement.type, selectedElement.value);
      }
      updateWorkflowButtons();
    } else if (payload?.mode === 'primary') {
      await handlePrimaryDatLoaded(payload);
    }
  } catch (error) {
    log('logs.dat.refreshAfterLoadError', { params: { error: error instanceof Error ? error.message : String(error) }, severity: 'error', context: 'dat' });
  }
});

// Fonction réutilisable pour ajouter des dossiers de ROMs
async function addRomsFolders() {
  if (!currentDbPath) {
    log('logs.folder.createDbFirst', { severity: 'warning', context: 'folder' });
    return;
  }

  try {
    romAddFolderButton.disabled = true;
    romAddFolderButtonSidebar.disabled = true;
    log('logs.folder.selecting', { context: 'folder', state: 'question' });

    const folderPaths = await window.api.selectRomFolders();
    if (folderPaths) {
      const folders = Array.isArray(folderPaths) ? folderPaths : [folderPaths];

      log('logs.folder.scanningCount', { params: { count: folders.length }, context: 'folder', state: 'loading' });

      const progressHandler = (data: any) => {
        if (data.fileName) {
          const icon = data.isArchive ? '📦' : '💾';
          log('logs.romfile.scanningIcon', { params: { icon, file: data.fileName }, context: 'romfile', state: 'loading' });
        }
      };

      window.api.onScanProgress(progressHandler);

      const stats = await window.api.addRomsFolder(folders);

      log('logs.folder.scanDoneTotal', { params: { count: stats.length }, context: 'folder', state: 'success' });

      // Rafraîchir la liste des dossiers
      const rootFolders = await window.api.getRootFolders();
      loadedFolders = rootFolders;

      updateLeftSidebar();

      // Mettre à jour l'état des boutons workflow
      updateWorkflowButtons();
    } else {
      log('logs.folder.selectCancelled', { context: 'folder', state: 'cancel' });
    }
  } catch (error) {
    log('common.errorWithDetail', { params: { error: error instanceof Error ? error.message : String(error) }, severity: 'error', context: 'folder' });
  } finally {
    romAddFolderButton.disabled = false;
    romAddFolderButtonSidebar.disabled = false;
  }
}

// Étape 4 : Ajout de dossier de ROMs
romAddFolderButton?.addEventListener('click', addRomsFolders);

// Bouton sidebar pour ajouter des dossiers de ROMs
romAddFolderButtonSidebar?.addEventListener('click', addRomsFolders);

// Étape 5 : Handler pour le matching
matchRomsButton?.addEventListener('click', runMatching);

// Étape 6 : Handler pour la consolidation
consolidateRomsButton?.addEventListener('click', runConsolidation);

// ============================================================================
// Phase 10 — Sélection automatique par règles d'inclusion/exclusion
// ============================================================================
//
// Modèle : un état de départ (tout / rien / sélection actuelle) + une liste
// ordonnée de règles. Pour chaque jeu, les règles sont évaluées de haut en
// bas et la DERNIÈRE règle qui correspond détermine l'état final.
// BIOS, devices et jeux disparus sont exclus du ciblage (gérés par la cascade).
// Les règles sont persistées dans la metadata DB ('selection_rules').

type AsmField = 'name' | 'description' | 'category' | 'driver_status' | 'has_chd' | 'is_clone' | 'match_status';

interface SelectionRule {
  action: 'select' | 'deselect';
  field: AsmField;
  operator: string;
  value: string;
}

let asmRules: SelectionRule[] = [];
let asmBase: 'all' | 'none' | 'current' = 'all';

const ASM_TEXT_FIELDS: AsmField[] = ['name', 'description', 'category'];

// Libellés résolus au rendu (les traductions ne sont pas chargées à l'import du module)
function asmFieldLabels(): Record<AsmField, string> {
  return {
    name: t('index.asm.fieldName'),
    description: t('index.asm.fieldDescription'),
    category: t('index.asm.fieldCategory'),
    driver_status: t('index.asm.fieldDriverStatus'),
    has_chd: t('index.asm.fieldHasChd'),
    is_clone: t('index.asm.fieldIsClone'),
    match_status: t('index.asm.fieldMatchStatus')
  };
}

function asmTextOps(): Array<{ v: string; l: string }> {
  return [
    { v: 'contains', l: t('index.asm.opContains') },
    { v: 'not-contains', l: t('index.asm.opNotContains') },
    { v: 'starts', l: t('index.asm.opStarts') },
    { v: 'ends', l: t('index.asm.opEnds') },
    { v: 'regex', l: t('index.asm.opRegex') }
  ];
}

function asmEnumOps(): Array<{ v: string; l: string }> {
  return [
    { v: 'is', l: t('index.asm.opIs') },
    { v: 'is-not', l: t('index.asm.opIsNot') }
  ];
}

function asmEnumValues(): Partial<Record<AsmField, Array<{ v: string; l: string }>>> {
  return {
    driver_status: [
      { v: 'good', l: 'good' },
      { v: 'imperfect', l: 'imperfect' },
      { v: 'preliminary', l: 'preliminary' },
      { v: '', l: t('index.asm.valueUnset') }
    ],
    has_chd: [{ v: 'yes', l: t('common.yes').toLowerCase() }, { v: 'no', l: t('common.no').toLowerCase() }],
    is_clone: [{ v: 'yes', l: t('common.yes').toLowerCase() }, { v: 'no', l: t('common.no').toLowerCase() }],
    match_status: [
      { v: 'complete', l: t('index.asm.valueComplete') },
      { v: 'partial', l: t('index.asm.valuePartial') },
      { v: 'missing', l: t('index.asm.valueMissing') },
      { v: 'unknown', l: t('index.asm.valueUnknown') }
    ]
  };
}

// Modèles rapides : jeux de règles pré-configurés ajoutés à la liste courante
const ASM_PRESETS: Record<string, SelectionRule[]> = {
  'no-proto': [
    { action: 'deselect', field: 'name', operator: 'contains', value: '(proto' },
    { action: 'deselect', field: 'name', operator: 'contains', value: '(beta' },
    { action: 'deselect', field: 'name', operator: 'contains', value: '(demo' },
    { action: 'deselect', field: 'name', operator: 'contains', value: '(sample' }
  ],
  // Convention No-Intro/Redump : les BIOS sont préfixés « [BIOS] » dans le nom.
  // (Les BIOS MAME portent isbios="yes" et sont déjà exclus du ciblage des règles —
  // leur sélection est pilotée par la cascade de dépendances.)
  'no-bios': [
    { action: 'deselect', field: 'name', operator: 'contains', value: '[bios]' }
  ],
  // Convention No-Intro/Redump : « (Aftermarket) » = production post-commerciale,
  // « (Unl) » = jeu non licencié. N'existe pas dans les DAT MAME.
  'no-aftermarket-unl': [
    { action: 'deselect', field: 'name', operator: 'contains', value: '(aftermarket' },
    { action: 'deselect', field: 'name', operator: 'contains', value: '(unl)' }
  ],
  'no-clones': [{ action: 'deselect', field: 'is_clone', operator: 'is', value: 'yes' }],
  'good-only': [{ action: 'deselect', field: 'driver_status', operator: 'is-not', value: 'good' }],
  'no-chd': [{ action: 'deselect', field: 'has_chd', operator: 'is', value: 'yes' }],
  'complete-only': [{ action: 'deselect', field: 'match_status', operator: 'is-not', value: 'complete' }]
};

function asmRuleMatches(rule: SelectionRule, game: GameInfo): boolean {
  if (ASM_TEXT_FIELDS.includes(rule.field)) {
    const raw = String((game as any)[rule.field] || '');
    const v = raw.toLowerCase();
    const q = (rule.value || '').toLowerCase();
    // Une règle texte sans valeur ne matche rien (sauf regex vide, rejetée aussi)
    if (!rule.value) return false;
    switch (rule.operator) {
      case 'contains': return v.includes(q);
      case 'not-contains': return !v.includes(q);
      case 'starts': return v.startsWith(q);
      case 'ends': return v.endsWith(q);
      case 'regex':
        try { return new RegExp(rule.value, 'i').test(raw); } catch { return false; }
      default: return false;
    }
  }

  // Champs booléens / énumérés
  let actual: string;
  if (rule.field === 'has_chd') actual = game.has_chd ? 'yes' : 'no';
  else if (rule.field === 'is_clone') actual = game.parent_name_ref ? 'yes' : 'no';
  else if (rule.field === 'driver_status') actual = game.driver_status || '';
  else actual = game.match_status || 'unknown';

  const eq = actual === rule.value;
  return rule.operator === 'is-not' ? !eq : eq;
}

/** Jeux ciblés par les règles : ni disparus, ni BIOS, ni devices. */
function asmTargets(): GameInfo[] {
  return allGames.filter(g => !g.is_disappeared && !g.is_bios && !g.is_device);
}

/** Calcule l'état de sélection final pour chaque jeu ciblé. */
function asmCompute(): Map<number, boolean> {
  const result = new Map<number, boolean>();
  for (const g of asmTargets()) {
    let sel = asmBase === 'all' ? true : asmBase === 'none' ? false : g.is_selected !== 0;
    for (const rule of asmRules) {
      if (asmRuleMatches(rule, g)) sel = rule.action === 'select';
    }
    result.set(g.id, sel);
  }
  return result;
}

// Aperçu débounced (les regex sur de gros DAT MAME peuvent coûter cher au keystroke)
let asmPreviewTimer: ReturnType<typeof setTimeout> | null = null;

function asmSchedulePreview() {
  if (asmPreviewTimer) clearTimeout(asmPreviewTimer);
  asmPreviewTimer = setTimeout(asmUpdatePreview, 250);
}

function asmUpdatePreview() {
  const el = document.getElementById('asm-preview');
  if (!el) return;
  const result = asmCompute();
  let sel = 0;
  let changed = 0;
  for (const g of asmTargets()) {
    const target = result.get(g.id)!;
    if (target) sel++;
    if (target !== (g.is_selected !== 0)) changed++;
  }
  el.innerHTML = t('index.asm.preview', { selected: `<strong>${sel}</strong>`, total: result.size, changed: `<strong>${changed}</strong>` });
}

/** Construit la ligne d'édition d'une règle (action / champ / opérateur / valeur / déplacer / supprimer). */
function asmMakeRow(rule: SelectionRule, index: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'asm-rule';

  // Boutons déplacer (l'ordre des règles est significatif)
  const upBtn = document.createElement('button');
  upBtn.className = 'asm-rule-btn';
  upBtn.textContent = '▲';
  upBtn.title = t('index.asm.moveUp');
  upBtn.disabled = index === 0;
  upBtn.addEventListener('click', () => {
    [asmRules[index - 1], asmRules[index]] = [asmRules[index], asmRules[index - 1]];
    asmRenderRules();
  });

  const downBtn = document.createElement('button');
  downBtn.className = 'asm-rule-btn';
  downBtn.textContent = '▼';
  downBtn.title = t('index.asm.moveDown');
  downBtn.disabled = index === asmRules.length - 1;
  downBtn.addEventListener('click', () => {
    [asmRules[index], asmRules[index + 1]] = [asmRules[index + 1], asmRules[index]];
    asmRenderRules();
  });

  // Action (sélectionner / désélectionner)
  const actionSel = document.createElement('select');
  for (const [v, l] of [['select', `✅ ${t('index.asm.actionSelect')}`], ['deselect', `❌ ${t('index.asm.actionDeselect')}`]] as const) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = l;
    if (rule.action === v) opt.selected = true;
    actionSel.appendChild(opt);
  }
  actionSel.addEventListener('change', () => {
    rule.action = actionSel.value as 'select' | 'deselect';
    asmSchedulePreview();
  });

  // Champ
  const fieldSel = document.createElement('select');
  const fieldLabels = asmFieldLabels();
  (Object.keys(fieldLabels) as AsmField[]).forEach(f => {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = fieldLabels[f];
    if (rule.field === f) opt.selected = true;
    fieldSel.appendChild(opt);
  });
  fieldSel.addEventListener('change', () => {
    rule.field = fieldSel.value as AsmField;
    // Réinitialiser opérateur + valeur cohérents avec le nouveau champ
    if (ASM_TEXT_FIELDS.includes(rule.field)) {
      rule.operator = 'contains';
      rule.value = '';
    } else {
      rule.operator = 'is';
      rule.value = asmEnumValues()[rule.field]?.[0]?.v ?? '';
    }
    asmRenderRules();
  });

  // Opérateur
  const opSel = document.createElement('select');
  const ops = ASM_TEXT_FIELDS.includes(rule.field) ? asmTextOps() : asmEnumOps();
  ops.forEach(({ v, l }) => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = l;
    if (rule.operator === v) opt.selected = true;
    opSel.appendChild(opt);
  });
  opSel.addEventListener('change', () => {
    rule.operator = opSel.value;
    asmSchedulePreview();
  });

  // Valeur : input texte (champs texte) ou select (champs énumérés)
  let valueEl: HTMLElement;
  if (ASM_TEXT_FIELDS.includes(rule.field)) {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = rule.operator === 'regex' ? t('index.asm.regexPlaceholder') : t('index.asm.textPlaceholder');
    input.value = rule.value;
    input.addEventListener('input', () => {
      rule.value = input.value;
      asmSchedulePreview();
    });
    valueEl = input;
  } else {
    const sel = document.createElement('select');
    sel.className = 'asm-value-select';
    (asmEnumValues()[rule.field] || []).forEach(({ v, l }) => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = l;
      if (rule.value === v) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => {
      rule.value = sel.value;
      asmSchedulePreview();
    });
    valueEl = sel;
  }

  // Supprimer
  const delBtn = document.createElement('button');
  delBtn.className = 'asm-rule-btn asm-delete';
  delBtn.textContent = '🗑';
  delBtn.title = t('index.asm.deleteRule');
  delBtn.addEventListener('click', () => {
    asmRules.splice(index, 1);
    asmRenderRules();
  });

  row.appendChild(upBtn);
  row.appendChild(downBtn);
  row.appendChild(actionSel);
  row.appendChild(fieldSel);
  row.appendChild(opSel);
  row.appendChild(valueEl);
  row.appendChild(delBtn);
  return row;
}

function asmRenderRules() {
  const container = document.getElementById('asm-rules');
  if (!container) return;
  container.innerHTML = '';
  if (asmRules.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'asm-rules-empty';
    empty.textContent = t('index.asm.noRules');
    container.appendChild(empty);
  } else {
    asmRules.forEach((rule, index) => container.appendChild(asmMakeRow(rule, index)));
  }
  asmSchedulePreview();
}

async function openAutoSelectModal() {
  if (!currentDbPath || allGames.length === 0) {
    log('logs.game.loadDatFirst', { severity: 'warning', context: 'game' });
    return;
  }

  // Restaurer les règles persistées dans la base
  try {
    const saved = await window.api.getDbMetadata('selection_rules');
    if (saved) {
      const parsed = JSON.parse(saved);
      asmBase = parsed.base === 'none' || parsed.base === 'current' ? parsed.base : 'all';
      asmRules = Array.isArray(parsed.rules) ? parsed.rules : [];
    }
  } catch {
    // Metadata absente ou corrompue — on repart de zéro
  }

  document.querySelectorAll<HTMLInputElement>('input[name="asm-base"]').forEach(r => {
    r.checked = r.value === asmBase;
  });

  asmRenderRules();

  const modal = document.getElementById('auto-select-modal') as HTMLElement;
  modal.style.display = 'flex';
}

async function asmApply() {
  const applyBtn = document.getElementById('asm-apply') as HTMLButtonElement;
  applyBtn.disabled = true;

  try {
    const result = asmCompute();

    // Ne mettre à jour que les jeux dont l'état change réellement
    const toSelect: number[] = [];
    const toDeselect: number[] = [];
    for (const g of asmTargets()) {
      const target = result.get(g.id)!;
      if (target !== (g.is_selected !== 0)) {
        (target ? toSelect : toDeselect).push(g.id);
      }
    }

    // Chunker les updates bulk (limite de variables SQLite sur les gros DAT MAME)
    const CHUNK = 500;
    for (let i = 0; i < toSelect.length; i += CHUNK) {
      await window.api.updateGameSelectionBulk(toSelect.slice(i, i + CHUNK), true);
    }
    for (let i = 0; i < toDeselect.length; i += CHUNK) {
      await window.api.updateGameSelectionBulk(toDeselect.slice(i, i + CHUNK), false);
    }

    // Synchroniser l'état local
    for (const g of allGames) {
      if (result.has(g.id)) {
        g.is_selected = result.get(g.id) ? 1 : 0;
      }
    }

    // Persister les règles dans la base pour la prochaine ouverture
    await window.api.setDbMetadata('selection_rules', JSON.stringify({ base: asmBase, rules: asmRules }));

    // Recalculer la cascade de dépendances et re-rendre
    await refreshDependencyResolution();
    applyFiltersAndGrouping();
    updateSelectAllCheckbox();
    generateSelectionFilters();

    log('logs.game.autoSelectApplied', { params: { selected: toSelect.length, deselected: toDeselect.length }, context: 'game', state: 'success' });

    (document.getElementById('auto-select-modal') as HTMLElement).style.display = 'none';
  } catch (error) {
    log('logs.game.autoSelectError', { params: { error: error instanceof Error ? error.message : String(error) }, severity: 'error', context: 'game' });
  } finally {
    applyBtn.disabled = false;
  }
}

function setupAutoSelectModal() {
  document.getElementById('auto-select-btn')?.addEventListener('click', openAutoSelectModal);

  document.getElementById('asm-add-rule')?.addEventListener('click', () => {
    asmRules.push({ action: 'deselect', field: 'name', operator: 'contains', value: '' });
    asmRenderRules();
  });

  document.querySelectorAll<HTMLInputElement>('input[name="asm-base"]').forEach(radio => {
    radio.addEventListener('change', () => {
      asmBase = radio.value as 'all' | 'none' | 'current';
      asmSchedulePreview();
    });
  });

  document.querySelectorAll<HTMLButtonElement>('#auto-select-modal [data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = ASM_PRESETS[btn.dataset.preset || ''];
      if (preset) {
        // Copie profonde : les règles du preset sont éditables indépendamment
        asmRules.push(...preset.map(r => ({ ...r })));
        asmRenderRules();
      }
    });
  });

  document.getElementById('asm-cancel')?.addEventListener('click', () => {
    (document.getElementById('auto-select-modal') as HTMLElement).style.display = 'none';
  });

  document.getElementById('asm-apply')?.addEventListener('click', asmApply);
}

setupAutoSelectModal();

// Écouter les actions du menu
window.api.onMenuAction(async (action: string) => {
  switch (action) {
    case 'new-database':
      datLoadButton?.click();
      break;
    case 'open-database':
      openExistingDatabase();
      break;
    case 'close-database':
      closeDatabase();
      break;
    case 'load-dat':
      datLoadButton?.click();
      break;
    case 'add-folder':
      romAddFolderButton?.click();
      break;
    case 'delete-folder':
      // Récupérer le dossier actuellement sélectionné
      if (selectedElement && selectedElement.type === 'folder') {
        await handleDeleteFolder(selectedElement.value);
      } else {
        log('logs.folder.noneSelected', { severity: 'warning', context: 'folder' });
      }
      break;
    case 'match-roms':
      runMatching();
      break;
    case 'consolidate-roms':
      runConsolidation();
      break;
    case 'show-missing':
      showMissingRoms();
      break;
    case 'show-extras':
      showExtraFiles();
      break;
    case 'export-report':
      exportReport();
      break;
  }
});

// Écouter le changement de mode de vue
window.api.onViewMode?.((mode: string) => {
  viewMode = mode as 'hierarchical' | 'flat';
  const radio = document.querySelector(`input[name="view-mode"][value="${mode}"]`) as HTMLInputElement;
  if (radio) radio.checked = true;
  
  if (currentFolderPath) {
    updateFolderContent(currentFolderPath);
  }
});

// Écouter les messages de log envoyés par le main process.
// isFromMain=true : le main a déjà écrit dans le fichier — ne pas ré-écrire.
window.api.onLogMessage((data: { severity: string, context: string, key: string, params?: Record<string, string | number> }) => {
  log(data.key, {
    severity: data.severity as LogSeverity,
    context: data.context as LogContext,
    params: data.params
  }, true);
});

// Fermeture de la fenêtre modale
document.getElementById('modal-close')?.addEventListener('click', () => {
  const modal = document.getElementById('modal');
  if (modal) modal.style.display = 'none';
});

window.addEventListener('click', (event) => {
  const modal = document.getElementById('modal');
  if (event.target === modal && modal) {
    modal.style.display = 'none';
  }
});

// Rendre les fonctions disponibles globalement pour les boutons inline
(window as any).convertToChd = convertToChd;
(window as any).extractChd = extractChd;
(window as any).verifyChdFile = verifyChdFile;
(window as any).showChdInfo = showChdInfo;
(window as any).showMissingRoms = showMissingRoms;
(window as any).showExtraFiles = showExtraFiles;
(window as any).exportReport = exportReport;

// Configuration du groupement et filtrage
function setupGroupingAndFiltering() {
  const groupBySelect = document.getElementById('group-by') as HTMLSelectElement;
  if (!groupBySelect) return;

  groupBySelect.addEventListener('change', () => {
    currentGroupBy = groupBySelect.value as 'none' | 'category' | 'letter' | 'match-status' | 'selection' | 'change-status';
    // Les clés de groupes ne sont plus valides quand le mode de groupement change
    collapsedGameGroups.clear();
    applyFiltersAndGrouping();
    updateGroupFilterSummary();
  });

  // Gestion de la checkbox "Tout sélectionner"
  const selectAllCheckbox = document.getElementById('select-all-checkbox') as HTMLInputElement;
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', async () => {
      const isSelected = selectAllCheckbox.checked;
      selectAllCheckbox.indeterminate = false;

      // Récupérer les jeux actuellement affichés (filtrés), hors jeux disparus
      const displayedGames = getDisplayedGames().filter((g: GameInfo) => !g.is_disappeared);
      const gameIds = displayedGames.map((g: GameInfo) => g.id);

      if (gameIds.length === 0) return;

      // Mettre à jour en base
      await window.api.updateGameSelectionBulk(gameIds, isSelected);

      // Mettre à jour l'état local
      displayedGames.forEach((g: GameInfo) => g.is_selected = isSelected ? 1 : 0);

      // Recalculer la cascade (auto-sélections de BIOS/parents/devices) puis
      // re-rendre complètement pour libérer les éventuels cadenas obsolètes.
      await refreshDependencyResolution();
      applyFiltersAndGrouping();

      updateGroupCheckboxes();
      updateSelectionCounter();
      generateSelectionFilters();
    });
  }
}

// Mise à jour du résumé de groupement et filtrage
function updateGroupFilterSummary() {
  const bar = document.getElementById('active-filters-bar');
  if (!bar) return;

  const selectionLabels: Record<string, string> = {
    'selected': `✅ ${t('index.selectionStatus.selected')}`,
    'unselected': `⬜ ${t('index.selectionStatus.unselected')}`
  };
  const changeStatusLabels: Record<string, string> = {
    'new': `🆕 ${t('index.changeStatus.new')}`,
    'modified': `✏️ ${t('index.changeStatus.modified')}`,
    'unchanged': `⏸️ ${t('index.changeStatus.unchanged')}`,
    'disappeared': `❌ ${t('index.changeStatus.disappeared')}`
  };

  // Définir les groupes de filtres avec leur label, set actif et fonction de label
  const filterGroups: Array<{ label: string; activeSet: Set<string>; getDisplayName: (key: string) => string; containerId: string }> = [
    { label: t('index.filters.groupCategory'), activeSet: activeFilters, getDisplayName: (k) => k, containerId: 'category-filters-container' },
    { label: t('index.filters.matching'), activeSet: activeMatchFilters, getDisplayName: (k) => `${matchStatusIcons[k]} ${matchStatusLabel(k)}`, containerId: 'match-status-filters-container' },
    { label: t('index.filters.groupSelection'), activeSet: activeSelectionFilters, getDisplayName: (k) => selectionLabels[k] || k, containerId: 'selection-filters-container' },
    { label: t('index.filters.groupChangeStatus'), activeSet: activeChangeFilters, getDisplayName: (k) => changeStatusLabels[k] || k, containerId: 'change-status-filters-container' }
  ];

  const activeGroups = filterGroups.filter(g => g.activeSet.size > 0);

  if (activeGroups.length === 0) {
    bar.classList.remove('visible');
    bar.innerHTML = '';
    return;
  }

  bar.innerHTML = '';
  bar.classList.add('visible');

  function clearFilterGroup(group: typeof filterGroups[0]) {
    group.activeSet.clear();
    const container = document.getElementById(group.containerId);
    if (container) {
      const checkboxes = container.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
      checkboxes.forEach(cb => cb.checked = false);
      const countSpan = container.querySelector('.filter-active-count');
      if (countSpan) countSpan.remove();
    }
    applyFiltersAndGrouping();
    updateGroupFilterSummary();
  }

  activeGroups.forEach((group, groupIndex) => {
    if (groupIndex > 0) {
      const sep = document.createElement('div');
      sep.className = 'active-filters-separator';
      bar.appendChild(sep);
    }

    const groupDiv = document.createElement('div');
    groupDiv.className = 'active-filters-group';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'active-filters-group-label';
    labelSpan.textContent = group.label + ' :';
    groupDiv.appendChild(labelSpan);

    const tagDiv = document.createElement('span');
    tagDiv.className = 'active-filters-group-tag';

    const valuesSpan = document.createElement('span');
    valuesSpan.className = 'active-filter-values';
    valuesSpan.textContent = Array.from(group.activeSet).map(k => group.getDisplayName(k)).join(', ');
    tagDiv.appendChild(valuesSpan);

    const removeBtn = document.createElement('span');
    removeBtn.className = 'remove-filter';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => clearFilterGroup(group));
    tagDiv.appendChild(removeBtn);

    groupDiv.appendChild(tagDiv);

    bar.appendChild(groupDiv);
  });

  // Bouton "Tout effacer" si plusieurs groupes actifs
  if (activeGroups.length > 1) {
    const clearAll = document.createElement('span');
    clearAll.className = 'clear-all-filters';
    clearAll.textContent = `✕ ${t('index.filters.clearAll')}`;
    clearAll.addEventListener('click', () => {
      filterGroups.forEach(group => clearFilterGroup(group));
    });
    bar.appendChild(clearAll);
  }
}

/**
 * Rafraîchissement à chaud après un changement de langue : retraduit le DOM
 * statique puis re-rend les zones dynamiques via les fonctions existantes.
 * Préserve l'état de l'application (base ouverte, sélection, panneau de logs) —
 * contrairement à un location.reload().
 */
async function handleLanguageChanged(): Promise<void> {
  await refreshTranslations();
  updateLeftSidebar();
  await updateDbInfoBanner();
  updateWorkflowButtons();
  if (matchingComplete) {
    await displayMatchingReport('matching-report');
  }
  if (selectedElement) {
    await updateCenterContent(selectedElement.type, selectedElement.value);
  }
}

// Initialisation
document.addEventListener('DOMContentLoaded', async () => {
  // Traductions d'abord : le DOM statique et tous les textes dynamiques en dépendent
  await initI18n({ onLanguageChanged: handleLanguageChanged });
  initSplitters();
  setupContextMenu();
  setupViewControls();
  setupSearch();
  setupGroupingAndFiltering();
  initMatchingUI();
  setupCollapsibleSections();

  // Log panel toggle (retractable)
  const logHeader = document.getElementById('log-header');
  if (logHeader) {
    logHeader.addEventListener('click', () => {
      document.getElementById('log-panel')?.classList.toggle('collapsed');
    });
  }

  // Bouton téléchargement DAT
  document.getElementById('dat-download-btn')?.addEventListener('click', () => {
    window.api.openDatDownloadWindow();
  });

  log('logs.welcome.ready', { context: 'welcome' });
}, { once: true });
