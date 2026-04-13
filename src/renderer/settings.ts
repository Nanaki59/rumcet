// src/renderer/settings.ts

// Utiliser les types depuis global.d.ts
type ArchiveFormat = '7z' | 'zip' | 'chd';
type CleanupScope = 'used-only' | 'all-matched';
type RarTool = '7zip' | 'winrar' | 'unrar';

type SystemCategory = 'Nintendo' | 'Sega' | 'Sony' | 'Arcade' | 'Ordinateurs' | 'Autres';
type SystemSubcategory = 'Consoles de salon' | 'Consoles portables';

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
  tempExtractionFolder: string;
  cleanSourceAfterConsolidation: boolean;
  cleanupScope: CleanupScope;
  protectFilesForUnselectedGames: boolean;
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
}

// Systèmes par défaut (miroir de DEFAULT_SYSTEM_COMPATIBILITY dans settingsManager.ts)
const defaultSystemCompatibility: SystemCompatibility[] = [
  // ── Nintendo — Consoles de salon ──
  { systemId: 'nes', systemName: 'Nintendo Entertainment System (NES)', category: 'Nintendo', subcategory: 'Consoles de salon', supportedFormats: ['zip', '7z'], unsupportedFormats: ['chd'] },
  { systemId: 'snes', systemName: 'Super Nintendo (SNES)', category: 'Nintendo', subcategory: 'Consoles de salon', supportedFormats: ['zip', '7z'], unsupportedFormats: ['chd'] },
  { systemId: 'n64', systemName: 'Nintendo 64', category: 'Nintendo', subcategory: 'Consoles de salon', supportedFormats: ['7z', 'zip'], unsupportedFormats: ['chd'] },
  { systemId: 'gamecube', systemName: 'Nintendo GameCube', category: 'Nintendo', subcategory: 'Consoles de salon', supportedFormats: ['7z'], warningFormats: ['zip'], unsupportedFormats: ['chd'] },
  { systemId: 'wii', systemName: 'Nintendo Wii', category: 'Nintendo', subcategory: 'Consoles de salon', supportedFormats: ['7z'], warningFormats: ['zip'], unsupportedFormats: ['chd'] },
  // ── Nintendo — Consoles portables ──
  { systemId: 'gb', systemName: 'Game Boy', category: 'Nintendo', subcategory: 'Consoles portables', supportedFormats: ['zip', '7z'], unsupportedFormats: ['chd'] },
  { systemId: 'gbc', systemName: 'Game Boy Color', category: 'Nintendo', subcategory: 'Consoles portables', supportedFormats: ['zip', '7z'], unsupportedFormats: ['chd'] },
  { systemId: 'gba', systemName: 'Game Boy Advance', category: 'Nintendo', subcategory: 'Consoles portables', supportedFormats: ['zip', '7z'], unsupportedFormats: ['chd'] },
  { systemId: 'nds', systemName: 'Nintendo DS', category: 'Nintendo', subcategory: 'Consoles portables', supportedFormats: ['7z', 'zip'], unsupportedFormats: ['chd'] },
  { systemId: '3ds', systemName: 'Nintendo 3DS', category: 'Nintendo', subcategory: 'Consoles portables', supportedFormats: ['7z'], warningFormats: ['zip'], unsupportedFormats: ['chd'] },
  // ── Sega — Consoles de salon ──
  { systemId: 'mastersystem', systemName: 'Sega Master System', category: 'Sega', subcategory: 'Consoles de salon', supportedFormats: ['zip', '7z'], unsupportedFormats: ['chd'] },
  { systemId: 'genesis', systemName: 'Sega Genesis / Mega Drive', category: 'Sega', subcategory: 'Consoles de salon', supportedFormats: ['zip', '7z'], unsupportedFormats: ['chd'] },
  { systemId: 'sega32x', systemName: 'Sega 32X', category: 'Sega', subcategory: 'Consoles de salon', supportedFormats: ['zip', '7z'], unsupportedFormats: ['chd'] },
  { systemId: 'segacd', systemName: 'Sega CD / Mega CD', category: 'Sega', subcategory: 'Consoles de salon', supportedFormats: ['chd'], warningFormats: ['7z', 'zip'], unsupportedFormats: [] },
  { systemId: 'saturn', systemName: 'Sega Saturn', category: 'Sega', subcategory: 'Consoles de salon', supportedFormats: ['chd'], warningFormats: ['7z'], unsupportedFormats: ['zip'] },
  { systemId: 'dreamcast', systemName: 'Sega Dreamcast', category: 'Sega', subcategory: 'Consoles de salon', supportedFormats: ['chd'], warningFormats: ['7z'], unsupportedFormats: ['zip'] },
  // ── Sega — Consoles portables ──
  { systemId: 'gamegear', systemName: 'Sega Game Gear', category: 'Sega', subcategory: 'Consoles portables', supportedFormats: ['zip', '7z'], unsupportedFormats: ['chd'] },
  // ── Sony — Consoles de salon ──
  { systemId: 'psx', systemName: 'PlayStation (PSX)', category: 'Sony', subcategory: 'Consoles de salon', supportedFormats: ['chd'], warningFormats: ['7z', 'zip'], unsupportedFormats: [] },
  { systemId: 'ps2', systemName: 'PlayStation 2 (PS2)', category: 'Sony', subcategory: 'Consoles de salon', supportedFormats: ['chd', '7z'], unsupportedFormats: ['zip'] },
  // ── Sony — Consoles portables ──
  { systemId: 'psp', systemName: 'PlayStation Portable (PSP)', category: 'Sony', subcategory: 'Consoles portables', supportedFormats: ['chd', '7z'], warningFormats: ['zip'], unsupportedFormats: [] },
  // ── Arcade ──
  { systemId: 'mame', systemName: 'Arcade (MAME)', category: 'Arcade', supportedFormats: ['zip'], warningFormats: ['7z'], unsupportedFormats: ['chd'] },
  { systemId: 'fba', systemName: 'Arcade (FinalBurn Neo)', category: 'Arcade', supportedFormats: ['zip'], warningFormats: ['7z'], unsupportedFormats: ['chd'] },
  { systemId: 'neogeo', systemName: 'Neo Geo', category: 'Arcade', supportedFormats: ['zip'], warningFormats: ['7z'], unsupportedFormats: ['chd'] },
  // ── Ordinateurs ──
  { systemId: 'pc', systemName: 'PC (DOS / Windows)', category: 'Ordinateurs', supportedFormats: ['7z', 'zip'], warningFormats: ['chd'], unsupportedFormats: [] },
  // ── Autres ──
  { systemId: 'pcengine', systemName: 'PC Engine / TurboGrafx-16', category: 'Autres', supportedFormats: ['chd', '7z', 'zip'], unsupportedFormats: [] },
  { systemId: 'atari2600', systemName: 'Atari 2600', category: 'Autres', supportedFormats: ['zip', '7z'], unsupportedFormats: ['chd'] },
];

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
});

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
    
    // Onglet Dossiers
    (document.getElementById('defaultDatFolder') as HTMLInputElement).value = currentSettings.defaultDatFolder || '';
    (document.getElementById('defaultDatabaseFolder') as HTMLInputElement).value = currentSettings.defaultDatabaseFolder || '';
    (document.getElementById('defaultRomsFolder') as HTMLInputElement).value = currentSettings.defaultRomsFolder || '';
    (document.getElementById('unmatchedRomsFolder') as HTMLInputElement).value = currentSettings.unmatchedRomsFolder || '';
    (document.getElementById('validatedRomsFolder') as HTMLInputElement).value = currentSettings.validatedRomsFolder || '';
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
      folderType = 'unmatched';
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

  const systemCompat = currentSettings.systemCompatibility || defaultSystemCompatibility;

  // Grouper par catégorie
  const categories: SystemCategory[] = ['Nintendo', 'Sega', 'Sony', 'Arcade', 'Ordinateurs', 'Autres'];
  const grouped = new Map<SystemCategory, typeof systemCompat>();
  for (const cat of categories) {
    const systems = systemCompat.filter(s => (s.category || 'Autres') === cat);
    if (systems.length > 0) {
      grouped.set(cat, systems);
    }
  }

  for (const [category, systems] of grouped) {
    const section = document.createElement('div');
    section.className = 'system-category-section';

    const catTitle = document.createElement('h4');
    catTitle.textContent = category;
    section.appendChild(catTitle);

    // Grouper par sous-catégorie au sein de la catégorie
    const subcategories = new Map<string, typeof systems>();
    for (const system of systems) {
      const subcat = system.subcategory || '';
      if (!subcategories.has(subcat)) {
        subcategories.set(subcat, []);
      }
      subcategories.get(subcat)!.push(system);
    }

    for (const [subcategory, subcatSystems] of subcategories) {
      if (subcategory) {
        const subcatTitle = document.createElement('h6');
        subcatTitle.className = 'system-subcategory-title';
        subcatTitle.textContent = subcategory;
        section.appendChild(subcatTitle);
      }

    for (const system of subcatSystems) {
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
      section.appendChild(systemDiv);
    }
    } // fin subcategories loop

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
  const enabled = (document.getElementById('cleanSourceAfterConsolidation') as HTMLInputElement).checked;
  (document.getElementById('cleanupScope') as HTMLSelectElement).disabled = !enabled;
  (document.getElementById('protectFilesForUnselectedGames') as HTMLInputElement).disabled = !enabled;
  (document.getElementById('moveUnmatchedFiles') as HTMLInputElement).disabled = !enabled;
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
      
      // Dossiers
      defaultDatFolder: (document.getElementById('defaultDatFolder') as HTMLInputElement).value,
      defaultDatabaseFolder: (document.getElementById('defaultDatabaseFolder') as HTMLInputElement).value,
      defaultRomsFolder: (document.getElementById('defaultRomsFolder') as HTMLInputElement).value,
      unmatchedRomsFolder: (document.getElementById('unmatchedRomsFolder') as HTMLInputElement).value,
      validatedRomsFolder: (document.getElementById('validatedRomsFolder') as HTMLInputElement).value,
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
      systemCompatibility
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
