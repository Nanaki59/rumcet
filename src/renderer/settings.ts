// src/renderer/settings.ts

import { SYSTEMS } from '../config/systems.js';

// Utiliser les types depuis global.d.ts
type ArchiveFormat = '7z' | 'zip' | 'chd';
type CleanupScope = 'used-only' | 'all-matched';
type RarTool = '7zip' | 'winrar' | 'unrar';

// Types élargis (alignés avec settingsManager.ts) pour suivre Recalbox
type SystemCategory = string;
type SystemSubcategory = string;

interface SystemCompatibility {
  systemId: string;
  systemName: string;
  category: SystemCategory;
  subcategory?: SystemSubcategory;
  supportedFormats: ArchiveFormat[];
  warningFormats?: ArchiveFormat[];
  unsupportedFormats?: ArchiveFormat[];
}

interface AppSettings {
  defaultDatFolder: string;
  defaultDatabaseFolder: string;
  defaultRomsFolder: string;
  unmatchedRomsFolder: string;
  validatedRomsFolder: string;
  validatedRomsMultiSystem?: boolean;
  tempExtractionFolder: string;
  cleanSourceAfterConsolidation: boolean;
  cleanupScope: CleanupScope;
  protectFilesForUnselectedGames: boolean;
  autoSelectNewGames: boolean;
  theme: 'light' | 'dark';
  language: 'fr' | 'en';
  autoScanOnStartup: boolean;
  compressionLevel: 'fastest' | 'normal' | 'maximum';
  recreateArchivesIfNeeded: boolean;
  archiveFormatPriority: ArchiveFormat[];
  useBestCompression: boolean;
  solidArchive: boolean;
  multithreading: boolean;
  sevenZipPath?: string;
  winrarPath?: string;
  unrarPath?: string;
  chdmanPath?: string;
  useEmbeddedChdman?: boolean;
  rarToolPriority?: RarTool[];
  systemCompatibility?: SystemCompatibility[];
  noIntroDefaults?: {
    includeBios: boolean;
    includeProto: boolean;
    includeBeta: boolean;
    includeDemo: boolean;
    includeSample: boolean;
  };
  downloadSources?: Array<{
    id: string;
    name: string;
    baseUrl: string;
    enabled: boolean;
    extensions?: string[];
    systemExtensions?: Record<string, string[]>;
  }>;
  downloadExtensions?: string[];
  downloadSystemExtensions?: Array<{
    systemId: string;
    extensions: string[];
  }>;
  incompleteRomsFolder?: string;
}

// Systèmes par défaut, dérivés du registre central src/config/systems.ts
// Régénération via `npm run sync-systems`.
const defaultSystemCompatibility: SystemCompatibility[] = SYSTEMS.map(s => ({
  systemId: s.systemId,
  systemName: s.fullname,
  category: s.manufacturer ?? 'Autres',
  subcategory: s.type ?? undefined,
  supportedFormats: s.supportedFormats,
  warningFormats: s.warningFormats,
  unsupportedFormats: s.unsupportedFormats
}));

let currentFormatPriority: ArchiveFormat[] = ['chd', '7z', 'zip'];
let currentRarToolPriority: RarTool[] = ['7zip', 'winrar', 'unrar'];
let currentSettings: AppSettings;

// ============================================
// INITIALISATION
// ============================================

window.addEventListener('DOMContentLoaded', async () => {
  console.log('Chargement des paramètres...');
  await loadSettings();
  setupTabs();

  // Bouton "Ajouter une source"
  document.getElementById('addDownloadSource')?.addEventListener('click', addDownloadSource);

  // Tri & recherche dans la compatibilité par système
  document.getElementById('systemCompatSortMode')?.addEventListener('change', renderSystemCompatibility);
  document.getElementById('systemCompatSearch')?.addEventListener('input', renderSystemCompatibility);

  // Réagir au changement de la checkbox "Déplacer les fichiers non matchés" pour griser/dégriser
  document.getElementById('moveUnmatchedFiles')?.addEventListener('change', updateUnmatchedFolderEnabled);

  // Lien "aller aux paramètres de nettoyage" dans le message d'avertissement
  document.getElementById('unmatchedGoToCleanup')?.addEventListener('click', (e) => {
    e.preventDefault();
    const cleanupTabBtn = document.querySelector('.tab-button[data-tab="cleanup"]') as HTMLElement | null;
    cleanupTabBtn?.click();
  });
});

// État persistant (entre re-renders) des groupes pliés dans la compatibilité.
// Clé : nom du groupe primaire (type ou constructeur selon le mode de tri).
const collapsedCompatGroups = new Set<string>();

// ============================================
// GESTION DES ONGLETS
// ============================================

function setupTabs(): void {
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabPanes = document.querySelectorAll('.tab-pane');
  
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const tabId = button.getAttribute('data-tab');
      
      tabButtons.forEach(btn => btn.classList.remove('active'));
      tabPanes.forEach(pane => pane.classList.remove('active'));
      
      button.classList.add('active');
      const targetPane = document.getElementById(`tab-${tabId}`);
      if (targetPane) {
        targetPane.classList.add('active');
      }
    });
  });
}

// ============================================
// CHARGEMENT DES PARAMÈTRES
// ============================================

async function loadSettings(): Promise<void> {
  try {
    console.log('Récupération des paramètres depuis l\'API...');
    currentSettings = await window.api.getSettings() as AppSettings;
    console.log('Paramètres reçus:', currentSettings);
    
    // Onglet Général
    (document.getElementById('theme') as HTMLSelectElement).value = currentSettings.theme || 'light';
    (document.getElementById('language') as HTMLSelectElement).value = currentSettings.language || 'fr';
    (document.getElementById('autoScanOnStartup') as HTMLInputElement).checked = currentSettings.autoScanOnStartup || false;
    (document.getElementById('autoSelectNewGames') as HTMLInputElement).checked = currentSettings.autoSelectNewGames !== undefined ? currentSettings.autoSelectNewGames : true;

    // Paramètres No-Intro par défaut
    if (currentSettings.noIntroDefaults) {
      (document.getElementById('noIntroBios') as HTMLInputElement).checked = currentSettings.noIntroDefaults.includeBios;
      (document.getElementById('noIntroProto') as HTMLInputElement).checked = currentSettings.noIntroDefaults.includeProto;
      (document.getElementById('noIntroBeta') as HTMLInputElement).checked = currentSettings.noIntroDefaults.includeBeta;
      (document.getElementById('noIntroDemo') as HTMLInputElement).checked = currentSettings.noIntroDefaults.includeDemo;
      (document.getElementById('noIntroSample') as HTMLInputElement).checked = currentSettings.noIntroDefaults.includeSample;
    }

    // Onglet Dossiers
    (document.getElementById('defaultDatFolder') as HTMLInputElement).value = currentSettings.defaultDatFolder || '';
    (document.getElementById('defaultDatabaseFolder') as HTMLInputElement).value = currentSettings.defaultDatabaseFolder || '';
    (document.getElementById('defaultRomsFolder') as HTMLInputElement).value = currentSettings.defaultRomsFolder || '';
    (document.getElementById('unmatchedRomsFolder') as HTMLInputElement).value = currentSettings.unmatchedRomsFolder || '';
    const unmatchedCleanupInput = document.getElementById('unmatchedRomsFolderCleanup') as HTMLInputElement | null;
    if (unmatchedCleanupInput) unmatchedCleanupInput.value = currentSettings.unmatchedRomsFolder || '';
    (document.getElementById('validatedRomsFolder') as HTMLInputElement).value = currentSettings.validatedRomsFolder || '';
    (document.getElementById('validatedRomsMultiSystem') as HTMLInputElement).checked = !!currentSettings.validatedRomsMultiSystem;
    (document.getElementById('tempExtractionFolder') as HTMLInputElement).value = currentSettings.tempExtractionFolder || '';
    (document.getElementById('cleanSourceAfterConsolidation') as HTMLInputElement).checked = currentSettings.cleanSourceAfterConsolidation !== undefined ? currentSettings.cleanSourceAfterConsolidation : true;
    (document.getElementById('cleanupScope') as HTMLSelectElement).value = currentSettings.cleanupScope || 'used-only';
    (document.getElementById('protectFilesForUnselectedGames') as HTMLInputElement).checked = currentSettings.protectFilesForUnselectedGames !== undefined ? currentSettings.protectFilesForUnselectedGames : true;
    toggleCleanupOptions();

    // Onglet Archives
    (document.getElementById('compressionLevel') as HTMLSelectElement).value = currentSettings.compressionLevel || 'normal';
    (document.getElementById('recreateArchivesIfNeeded') as HTMLInputElement).checked = currentSettings.recreateArchivesIfNeeded || false;
    (document.getElementById('useBestCompression') as HTMLInputElement).checked = currentSettings.useBestCompression || false;
    (document.getElementById('solidArchive') as HTMLInputElement).checked = currentSettings.solidArchive !== undefined ? currentSettings.solidArchive : true;
    (document.getElementById('multithreading') as HTMLInputElement).checked = currentSettings.multithreading !== undefined ? currentSettings.multithreading : true;
    
    toggleBestCompressionWarning((document.getElementById('useBestCompression') as HTMLInputElement).checked);
    
    if (currentSettings.archiveFormatPriority && Array.isArray(currentSettings.archiveFormatPriority)) {
      currentFormatPriority = currentSettings.archiveFormatPriority;
    }
    renderFormatPriorityList();
    
    // Onglet Outils externes
    (document.getElementById('sevenZipPath') as HTMLInputElement).value = currentSettings.sevenZipPath || '';
    (document.getElementById('winrarPath') as HTMLInputElement).value = currentSettings.winrarPath || '';
    (document.getElementById('unrarPath') as HTMLInputElement).value = currentSettings.unrarPath || '';
    (document.getElementById('chdmanPath') as HTMLInputElement).value = currentSettings.chdmanPath || '';
    (document.getElementById('useEmbeddedChdman') as HTMLInputElement).checked = currentSettings.useEmbeddedChdman !== undefined ? currentSettings.useEmbeddedChdman : true;

    if (currentSettings.rarToolPriority && Array.isArray(currentSettings.rarToolPriority)) {
      currentRarToolPriority = currentSettings.rarToolPriority;
    }
    renderRarToolPriorityList();
    
    // Onglet Compatibilité
    renderSystemCompatibility();

    // Onglet Téléchargement
    renderDownloadSources();
    (document.getElementById('downloadExtensions') as HTMLInputElement).value =
      (currentSettings.downloadExtensions || ['7z', 'zip', 'chd', 'rar', 'iso', 'cso', 'pbp']).join(', ');
    renderDownloadSystemExtensions();
    (document.getElementById('incompleteRomsFolder') as HTMLInputElement).value =
      currentSettings.incompleteRomsFolder || '';

    console.log('Paramètres chargés dans l\'interface');
  } catch (error) {
    console.error('Erreur lors du chargement des paramètres:', error);
  }
}

// ============================================
// PARCOURIR DOSSIERS
// ============================================

async function browseFolder(fieldId: string): Promise<void> {
  console.log('Sélection d\'un dossier pour:', fieldId);
  
  let folderType = '';
  switch (fieldId) {
    case 'defaultDatFolder':
      folderType = 'dat';
      break;
    case 'defaultDatabaseFolder':
      folderType = 'database';
      break;
    case 'defaultRomsFolder':
      folderType = 'roms';
      break;
    case 'unmatchedRomsFolder':
    case 'unmatchedRomsFolderCleanup':
      folderType = 'unmatched';
      break;
    case 'incompleteRomsFolder':
      folderType = 'incomplete';
      break;
    case 'validatedRomsFolder':
      folderType = 'validated';
      break;
    case 'tempExtractionFolder':
      folderType = 'temp';
      break;
  }

  try {
    const folderPath = await window.api.selectSettingsFolder(folderType);
    if (folderPath) {
      (document.getElementById(fieldId) as HTMLInputElement).value = folderPath;
      (currentSettings as any)[fieldId] = folderPath;
      // Synchronisation : les deux champs "ROMs non référencées" reflètent la même valeur
      if (fieldId === 'unmatchedRomsFolder' || fieldId === 'unmatchedRomsFolderCleanup') {
        const main = document.getElementById('unmatchedRomsFolder') as HTMLInputElement | null;
        const cleanup = document.getElementById('unmatchedRomsFolderCleanup') as HTMLInputElement | null;
        if (main) main.value = folderPath;
        if (cleanup) cleanup.value = folderPath;
        (currentSettings as any).unmatchedRomsFolder = folderPath;
      }
    }
  } catch (error) {
    console.error('Erreur lors de la sélection du dossier:', error);
  }
}

// ============================================
// PARCOURIR FICHIERS (OUTILS)
// ============================================

async function browseFile(fieldId: string, fileName: string): Promise<void> {
  console.log('Sélection d\'un fichier pour:', fieldId);
  
  try {
    // openFileDialog peut retourner string | string[] | undefined
    const result = await window.api.openFileDialog({
      title: `Sélectionner ${fileName}`,
      filters: [
        { name: 'Exécutables', extensions: ['exe'] },
        { name: 'Tous les fichiers', extensions: ['*'] }
      ],
      multiSelections: false
    });
    
    if (result) {
      // Si c'est un tableau, prendre le premier élément
      const filePath = Array.isArray(result) ? result[0] : result;
      (document.getElementById(fieldId) as HTMLInputElement).value = filePath;
      (currentSettings as any)[fieldId] = filePath;
    }
  } catch (error) {
    console.error('Erreur lors de la sélection du fichier:', error);
  }
}

// ============================================
// AUTO-DÉTECTION DES OUTILS
// ============================================

async function autoDetect7Zip(): Promise<void> {
  console.log('Auto-détection de 7-Zip...');
  
  try {
    const result = await window.api.archive.detectTools();
    if (result.sevenZip) {
      (document.getElementById('sevenZipPath') as HTMLInputElement).value = result.sevenZip;
      (currentSettings as any).sevenZipPath = result.sevenZip;
      alert('7-Zip détecté : ' + result.sevenZip);
    } else {
      alert('7-Zip non trouvé. Veuillez sélectionner manuellement le fichier 7z.exe');
    }
  } catch (error) {
    console.error('Erreur lors de l\'auto-détection de 7-Zip:', error);
    alert('Erreur lors de la détection automatique de 7-Zip');
  }
}

async function autoDetectWinRAR(): Promise<void> {
  console.log('Auto-détection de WinRAR...');
  
  try {
    const result = await window.api.archive.detectTools();
    if (result.winrar) {
      (document.getElementById('winrarPath') as HTMLInputElement).value = result.winrar;
      (currentSettings as any).winrarPath = result.winrar;
      alert('WinRAR détecté : ' + result.winrar);
    } else {
      alert('WinRAR non trouvé. Veuillez sélectionner manuellement le fichier Rar.exe');
    }
  } catch (error) {
    console.error('Erreur lors de l\'auto-détection de WinRAR:', error);
    alert('Erreur lors de la détection automatique de WinRAR');
  }
}

async function autoDetectUnRAR(): Promise<void> {
  console.log('Auto-détection de UnRAR...');
  
  try {
    const result = await window.api.archive.detectTools();
    if (result.unrar) {
      (document.getElementById('unrarPath') as HTMLInputElement).value = result.unrar;
      (currentSettings as any).unrarPath = result.unrar;
      alert('UnRAR détecté : ' + result.unrar);
    } else {
      alert('UnRAR non trouvé. Veuillez sélectionner manuellement le fichier UnRAR.exe');
    }
  } catch (error) {
    console.error('Erreur lors de l\'auto-détection de UnRAR:', error);
    alert('Erreur lors de la détection automatique de UnRAR');
  }
}


// ============================================
// PRIORITÉ DES FORMATS (DRAG & DROP)
// ============================================

function renderFormatPriorityList(): void {
  const container = document.getElementById('formatPriorityList');
  if (!container) return;
  
  container.innerHTML = '';
  
  currentFormatPriority.forEach((format, index) => {
    const item = createFormatPriorityItem(format, index);
    container.appendChild(item);
  });
}

function createFormatPriorityItem(format: ArchiveFormat, index: number): HTMLElement {
  const item = document.createElement('div');
  item.className = 'format-priority-item';
  item.draggable = true;
  item.dataset.index = index.toString();
  
  const order = document.createElement('span');
  order.className = 'format-order';
  order.textContent = `${index + 1}.`;
  
  const name = document.createElement('span');
  name.className = `format-name format-${format}`;
  name.textContent = getFormatDisplayName(format);
  
  const actions = document.createElement('div');
  actions.className = 'format-actions';
  
  if (index > 0) {
    const upBtn = document.createElement('button');
    upBtn.className = 'btn-icon';
    upBtn.textContent = '↑';
    upBtn.onclick = () => moveFormat(index, index - 1);
    actions.appendChild(upBtn);
  }
  
  if (index < currentFormatPriority.length - 1) {
    const downBtn = document.createElement('button');
    downBtn.className = 'btn-icon';
    downBtn.textContent = '↓';
    downBtn.onclick = () => moveFormat(index, index + 1);
    actions.appendChild(downBtn);
  }
  
  item.appendChild(order);
  item.appendChild(name);
  item.appendChild(actions);
  
  item.addEventListener('dragstart', handleDragStart);
  item.addEventListener('dragover', handleDragOver);
  item.addEventListener('drop', handleDrop);
  item.addEventListener('dragend', handleDragEnd);
  
  return item;
}

function getFormatDisplayName(format: ArchiveFormat): string {
  const names: Record<ArchiveFormat, string> = {
    '7z': '7-Zip (7Z)',
    'zip': 'ZIP',
    'chd': 'CHD (Compressed Hunks of Data)'
  };
  return names[format] || format.toUpperCase();
}

function moveFormat(fromIndex: number, toIndex: number): void {
  const format = currentFormatPriority.splice(fromIndex, 1)[0];
  currentFormatPriority.splice(toIndex, 0, format);
  renderFormatPriorityList();
}

let draggedElement: HTMLElement | null = null;

function handleDragStart(this: HTMLElement, e: DragEvent): void {
  draggedElement = this;
  this.classList.add('dragging');
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
  }
}

function handleDragOver(this: HTMLElement, e: DragEvent): void {
  if (e.preventDefault) e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  
  const items = Array.from(document.querySelectorAll('.format-priority-item'));
  items.forEach(item => item.classList.remove('drag-over'));
  this.classList.add('drag-over');
}

function handleDrop(this: HTMLElement, e: DragEvent): void {
  if (e.stopPropagation) e.stopPropagation();
  
  if (draggedElement && draggedElement !== this) {
    const fromIndex = parseInt(draggedElement.dataset.index || '0');
    const toIndex = parseInt(this.dataset.index || '0');
    moveFormat(fromIndex, toIndex);
  }
}

function handleDragEnd(this: HTMLElement): void {
  this.classList.remove('dragging');
  const items = document.querySelectorAll('.format-priority-item');
  items.forEach(item => item.classList.remove('drag-over'));
  draggedElement = null;
}


// ============================================
// PRIORITÉ DES OUTILS RAR (DRAG & DROP)
// ============================================

function renderRarToolPriorityList(): void {
  const container = document.getElementById('rarToolPriorityList');
  if (!container) return;
  
  container.innerHTML = '';
  
  currentRarToolPriority.forEach((tool, index) => {
    const item = createRarToolPriorityItem(tool, index);
    container.appendChild(item);
  });
}

function createRarToolPriorityItem(tool: RarTool, index: number): HTMLElement {
  const item = document.createElement('div');
  item.className = 'format-priority-item';
  item.draggable = true;
  item.dataset.index = index.toString();
  
  const order = document.createElement('span');
  order.className = 'format-order';
  order.textContent = `${index + 1}.`;
  
  const name = document.createElement('span');
  name.className = `format-name format-${tool}`;
  name.textContent = getRarToolDisplayName(tool);
  
  const actions = document.createElement('div');
  actions.className = 'format-actions';
  
  if (index > 0) {
    const upBtn = document.createElement('button');
    upBtn.className = 'btn-icon';
    upBtn.textContent = '↑';
    upBtn.onclick = () => moveRarTool(index, index - 1);
    actions.appendChild(upBtn);
  }
  
  if (index < currentRarToolPriority.length - 1) {
    const downBtn = document.createElement('button');
    downBtn.className = 'btn-icon';
    downBtn.textContent = '↓';
    downBtn.onclick = () => moveRarTool(index, index + 1);
    actions.appendChild(downBtn);
  }
  
  item.appendChild(order);
  item.appendChild(name);
  item.appendChild(actions);
  
  item.addEventListener('dragstart', handleRarToolDragStart);
  item.addEventListener('dragover', handleDragOver);
  item.addEventListener('drop', handleRarToolDrop);
  item.addEventListener('dragend', handleDragEnd);
  
  return item;
}

function getRarToolDisplayName(tool: RarTool): string {
  const names: Record<RarTool, string> = {
    '7zip': '7-Zip (Recommandé)',
    'winrar': 'WinRAR',
    'unrar': 'UnRAR'
  };
  return names[tool] || tool.toUpperCase();
}

function moveRarTool(fromIndex: number, toIndex: number): void {
  const tool = currentRarToolPriority.splice(fromIndex, 1)[0];
  currentRarToolPriority.splice(toIndex, 0, tool);
  renderRarToolPriorityList();
}

let draggedRarToolElement: HTMLElement | null = null;

function handleRarToolDragStart(this: HTMLElement, e: DragEvent): void {
  draggedRarToolElement = this;
  this.classList.add('dragging');
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
  }
}

function handleRarToolDrop(this: HTMLElement, e: DragEvent): void {
  if (e.stopPropagation) e.stopPropagation();
  
  if (draggedRarToolElement && draggedRarToolElement !== this) {
    const fromIndex = parseInt(draggedRarToolElement.dataset.index || '0');
    const toIndex = parseInt(this.dataset.index || '0');
    moveRarTool(fromIndex, toIndex);
  }
}

// ============================================
// COMPATIBILITÉ SYSTÈMES
// ============================================

function renderSystemCompatibility(): void {
  const container = document.getElementById('systemCompatibilityList');
  if (!container) return;

  container.innerHTML = '';

  // Liste de base : TOUJOURS depuis le registre central (defaultSystemCompatibility = SYSTEMS).
  // Les surcharges utilisateur (currentSettings.systemCompatibility) ne servent qu'à
  // remplacer les supportedFormats pour les systemId connus du registre.
  const userOverrides = new Map<string, SystemCompatibility>();
  for (const ov of currentSettings.systemCompatibility ?? []) {
    userOverrides.set(ov.systemId.toLowerCase(), ov);
  }
  const systemCompat: SystemCompatibility[] = defaultSystemCompatibility.map(base => {
    const override = userOverrides.get(base.systemId.toLowerCase());
    if (override && override.supportedFormats) {
      return { ...base, supportedFormats: override.supportedFormats };
    }
    return base;
  });

  // Filtre par recherche
  const searchInput = document.getElementById('systemCompatSearch') as HTMLInputElement | null;
  const search = (searchInput?.value || '').trim().toLowerCase();
  const filtered = search
    ? systemCompat.filter(s =>
        s.systemId.toLowerCase().includes(search) ||
        s.systemName.toLowerCase().includes(search) ||
        (s.category || '').toLowerCase().includes(search) ||
        (s.subcategory || '').toLowerCase().includes(search)
      )
    : systemCompat;

  // Mode de tri
  const sortSelect = document.getElementById('systemCompatSortMode') as HTMLSelectElement | null;
  const sortMode = sortSelect?.value || 'type-then-manufacturer';

  let grouped: Map<string, Map<string, SystemCompatibility[]>>;
  if (sortMode === 'alphabetical') {
    grouped = new Map();
    grouped.set('', new Map([['', [...filtered].sort((a, b) => a.systemName.localeCompare(b.systemName))]]));
  } else {
    // Détermination des deux niveaux selon le mode choisi
    const primaryKey = (s: SystemCompatibility) =>
      sortMode === 'type-then-manufacturer'
        ? (s.subcategory || 'autres')
        : (s.category || 'Autres');
    const secondaryKey = (s: SystemCompatibility) =>
      sortMode === 'type-then-manufacturer'
        ? (s.category || 'Autres')
        : (s.subcategory || 'autres');

    grouped = new Map();
    for (const sys of filtered) {
      const p = primaryKey(sys);
      const s = secondaryKey(sys);
      if (!grouped.has(p)) grouped.set(p, new Map());
      const sec = grouped.get(p)!;
      if (!sec.has(s)) sec.set(s, []);
      sec.get(s)!.push(sys);
    }

    // Tri des clés primaires alphabétiquement (avec "Autres"/"autres" en dernier)
    const sortedPrimary = [...grouped.keys()].sort((a, b) => {
      const aOther = a.toLowerCase() === 'autres';
      const bOther = b.toLowerCase() === 'autres';
      if (aOther && !bOther) return 1;
      if (!aOther && bOther) return -1;
      return a.localeCompare(b);
    });
    grouped = new Map(sortedPrimary.map(k => [k, grouped.get(k)!]));
  }

  // Capitalise la première lettre (les types Recalbox sont en minuscules : console, handheld, ...)
  const capitalize = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

  for (const [primary, secondaryMap] of grouped) {
    const section = document.createElement('div');
    section.className = 'system-category-section';

    // Conteneur du contenu pliable (sous-titres + items)
    const content = document.createElement('div');
    content.className = 'system-category-content';

    if (primary) {
      const catTitle = document.createElement('h4');
      catTitle.className = 'system-category-title';
      const isCollapsed = collapsedCompatGroups.has(primary);
      catTitle.dataset.collapsed = isCollapsed ? '1' : '0';
      const chevron = document.createElement('span');
      chevron.className = 'system-category-chevron';
      chevron.textContent = isCollapsed ? '▶' : '▼';
      const label = document.createElement('span');
      label.textContent = capitalize(primary);
      catTitle.appendChild(chevron);
      catTitle.appendChild(label);
      catTitle.style.cursor = 'pointer';
      catTitle.style.userSelect = 'none';
      content.style.display = isCollapsed ? 'none' : '';
      catTitle.addEventListener('click', () => {
        const nowCollapsed = catTitle.dataset.collapsed !== '1';
        catTitle.dataset.collapsed = nowCollapsed ? '1' : '0';
        chevron.textContent = nowCollapsed ? '▶' : '▼';
        content.style.display = nowCollapsed ? 'none' : '';
        if (nowCollapsed) collapsedCompatGroups.add(primary);
        else collapsedCompatGroups.delete(primary);
      });
      section.appendChild(catTitle);
    }

    const sortedSecondary = [...secondaryMap.keys()].sort((a, b) => a.localeCompare(b));
    for (const secondary of sortedSecondary) {
      const subcatSystems = secondaryMap.get(secondary)!;
      if (secondary) {
        const subcatTitle = document.createElement('h6');
        subcatTitle.className = 'system-subcategory-title';
        subcatTitle.textContent = capitalize(secondary);
        content.appendChild(subcatTitle);
      }

    for (const system of [...subcatSystems].sort((a, b) => a.systemName.localeCompare(b.systemName))) {
      // Récupérer les infos par défaut pour les icônes warning/unsupported
      const defaultEntry = defaultSystemCompatibility.find(s => s.systemId === system.systemId);

      const systemDiv = document.createElement('div');
      systemDiv.className = 'system-compatibility-item';
      systemDiv.dataset.systemId = system.systemId;

      // Header : nom du système + bouton reset individuel
      const headerDiv = document.createElement('div');
      headerDiv.className = 'system-compatibility-header';

      const title = document.createElement('h5');
      title.textContent = system.systemName;
      headerDiv.appendChild(title);

      const resetBtn = document.createElement('button');
      resetBtn.className = 'btn-reset-system';
      resetBtn.title = `Réinitialiser ${system.systemName} aux valeurs par défaut`;
      resetBtn.textContent = '↺';
      resetBtn.addEventListener('click', () => resetSystemCompatibility(system.systemId));
      headerDiv.appendChild(resetBtn);

      systemDiv.appendChild(headerDiv);

      const checkboxesDiv = document.createElement('div');
      checkboxesDiv.className = 'format-checkboxes';

      (['7z', 'zip', 'chd'] as ArchiveFormat[]).forEach(format => {
        const label = document.createElement('label');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.system = system.systemId;
        checkbox.dataset.format = format;
        checkbox.checked = system.supportedFormats.includes(format);

        const formatText = document.createElement('span');
        formatText.textContent = format.toUpperCase();

        // Icône warning (triangle orange) — format partiellement supporté
        if (defaultEntry?.warningFormats?.includes(format)) {
          const warning = document.createElement('span');
          warning.className = 'format-icon-warning';
          warning.textContent = ' ⚠️';
          warning.title = 'Compatibilité partielle : certains émulateurs ne supportent pas ce format';
          formatText.appendChild(warning);
        }

        // Icône croix rouge — format non supporté
        if (defaultEntry?.unsupportedFormats?.includes(format)) {
          const unsupported = document.createElement('span');
          unsupported.className = 'format-icon-unsupported';
          unsupported.textContent = ' ❌';
          unsupported.title = 'Non supporté par les émulateurs de ce système';
          formatText.appendChild(unsupported);
        }

        label.appendChild(checkbox);
        label.appendChild(formatText);
        checkboxesDiv.appendChild(label);
      });

      systemDiv.appendChild(checkboxesDiv);

      // Affichage informatif des formats bruts (non éditables)
      const sysDef = SYSTEMS.find(s => s.systemId === system.systemId);
      if (sysDef && (sysDef.datRawFormats.length > 0 || sysDef.extraRawFormats.length > 0)) {
        const rawInfo = document.createElement('div');
        rawInfo.className = 'raw-formats-info';

        if (sysDef.datRawFormats.length > 0) {
          const datLine = document.createElement('div');
          datLine.className = 'raw-formats-line';
          const datLabel = document.createElement('span');
          datLabel.className = 'raw-formats-label';
          datLabel.textContent = 'Formats sans compression :';
          datLine.appendChild(datLabel);
          for (const ext of sysDef.datRawFormats) {
            const tag = document.createElement('span');
            tag.className = 'raw-format-tag raw-format-dat';
            tag.textContent = '.' + ext;
            datLine.appendChild(tag);
          }
          rawInfo.appendChild(datLine);
        }

        if (sysDef.extraRawFormats.length > 0) {
          const extraLine = document.createElement('div');
          extraLine.className = 'raw-formats-line';
          const extraLabel = document.createElement('span');
          extraLabel.className = 'raw-formats-label';
          extraLabel.textContent = 'Autres formats lus par les émulateurs :';
          extraLine.appendChild(extraLabel);
          for (const ext of sysDef.extraRawFormats) {
            const tag = document.createElement('span');
            tag.className = 'raw-format-tag raw-format-extra';
            tag.textContent = '.' + ext;
            extraLine.appendChild(tag);
          }
          rawInfo.appendChild(extraLine);
        }

        systemDiv.appendChild(rawInfo);
      }

      content.appendChild(systemDiv);
    }
    } // fin subcategories loop

    section.appendChild(content);
    container.appendChild(section);
  }
}

/**
 * Réinitialise un seul système aux valeurs par défaut
 */
function resetSystemCompatibility(systemId: string): void {
  const defaultConfig = defaultSystemCompatibility.find(s => s.systemId === systemId);
  if (!defaultConfig) return;

  const systemDiv = document.querySelector(`.system-compatibility-item[data-system-id="${systemId}"]`);
  if (!systemDiv) return;

  const checkboxes = systemDiv.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  checkboxes.forEach(checkbox => {
    const format = checkbox.dataset.format as ArchiveFormat;
    checkbox.checked = defaultConfig.supportedFormats.includes(format);
  });
}

/**
 * Réinitialise tous les systèmes aux valeurs par défaut
 */
function resetAllSystemCompatibility(): void {
  // Mettre à jour les settings en mémoire
  currentSettings.systemCompatibility = JSON.parse(JSON.stringify(defaultSystemCompatibility));
  // Re-rendre
  renderSystemCompatibility();
}

// Exposer pour l'appel inline dans le HTML
(window as any).resetAllSystemCompatibility = resetAllSystemCompatibility;

// ============================================
// TOGGLE OPTIONS DE NETTOYAGE
// ============================================

function toggleCleanupOptions(): void {
  const cleanEnabled = (document.getElementById('cleanSourceAfterConsolidation') as HTMLInputElement).checked;
  (document.getElementById('cleanupScope') as HTMLSelectElement).disabled = !cleanEnabled;
  (document.getElementById('protectFilesForUnselectedGames') as HTMLInputElement).disabled = !cleanEnabled;
  (document.getElementById('moveUnmatchedFiles') as HTMLInputElement).disabled = !cleanEnabled;

  // Le dossier "ROMs non référencées" ne sert que si le nettoyage ET le déplacement sont activés
  updateUnmatchedFolderEnabled();
}

/**
 * Active ou désactive (grise) les champs "ROMs non référencées" selon l'état des deux
 * checkboxes du nettoyage. Les deux champs (onglet Dossiers + onglet Nettoyage) sont synchronisés.
 */
function updateUnmatchedFolderEnabled(): void {
  const cleanCb = document.getElementById('cleanSourceAfterConsolidation') as HTMLInputElement | null;
  const moveCb = document.getElementById('moveUnmatchedFiles') as HTMLInputElement | null;
  const enabled = !!cleanCb?.checked && !!moveCb?.checked;

  for (const id of ['unmatchedRomsFolder', 'unmatchedRomsFolderCleanup']) {
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (input) {
      input.disabled = !enabled;
      input.style.opacity = enabled ? '' : '0.55';
    }
  }
  for (const id of ['unmatchedRomsFolderBrowse']) {
    const btn = document.getElementById(id) as HTMLButtonElement | null;
    if (btn) btn.disabled = !enabled;
  }

  const msg = document.getElementById('unmatchedRomsFolderDisabledMsg');
  if (msg) msg.style.display = enabled ? 'none' : 'block';
}

// ============================================
// AVERTISSEMENT "BEST COMPRESSION"
// ============================================

function toggleBestCompressionWarning(show: boolean): void {
  const warning = document.getElementById('bestCompressionWarning');
  if (warning) {
    warning.style.display = show ? 'block' : 'none';
  }
}

// ============================================
// TÉLÉCHARGEMENT — SOURCES
// ============================================

function renderDownloadSources(): void {
  const container = document.getElementById('downloadSourcesList')!;
  container.innerHTML = '';
  const sources = currentSettings?.downloadSources || [];

  sources.forEach((source, index) => {
    const item = document.createElement('div');
    item.className = 'download-source-item';
    item.dataset.index = String(index);
    item.style.cssText = 'border: 1px solid #dee2e6; border-radius: 6px; padding: 12px; margin-bottom: 8px; background: #f8f9fa;';

    item.innerHTML = `
      <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
        <input type="text" class="source-name" value="${escapeHtml(source.name)}" placeholder="Nom" style="flex: 1; padding: 6px 10px; border: 1px solid #ced4da; border-radius: 4px; font-size: 13px;">
        <label style="display: flex; align-items: center; gap: 4px; font-size: 13px; white-space: nowrap;">
          <input type="checkbox" class="source-enabled" ${source.enabled ? 'checked' : ''}> Actif
        </label>
      </div>
      <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
        <input type="text" class="source-url" value="${escapeHtml(source.baseUrl)}" placeholder="URL de base (ex: https://example.com/roms/)" style="flex: 1; padding: 6px 10px; border: 1px solid #ced4da; border-radius: 4px; font-size: 13px;">
      </div>
      <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
        <input type="text" class="source-extensions" value="${(source.extensions || []).join(', ')}" placeholder="Extensions (vide = utiliser les globales)" style="flex: 1; padding: 6px 10px; border: 1px solid #ced4da; border-radius: 4px; font-size: 13px;">
      </div>
      <div class="source-system-overrides" style="margin-bottom: 8px;">
        ${renderSourceSystemOverrides(source.systemExtensions || {}, index)}
      </div>
      <div style="display: flex; gap: 6px; justify-content: flex-end;">
        <button class="btn-secondary source-add-system" data-index="${index}" style="font-size: 12px; padding: 4px 8px;">+ Système</button>
        <button class="btn-secondary source-move-up" data-index="${index}" style="font-size: 12px; padding: 4px 8px;" ${index === 0 ? 'disabled' : ''}>&#8593;</button>
        <button class="btn-secondary source-move-down" data-index="${index}" style="font-size: 12px; padding: 4px 8px;" ${index === sources.length - 1 ? 'disabled' : ''}>&#8595;</button>
        <button class="btn-danger source-delete" data-index="${index}" style="font-size: 12px; padding: 4px 8px;">&#10005;</button>
      </div>
    `;

    container.appendChild(item);
  });

  // Bind events
  container.querySelectorAll('.source-move-up').forEach(btn => {
    btn.addEventListener('click', () => moveDownloadSource(Number((btn as HTMLElement).dataset.index), -1));
  });
  container.querySelectorAll('.source-move-down').forEach(btn => {
    btn.addEventListener('click', () => moveDownloadSource(Number((btn as HTMLElement).dataset.index), 1));
  });
  container.querySelectorAll('.source-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteDownloadSource(Number((btn as HTMLElement).dataset.index)));
  });
  container.querySelectorAll('.source-add-system').forEach(btn => {
    btn.addEventListener('click', () => addSystemOverrideToSource(Number((btn as HTMLElement).dataset.index)));
  });
  container.querySelectorAll('.source-system-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const sourceIdx = Number((btn as HTMLElement).dataset.sourceIndex);
      const systemId = (btn as HTMLElement).dataset.systemId!;
      removeSystemOverrideFromSource(sourceIdx, systemId);
    });
  });
}

function renderSourceSystemOverrides(systemExtensions: Record<string, string[]>, sourceIndex: number): string {
  const entries = Object.entries(systemExtensions);
  if (entries.length === 0) return '';

  return entries.map(([systemId, exts]) => {
    const systemName = defaultSystemCompatibility.find(s => s.systemId === systemId)?.systemName || systemId;
    return `<div style="display: flex; gap: 6px; align-items: center; margin-top: 4px; padding-left: 12px;">
      <span style="font-size: 12px; color: #7f8c8d; min-width: 140px;">${escapeHtml(systemName)} :</span>
      <input type="text" class="source-system-ext" data-source-index="${sourceIndex}" data-system-id="${systemId}"
        value="${exts.join(', ')}" placeholder="Extensions pour ce système"
        style="flex: 1; padding: 4px 8px; border: 1px solid #ced4da; border-radius: 4px; font-size: 12px;">
      <button class="btn-secondary source-system-remove" data-source-index="${sourceIndex}" data-system-id="${systemId}"
        style="font-size: 11px; padding: 2px 6px;">&#10005;</button>
    </div>`;
  }).join('');
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function addDownloadSource(): void {
  if (!currentSettings) return;
  if (!currentSettings.downloadSources) currentSettings.downloadSources = [];
  currentSettings.downloadSources.push({
    id: crypto.randomUUID(),
    name: '',
    baseUrl: '',
    enabled: true,
  });
  // Sync from DOM before re-render to preserve unsaved edits
  syncDownloadSourcesFromDom();
  renderDownloadSources();
}

function moveDownloadSource(index: number, direction: number): void {
  if (!currentSettings?.downloadSources) return;
  syncDownloadSourcesFromDom();
  const sources = currentSettings.downloadSources;
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= sources.length) return;
  [sources[index], sources[newIndex]] = [sources[newIndex], sources[index]];
  renderDownloadSources();
}

function deleteDownloadSource(index: number): void {
  if (!currentSettings?.downloadSources) return;
  syncDownloadSourcesFromDom();
  currentSettings.downloadSources.splice(index, 1);
  renderDownloadSources();
}

function addSystemOverrideToSource(sourceIndex: number): void {
  if (!currentSettings?.downloadSources) return;
  syncDownloadSourcesFromDom();
  const source = currentSettings.downloadSources[sourceIndex];
  if (!source) return;
  if (!source.systemExtensions) source.systemExtensions = {};

  // Find systems not already overridden
  const existingIds = Object.keys(source.systemExtensions);
  const available = defaultSystemCompatibility.filter(s => !existingIds.includes(s.systemId));
  if (available.length === 0) return;

  // Add the first available system with its default extensions
  const sys = available[0];
  const defaultExts = [...(sys.supportedFormats || []), ...(sys.warningFormats || [])];
  source.systemExtensions[sys.systemId] = defaultExts;
  renderDownloadSources();
}

function removeSystemOverrideFromSource(sourceIndex: number, systemId: string): void {
  if (!currentSettings?.downloadSources) return;
  syncDownloadSourcesFromDom();
  const source = currentSettings.downloadSources[sourceIndex];
  if (!source?.systemExtensions) return;
  delete source.systemExtensions[systemId];
  renderDownloadSources();
}

function syncDownloadSourcesFromDom(): void {
  if (!currentSettings?.downloadSources) return;
  const items = document.querySelectorAll('.download-source-item');
  items.forEach((item, i) => {
    if (i >= currentSettings!.downloadSources!.length) return;
    const source = currentSettings!.downloadSources![i];
    source.name = (item.querySelector('.source-name') as HTMLInputElement)?.value || '';
    source.baseUrl = (item.querySelector('.source-url') as HTMLInputElement)?.value || '';
    source.enabled = (item.querySelector('.source-enabled') as HTMLInputElement)?.checked ?? true;
    const extVal = (item.querySelector('.source-extensions') as HTMLInputElement)?.value || '';
    source.extensions = extVal ? extVal.split(',').map(s => s.trim()).filter(s => s.length > 0) : undefined;

    // System overrides
    const sysExtInputs = item.querySelectorAll('.source-system-ext');
    if (sysExtInputs.length > 0) {
      if (!source.systemExtensions) source.systemExtensions = {};
      sysExtInputs.forEach(input => {
        const sysId = (input as HTMLElement).dataset.systemId!;
        const val = (input as HTMLInputElement).value;
        source.systemExtensions![sysId] = val.split(',').map(s => s.trim()).filter(s => s.length > 0);
      });
    }
  });
}

function collectDownloadSources(): AppSettings['downloadSources'] {
  syncDownloadSourcesFromDom();
  return currentSettings?.downloadSources || [];
}

// ============================================
// TÉLÉCHARGEMENT — EXTENSIONS PAR SYSTÈME
// ============================================

function renderDownloadSystemExtensions(): void {
  const container = document.getElementById('downloadSystemExtensionsList')!;
  container.innerHTML = '';
  const systemExts = currentSettings?.downloadSystemExtensions || [];

  defaultSystemCompatibility.forEach(sys => {
    const override = systemExts.find(s => s.systemId === sys.systemId);
    const defaultExts = [...(sys.supportedFormats || []), ...(sys.warningFormats || [])];
    const displayExts = override ? override.extensions.join(', ') : '';

    const row = document.createElement('div');
    row.style.cssText = 'display: flex; gap: 8px; align-items: center; margin-bottom: 4px;';
    row.innerHTML = `
      <span style="font-size: 13px; min-width: 220px; color: #2c3e50;">${escapeHtml(sys.systemName)}</span>
      <input type="text" class="system-dl-ext" data-system-id="${sys.systemId}"
        value="${escapeHtml(displayExts)}" placeholder="${defaultExts.join(', ')}"
        style="flex: 1; padding: 5px 8px; border: 1px solid #ced4da; border-radius: 4px; font-size: 12px;">
    `;
    container.appendChild(row);
  });
}

function collectDownloadSystemExtensions(): AppSettings['downloadSystemExtensions'] {
  const result: Array<{ systemId: string; extensions: string[] }> = [];
  document.querySelectorAll('.system-dl-ext').forEach(input => {
    const systemId = (input as HTMLElement).dataset.systemId!;
    const val = (input as HTMLInputElement).value.trim();
    if (val) {
      result.push({
        systemId,
        extensions: val.split(',').map(s => s.trim()).filter(s => s.length > 0)
      });
    }
  });
  return result;
}

// ============================================
// SAUVEGARDE
// ============================================

async function saveSettings(): Promise<void> {
  try {
    console.log('Sauvegarde des paramètres...');
    
    // Collecter la compatibilité système
    const systemCompatibility: SystemCompatibility[] = [];
    const systemItems = document.querySelectorAll('.system-compatibility-item');

    systemItems.forEach(item => {
      const systemId = (item as HTMLElement).dataset.systemId!;
      const defaultEntry = defaultSystemCompatibility.find(s => s.systemId === systemId);
      const systemName = defaultEntry?.systemName || systemId;
      const supportedFormats: ArchiveFormat[] = [];

      const checkboxes = item.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach(checkbox => {
        if ((checkbox as HTMLInputElement).checked) {
          supportedFormats.push((checkbox as HTMLInputElement).dataset.format as ArchiveFormat);
        }
      });

      systemCompatibility.push({
        systemId,
        systemName,
        category: defaultEntry?.category || 'Autres',
        subcategory: defaultEntry?.subcategory,
        supportedFormats,
        warningFormats: defaultEntry?.warningFormats,
        unsupportedFormats: defaultEntry?.unsupportedFormats
      });
    });
    
    const newSettings: AppSettings = {
      // Général
      theme: (document.getElementById('theme') as HTMLSelectElement).value as 'light' | 'dark',
      language: (document.getElementById('language') as HTMLSelectElement).value as 'fr' | 'en',
      autoScanOnStartup: (document.getElementById('autoScanOnStartup') as HTMLInputElement).checked,
      autoSelectNewGames: (document.getElementById('autoSelectNewGames') as HTMLInputElement).checked,

      // Dossiers
      defaultDatFolder: (document.getElementById('defaultDatFolder') as HTMLInputElement).value,
      defaultDatabaseFolder: (document.getElementById('defaultDatabaseFolder') as HTMLInputElement).value,
      defaultRomsFolder: (document.getElementById('defaultRomsFolder') as HTMLInputElement).value,
      unmatchedRomsFolder: (document.getElementById('unmatchedRomsFolder') as HTMLInputElement).value,
      validatedRomsFolder: (document.getElementById('validatedRomsFolder') as HTMLInputElement).value,
      validatedRomsMultiSystem: (document.getElementById('validatedRomsMultiSystem') as HTMLInputElement).checked,
      tempExtractionFolder: (document.getElementById('tempExtractionFolder') as HTMLInputElement).value,
      cleanSourceAfterConsolidation: (document.getElementById('cleanSourceAfterConsolidation') as HTMLInputElement).checked,
      cleanupScope: (document.getElementById('cleanupScope') as HTMLSelectElement).value as CleanupScope,
      protectFilesForUnselectedGames: (document.getElementById('protectFilesForUnselectedGames') as HTMLInputElement).checked,

      // Compression
      compressionLevel: (document.getElementById('compressionLevel') as HTMLSelectElement).value as any,
      recreateArchivesIfNeeded: (document.getElementById('recreateArchivesIfNeeded') as HTMLInputElement).checked,
      archiveFormatPriority: currentFormatPriority,
      useBestCompression: (document.getElementById('useBestCompression') as HTMLInputElement).checked,
      solidArchive: (document.getElementById('solidArchive') as HTMLInputElement).checked,
      multithreading: (document.getElementById('multithreading') as HTMLInputElement).checked,
      
      // Outils externes
      sevenZipPath: (document.getElementById('sevenZipPath') as HTMLInputElement).value,
      winrarPath: (document.getElementById('winrarPath') as HTMLInputElement).value,
      unrarPath: (document.getElementById('unrarPath') as HTMLInputElement).value,
      chdmanPath: (document.getElementById('chdmanPath') as HTMLInputElement).value,
      useEmbeddedChdman: (document.getElementById('useEmbeddedChdman') as HTMLInputElement).checked,
      rarToolPriority: currentRarToolPriority,
      
      // Compatibilité système
      systemCompatibility,

      // Paramètres No-Intro par défaut
      noIntroDefaults: {
        includeBios: (document.getElementById('noIntroBios') as HTMLInputElement).checked,
        includeProto: (document.getElementById('noIntroProto') as HTMLInputElement).checked,
        includeBeta: (document.getElementById('noIntroBeta') as HTMLInputElement).checked,
        includeDemo: (document.getElementById('noIntroDemo') as HTMLInputElement).checked,
        includeSample: (document.getElementById('noIntroSample') as HTMLInputElement).checked,
      },

      // Téléchargement
      downloadSources: collectDownloadSources(),
      downloadExtensions: (document.getElementById('downloadExtensions') as HTMLInputElement).value
        .split(',').map(s => s.trim()).filter(s => s.length > 0),
      downloadSystemExtensions: collectDownloadSystemExtensions(),
      incompleteRomsFolder: (document.getElementById('incompleteRomsFolder') as HTMLInputElement).value,
    };

    console.log('Nouveaux paramètres à sauvegarder:', newSettings);

    await window.api.updateSettings(newSettings);
    console.log('Paramètres sauvegardés avec succès');
    
    const status = document.getElementById('save-status');
    if (status) {
      status.textContent = '✅ Enregistré !';
      setTimeout(() => {
        status.textContent = '';
      }, 2000);
    }
    
    setTimeout(() => {
      window.close();
    }, 1000);
  } catch (error) {
    console.error('Erreur lors de l\'enregistrement:', error);
    alert('Erreur lors de l\'enregistrement : ' + (error as Error).message);
  }
}

// ============================================
// BOUTONS
// ============================================

function cancel(): void {
  window.close();
}

async function resetToDefaults(): Promise<void> {
  if (confirm('Êtes-vous sûr de vouloir réinitialiser tous les paramètres ?')) {
    try {
      await window.api.resetSettings();
      await loadSettings();
      alert('Paramètres réinitialisés !');
    } catch (error) {
      console.error('Erreur lors de la réinitialisation:', error);
    }
  }
}

// ============================================
// EXPORT GLOBAL
// ============================================

(window as any).browseFolder = browseFolder;
(window as any).browseFile = browseFile;
(window as any).autoDetect7Zip = autoDetect7Zip;
(window as any).autoDetectWinRAR = autoDetectWinRAR;
(window as any).autoDetectUnRAR = autoDetectUnRAR;
(window as any).saveSettings = saveSettings;
(window as any).cancel = cancel;
(window as any).resetToDefaults = resetToDefaults;
(window as any).toggleBestCompressionWarning = toggleBestCompressionWarning;
(window as any).toggleCleanupOptions = toggleCleanupOptions;
