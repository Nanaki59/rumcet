// src/renderer/index.ts

import { displayMatchingReport, initMatchingUI, displayInitialReport } from './matchingUI.js';

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
}

interface RomInfo {
  id: number;
  game_id: number;
  name: string;
  size?: number;
  crc32?: string;
  md5?: string;
  sha1?: string;
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

// Fonction de log avec icônes
function log(message: string, options: LogOptions = {}, isFromMain: boolean = false): void {
  const { severity = 'info', context, state } = options;

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

    finalMessage += ` ${message}`;

    div.textContent = finalMessage;
    logDiv.appendChild(div);
    logDiv.scrollTop = logDiv.scrollHeight;

    // Mettre à jour le dernier message dans le header (visible quand replié)
    const lastMsg = document.getElementById('log-last-message');
    if (lastMsg) {
      lastMsg.textContent = finalMessage;
      lastMsg.className = `log-last-message log-${severity}`;
    }

    // IMPORTANT: Ne PAS appeler writeLog si le message vient du main process
    // pour éviter les boucles infinies
    if (!isFromMain) {
      window.api.writeLog(severity, context || 'ui', message).catch((err: Error) => {
        console.error('Erreur lors de l\'écriture du log:', err);
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
      const confirmed = confirm(`Êtes-vous sûr de vouloir supprimer "${target.dataset.path}" de la base de données ?`);
      if (confirmed) {
        try {
          await window.api.removeFolder(target.dataset.path);
          log(`Dossier supprimé : ${target.dataset.path}`, { context: 'folder', state: 'deleted' });

          // Retirer de la liste
          loadedFolders = loadedFolders.filter(f => f.path !== target.dataset.path);
          updateLeftSidebar();
        } catch (error) {
          log(`Erreur lors de la suppression : ${error}`, { severity: 'error', context: 'folder' });
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
      log(`Dossier cible défini : ${target.dataset.path}`, { context: 'folder', state: 'success' });
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
    ? 'Voir le rapport de la dernière mise à jour'
    : 'Aucune mise à jour du DAT effectuée';

  menu.innerHTML = `
    <div class="context-menu-item" id="ctx-update-dat">🔄 Mettre à jour le DAT</div>
    <div class="${reportClass}" id="ctx-show-dat-report" title="${reportTitle}">📋 Voir le dernier rapport de mise à jour</div>
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
    menuHtml += `<div class="context-menu-item" id="ctx-download-rom">&#11015; Télécharger la ROM</div>`;
  }
  menuHtml += `<div class="context-menu-item" id="ctx-download-all-missing">&#11015; Télécharger toutes les ROMs manquantes</div>`;

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
      log(progress.message, { context: 'download', state: 'success' });
    } else if (progress.phase === 'incomplete') {
      log(progress.message, { context: 'download', state: 'warning' });
    } else {
      log(progress.message, { context: 'download', state: 'loading' });
    }
  });
  try {
    const result = await window.api.downloadRom(gameIds);
    const hasFailures = result.stats.failed > 0;
    log(`Téléchargement terminé : ${result.stats.consolidated} consolidé(s), ${result.stats.failed} échec(s)`,
      { context: 'download', state: hasFailures ? 'warning' : 'success' });

    if (result.stats.consolidated > 0) {
      await refreshTargetAndMatching();
    }
  } catch (error: any) {
    log(`Erreur téléchargement : ${error.message}`, { severity: 'error', context: 'download' });
  } finally {
    removeListener();
  }
}

async function startAllMissingRomDownload() {
  const removeListener = window.api.onRomDownloadProgress((progress) => {
    if (progress.phase === 'complete') {
      log(progress.message, { context: 'download', state: 'success' });
    } else if (progress.phase === 'incomplete') {
      log(progress.message, { context: 'download', state: 'warning' });
    } else {
      log(progress.message, { context: 'download', state: 'loading' });
    }
  });
  try {
    const result = await window.api.downloadAllMissingRoms();
    const hasFailures = result.stats.failed > 0;
    log(`Téléchargement terminé : ${result.stats.consolidated} consolidé(s), ${result.stats.failed} échec(s)`,
      { context: 'download', state: hasFailures ? 'warning' : 'success' });

    if (result.stats.consolidated > 0) {
      await refreshTargetAndMatching();
    }
  } catch (error: any) {
    log(`Erreur téléchargement : ${error.message}`, { severity: 'error', context: 'download' });
  } finally {
    removeListener();
  }
}

// Recharge et affiche le dernier rapport de mise à jour DAT depuis la base
async function showLastDatUpdateReport() {
  try {
    const report = await window.api.getDatUpdateReport();
    if (!report) {
      log('Aucun rapport de mise à jour disponible.', { context: 'dat', state: 'waiting' });
      return;
    }
    showDatUpdateReport(report);
  } catch (error) {
    log(`Erreur lors du chargement du rapport : ${error instanceof Error ? error.message : String(error)}`, { severity: 'error', context: 'dat' });
  }
}

// Gestion de la mise à jour du DAT
async function handleDatUpdate() {
  try {
    log('Mise à jour du DAT...', { context: 'dat', state: 'loading' });

    const result = await window.api.updateDat();
    if (!result) {
      log('Mise à jour annulée.', { context: 'dat', state: 'cancel' });
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

    log(`DAT mis à jour : ${result.datInfo.name} v${result.datInfo.version}`, { context: 'dat', state: 'success' });
    log(`${comp.newGames} nouveau(x), ${comp.modifiedGames} modifié(s), ${comp.unchangedGames} inchangé(s), ${comp.disappearedGames} disparu(s)`, { context: 'dat', state: 'count' });

    // Rafraîchir le volet central
    if (selectedElement) {
      await updateCenterContent(selectedElement.type, selectedElement.value);
    }
  } catch (error) {
    log(`Erreur lors de la mise à jour du DAT : ${error instanceof Error ? error.message : String(error)}`, { severity: 'error', context: 'dat' });
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
        <h2>Mise à jour du DAT</h2>
        <button class="close-modal">&times;</button>
      </div>
      <div class="modal-body">
        <div style="font-size: 13px; color: #7f8c8d; margin-bottom: 16px;">
          ${result.previousName} v${result.previousVersion} &rarr; ${result.datInfo.name} v${result.datInfo.version}
        </div>

        <div class="dat-update-stats">
          <div class="dat-update-stat stat-new">
            <span class="stat-value">${comp.newGames}</span>
            <span class="stat-label">Nouveaux</span>
          </div>
          <div class="dat-update-stat stat-modified">
            <span class="stat-value">${comp.modifiedGames}</span>
            <span class="stat-label">Modifiés</span>
          </div>
          <div class="dat-update-stat stat-unchanged">
            <span class="stat-value">${comp.unchangedGames}</span>
            <span class="stat-label">Inchangés</span>
          </div>
          <div class="dat-update-stat stat-disappeared">
            <span class="stat-value">${comp.disappearedGames}</span>
            <span class="stat-label">Disparus</span>
          </div>
        </div>

        ${comp.disappearedGames > 0 ? `
          <div class="dat-update-section">
            <h4>Jeux disparus (${comp.disappearedGames})</h4>
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
          Le matching a été invalidé. Relancez le matching pour prendre en compte les changements.
          <br>Utilisez le filtre « Évolution DAT » dans la vue des jeux pour explorer les différences.
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-close-modal">Fermer</button>
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
        <td>+ Ajouté</td><td>${rom.name}</td><td>${rom.size || ''}</td><td>${rom.crc32 || ''}</td>
      </tr>`;
    }
    for (const rom of diff.removed) {
      tableRows += `<tr class="diff-removed">
        <td>- Supprimé</td><td>${rom.name}</td><td>${rom.size || ''}</td><td>${rom.crc32 || ''}</td>
      </tr>`;
    }
    for (const c of diff.changed) {
      tableRows += `<tr class="diff-changed">
        <td>~ Modifié</td><td>${c.name}</td>
        <td>${c.old.size || ''} &rarr; ${c.new.size || ''}</td>
        <td>${c.old.crc32 || ''} &rarr; ${c.new.crc32 || ''}</td>
      </tr>`;
    }

    overlay.innerHTML = `
      <div class="modal-content large">
        <div class="modal-header">
          <h2>Évolution : ${gameName}</h2>
          <button class="close-modal">&times;</button>
        </div>
        <div class="modal-body">
          <div style="font-size: 13px; color: #7f8c8d; margin-bottom: 12px;">
            ${diff.added.length} ajouté(s), ${diff.removed.length} supprimé(s), ${diff.changed.length} modifié(s)
          </div>
          <table class="rom-diff-table">
            <thead><tr><th>Statut</th><th>Fichier</th><th>Taille</th><th>CRC32</th></tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
        <div class="modal-footer">
          <button class="btn-close-modal">Fermer</button>
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
    log(`Erreur lors du chargement du diff : ${error}`, { severity: 'error', context: 'dat' });
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

    log('UI rafraîchie.', { context: 'match', state: 'success' });
  } catch (error) {
    log(`Erreur lors du rafraîchissement : ${error}`, { severity: 'error', context: 'match' });
  }
}

async function rescanFolder(folderPath: string) {
  try {
    log(`Re-scan du dossier : ${folderPath}...`, { context: 'folder', state: 'loading' });
    
    const progressHandler = (data: any) => {
      if (data.fileName) {
        log(`Scan : ${data.fileName}`, { context: 'romfile', state: 'loading' });
      }
    };
    
    window.api.onScanProgress(progressHandler);
    
    const stats = await window.api.addRomsFolder(folderPath);
    log(`Re-scan terminé : ${stats.length} fichiers trouvés.`, { context: 'folder', state: 'success' });

    // Rafraîchir les compteurs dans la sidebar
    const rootFolders = await window.api.getRootFolders();
    loadedFolders = rootFolders;
    updateLeftSidebar();

    // Rafraîchir l'affichage si c'est le dossier actuel
    if (currentFolderPath === folderPath) {
      await updateCenterContent('folder', folderPath);
    }
  } catch (error) {
    log(`Erreur lors du re-scan : ${error}`, { severity: 'error', context: 'folder' });
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
    menuHtml += `<div id="ctx-refresh-folder" class="context-menu-item">🔄 Re-scanner le dossier</div>`;
    if (!isTarget) {
      menuHtml += `<div id="ctx-set-target" class="context-menu-item">📁 Définir comme dossier cible</div>`;
    }
  }
  if (!isTarget) {
    menuHtml += `<div id="ctx-delete-folder-database" class="context-menu-item">❌ Retirer le dossier de la base</div>`;
    menuHtml += `<div id="ctx-delete-folder-physical" class="context-menu-item danger">🗑️ Supprimer le dossier</div>`;
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
    menu.innerHTML += `<div class="context-menu-item" id="ctx-convert-chd">💿 Convertir en CHD</div>`;
  }

  // CHD → extraction / vérif / infos
  if (ext === 'chd') {
    menu.innerHTML += `<div class="context-menu-item" id="ctx-extract-chd">📦 Extraire le CHD</div>`;
    menu.innerHTML += `<div class="context-menu-item" id="ctx-verify-chd">✔️ Vérifier l'intégrité</div>`;
    menu.innerHTML += `<div class="context-menu-item" id="ctx-info-chd">ℹ️ Informations CHD</div>`;
  }

  // Toujours : retirer de la base + supprimer (corbeille)
  menu.innerHTML += `<div class="context-menu-item" id="ctx-remove-file">❌ Retirer le fichier de la base</div>`;
  menu.innerHTML += `<div class="context-menu-item danger" id="ctx-delete-file">🗑️ Supprimer le fichier</div>`;

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
    const confirmed = confirm(`Retirer "${file.fileName}" de la base de données ?\n\nLe fichier physique ne sera pas supprimé.`);
    if (!confirmed) return;
    try {
      await window.api.removeFile(file.filePath);
      log(`Fichier retiré de la base : ${file.fileName}`, { context: 'folder', state: 'deleted' });
      if (currentFolderPath) await updateFolderContent(currentFolderPath);
    } catch (error) {
      log(`Erreur lors du retrait : ${error}`, { severity: 'error', context: 'folder' });
    }
  });

  // Handler "Supprimer (corbeille)"
  menu.querySelector('#ctx-delete-file')?.addEventListener('click', async () => {
    menu.remove();
    const result = await window.api.showMessageBox({
      type: 'warning',
      title: 'Supprimer le fichier',
      message: `Êtes-vous sûr de vouloir supprimer "${file.fileName}" ?`,
      detail: 'Cette action déplacera le fichier vers la corbeille. Vous pourrez le restaurer depuis la corbeille si nécessaire.',
      buttons: ['Annuler', 'Déplacer vers la corbeille'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    if (result.response !== 1) return;
    try {
      await window.api.deleteFile(file.filePath);
      log(`Fichier supprimé : ${file.fileName}`, { context: 'folder', state: 'deleted' });
      if (currentFolderPath) await updateFolderContent(currentFolderPath);
    } catch (error) {
      log(`Erreur lors de la suppression : ${error}`, { severity: 'error', context: 'folder' });
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

  if (!dbPath || !dbSystem) return;

  if (currentDbPath) {
    dbPath.textContent = currentDbPath;
    dbPath.title = currentDbPath;

    // Récupérer le système depuis les metadata
    try {
      const systemName = await window.api.getDbMetadata('system_name');
      const systemId = await window.api.getDbMetadata('system_id');
      if (systemName && systemId) {
        dbSystem.textContent = `${systemName} (${systemId})`;
        dbSystem.title = `Système : ${systemName}\nID : ${systemId}`;
        (dbSystem as HTMLElement).style.color = '';
        (dbSystem as HTMLElement).style.fontStyle = '';
      } else {
        dbSystem.textContent = 'À définir';
        dbSystem.title = 'Aucun système associé — sélection manuelle requise';
        (dbSystem as HTMLElement).style.color = '#e67e22';
        (dbSystem as HTMLElement).style.fontStyle = 'italic';
        // Déclencher la modale de sélection manuelle (bloquante)
        await openSystemSelectionModal();
      }
    } catch {
      dbSystem.textContent = '';
    }
  } else {
    // Vider les champs quand il n'y a pas de base de données
    dbSystem.textContent = '';
    dbSystem.title = '';
    dbPath.textContent = '';
    dbPath.title = '';
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
        log(`Système défini manuellement : ${fullname} (${systemId})`, { context: 'dat', state: 'success' });
      } catch (error: any) {
        log(`Erreur sauvegarde système : ${error?.message || error}`, { severity: 'error', context: 'dat' });
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
    datSelect: document.getElementById('dat-select') as HTMLButtonElement,
    dbCreate: document.getElementById('db-create') as HTMLButtonElement,
    romAddFolder: document.getElementById('rom-add-folder') as HTMLButtonElement,
    romAddFolderSidebar: document.getElementById('rom-add-folder-sidebar') as HTMLButtonElement,
    datQuickLoad: document.getElementById('dat-quick-load') as HTMLButtonElement,
    matchRoms: document.getElementById('match-roms') as HTMLButtonElement,
    consolidateRoms: document.getElementById('consolidate-roms') as HTMLButtonElement
  };

  // Logique de mise à jour basée sur l'état de l'application

  // Bouton "Chargement rapide" : toujours disponible
  if (elements.datQuickLoad) {
    elements.datQuickLoad.disabled = false;
  }

  // Bouton "Sélectionner DAT/XML" : disponible si aucun DAT n'est sélectionné
  if (elements.datSelect) {
    elements.datSelect.disabled = currentDatPath !== null;
  }

  // Bouton "Créer base de données" : disponible si DAT sélectionné mais pas de DB
  if (elements.dbCreate) {
    elements.dbCreate.disabled = !(currentDatPath && !currentDbPath);
  }

  // Boutons "Ajouter dossier ROMs" : disponibles si currentDatPath existe ET currentDbPath existe ET DAT chargé dans la base
  const canAddRoms = currentDatPath !== null && currentDbPath !== null && currentDatInfo !== null;
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

  // Mettre à jour l'état des entrées du menu principal
  const canLoadDat = !currentDatInfo; // On peut charger un DAT si pas déjà chargé (workflow rapide toujours disponible)
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

  // Masquer le bandeau d'info DB
  updateDbInfoBanner();

  const elements = {
    datSelect: document.getElementById('dat-select') as HTMLButtonElement,
    dbCreate: document.getElementById('db-create') as HTMLButtonElement,
    romAddFolder: document.getElementById('rom-add-folder') as HTMLButtonElement,
    romAddFolderSidebar: document.getElementById('rom-add-folder-sidebar') as HTMLButtonElement,
    datQuickLoad: document.getElementById('dat-quick-load') as HTMLButtonElement,
    matchRoms: document.getElementById('match-roms') as HTMLButtonElement,
    consolidateRoms: document.getElementById('consolidate-roms') as HTMLButtonElement
  };

  if (elements.datSelect) elements.datSelect.disabled = false;
  if (elements.dbCreate) elements.dbCreate.disabled = true;
  if (elements.romAddFolder) elements.romAddFolder.disabled = true;
  if (elements.romAddFolderSidebar) elements.romAddFolderSidebar.disabled = true;
  if (elements.datQuickLoad) elements.datQuickLoad.disabled = false;
  if (elements.matchRoms) elements.matchRoms.disabled = true;
  if (elements.consolidateRoms) elements.consolidateRoms.disabled = true;

  updateLeftSidebar();

  const gameList = document.getElementById('game-list');
  if (gameList) {
    gameList.innerHTML = `
      <div style="padding: 40px; text-align: center; color: #7f8c8d;">
        <h3>Bienvenue dans RUMCET</h3>
        <p style="margin-top: 20px;">Pour commencer :</p>
        <ol style="text-align: left; display: inline-block; margin-top: 10px;">
          <li>Sélectionnez un fichier DAT/XML ou ouvrez une base existante</li>
          <li>Créez une base de données</li>
          <li>Chargez les données</li>
          <li>Ajoutez vos dossiers de ROMs</li>
          <li>Matchez les ROMs pour identifier les manquantes</li>
          <li>Consolidez les ROMs validées en archives</li>
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

      const datFileName = currentDatPath.split(/[\\\/]/).pop() || 'Fichier DAT';

      div.innerHTML = `
        <div class="dat-header" style="display: flex; justify-content: space-between; align-items: center; font-weight: 600; margin-bottom: 5px;">
          <span>${datFileName}</span>
          <button class="dat-toggle-btn collapsed" title="Afficher/Masquer les détails">
            <span class="chevron">▲</span>
          </button>
        </div>
        <div class="dat-details collapsed" style="font-size: 11px; color: #7f8c8d; line-height: 1.4;">
          ${currentDatInfo.name ? `<div><strong>Nom:</strong> ${currentDatInfo.name}</div>` : ''}
          ${currentDatInfo.description ? `<div><strong>Description:</strong> ${currentDatInfo.description}</div>` : ''}
          ${currentDatInfo.version ? `<div><strong>Version:</strong> ${currentDatInfo.version}</div>` : ''}
          ${currentDatInfo.date ? `<div><strong>Date:</strong> ${currentDatInfo.date}</div>` : ''}
          ${currentDatInfo.author ? `<div><strong>Auteur:</strong> ${currentDatInfo.author}</div>` : ''}
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
      const badge = isTarget ? '<span class="target-folder-badge">CIBLE</span>' : '';
      div.innerHTML = `
        <div class="folder-header" style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 11px; color: #7f8c8d; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${folder.path}">${parentPath}/</div>
            <div style="font-weight: 600; margin-bottom: 2px;">${name}${badge}</div>
            <div style="font-size: 11px; color: #7f8c8d;">${folder.fileCount} fichiers</div>
          </div>
          <button class="folder-remove-btn" title="Retirer le dossier de la base de données">×</button>
        </div>
      `;

      // Gestion du clic sur le bouton de suppression
      const removeBtn = div.querySelector('.folder-remove-btn') as HTMLButtonElement;
      removeBtn?.addEventListener('click', async (e) => {
        e.stopPropagation(); // Empêcher la sélection du sidebar-item

        // Ne pas permettre la suppression du dossier cible
        if (targetFolderPath !== null && folder.path === targetFolderPath) return;

        const confirmed = confirm(`Êtes-vous sûr de vouloir retirer "${folder.path}" de la base de données ?`);
        if (confirmed) {
          try {
            await window.api.removeFolder(folder.path);
            log(`Dossier retiré de la base : ${folder.path}`, { context: 'folder', state: 'deleted' });

            // Retirer de la liste
            loadedFolders = loadedFolders.filter(f => f.path !== folder.path);
            updateLeftSidebar();

            // Mettre à jour l'état des boutons workflow
            updateWorkflowButtons();
          } catch (error) {
            log(`Erreur lors du retrait du dossier : ${error instanceof Error ? error.message : String(error)}`, { severity: 'error', context: 'folder' });
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
  
  gameList.innerHTML = '<div style="padding: 20px; text-align: center;">Chargement...</div>';

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

      // Sauvegarder les jeux et recalculer les compteurs (sans effacer les filtres actifs)
      allGames = games;
      categoryCounts = extractCategoryCounts(games);
      matchStatusCounts = extractMatchStatusCounts(games);

      // Nettoyer les filtres qui ne correspondent plus aux données actuelles
      for (const f of activeFilters) {
        if (!categoryCounts.has(f)) activeFilters.delete(f);
      }
      for (const f of activeMatchFilters) {
        if (!matchStatusCounts.has(f)) activeMatchFilters.delete(f);
      }
      // Nettoyer les filtres d'évolution DAT (invalides si pas de change_status)
      const hasChangeData = games.some((g: GameInfo) => g.change_status);
      if (!hasChangeData) {
        activeChangeFilters.clear();
      } else {
        const validStatuses = new Set(games.map((g: GameInfo) => g.change_status).filter(Boolean) as string[]);
        for (const f of activeChangeFilters) {
          if (!validStatuses.has(f)) activeChangeFilters.delete(f);
        }
      }
      // Nettoyer les filtres de sélection
      for (const f of activeSelectionFilters) {
        if (f === 'selected' && !games.some((g: GameInfo) => g.is_selected !== 0 && !g.is_disappeared)) activeSelectionFilters.delete(f);
        if (f === 'unselected' && !games.some((g: GameInfo) => g.is_selected === 0 && !g.is_disappeared)) activeSelectionFilters.delete(f);
      }

      // Générer les filtres (en restaurant l'état actif)
      generateCategoryFilters();
      generateMatchStatusFilters();
      generateSelectionFilters();
      generateChangeStatusFilters();

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
    gameList.innerHTML = `<div style="padding: 20px; color: #e74c3c;">Erreur : ${error}</div>`;
  }
}

/*async function updateCenterContent(type: 'dat' | 'folder', path: string) {
  const gameList = document.getElementById('game-list');
  if (!gameList) return;
  
  gameList.innerHTML = '<div style="padding: 20px; text-align: center;">Chargement...</div>';
  
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
    gameList.innerHTML = `<div style="padding: 20px; color: #e74c3c;">Erreur : ${error}</div>`;
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
      gameList.innerHTML = '<div style="padding: 20px; text-align: center; color: #7f8c8d;">Dossier vide</div>';
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
            <div class="list-item-info">${folder.fileCount} fichier${folder.fileCount > 1 ? 's' : ''}</div>
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
      gameList.innerHTML = '<div style="padding: 20px; text-align: center; color: #7f8c8d;">Aucun fichier trouvé dans ce dossier et ses sous-dossiers</div>';
    }
  } catch (error) {
    gameList.innerHTML = `<div style="padding: 20px; color: #e74c3c;">Erreur : ${error}</div>`;
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
function displayGames(games: GameInfo[]) {
  const gameList = document.getElementById('game-list');
  if (!gameList) return;

  gameList.innerHTML = '';
  gameList.classList.remove('has-groups');

  if (games.length === 0) {
    gameList.innerHTML = '<div style="padding: 20px; text-align: center;">Aucun jeu trouvé</div>';
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
    const isChecked = !isDisappeared && game.is_selected !== 0;

    item.innerHTML = `
      <input type="checkbox" class="game-checkbox" data-game-id="${game.id}" ${isChecked ? 'checked' : ''} ${isDisappeared ? 'disabled' : ''}>
      <div style="flex: 1; min-width: 0;">
        <div class="list-item-name">${icon} ${game.name}${getChangeStatusBadgeHtml(game)}</div>
        ${game.description ? `<div class="list-item-info">${game.description}</div>` : ''}
        ${game.category ? `<div class="list-item-info"><strong>Categorie :</strong> ${game.category}</div>` : ''}
      </div>
      ${isDisappeared ? '' : getMatchStatusBadgeHtml(game)}
    `;

    if (isDisappeared) {
      item.classList.add('disappeared');
    } else if (!isChecked) {
      item.classList.add('deselected');
    }

    // Checkbox click handler (pas pour les jeux disparus)
    if (!isDisappeared) {
      const checkbox = item.querySelector('.game-checkbox') as HTMLInputElement;
      checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
        const selected = checkbox.checked;
        game.is_selected = selected ? 1 : 0;
        item.classList.toggle('deselected', !selected);
        window.api.updateGameSelection(game.id, selected);
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

  updateSelectAllCheckbox();
}

// Extraction des catégories et comptage
function extractCategoryCounts(games: GameInfo[]): Map<string, number> {
  const counts = new Map<string, number>();

  games.forEach(game => {
    const category = game.category || 'Non catégorisé';
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

// Labels et icônes pour les statuts de matching
const matchStatusLabels: Record<string, string> = {
  'unknown': 'Inconnu',
  'missing': 'Manquant',
  'partial': 'Partiel',
  'complete': 'Complet'
};

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
  const label = matchStatusLabels[status];
  return `<span class="match-status-badge status-${status}">${icon} ${label}</span>`;
}

function getChangeStatusBadgeHtml(game: GameInfo): string {
  if (!game.change_status || game.change_status === 'unchanged') return '';
  const labels: Record<string, string> = { 'new': 'NOUVEAU', 'modified': 'MODIFIÉ', 'disappeared': 'DISPARU' };
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
    displayName: `${matchStatusIcons[status]} ${matchStatusLabels[status]}`,
    count: matchStatusCounts.get(status) || 0
  }));

  createFilterDropdown('match-status-filters-container', 'Matching', items, activeMatchFilters, () => {
    applyFiltersAndGrouping();
    updateGroupFilterSummary();
  });
}

// Génération du dropdown de filtrage par statut de sélection
function generateSelectionFilters() {
  const selectedCount = allGames.filter(g => g.is_selected !== 0).length;
  const unselectedCount = allGames.length - selectedCount;

  const items = [
    { key: 'selected', displayName: '✅ Sélectionné', count: selectedCount },
    { key: 'unselected', displayName: '⬜ Non sélectionné', count: unselectedCount }
  ];

  createFilterDropdown('selection-filters-container', 'Sélection', items, activeSelectionFilters, () => {
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
    { key: 'new', displayName: '🆕 Nouveau', count: newCount },
    { key: 'modified', displayName: '✏️ Modifié', count: modifiedCount },
    { key: 'unchanged', displayName: '⏸️ Inchangé', count: unchangedCount },
    { key: 'disappeared', displayName: '❌ Disparu', count: disappearedCount }
  ];

  createFilterDropdown('change-status-filters-container', 'Évolution DAT', items, activeChangeFilters, () => {
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

  // Appliquer les filtres de catégorie
  if (activeFilters.size > 0) {
    filteredGames = filteredGames.filter(game => {
      const category = game.category || 'Non catégorisé';
      return activeFilters.has(category);
    });
  }

  // Appliquer les filtres de statut de matching
  if (activeMatchFilters.size > 0) {
    filteredGames = filteredGames.filter(game => {
      return activeMatchFilters.has(getGameMatchStatus(game));
    });
  }

  // Appliquer les filtres de sélection
  if (activeSelectionFilters.size > 0) {
    filteredGames = filteredGames.filter(game => {
      const isSelected = game.is_selected !== 0;
      if (activeSelectionFilters.has('selected') && isSelected) return true;
      if (activeSelectionFilters.has('unselected') && !isSelected) return true;
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

  gameList.innerHTML = '';
  gameList.classList.add('has-groups');

  if (games.length === 0) {
    gameList.innerHTML = '<div style="padding: 20px; text-align: center;">Aucun jeu trouvé</div>';
    gameList.classList.remove('has-groups');
    return;
  }

  // Grouper les jeux
  const groups = new Map<string, GameInfo[]>();

  games.forEach(game => {
    let groupKey: string;

    if (currentGroupBy === 'category') {
      groupKey = game.category || 'Non catégorisé';
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
    const selectionLabelsMap: Record<string, string> = { 'selected': '✅ Sélectionné', 'unselected': '⬜ Non sélectionné' };
    const changeStatusLabelsMap: Record<string, string> = { 'new': '🆕 Nouveau', 'modified': '✏️ Modifié', 'unchanged': '⏸️ Inchangé', 'disappeared': '❌ Disparu' };
    const groupName = currentGroupBy === 'match-status'
      ? `${matchStatusIcons[groupKey]} ${matchStatusLabels[groupKey]}`
      : currentGroupBy === 'selection'
      ? selectionLabelsMap[groupKey]
      : currentGroupBy === 'change-status'
      ? (changeStatusLabelsMap[groupKey] || groupKey)
      : groupKey;
    // Trier les jeux par nom dans chaque groupe
    groupGames.sort((a, b) => a.name.localeCompare(b.name));

    const groupDiv = document.createElement('div');
    groupDiv.className = 'game-group';

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

    // Clic sur le chevron → replier/déplier le groupe
    const chevron = headerDiv.querySelector('.group-chevron') as HTMLElement;
    chevron.addEventListener('click', (e) => {
      e.stopPropagation();
      groupDiv.classList.toggle('collapsed');
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

      // Mettre à jour les checkboxes des jeux du groupe (hors disabled)
      const groupContent = groupDiv.querySelector('.game-group-content');
      if (groupContent) {
        const checkboxes = groupContent.querySelectorAll('.game-checkbox:not(:disabled)') as NodeListOf<HTMLInputElement>;
        checkboxes.forEach(cb => {
          cb.checked = isSelected;
          const listItem = cb.closest('.list-item');
          if (listItem) listItem.classList.toggle('deselected', !isSelected);
        });
      }

      // Mettre à jour le compteur du groupe
      const countSpan = headerDiv.querySelector('.group-count');
      if (countSpan) {
        countSpan.textContent = `✔️ ${isSelected ? selectableGames.length : 0} / ${groupGames.length}`;
      }

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
      groupDiv.classList.toggle('collapsed');
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
      const isChecked = !isDisappeared && game.is_selected !== 0;

      item.innerHTML = `
        <input type="checkbox" class="game-checkbox" data-game-id="${game.id}" ${isChecked ? 'checked' : ''} ${isDisappeared ? 'disabled' : ''}>
        <div style="flex: 1; min-width: 0;">
          <div class="list-item-name">${icon} ${game.name}${getChangeStatusBadgeHtml(game)}</div>
          ${game.description ? `<div class="list-item-info">${game.description}</div>` : ''}
          ${game.category ? `<div class="list-item-info"><strong>Categorie :</strong> ${game.category}</div>` : ''}
        </div>
        ${isDisappeared ? '' : getMatchStatusBadgeHtml(game)}
      `;

      if (isDisappeared) {
        item.classList.add('disappeared');
      } else if (!isChecked) {
        item.classList.add('deselected');
      }

      if (!isDisappeared) {
        const checkbox = item.querySelector('.game-checkbox') as HTMLInputElement;
        checkbox.addEventListener('click', (e) => {
          e.stopPropagation();
          const selected = checkbox.checked;
          game.is_selected = selected ? 1 : 0;
          item.classList.toggle('deselected', !selected);
          window.api.updateGameSelection(game.id, selected);
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

  updateSelectAllCheckbox();
}

// Retourne les jeux actuellement affichés (après filtrage)
function getDisplayedGames(): GameInfo[] {
  let result = allGames;
  if (activeFilters.size > 0) {
    result = result.filter(game => {
      const category = game.category || 'Non catégorisé';
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
    gameList.innerHTML = '<div style="padding: 20px; text-align: center; color: #7f8c8d;">Aucun fichier trouvé</div>';
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
          matchBadge = `<span class="match-status-badge status-complete">✅ Matché</span>`;
        } else if (matchedContentCount > 0) {
          matchBadge = `<span class="match-status-badge status-partial">⚠️ Partiel</span>`;
        } else {
          matchBadge = `<span class="match-status-badge status-missing">❌ Non matché</span>`;
        }
        // Multi-jeux : au moins un fichier de l'archive sert à plusieurs jeux
        const hasMultiGame = Object.values(matchedContents).some((games: any[]) => games.length > 1);
        if (hasMultiGame) {
          multiBadge = `<span class="match-status-badge" style="background-color: rgba(52,152,219,0.1); color: #2980b9;">🔀 Multi-jeux</span>`;
        }
      } else if (matchInfo.looseMatches.length > 0) {
        matchBadge = `<span class="match-status-badge status-complete">✅ Matché</span>`;
        // Multi-jeux : le fichier loose sert à plusieurs jeux
        const distinctGames = new Set(matchInfo.looseMatches.map((m: any) => m.gameId));
        if (distinctGames.size > 1) {
          multiBadge = `<span class="match-status-badge" style="background-color: rgba(52,152,219,0.1); color: #2980b9;">🔀 Multi-jeux</span>`;
        }
      } else {
        matchBadge = `<span class="match-status-badge status-missing">❌ Non matché</span>`;
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
    <div style="padding: 10px;">Chargement des ROMs...</div>
    <div style="padding: 10px;">Chargement des ROMs...</div>
  `;
  
  try {
    const [roms, matches] = await Promise.all([
      window.api.listRomsByGame(game.id),
      window.api.getMatchesForGame(game.id).catch(() => [])
    ]);
    displayRomDetails(game, roms, matches);
  } catch (error) {
    detailView.innerHTML += `<div style="color: #e74c3c;">Erreur : ${error}</div>`;
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
        <strong>Catégorie :</strong> ${icon} ${game.category || 'Non catégorisé'}
      </div>
      <div style="margin-bottom: 10px;">
        <strong>Matching :</strong> ${statusBadge}
      </div>
      <div style="margin-top: 15px;">
        <strong>Fichier(s) de ROM :</strong> (${roms.length})
      </div>
    </div>`;

  if (roms.length === 0) {
    html += '<div style="padding: 10px;">Aucune ROM définie</div>';
  } else {
    const matchingDone = game.match_status !== undefined;

    roms.forEach(rom => {
      const romMatches = allMatchesMap.get(rom.id) || [];
      const isFound = romMatches.length > 0;

      let statusIcon: string, statusClass: string, statusLabel: string;
      if (!matchingDone) {
        statusIcon = '❓';
        statusClass = 'rom-unknown';
        statusLabel = 'Inconnu';
      } else if (isFound) {
        statusIcon = '✅';
        statusClass = 'rom-found';
        statusLabel = 'Trouvé';
      } else {
        statusIcon = '❌';
        statusClass = 'rom-missing';
        statusLabel = 'Manquant';
      }

      // Compter les fichiers loose et les archives distinctes
      let matchSummary = '';
      if (isFound && matchingDone) {
        const looseCount = romMatches.filter((m: any) => !m.archiveContentId).length;
        const archiveIds = new Set(romMatches.filter((m: any) => m.archiveContentId).map((m: any) => m.scannedFileId));
        const archiveCount = archiveIds.size;

        const parts: string[] = [];
        if (looseCount > 0) parts.push(`${looseCount} fichier${looseCount > 1 ? 's' : ''} loose`);
        if (archiveCount > 0) parts.push(`${archiveCount} archive${archiveCount > 1 ? 's' : ''}`);
        if (parts.length > 0) {
          matchSummary = `<div class="file-hash"><strong>Sources :</strong> ${parts.join(', ')}</div>`;
        }
      }

      html += `
        <div class="file-item ${statusClass}">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>${rom.name}</div>
            <span class="rom-status-badge ${statusClass}">${statusIcon} ${statusLabel}</span>
          </div>
          ${rom.size ? `<div style="font-size: 12px; color: #7f8c8d;"><strong>Taille :</strong> ${formatFileSize(rom.size)}</div>` : ''}
          ${rom.crc32 ? `<div class="file-hash"><strong>CRC32 :</strong> ${rom.crc32.toUpperCase()}</div>` : ''}
          ${rom.md5 ? `<div class="file-hash"><strong>MD5 :</strong> ${rom.md5.toUpperCase()}</div>` : ''}
          ${rom.sha1 ? `<div class="file-hash"><strong>SHA1 :</strong> ${rom.sha1.toUpperCase()}</div>` : ''}
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
      archiveBadge = `<span class="match-status-badge status-complete">✅ Matché</span>`;
    } else if (matchedContentCount > 0) {
      archiveBadge = `<span class="match-status-badge status-partial">⚠️ Partiel</span>`;
    } else {
      archiveBadge = `<span class="match-status-badge status-missing">❌ Non matché</span>`;
    }
  }

  let html = `<div class="detail-header">📦 ${file.fileName}</div>`;
  html += `
    <div style="padding: 10px; font-size: 12px;">
      <div style="margin-bottom: 10px;">
        <strong>Taille :</strong> ${formatFileSize(file.size)}
      </div>
      <div style="margin-bottom: 10px;">
        <strong>Chemin :</strong><br>
        <span>${file.filePath}</span>
      </div>
      <div style="margin-bottom: 10px;">
        <strong>Type :</strong> ${file.archiveType?.toUpperCase()}
      </div>
      ${archiveBadge ? `<div style="margin-bottom: 10px;"><strong>Matching :</strong> ${archiveBadge}</div>` : ''}
      <div style="margin-top: 15px;">
        <strong>Contenu de l'archive :</strong> (${totalContentCount} fichier${totalContentCount > 1 ? 's' : ''})
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
        const statusLabel = isMatched ? 'Matché' : 'Non matché';
        statusBadge = `<span class="rom-status-badge ${statusClass}">${statusIcon} ${statusLabel}</span>`;

        if (isMatched) {
          const gameNames = contentGames.map((g: any) => g.gameName);
          gameInfo = `<div class="file-hash"><strong>Jeu${gameNames.length > 1 ? 'x' : ''} :</strong> ${gameNames.join(', ')}</div>`;
          if (gameNames.length > 1) {
            multiGameBadge = `<span class="rom-status-badge" style="background-color: rgba(52,152,219,0.1); color: #2980b9;">🔀 Multi-jeux</span>`;
          }
        }
      }

      html += `
        <div class="file-item ${statusClass}">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>${content.fileName}</div>
            <div style="display: flex; gap: 4px;">${multiGameBadge}${statusBadge}</div>
          </div>
          ${content.size ? `<div style="font-size: 12px; color: #7f8c8d;"><strong>Taille :</strong> ${formatFileSize(content.size)}</div>` : ''}
          ${content.hashes?.crc32 ? `<div class="file-hash"><strong>CRC32 :</strong> ${content.hashes.crc32}</div>` : ''}
          ${content.hashes?.md5 ? `<div class="file-hash"><strong>MD5 :</strong> ${content.hashes.md5}</div>` : ''}
          ${content.hashes?.sha1 ? `<div class="file-hash"><strong>SHA1 :</strong> ${content.hashes.sha1}</div>` : ''}
          ${gameInfo}
        </div>
      `;
    });
  } else {
    html += '<div style="padding: 10px;">Archive vide ou non lisible</div>';
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
      ? `<span class="match-status-badge status-complete">✅ Matché</span>`
      : `<span class="match-status-badge status-missing">❌ Non matché</span>`;
  }

  let html = `<div class="detail-header">💾 ${file.fileName}</div>`;
  html += `
    <div style="padding: 10px; font-size: 12px;">
      <div style="margin-bottom: 10px;">
        <strong>Taille :</strong> ${formatFileSize(file.size)}
      </div>
      <div style="margin-bottom: 10px;">
        <strong>Chemin :</strong><br>
        <span>${file.filePath}</span>
      </div>
      <div style="margin-bottom: 10px;">
        <strong>Type :</strong> ${fileExtension.toUpperCase()}
      </div>
      ${matchBadge ? `<div style="margin-bottom: 10px;"><strong>Matching :</strong> ${matchBadge}</div>` : ''}
      <div style="margin-top: 15px;">
        <strong>Empreintes :</strong>
      </div>
    </div>`;

  if (file.hashes) {
    const statusClass = hasMatchData ? (isMatched ? 'rom-found' : 'rom-missing') : '';
    const statusBadge = hasMatchData
      ? `<span class="rom-status-badge ${statusClass}">${isMatched ? '✅ Matché' : '❌ Non matché'}</span>`
      : '';

    // Noms des jeux pour lesquels ce fichier sert
    let gameInfo = '';
    let multiGameBadge = '';
    if (hasMatchData && isMatched) {
      const gameNames = [...new Set(looseMatches.map(m => m.gameName))];
      gameInfo = `<div class="file-hash"><strong>Jeu${gameNames.length > 1 ? 'x' : ''} :</strong> ${gameNames.join(', ')}</div>`;
      if (gameNames.length > 1) {
        multiGameBadge = `<span class="rom-status-badge" style="background-color: rgba(52,152,219,0.1); color: #2980b9;">🔀 Multi-jeux</span>`;
      }
    }

    html += `
      <div class="file-item ${statusClass}">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>${file.fileName}</div>
          <div style="display: flex; gap: 4px;">${multiGameBadge}${statusBadge}</div>
        </div>
        <div style="font-size: 12px; color: #7f8c8d;"><strong>Taille :</strong> ${formatFileSize(file.size)}</div>
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
    log(`Conversion CHD : ${getBasename(filePath)}`, { context: 'chd', state: 'loading' });
    const results = await window.api.convertToChd([filePath]);
    
    if (results[0]?.success) {
      log(`Conversion réussie : ${results[0].message}`, { context: 'chd', state: 'success' });
      if (currentFolderPath) await updateFolderContent(currentFolderPath);
    } else {
      log(`Échec : ${results[0]?.message || 'Erreur inconnue'}`, { severity: 'error', context: 'chd' });
    }
  } catch (error) {
    log(`Erreur : ${error}`, { severity: 'error', context: 'chd' });
  }
}

async function extractChd(filePath: string) {
  try {
    log(`Extraction CHD : ${getBasename(filePath)}`, { context: 'archive', state: 'loading' });
    const result = await window.api.extractChd(filePath);
    
    if (result?.success) {
      log(result.message, { context: 'archive', state: 'success' });
      if (currentFolderPath) await updateFolderContent(currentFolderPath);
    }
  } catch (error) {
    log(`Erreur : ${error}`, { severity: 'error', context: 'archive' });
  }
}

async function verifyChdFile(filePath: string) {
  try {
    log(`Vérification CHD : ${getBasename(filePath)}`, { context: 'romfile', state: 'loading' });
    const result = await window.api.verifyChd(filePath);
    
    log(result.message, { 
      severity: result.valid ? 'info' : 'warning', 
      context: 'romfile',
      state: result.valid ? 'success' : 'missing'
    });
  } catch (error) {
    log(`Erreur : ${error}`, { severity: 'error', context: 'romfile' });
  }
}

async function showChdInfo(filePath: string) {
  try {
    const info = await window.api.getChdInfo(filePath);
    
    showModal('Informations CHD', `
      <div style="padding: 20px;">
        <p><strong>Fichier :</strong> ${getBasename(filePath)}</p>
        <p><strong>Version :</strong> ${info.version || 'N/A'}</p>
        <p><strong>Taille logique :</strong> ${info.logicalSize ? formatFileSize(info.logicalSize) : 'N/A'}</p>
        <p><strong>Compression :</strong> ${info.compression || 'N/A'}</p>
        <p><strong>SHA1 :</strong> ${info.sha1 || 'N/A'}</p>
        <p><strong>MD5 :</strong> ${info.md5 || 'N/A'}</p>
      </div>
    `);
  } catch (error) {
    log(`Erreur : ${error}`, { severity: 'error', context: 'romfile' });
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
    btn.textContent = '⏳ Matching en cours...';
    
    log('Lancement du matching des ROMs...', { context: 'match', state: 'loading' });
    
    const result = await window.api.runMatching();
    
    // Mettre à jour le rapport dans le volet gauche
    if (typeof displayMatchingReport === 'function') {
      await displayMatchingReport('matching-report');
    }
    
    // Afficher une popup de succès
    alert(`✅ Matching terminé !\n\n` +
          `Jeux complets : ${result.stats.completeGames}/${result.stats.totalGames} ✅\n` +
          `Jeux partiels : ${result.stats.partialGames}/${result.stats.totalGames} ⚠️\n` +
          `Jeux manquants : ${result.stats.missingGames}/${result.stats.totalGames} ❌\n\n` +
          `ROMs matchées : ${result.stats.matchedRoms}/${result.stats.totalDatRoms}`);
    
    matchingComplete = true;
    updateWorkflowButtons();
    log(`Matching terminé avec succès !`, { context: 'match', state: 'success' });

    // Rafraîchir le volet central si un contenu est affiché
    if (selectedElement) {
      await updateCenterContent(selectedElement.type, selectedElement.value);
    }
  } catch (error) {
    log(`Erreur lors du matching : ${error}`, { severity: 'error', context: 'match' });
    alert('❌ Erreur lors du matching. Consultez les logs pour plus de détails.');
  } finally {
    // Réactiver le bouton
    btn.disabled = false;
    btn.textContent = '🎯 4. Matcher les ROMs';
  }
}

async function runConsolidation() {
  const btn = document.getElementById('consolidate-roms') as HTMLButtonElement;
  if (!btn) return;

  // Récupérer les paramètres pour le récapitulatif
  const settings = await window.api.getSettings();

  // Construire le récapitulatif des options
  const compressionLabels: Record<string, string> = {
    'fastest': 'Rapide',
    'normal': 'Normal',
    'maximum': 'Maximum'
  };
  const cleanupScopeLabels: Record<string, string> = {
    'used-only': 'Fichiers utilisés uniquement',
    'all-matched': 'Tous les fichiers matchés'
  };

  const lines: string[] = [];

  // --- Archives ---
  lines.push('📦 ARCHIVES');
  if (settings.useBestCompression) {
    lines.push(`  • Mode : Tester tous les formats compatibles et conserver le plus léger`);
  } else {
    const formats = settings.archiveFormatPriority?.join(' > ') || '7z > zip';
    lines.push(`  • Priorité des formats : ${formats}`);
  }
  lines.push(`  • Compression : ${compressionLabels[settings.compressionLevel] || settings.compressionLevel}`);
  if (settings.recreateArchivesIfNeeded) {
    lines.push(`  • Recréer les archives si nécessaire : Oui`);
  } else {
    lines.push(`  • Copie directe des archives sources quand possible`);
  }
  if (settings.solidArchive) lines.push(`  • Archive solide : Oui`);
  if (settings.multithreading) lines.push(`  • Multithreading : Oui`);

  // --- Dossiers ---
  lines.push('');
  lines.push('📁 DOSSIERS');
  lines.push(`  • Dossier cible : ${settings.validatedRomsFolder || '(non configuré)'}`);
  if (settings.cleanSourceAfterConsolidation && settings.unmatchedRomsFolder) {
    lines.push(`  • Fichiers non matchés : ${settings.unmatchedRomsFolder}`);
  }

  // --- Nettoyage ---
  lines.push('');
  lines.push('🧹 NETTOYAGE');
  if (settings.cleanSourceAfterConsolidation) {
    lines.push(`  • Nettoyage activé`);
    lines.push(`  • Portée : ${cleanupScopeLabels[settings.cleanupScope] || settings.cleanupScope}`);
    if (settings.protectFilesForUnselectedGames) {
      lines.push(`  • Protection des fichiers utilisés par des jeux non sélectionnés`);
    } else {
      lines.push(`  • Pas de protection pour les jeux non sélectionnés`);
    }
  } else {
    lines.push(`  • Nettoyage désactivé (les sources restent intactes)`);
  }

  // Boîte de dialogue de confirmation
  const confirmResult = await window.api.showMessageBox({
    type: 'question',
    title: 'Consolider les ROMs',
    message: 'Voulez-vous lancer la consolidation avec ces paramètres ?',
    detail: lines.join('\n'),
    buttons: ['Consolider', 'Annuler'],
    defaultId: 0,
    cancelId: 1
  });

  if (confirmResult.response !== 0) return;

  try {
    btn.disabled = true;
    btn.textContent = '⏳ Consolidation...';

    log('Lancement de la consolidation des ROMs...', { context: 'match', state: 'loading' });

    const removeListener = window.api.onConsolidationProgress((progress) => {
      if (progress.phase === 'complete') {
        log(progress.message, { context: 'match', state: 'success' });
      } else {
        log(progress.message, { context: 'match', state: 'loading' });
      }
    });

    const result = await window.api.runConsolidation();

    alert(`🧹 Consolidation terminée !\n\n` +
          `Jeux consolidés : ${result.stats.gamesConsolidated}\n` +
          `Archives créées : ${result.stats.archivesCreated}\n` +
          `Fichiers non matchés déplacés : ${result.stats.unmatchedFilesMoved}\n` +
          `Erreurs : ${result.stats.gamesErrored}`);

    log('Consolidation terminée !', { context: 'match', state: 'success' });
    removeListener();

    // Rafraîchissement automatique du dossier cible + rematching
    if (result.stats.gamesConsolidated > 0) {
      await refreshTargetAndMatching();
    }
  } catch (error) {
    log(`Erreur lors de la consolidation : ${error}`, { severity: 'error', context: 'match' });
    alert('❌ Erreur lors de la consolidation. Consultez les logs.');
  } finally {
    btn.disabled = false;
    btn.textContent = '🧹 5. Consolider';
  }
}

async function showMissingRoms() {
  try {
    const missing = await window.api.getMissingRoms();
    
    if (missing.length === 0) {
      showModal('ROMs manquantes', '<div style="padding: 20px; text-align: center;">Aucune ROM manquante !</div>');
      return;
    }
    
    const content = missing.map(m => 
      `<div style="padding: 8px; border-bottom: 1px solid #eee;">
        <strong style="color: #2c3e50;">${m.gameName}</strong><br>
        <span style="color: #7f8c8d; font-size: 13px;">📀 ${m.datRomName}</span>
      </div>`
    ).join('');
    
    showModal(`ROMs manquantes (${missing.length})`, content);
  } catch (error) {
    log(`Erreur lors de la récupération des ROMs manquantes : ${error}`, { severity: 'error', context: 'match' });
  }
}

async function showExtraFiles() {
  try {
    const extras = await window.api.getExtraFiles();
    
    if (extras.length === 0) {
      showModal('Fichiers non matchés', '<div style="padding: 20px; text-align: center;">Aucun fichier non matché !</div>');
      return;
    }
    
    const content = extras.map(e => 
      `<div style="padding: 8px; border-bottom: 1px solid #eee;">
        <span style="color: #2c3e50;">📁 ${e.file_name}</span><br>
        <span style="color: #7f8c8d; font-size: 12px;">${formatFileSize(e.size)}</span>
      </div>`
    ).join('');
    
    showModal(`Fichiers non matchés (${extras.length})`, content);
  } catch (error) {
    log(`Erreur lors de la récupération des fichiers extras : ${error}`, { severity: 'error', context: 'match' });
  }
}

async function exportReport() {
  try {
    const result = await window.api.exportMatchingReport();
    if (result && result.success) {
      log(`Rapport exporté avec succès : ${result.filePath}`, { context: 'match', state: 'success' });
      showModal('Export réussi', `
        <div style="padding: 20px; text-align: center;">
          <p>Le rapport a été exporté avec succès !</p>
          <p style="margin-top: 10px; font-size: 13px; color: #7f8c8d;">
            ${result.filePath}
          </p>
        </div>
      `);
    }
  } catch (error) {
    log(`Erreur lors de l'export : ${error}`, { severity: 'error', context: 'match' });
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
    log('Ouverture d\'une base de données...', { context: 'database', state: 'question' });

    const result = await window.api.openDatabase();

    if (result && result.success) {
      resetInterface();

      currentDbPath = result.dbPath;
      currentDatPath = result.datPath;
      currentDatInfo = result.datInfo || null;

      // Mettre à jour le bandeau d'info DB
      updateDbInfoBanner();

      log(`Base de données ouverte : ${result.dbPath}`, { context: 'database', state: 'success' });
      log(`Jeux trouvés : ${result.gamesCount}`, { context: 'game', state: 'count' });
      log(`ROMs référencées : ${result.romsCount}`, { context: 'romfile', state: 'count' });

      if (result.folders && result.folders.length > 0) {
        loadedFolders = result.folders;
        log(`Dossiers de ROMs trouvés : ${result.folders.length}`, { context: 'folder', state: 'count' });
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
        log('✅ Rapport de matching chargé depuis la base de données', { context: 'match', state: 'success' });
      } else if (result.gamesCount > 0) {
        // Afficher le rapport initial (tous manquants)
        await displayInitialReport(result.gamesCount, result.romsCount);
        log('📊 Rapport initial affiché (matching non effectué)', { context: 'match', state: 'waiting' });
      }

      const datList = document.getElementById('dat-list');
      if (datList && datList.firstElementChild) {
        (datList.firstElementChild as HTMLElement).click();
      }
    } else {
      log('Ouverture annulée.', { context: 'database', state: 'cancel' });
    }
  } catch (error) {
    log(`Erreur : ${error instanceof Error ? error.message : String(error)}`, { severity: 'error', context: 'database' });
  }
}

async function closeDatabase() {
  try {
    const closed = await window.api.closeDatabase();
    if (closed) {
      log('Base de données fermée.', { context: 'database', state: 'complete' });
      resetInterface();

      // Mettre à jour l'état des boutons workflow et des menus après fermeture
      updateWorkflowButtons();
    }
  } catch (error) {
    log(`Erreur lors de la fermeture : ${error instanceof Error ? error.message : String(error)}`, { severity: 'error', context: 'database' });
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
    gameList.innerHTML = '<div style="padding: 20px; text-align: center;">Recherche en cours...</div>';
    
    const results = await window.api.searchGlobal(query, scope);
    
    // Afficher les résultats
    displaySearchResults(results, query);
  } catch (error) {
    gameList.innerHTML = `<div style="padding: 20px; color: #e74c3c;">Erreur lors de la recherche : ${error}</div>`;
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
        Aucun résultat trouvé pour "<strong>${escapeHtml(query)}</strong>"
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
        🎮 Jeux DAT (${results.games.length})
      </h4>
    `;
    
    results.games.forEach((game: any) => {
      const item = document.createElement('div');
      item.className = 'list-item search-match';
      item.innerHTML = `
        <div>
          <div class="list-item-name">${highlightText(game.name, query)}</div>
          ${game.description ? `<div class="list-item-info">${highlightText(game.description, query)}</div>` : ''}
          <div class="list-item-info">${game.rom_count} ROM${game.rom_count > 1 ? 's' : ''}</div>
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
        💾 Fichiers ROMs (${results.files.length})
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
        📦 Contenu d'archives (${results.archives.length})
      </h4>
    `;
    
    results.archives.forEach((archive: any) => {
      const item = document.createElement('div');
      item.className = 'list-item search-match';
      item.innerHTML = `
        <div>
          <div class="list-item-name">📄 ${highlightText(archive.file_name, query)}</div>
          <div class="list-item-info" style="font-size: 11px;">
            Dans : ${archive.archive_name}
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
    title: 'Supprimer le dossier',
    message: `Êtes-vous sûr de vouloir supprimer le dossier "${folderName}" ?`,
    detail: 'Cette action déplacera le dossier et tout son contenu vers la corbeille. Vous pourrez le restaurer depuis la corbeille si nécessaire.',
    buttons: ['Annuler', 'Déplacer vers la corbeille'],
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
        log(`Dossier "${folderName}" déplacé vers la corbeille`, { context: 'folder', state: 'deleted' });
      }
    } catch (error) {
      console.error('Erreur lors de la suppression:', error);
      await window.api.showMessageBox({
        type: 'error',
        title: 'Erreur',
        message: 'Impossible de supprimer le dossier',
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

// Récupération des éléments du DOM
const datSelectButton = document.getElementById('dat-select') as HTMLButtonElement;
const dbCreateButton = document.getElementById('db-create') as HTMLButtonElement;
const romAddFolderButton = document.getElementById('rom-add-folder') as HTMLButtonElement;
const romAddFolderButtonSidebar = document.getElementById('rom-add-folder-sidebar') as HTMLButtonElement;
const datQuickLoadButton = document.getElementById('dat-quick-load') as HTMLButtonElement;
const matchRomsButton = document.getElementById('match-roms') as HTMLButtonElement;
const consolidateRomsButton = document.getElementById('consolidate-roms') as HTMLButtonElement;

// Étape 1 : Sélection du fichier DAT/XML
datSelectButton?.addEventListener('click', async () => {
  try {
    datQuickLoadButton.disabled = true;
    datSelectButton.disabled = true;
    log('Ouverture de la boîte de dialogue...', { context: 'dat', state: 'question' });

    const filePath = await window.api.selectDatFile();

    if (filePath) {
      log(`Fichier DAT/XML sélectionné : ${filePath}`, { context: 'dat', state: 'select' });
      currentDatPath = filePath;
      updateWorkflowButtons();
    } else {
      log('Sélection annulée.', { context: 'dat', state: 'cancel' });
      datQuickLoadButton.disabled = false;
      datSelectButton.disabled = false;
    }
  } catch (error) {
    log(`Erreur : ${error instanceof Error ? error.message : String(error)}`, { severity: 'error', context: 'dat' });
  }
});

// Étape 2 : Création de la base de données + chargement des données DAT
dbCreateButton?.addEventListener('click', async () => {
  if (!currentDatPath) {
    log('Aucun fichier DAT sélectionné !', { severity: 'warning', context: 'database' });
    return;
  }

  try {
    datQuickLoadButton.disabled = true;
    dbCreateButton.disabled = true;
    log('Création de la base de données...', { context: 'database', state: 'question' });

    const result = await window.api.createDatabase(currentDatPath, true);
    if (result) {
      log(`Base de données créée : ${result.dbPath}`, { context: 'database', state: 'success' });
      log(`Jeux importés : ${result.gamesCount}`, { context: 'game', state: 'count' });
      log(`ROMs référencées : ${result.romsCount}`, { context: 'romfile', state: 'count' });

      currentDbPath = result.dbPath;
      currentDatInfo = result.datInfo || null;

      // Mettre à jour le bandeau d'info DB
      updateDbInfoBanner();
      updateLeftSidebar();
      updateWorkflowButtons();

      // Afficher le rapport initial
      if (result.gamesCount > 0) {
        await displayInitialReport(result.gamesCount, result.romsCount);
        log('📊 Rapport de matching initialisé', { context: 'match', state: 'waiting' });
      }

      // Auto-ajouter le dossier de ROMs validées s'il est configuré
      // (avec sous-dossier système si l'option multi-système est activée)
      const settings = await window.api.getSettings();
      if (settings.validatedRomsFolder) {
        const effectiveFolder = await window.api.getEffectiveValidatedFolder();
        targetFolderPath = effectiveFolder;
        await window.api.setDbMetadata('target_folder', effectiveFolder);
        try {
          log(`Vérification du dossier cible : ${effectiveFolder}`, { context: 'folder', state: 'loading' });

          const progressHandler = (data: any) => {
            if (data.fileName) {
              const icon = data.isArchive ? '📦' : '💾';
              log(`${icon} ${data.fileName}`, { context: 'romfile', state: 'loading' });
            }
          };
          window.api.onScanProgress(progressHandler);

          const stats = await window.api.addRomsFolder(effectiveFolder);

          if (stats.length > 0) {
            log(`Dossier cible ajouté : ${stats.length} fichiers trouvés`, { context: 'folder', state: 'success' });
          } else {
            log(`Dossier cible ajouté (vide)`, { context: 'folder', state: 'success' });
          }

          // Rafraîchir la liste des dossiers
          const rootFolders = await window.api.getRootFolders();
          loadedFolders = rootFolders;
          updateLeftSidebar();
          updateWorkflowButtons();
        } catch (folderError) {
          log(`Impossible d'ajouter le dossier cible : ${folderError instanceof Error ? folderError.message : String(folderError)}`, { severity: 'warning', context: 'folder' });
        }
      }

      log('Prêt pour ajouter des dossiers de ROMs !', { context: 'folder', state: 'waiting' });
    } else {
      log('Création annulée.', { context: 'database', state: 'cancel' });
      datQuickLoadButton.disabled = false;
      dbCreateButton.disabled = false;
    }
  } catch (error) {
    log(`Erreur : ${error instanceof Error ? error.message : String(error)}`, { severity: 'error', context: 'database' });
  }
});

// Fonction réutilisable pour ajouter des dossiers de ROMs
async function addRomsFolders() {
  if (!currentDbPath) {
    log('Veuillez d\'abord créer une base de données !', { severity: 'warning', context: 'folder' });
    return;
  }

  try {
    datQuickLoadButton.disabled = true;
    romAddFolderButton.disabled = true;
    romAddFolderButtonSidebar.disabled = true;
    log('Sélection du/des dossier(s)...', { context: 'folder', state: 'question' });

    const folderPaths = await window.api.selectRomFolders();
    if (folderPaths) {
      const folders = Array.isArray(folderPaths) ? folderPaths : [folderPaths];

      log(`Scan de ${folders.length} dossier(s)...`, { context: 'folder', state: 'loading' });

      const progressHandler = (data: any) => {
        if (data.fileName) {
          const icon = data.isArchive ? '📦' : '💾';
          log(`${icon} ${data.fileName}`, { context: 'romfile', state: 'loading' });
        }
      };

      window.api.onScanProgress(progressHandler);

      const stats = await window.api.addRomsFolder(folders);

      log(`Scan terminé : ${stats.length} fichiers trouvés au total.`, { context: 'folder', state: 'success' });

      // Rafraîchir la liste des dossiers
      const rootFolders = await window.api.getRootFolders();
      loadedFolders = rootFolders;

      updateLeftSidebar();

      // Mettre à jour l'état des boutons workflow
      updateWorkflowButtons();
    } else {
      log('Sélection annulée.', { context: 'folder', state: 'cancel' });
    }
  } catch (error) {
    log(`Erreur : ${error instanceof Error ? error.message : String(error)}`, { severity: 'error', context: 'folder' });
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

// Chargement rapide
datQuickLoadButton?.addEventListener('click', async () => {
  try {
    const allDisabled = true;
    datQuickLoadButton.disabled = allDisabled;
    datSelectButton.disabled = allDisabled;
    dbCreateButton.disabled = allDisabled;
    romAddFolderButton.disabled = allDisabled;
    romAddFolderButtonSidebar.disabled = allDisabled;

    log('Ouverture de la boîte de dialogue...', { context: 'dat', state: 'question' });

    const filePath = await window.api.selectDatFile();

    if (!filePath) {
      log('Sélection annulée.', { context: 'dat', state: 'cancel' });
      datQuickLoadButton.disabled = false;
      datSelectButton.disabled = false;
      return;
    }

    log(`Fichier DAT/XML sélectionné : ${filePath}`, { context: 'dat', state: 'select' });
    currentDatPath = filePath;

    log('Création de la base de données...', { context: 'database', state: 'loading' });

    const resultQuick = await window.api.quickLoadDatabase(currentDatPath);
    if (!resultQuick) {
      log('Création annulée.', { context: 'database', state: 'cancel' });
      datQuickLoadButton.disabled = false;
      datSelectButton.disabled = false;
      return;
    }

    log(`Base de données créée : ${resultQuick.dbPath}`, { context: 'database', state: 'success' });
    log(`Jeux importés : ${resultQuick.gamesCount}`, { context: 'game', state: 'count' });
    log(`ROMs référencées : ${resultQuick.romsCount}`, { context: 'romfile', state: 'count' });

    currentDbPath = resultQuick.dbPath;
    currentDatInfo = resultQuick.datInfo || null;

    // Mettre à jour le bandeau d'info DB
    updateDbInfoBanner();

    updateLeftSidebar();

    // Mettre à jour l'état des boutons workflow
    updateWorkflowButtons();

    // Afficher le rapport initial avec tous les jeux/fichiers en "manquants"
    if (resultQuick.gamesCount > 0) {
      await displayInitialReport(resultQuick.gamesCount, resultQuick.romsCount);
      log('📊 Rapport de matching initialisé', { context: 'match', state: 'waiting' });
    }

    // Auto-ajouter le dossier de ROMs validées s'il est configuré
    // (avec sous-dossier système si l'option multi-système est activée)
    const settings = await window.api.getSettings();
    if (settings.validatedRomsFolder) {
      const effectiveFolder = await window.api.getEffectiveValidatedFolder();
      targetFolderPath = effectiveFolder;
      await window.api.setDbMetadata('target_folder', effectiveFolder);
      try {
        log(`Vérification du dossier cible : ${effectiveFolder}`, { context: 'folder', state: 'loading' });

        const progressHandler = (data: any) => {
          if (data.fileName) {
            const icon = data.isArchive ? '📦' : '💾';
            log(`${icon} ${data.fileName}`, { context: 'romfile', state: 'loading' });
          }
        };
        window.api.onScanProgress(progressHandler);

        const stats = await window.api.addRomsFolder(effectiveFolder);

        if (stats.length > 0) {
          log(`Dossier cible ajouté : ${stats.length} fichiers trouvés`, { context: 'folder', state: 'success' });
        } else {
          log(`Dossier cible ajouté (vide)`, { context: 'folder', state: 'success' });
        }

        // Rafraîchir la liste des dossiers
        const rootFolders = await window.api.getRootFolders();
        loadedFolders = rootFolders;
        updateLeftSidebar();
        updateWorkflowButtons();
      } catch (folderError) {
        log(`Impossible d'ajouter le dossier cible : ${folderError instanceof Error ? folderError.message : String(folderError)}`, { severity: 'warning', context: 'folder' });
      }
    }

    log('Prêt pour ajouter des dossiers de ROMs !', { context: 'folder', state: 'waiting' });

  } catch (error) {
    log(`Erreur : ${error instanceof Error ? error.message : String(error)}`, { severity: 'error', context: 'folder' });
    datQuickLoadButton.disabled = false;
    datSelectButton.disabled = false;
  }
});

// Écouter les actions du menu
window.api.onMenuAction(async (action: string) => {
  switch (action) {
    case 'new-database':
      datSelectButton?.click();
      break;
    case 'open-database':
      openExistingDatabase();
      break;
    case 'close-database':
      closeDatabase();
      break;
    case 'load-dat':
      datQuickLoadButton?.click();
      break;
    case 'add-folder':
      romAddFolderButton?.click();
      break;
    case 'delete-folder':
      // Récupérer le dossier actuellement sélectionné
      if (selectedElement && selectedElement.type === 'folder') {
        await handleDeleteFolder(selectedElement.value);
      } else {
        log('Aucun dossier sélectionné', { severity: 'warning', context: 'folder' });
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

// Écouter les messages de log
window.api.onLogMessage((data: { severity: string, context: string, message: string }) => {
  log(data.message, { 
    severity: data.severity as LogSeverity, 
    context: data.context as LogContext 
  });
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

      // Mettre à jour les checkboxes dans le DOM (hors disabled)
      const checkboxes = document.querySelectorAll('.game-checkbox:not(:disabled)') as NodeListOf<HTMLInputElement>;
      checkboxes.forEach(cb => {
        cb.checked = isSelected;
        const listItem = cb.closest('.list-item');
        if (listItem) listItem.classList.toggle('deselected', !isSelected);
      });

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

  const selectionLabels: Record<string, string> = { 'selected': '✅ Sélectionné', 'unselected': '⬜ Non sélectionné' };
  const changeStatusLabels: Record<string, string> = { 'new': '🆕 Nouveau', 'modified': '✏️ Modifié', 'unchanged': '⏸️ Inchangé', 'disappeared': '❌ Disparu' };

  // Définir les groupes de filtres avec leur label, set actif et fonction de label
  const filterGroups: Array<{ label: string; activeSet: Set<string>; getDisplayName: (key: string) => string; containerId: string }> = [
    { label: 'Catégorie', activeSet: activeFilters, getDisplayName: (k) => k, containerId: 'category-filters-container' },
    { label: 'Matching', activeSet: activeMatchFilters, getDisplayName: (k) => `${matchStatusIcons[k]} ${matchStatusLabels[k]}`, containerId: 'match-status-filters-container' },
    { label: 'Sélection', activeSet: activeSelectionFilters, getDisplayName: (k) => selectionLabels[k] || k, containerId: 'selection-filters-container' },
    { label: 'Évolution DAT', activeSet: activeChangeFilters, getDisplayName: (k) => changeStatusLabels[k] || k, containerId: 'change-status-filters-container' }
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
    clearAll.textContent = '✕ Tout effacer';
    clearAll.addEventListener('click', () => {
      filterGroups.forEach(group => clearFilterGroup(group));
    });
    bar.appendChild(clearAll);
  }
}

// Initialisation
document.addEventListener('DOMContentLoaded', () => {
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

  log('RUMCET est prêt ! Utilisez le menu Fichier ou les boutons pour commencer.', { context: 'welcome' });
}, { once: true });
