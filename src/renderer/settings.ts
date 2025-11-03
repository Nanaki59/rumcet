// src/renderer/settings.ts

// Utiliser les types depuis global.d.ts
type ArchiveFormat = '7z' | 'zip' | 'chd';
type RarTool = '7zip' | 'winrar' | 'unrar';

interface SystemCompatibility {
  systemId: string;
  systemName: string;
  supportedFormats: ArchiveFormat[];
  warningFormats?: ArchiveFormat[];
}

interface AppSettings {
  defaultDatFolder: string;
  defaultDatabaseFolder: string;
  defaultRomsFolder: string;
  unmatchedRomsFolder: string;
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

// Systèmes par défaut
const defaultSystemCompatibility: SystemCompatibility[] = [
  {
    systemId: 'psx',
    systemName: 'PlayStation (PSX)',
    supportedFormats: ['chd', '7z', 'zip'],
    warningFormats: []
  },
  {
    systemId: 'ps2',
    systemName: 'PlayStation 2 (PS2)',
    supportedFormats: ['chd', '7z'],
    warningFormats: ['zip']
  },
  {
    systemId: 'psp',
    systemName: 'PlayStation Portable (PSP)',
    supportedFormats: ['chd', '7z', 'zip'],
    warningFormats: []
  },
  {
    systemId: 'dreamcast',
    systemName: 'Sega Dreamcast',
    supportedFormats: ['chd', '7z'],
    warningFormats: ['zip']
  },
  {
    systemId: 'saturn',
    systemName: 'Sega Saturn',
    supportedFormats: ['chd', '7z'],
    warningFormats: []
  },
  {
    systemId: 'segacd',
    systemName: 'Sega CD / Mega CD',
    supportedFormats: ['chd', '7z'],
    warningFormats: []
  },
  {
    systemId: 'n64',
    systemName: 'Nintendo 64',
    supportedFormats: ['7z', 'zip'],
    warningFormats: []
  },
  {
    systemId: 'gcn',
    systemName: 'Nintendo GameCube',
    supportedFormats: ['7z'],
    warningFormats: ['zip']
  },
  {
    systemId: 'nds',
    systemName: 'Nintendo DS',
    supportedFormats: ['7z', 'zip'],
    warningFormats: []
  },
  {
    systemId: 'snes',
    systemName: 'Super Nintendo (SNES)',
    supportedFormats: ['7z', 'zip'],
    warningFormats: []
  },
  {
    systemId: 'nes',
    systemName: 'Nintendo Entertainment System (NES)',
    supportedFormats: ['7z', 'zip'],
    warningFormats: []
  },
  {
    systemId: 'genesis',
    systemName: 'Sega Genesis / Mega Drive',
    supportedFormats: ['7z', 'zip'],
    warningFormats: []
  },
  {
    systemId: 'mastersystem',
    systemName: 'Sega Master System',
    supportedFormats: ['7z', 'zip'],
    warningFormats: []
  },
  {
    systemId: 'gamegear',
    systemName: 'Sega Game Gear',
    supportedFormats: ['7z', 'zip'],
    warningFormats: []
  },
  {
    systemId: 'gba',
    systemName: 'Game Boy Advance',
    supportedFormats: ['7z', 'zip'],
    warningFormats: []
  },
  {
    systemId: 'gbc',
    systemName: 'Game Boy Color',
    supportedFormats: ['7z', 'zip'],
    warningFormats: []
  },
  {
    systemId: 'gb',
    systemName: 'Game Boy',
    supportedFormats: ['7z', 'zip'],
    warningFormats: []
  },
  {
    systemId: 'arcade',
    systemName: 'Arcade (MAME)',
    supportedFormats: ['zip', '7z'],
    warningFormats: []
  }
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
  
  systemCompat.forEach(system => {
    const systemDiv = document.createElement('div');
    systemDiv.className = 'system-compatibility-item';
    
    const title = document.createElement('h5');
    title.textContent = system.systemName;
    systemDiv.appendChild(title);
    
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
      
      if (system.warningFormats?.includes(format)) {
        const warning = document.createElement('span');
        warning.textContent = ' ⚠️';
        warning.title = 'Fonctionne mais peut avoir des limitations';
        formatText.appendChild(warning);
      }
      
      label.appendChild(checkbox);
      label.appendChild(formatText);
      checkboxesDiv.appendChild(label);
    });
    
    systemDiv.appendChild(checkboxesDiv);
    container.appendChild(systemDiv);
  });
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
    
    systemItems.forEach((item, index) => {
      const systemId = defaultSystemCompatibility[index].systemId;
      const systemName = defaultSystemCompatibility[index].systemName;
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
        supportedFormats,
        warningFormats: defaultSystemCompatibility[index].warningFormats
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
