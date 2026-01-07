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

// Types pour l'application
interface GameInfo {
  id: number;
  name: string;
  description?: string;
  category?: string;
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
type LogContext = 'application' | 'archive' | 'audio' | 'chd' | 'dat' | 'database' | 'demo' | 'educational' | 'extra' | 'folder' | 'game' | 'match' | 'multimedia' | 'network' | 'otherfile' | 'preproduction' | 'romfile' | 'search' | 'settings' | 'video' | 'welcome';
type LogState = 'cancel' | 'cleanable' | 'complete' | 'count' | 'deleted' | 'found' | 'loading' | 'missing' | 'question' | 'select' | 'success' | 'sync' | 'waiting';

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
    waiting: '⏸️'
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

  contextMenu.innerHTML = `
    <div id="ctx-refresh-folder" class="context-menu-item">🔄 Re-scanner le dossier</div>
    <div id="ctx-delete-folder-database" class="context-menu-item">❌ Retirer le dossier de la base</div>
    <div id="ctx-delete-folder-physical" class="context-menu-item danger">🗑️ Supprimer le dossier</div>
  `;

  // Cacher le menu au clic ailleurs
  document.addEventListener('click', () => {
    contextMenu.style.display = 'none';
  });

  // Handler pour supprimer physiquement (corbeille)
  document.getElementById('ctx-delete-folder-physical')?.addEventListener('click', async () => {
    const target = (contextMenu as any).targetElement;
    if (target && target.dataset.path) {
      await handleDeleteFolder(target.dataset.path);
    }
  });

  // Handler pour supprimer un dossier
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
}

// Rescan d'un dossier
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
    
    // Rafraîchir l'affichage si c'est le dossier actuel
    if (currentFolderPath === folderPath) {
      await updateCenterContent('folder', folderPath);
    }
  } catch (error) {
    log(`Erreur lors du re-scan : ${error}`, { severity: 'error', context: 'folder' });
  }
}

// Fonction pour afficher le menu contextuel
function showContextMenu(event: MouseEvent, element: HTMLElement) {
  event.preventDefault();
  event.stopPropagation();
  
  const contextMenu = document.getElementById('context-menu');
  if (!contextMenu) return;
  
  (contextMenu as any).targetElement = element;
  
  contextMenu.style.display = 'block';
  contextMenu.style.left = event.pageX + 'px';
  contextMenu.style.top = event.pageY + 'px';
}

// Ajouter un bouton pour la conversion CHD dans le menu contextuel des fichiers
async function showFileContextMenu(event: MouseEvent, file: any) {
  event.preventDefault();
  
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.position = 'absolute';
  menu.style.left = event.pageX + 'px';
  menu.style.top = event.pageY + 'px';
  
  // Si c'est un fichier CD/ISO, proposer la conversion
  const ext = file.fileName.split('.').pop()?.toLowerCase();
  if (['cue', 'gdi', 'toc', 'nrg', 'iso', 'bin'].includes(ext)) {
    menu.innerHTML += `
      <div class="context-menu-item" onclick="convertToChd('${file.filePath}')">
        💿 Convertir en CHD
      </div>
    `;
  }
  
  // Si c'est un CHD, proposer l'extraction
  if (ext === 'chd') {
    menu.innerHTML += `
      <div class="context-menu-item" onclick="extractChd('${file.filePath}')">
        📦 Extraire le CHD
      </div>
      <div class="context-menu-item" onclick="verifyChdFile('${file.filePath}')">
        ✔️ Vérifier l'intégrité
      </div>
      <div class="context-menu-item" onclick="showChdInfo('${file.filePath}')">
        ℹ️ Informations CHD
      </div>
    `;
  }
  
  document.body.appendChild(menu);
  
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
  const rootName = currentRootFolder.split(/[\\\/]/).pop() || currentRootFolder;
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
function updateDbInfoBanner() {
  const dbName = document.getElementById('db-info-name');
  const dbPath = document.getElementById('db-info-path');

  if (!dbName || !dbPath) return;

  if (currentDbPath) {
    const name = currentDbPath.split(/[\\\/]/).pop() || 'Base de données';
    dbName.textContent = name;
    dbPath.textContent = currentDbPath;
    dbPath.title = currentDbPath; // Tooltip pour voir le chemin complet
  } else {
    // Vider les champs quand il n'y a pas de base de données
    dbName.textContent = '';
    dbPath.textContent = '';
    dbPath.title = '';
  }
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

  // Masquer le bandeau d'info DB
  updateDbInfoBanner();
  
  const elements = {
    datSelect: document.getElementById('dat-select') as HTMLButtonElement,
    dbCreate: document.getElementById('db-create') as HTMLButtonElement,
    datLoad: document.getElementById('dat-load') as HTMLButtonElement,
    romAddFolder: document.getElementById('rom-add-folder') as HTMLButtonElement,
    romAddFolderSidebar: document.getElementById('rom-add-folder-sidebar') as HTMLButtonElement,
    datQuickLoad: document.getElementById('dat-quick-load') as HTMLButtonElement,
    matchRoms: document.getElementById('match-roms') as HTMLButtonElement
  };

  if (elements.datSelect) elements.datSelect.disabled = false;
  if (elements.dbCreate) elements.dbCreate.disabled = true;
  if (elements.datLoad) elements.datLoad.disabled = true;
  if (elements.romAddFolder) elements.romAddFolder.disabled = true;
  if (elements.romAddFolderSidebar) elements.romAddFolderSidebar.disabled = true;
  if (elements.datQuickLoad) elements.datQuickLoad.disabled = false;
  if (elements.matchRoms) elements.matchRoms.disabled = true;
  
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
        <div style="font-weight: 600; margin-bottom: 5px;">📖 ${datFileName}</div>
        <div style="font-size: 11px; color: #7f8c8d; line-height: 1.4;">
          ${currentDatInfo.name ? `<div><strong>Nom:</strong> ${currentDatInfo.name}</div>` : ''}
          ${currentDatInfo.description ? `<div><strong>Description:</strong> ${currentDatInfo.description}</div>` : ''}
          ${currentDatInfo.version ? `<div><strong>Version:</strong> ${currentDatInfo.version}</div>` : ''}
          ${currentDatInfo.date ? `<div><strong>Date:</strong> ${currentDatInfo.date}</div>` : ''}
          ${currentDatInfo.author ? `<div><strong>Auteur:</strong> ${currentDatInfo.author}</div>` : ''}
          ${currentDatInfo.homepage ? `<div><strong>Homepage:</strong> ${currentDatInfo.homepage}</div>` : ''}
          ${currentDatInfo.url ? `<div><strong>URL:</strong> ${currentDatInfo.url}</div>` : ''}
        </div>
      `;
      div.addEventListener('click', () => {
        selectSidebarItem(div, 'dat', currentDbPath!);
      });
      datList.appendChild(div);
    }
  }
  
  if (folderList) {
    folderList.innerHTML = '';
    loadedFolders.forEach(folder => {
      const div = document.createElement('div');
      div.className = 'sidebar-item';
      div.dataset.type = 'folder';
      div.dataset.path = folder.path;
      
      const name = folder.path.split(/[\\\/]/).pop() || folder.path;
      div.innerHTML = `
        <div>${name}</div>
        <div style="font-size: 11px; color: #7f8c8d;">${folder.fileCount} fichiers</div>
      `;
      
      // Clic gauche pour sélectionner
      div.addEventListener('click', () => selectSidebarItem(div, 'folder', folder.path));
      
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
      displayGames(games);
      
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
          e.preventDefault();
          showContextMenu(e, item);
          (item as any).dataset = { path: folder.path };
        });
        
        gameList.appendChild(item);
      });
    }
    
    // Afficher les fichiers
    if (content.files.length > 0) {
      displayFiles(content.files);
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

    item.innerHTML = `
      <div>
        <div class="list-item-name">${icon} ${game.name}</div>
        ${game.description ? `<div class="list-item-info">${game.description}</div>` : ''}
        ${game.category ? `<div class="list-item-info"><strong>Categorie :</strong> ${game.category}</div>` : ''}
      </div>
    `;

    item.addEventListener('click', () => selectGame(item, game));
    gameList.appendChild(item);
  });
}

// Affichage des fichiers
function displayFiles(files: any[]) {
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
    
    item.innerHTML = `
      <div>
        <div class="list-item-name">${displayNameHTML}</div>
        <div class="list-item-info">${size}</div>
      </div>
    `;
    
    item.addEventListener('click', () => selectFile(item, file));
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
    const roms = await window.api.listRomsByGame(game.id);
    displayRomDetails(game, roms);
  } catch (error) {
    detailView.innerHTML += `<div style="color: #e74c3c;">Erreur : ${error}</div>`;
  }
}

// Sélection d'un fichier
function selectFile(element: HTMLElement, file: any) {
  document.querySelectorAll('.list-item').forEach(item => {
    item.classList.remove('selected');
  });
  element.classList.add('selected');
  
  const detailView = document.getElementById('detail-view');
  if (!detailView) return;
  
  if (file.isArchive && file.contents) {
    displayArchiveContents(file);
  } else {
    displayFileDetails(file);
  }
}

// Affichage des détails d'une ROM
function displayRomDetails(game: GameInfo, roms: RomInfo[]) {
  const detailView = document.getElementById('detail-view');
  if (!detailView) return;
  
  let icon = getIconGameCategory(game.category);
  
  let html = `<div class="detail-header">${icon} ${game.name}</div>`;
  html += `
    <div style="padding: 10px; font-size: 12px;">
      <div style="margin-bottom: 10px;">
        <strong>Categorie :</strong> ${icon} ${game.category}
      </div>
      <div style="margin-top: 15px;">
        <strong>Fichier(s) de rom :</strong>
      </div>
    </div>`;

  if (roms.length === 0) {
    html += '<div style="padding: 10px;">Aucune ROM définie</div>';
  } else {
    roms.forEach(rom => {
      html += `
        <div class="file-item">
          <div>${rom.name}</div>
          ${rom.size ? `<div style="font-size: 12px; color: #7f8c8d;"><strong>Taille :</strong> ${formatFileSize(rom.size)}</div>` : ''}
          ${rom.crc32 ? `<div class="file-hash"><strong>CRC32 :</strong> ${rom.crc32.toUpperCase()}</div>` : ''}
          ${rom.md5 ? `<div class="file-hash"><strong>MD5 :</strong> ${rom.md5.toUpperCase()}</div>` : ''}
          ${rom.sha1 ? `<div class="file-hash"><strong>SHA1 :</strong> ${rom.sha1.toUpperCase()}</div>` : ''}
        </div>
      `;
    });
  }
  
  detailView.innerHTML = html;
}

// Affichage du contenu d'une archive
function displayArchiveContents(file: any) {
  const detailView = document.getElementById('detail-view');
  if (!detailView) return;
  
  let html = `<div class="detail-header">📦 ${file.fileName}</div>`;
  html += `
    <div style="padding: 10px; font-size: 12px;">
      <div style="margin-bottom: 10px;">
        <strong>Taille :</strong> ${formatFileSize(file.size)}
      </div>
      <div style="margin-bottom: 10px;">
        <strong>Chemin :</strong><br>
        <span">${file.filePath}</span>
      </div>
      <div style="margin-bottom: 10px;">
        <strong>Type :</strong> ${file.archiveType?.toUpperCase()}
      </div>
      <div style="margin-top: 15px;">
        <strong>Contenu de l'archive :</strong>
      </div>
    </div>`;
  
  if (file.contents && file.contents.length > 0) {
    file.contents.forEach((content: any) => {
      html += `
        <div class="file-item">
          <div>${content.fileName}</div>
          ${content.size ? `<div style="font-size: 12px; color: #7f8c8d;"><strong>Taille :</strong> ${formatFileSize(content.size)}</div>` : ''}
          ${content.hashes?.crc32 ? `<div class="file-hash"><strong>CRC32 :</strong> ${content.hashes.crc32}</div>` : ''}
          ${content.hashes?.md5 ? `<div class="file-hash"><strong>MD5 :</strong> ${content.hashes.md5}</div>` : ''}
          ${content.hashes?.sha1 ? `<div class="file-hash"><strong>SHA1 :</strong> ${content.hashes.sha1}</div>` : ''}
        </div>
      `;
    });
  } else {
    html += '<div style="padding: 10px;">Archive vide ou non lisible</div>';
  }
  
  detailView.innerHTML = html;
}

// Affichage des détails d'un fichier
function displayFileDetails(file: any) {
  const parts = file.fileName.split('.');
  const fileExtension = parts.length > 1 ? parts[parts.length - 1] : '';

  const detailView = document.getElementById('detail-view');
  if (!detailView) return;
  
  let html = `<div class="detail-header">💾 ${file.fileName}</div>`;
  html += `
    <div style="padding: 10px; font-size: 12px;">
      <div style="margin-bottom: 10px;">
        <strong>Taille :</strong> ${formatFileSize(file.size)}
      </div>
      <div style="margin-bottom: 10px;">
        <strong>Chemin :</strong><br>
        <!--span style="font-size: 12px;">${file.filePath}</span-->
        <span">${file.filePath}</span>
      </div>
      <div style="margin-bottom: 10px;">
        <strong>Type :</strong> ${fileExtension.toUpperCase()}
      </div>
      <div style="margin-top: 15px;">
        <strong>Empreintes :</strong>
      </div>
    </div>
      ${file.hashes ? `
        <div class="file-item">
          <div>${file.fileName}</div>
          <div style="font-size: 12px; color: #7f8c8d;"><strong>Taille :</strong> ${formatFileSize(file.size)}</div>
          <div class="file-hash"><strong>CRC32 :</strong> ${file.hashes.crc32}</div>
          <div class="file-hash"><strong>MD5 :</strong> ${file.hashes.md5}</div>
          <div class="file-hash"><strong>SHA1 :</strong> ${file.hashes.sha1}</div>
        </div>
      ` : ''}
  `;
  
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
    
    log(`Matching terminé avec succès !`, { context: 'match', state: 'success' });
  } catch (error) {
    log(`Erreur lors du matching : ${error}`, { severity: 'error', context: 'match' });
    alert('❌ Erreur lors du matching. Consultez les logs pour plus de détails.');
  } finally {
    // Réactiver le bouton
    btn.disabled = false;
    btn.textContent = '🎯 5. Matcher les ROMs';
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
      
      const romAddFolderButton = document.getElementById('rom-add-folder') as HTMLButtonElement;
      const romAddFolderButtonSidebar = document.getElementById('rom-add-folder-sidebar') as HTMLButtonElement;
      const matchRomsButton = document.getElementById('match-roms') as HTMLButtonElement;

      if (romAddFolderButton) romAddFolderButton.disabled = false;
      if (romAddFolderButtonSidebar) romAddFolderButtonSidebar.disabled = false;
      if (matchRomsButton) matchRomsButton.disabled = false;
      
      updateLeftSidebar();
      
      // Vérifier si un matching a déjà été effectué et afficher le rapport approprié
      if (result.hasMatching) {
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
const datLoadButton = document.getElementById('dat-load') as HTMLButtonElement;
const romAddFolderButton = document.getElementById('rom-add-folder') as HTMLButtonElement;
const romAddFolderButtonSidebar = document.getElementById('rom-add-folder-sidebar') as HTMLButtonElement;
const datQuickLoadButton = document.getElementById('dat-quick-load') as HTMLButtonElement;
const matchRomsButton = document.getElementById('match-roms') as HTMLButtonElement;

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
      dbCreateButton.disabled = false;
    } else {
      log('Sélection annulée.', { context: 'dat', state: 'cancel' });
      datQuickLoadButton.disabled = false;
      datSelectButton.disabled = false;
    }
  } catch (error) {
    log(`Erreur : ${error instanceof Error ? error.message : String(error)}`, { severity: 'error', context: 'dat' });
  }
});

// Étape 2 : Création de la base de données
dbCreateButton?.addEventListener('click', async () => {
  if (!currentDatPath) {
    log('Aucun fichier DAT sélectionné !', { severity: 'warning', context: 'database' });
    return;
  }

  try {
    datQuickLoadButton.disabled = true;
    dbCreateButton.disabled = true;
    log('Création de la base de données...', { context: 'database', state: 'question' });

    const resultCreateDb = await window.api.createDatabase(currentDatPath, true);
    if (resultCreateDb) {
      log(`Base de données créée : ${resultCreateDb.dbPath}`, { context: 'database', state: 'success' });
      currentDbPath = resultCreateDb.dbPath;

      // Mettre à jour le bandeau d'info DB
      updateDbInfoBanner();

      datLoadButton.disabled = false;
    } else {
      log('Création annulée.', { context: 'database', state: 'cancel' });
      datQuickLoadButton.disabled = false;
      dbCreateButton.disabled = false;
    }
  } catch (error) {
    log(`Erreur : ${error instanceof Error ? error.message : String(error)}`, { severity: 'error', context: 'database' });
  }
});

// Étape 3 : Chargement des données
datLoadButton?.addEventListener('click', async () => {
  if (!currentDatPath || !currentDbPath) {
    log('Aucun fichier DAT/XML ou base de données sélectionnés !', { severity: 'warning', context: 'dat' });
    return;
  }

  try {
    datQuickLoadButton.disabled = true;
    datLoadButton.disabled = true;
    log('Chargement des données...', { context: 'dat', state: 'loading' });

    const resultLoadDatFile = await window.api.loadDatFile(currentDatPath);

    log('Données chargées avec succès !', { context: 'dat', state: 'success' });
    log(`Jeux importés : ${resultLoadDatFile.gamesCount}`, { context: 'game', state: 'count' });
    log(`ROMs référencées : ${resultLoadDatFile.romsCount}`, { context: 'romfile', state: 'count' });

    currentDatInfo = resultLoadDatFile.datInfo || null;
    //console.log('DEBUG - resultLoadDatFile:', resultLoadDatFile);
    romAddFolderButton.disabled = false;
    romAddFolderButtonSidebar.disabled = false;
    //matchRomsButton.disabled = false;
    updateLeftSidebar();
    //console.log('DEBUG - Avant displayInitialReport, gamesCount:', resultLoadDatFile.gamesCount);
    
    // Afficher le rapport initial avec tous les jeux/fichiers en "manquants"
    if (resultLoadDatFile.gamesCount > 0) {
      //console.log('DEBUG - Appel de displayInitialReport');
      await displayInitialReport(resultLoadDatFile.gamesCount, resultLoadDatFile.romsCount);
      log('📊 Rapport de matching initialisé', { context: 'match', state: 'waiting' });
      //console.log('DEBUG - Après displayInitialReport');
    } else {
      //console.log('DEBUG - gamesCount <= 0, pas d\'appel à displayInitialReport');
    }
  } catch (error) {
    log(`Erreur : ${error instanceof Error ? error.message : String(error)}`, { severity: 'error', context: 'dat' });
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
      matchRomsButton.disabled = false;
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

// Chargement rapide
datQuickLoadButton?.addEventListener('click', async () => {
  try {
    const allDisabled = true;
    datQuickLoadButton.disabled = allDisabled;
    datSelectButton.disabled = allDisabled;
    dbCreateButton.disabled = allDisabled;
    datLoadButton.disabled = allDisabled;
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

    romAddFolderButton.disabled = false;
    romAddFolderButtonSidebar.disabled = false;
    matchRomsButton.disabled = false;
    updateLeftSidebar();
    
    // Afficher le rapport initial avec tous les jeux/fichiers en "manquants"
    if (resultQuick.gamesCount > 0) {
      await displayInitialReport(resultQuick.gamesCount, resultQuick.romsCount);
      log('📊 Rapport de matching initialisé', { context: 'match', state: 'waiting' });
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

// Initialisation
document.addEventListener('DOMContentLoaded', () => {
  initSplitters();
  setupContextMenu();
  setupViewControls();
  setupSearch();
  initMatchingUI();
  setupCollapsibleSections();
  log('RUMCET est prêt ! Utilisez le menu Fichier ou les boutons pour commencer.', { context: 'welcome' });
}, { once: true });
