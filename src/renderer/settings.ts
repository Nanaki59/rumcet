// src/renderer/settings.ts

import { SYSTEMS, type SystemDefinition } from '../config/systems.js';
import { initI18n, refreshTranslations, t } from './i18n.js';
import { setupConsoleCapture } from './consoleCapture.js';

// Capturer les console.* de cette page vers le fichier de logs dès le chargement
setupConsoleCapture();
import { renderGroupedSystems, type SortMode } from './systemListRenderer.js';
import {
  renderExtensionPicker,
  buildDefaultPickerData,
  type ExtensionPickerData,
  type ExtensionPickerSources
} from './extensionPicker.js';
// Référentiels du parseur de noms : ils alimentent les listes de priorité 1G1R,
// de sorte que les valeurs proposées soient exactement celles que le parseur produit.
import { CANONICAL_REGIONS, CANONICAL_LANGUAGES } from '../shared/romNaming/index.js';
import { makeReorderable } from './reorderable.js';

// Utiliser les types depuis global.d.ts
type ArchiveFormat = '7z' | 'zip' | 'chd';
type CleanupScope = 'used-only' | 'all-matched';
type RarTool = '7zip' | 'winrar' | 'unrar';
type ArcadeTargetSetMode = 'split' | 'non-merged' | 'merged';

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
  arcadeTargetSetMode?: ArcadeTargetSetMode;
  arcadeSeparateBios?: boolean;
  arcadeChdEmptyZip?: boolean;
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
  /** Sélection 1G1R — miroir de OneGameOneRomSettings (settingsManager.ts). */
  oneGameOneRom?: {
    enabled: boolean;
    regionPriority: string[];
    languagePriority: string[];
    languageOverRegion: boolean;
    videoPriority: string[];
    preferLatestRevision: boolean;
    fallbackToOwned: boolean;
  };
  /** Clone lists — miroir de CloneListSettings (settingsManager.ts). */
  cloneLists?: {
    sourceUrl: string;
    folder?: string;
    lastDownload?: string;
    autoApply: boolean;
    autoDownload: boolean;
  };
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
    systems?: Array<{
      systemId: string;
      subfolder?: string;
      override?: ExtensionPickerData;
    }>;
  }>;
  downloadExtensions?: string[];
  downloadSystemExtensions?: Array<{ systemId: string } & ExtensionPickerData>;
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

// Listes de priorité 1G1R. Tableaux mutés en place par le widget de priorité,
// relus tels quels au moment de la sauvegarde.
let ogorRegionPriority: string[] = [];
let ogorLanguagePriority: string[] = [];
let ogorVideoPriority: string[] = [];

/** Modes vidéo proposables. Aligné sur le type VideoMode du parseur de noms. */
const OGOR_VIDEO_MODES = ['NTSC', 'PAL', 'PAL 60Hz', 'PAL-M', 'SECAM'];

// ============================================
// INITIALISATION
// ============================================

window.addEventListener('DOMContentLoaded', async () => {
  // Traductions d'abord : le DOM statique et tous les textes dynamiques en dépendent.
  // Pas de reload au changement de langue : c'est cette fenêtre qui le déclenche via
  // la sauvegarde — un reload tuerait le flux « ✅ Enregistré ! » + fermeture différée.
  await initI18n({ onLanguageChanged: refreshTranslations });
  console.log('Loading settings...');
  await loadSettings();
  setupTabs();
  setupOneGameOneRom();

  // Bouton "Ajouter une source"
  document.getElementById('addDownloadSource')?.addEventListener('click', addDownloadSource);

  // Tri & recherche dans la compatibilité par système
  document.getElementById('systemCompatSortMode')?.addEventListener('change', renderSystemCompatibility);
  document.getElementById('systemCompatSearch')?.addEventListener('input', renderSystemCompatibility);

  // Tri & recherche dans Extensions par système (téléchargement)
  document.getElementById('downloadSysExtSortMode')?.addEventListener('change', renderDownloadSystemExtensions);
  document.getElementById('downloadSysExtSearch')?.addEventListener('input', renderDownloadSystemExtensions);
  // Mise à jour des extensions globales par défaut → rafraîchir l'affichage des rappels
  document.getElementById('downloadExtensions')?.addEventListener('input', () => {
    const val = (document.getElementById('downloadExtensions') as HTMLInputElement).value;
    currentSettings.downloadExtensions = val.split(',').map(s => s.trim().replace(/^\./, '')).filter(Boolean);
    renderDownloadSystemExtensions();
  });

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
// Idem pour l'écran "Extensions par système" (téléchargement).
const collapsedDownloadSysExtGroups = new Set<string>();

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
    console.log('Retrieving settings from the API...');
    currentSettings = await window.api.getSettings() as AppSettings;
    console.log('Settings received:', currentSettings);
    
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

    // Onglet Arcade — mode du set cible
    const arcadeMode: ArcadeTargetSetMode = currentSettings.arcadeTargetSetMode || 'split';
    const arcadeRadio = document.querySelector(
      `input[name="arcadeTargetSetMode"][value="${arcadeMode}"]`
    ) as HTMLInputElement | null;
    if (arcadeRadio) arcadeRadio.checked = true;

    // Onglet Arcade — organisation des dossiers (BIOS / CHD)
    (document.getElementById('arcadeSeparateBios') as HTMLInputElement).checked = !!currentSettings.arcadeSeparateBios;
    (document.getElementById('arcadeChdEmptyZip') as HTMLInputElement).checked = !!currentSettings.arcadeChdEmptyZip;

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

    // Onglet 1G1R — désactivé tant que l'utilisateur ne l'a pas coché.
    // Les valeurs par défaut ne servent que si la clé est absente des paramètres.
    const ogor = currentSettings.oneGameOneRom;
    (document.getElementById('ogorEnabled') as HTMLInputElement).checked = ogor?.enabled === true;
    (document.getElementById('ogorLanguageOverRegion') as HTMLInputElement).checked = ogor?.languageOverRegion === true;
    (document.getElementById('ogorPreferLatestRevision') as HTMLInputElement).checked = ogor?.preferLatestRevision !== false;
    (document.getElementById('ogorFallbackToOwned') as HTMLInputElement).checked = ogor?.fallbackToOwned !== false;
    ogorRegionPriority = [...(ogor?.regionPriority ?? ['World', 'Europe', 'USA', 'Japan'])];
    ogorLanguagePriority = [...(ogor?.languagePriority ?? ['En', 'Fr', 'Ja'])];
    ogorVideoPriority = [...(ogor?.videoPriority ?? ['PAL', 'PAL 60Hz', 'NTSC'])];
    renderOneGameOneRom();

    const cloneLists = currentSettings.cloneLists;
    (document.getElementById('cloneListSourceUrl') as HTMLInputElement).value = cloneLists?.sourceUrl || '';
    (document.getElementById('cloneListFolder') as HTMLInputElement).value = cloneLists?.folder || '';
    (document.getElementById('cloneListAutoApply') as HTMLInputElement).checked = cloneLists?.autoApply === true;
    (document.getElementById('cloneListAutoDownload') as HTMLInputElement).checked = cloneLists?.autoDownload === true;
    await showEffectiveCloneListFolder();

    // Onglet Compatibilité
    renderSystemCompatibility();

    // Onglet Téléchargement
    renderDownloadSources();
    (document.getElementById('downloadExtensions') as HTMLInputElement).value =
      (currentSettings.downloadExtensions || ['7z', 'zip', 'chd', 'rar', 'iso', 'cso', 'pbp']).join(', ');
    renderDownloadSystemExtensions();
    (document.getElementById('incompleteRomsFolder') as HTMLInputElement).value =
      currentSettings.incompleteRomsFolder || '';

    console.log('Settings loaded into the interface');
  } catch (error) {
    console.error('Error while loading settings:', error);
  }
}

// ============================================
// PARCOURIR DOSSIERS
// ============================================

async function browseFolder(fieldId: string): Promise<void> {
  console.log('Selecting a folder for:', fieldId);
  
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
    case 'cloneListFolder':
      folderType = 'clonelists';
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
    console.error('Error while selecting the folder:', error);
  }
}

// ============================================
// PARCOURIR FICHIERS (OUTILS)
// ============================================

async function browseFile(fieldId: string, fileName: string): Promise<void> {
  console.log('Selecting a file for:', fieldId);
  
  try {
    // openFileDialog peut retourner string | string[] | undefined
    const result = await window.api.openFileDialog({
      title: t('settings.dialogs.selectFile', { fileName }),
      filters: [
        { name: t('common.filterExecutables'), extensions: ['exe'] },
        { name: t('common.filterAllFiles'), extensions: ['*'] }
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
    console.error('Error while selecting the file:', error);
  }
}

// ============================================
// AUTO-DÉTECTION DES OUTILS
// ============================================

async function autoDetect7Zip(): Promise<void> {
  console.log('Auto-detecting 7-Zip...');
  
  try {
    const result = await window.api.archive.detectTools();
    if (result.sevenZip) {
      (document.getElementById('sevenZipPath') as HTMLInputElement).value = result.sevenZip;
      (currentSettings as any).sevenZipPath = result.sevenZip;
      alert(t('settings.tools.detectedAlert', { tool: '7-Zip', path: result.sevenZip }));
    } else {
      alert(t('settings.tools.notFoundAlert', { tool: '7-Zip', file: '7z.exe' }));
    }
  } catch (error) {
    console.error('Error while auto-detecting 7-Zip:', error);
    alert(t('settings.tools.detectErrorAlert', { tool: '7-Zip' }));
  }
}

async function autoDetectWinRAR(): Promise<void> {
  console.log('Auto-detecting WinRAR...');
  
  try {
    const result = await window.api.archive.detectTools();
    if (result.winrar) {
      (document.getElementById('winrarPath') as HTMLInputElement).value = result.winrar;
      (currentSettings as any).winrarPath = result.winrar;
      alert(t('settings.tools.detectedAlert', { tool: 'WinRAR', path: result.winrar }));
    } else {
      alert(t('settings.tools.notFoundAlert', { tool: 'WinRAR', file: 'Rar.exe' }));
    }
  } catch (error) {
    console.error('Error while auto-detecting WinRAR:', error);
    alert(t('settings.tools.detectErrorAlert', { tool: 'WinRAR' }));
  }
}

async function autoDetectUnRAR(): Promise<void> {
  console.log('Auto-detecting UnRAR...');
  
  try {
    const result = await window.api.archive.detectTools();
    if (result.unrar) {
      (document.getElementById('unrarPath') as HTMLInputElement).value = result.unrar;
      (currentSettings as any).unrarPath = result.unrar;
      alert(t('settings.tools.detectedAlert', { tool: 'UnRAR', path: result.unrar }));
    } else {
      alert(t('settings.tools.notFoundAlert', { tool: 'UnRAR', file: 'UnRAR.exe' }));
    }
  } catch (error) {
    console.error('Error while auto-detecting UnRAR:', error);
    alert(t('settings.tools.detectErrorAlert', { tool: 'UnRAR' }));
  }
}


// ============================================
// LISTES DE PRIORITÉ ORDONNABLES (DRAG & DROP)
// ============================================
//
// Widget générique partagé par toutes les listes ordonnées des paramètres :
// formats d'archive, outils RAR, et les trois listes de la sélection 1G1R
// (régions, langues, modes vidéo). Auparavant dupliqué à l'identique par liste.
//
// Le drag & drop est doublé de boutons ↑/↓ : le glisser-déposer seul serait
// inaccessible au clavier.

interface PriorityListSpec {
  /** id du conteneur DOM qui reçoit les items. */
  containerId: string;
  /** Lecture de l'état courant (le tableau est muté puis re-rendu). */
  getItems: () => string[];
  /** Libellé affiché pour une valeur. Par défaut, la valeur brute. */
  displayName?: (value: string) => string;
  /** Suffixe de classe CSS pour la pastille colorée (`format-<suffixe>`). */
  cssSuffix?: (value: string) => string;
  /** Si true, chaque item porte un bouton de retrait. */
  removable?: boolean;
  /**
   * Valeurs proposables à l'ajout. Celles déjà présentes sont filtrées.
   * Fournir cette fonction fait apparaître le sélecteur d'ajout sous la liste.
   */
  addableValues?: () => Array<{ value: string; label: string }>;
  /** id du `<select>` d'ajout et du bouton associé (requis si addableValues). */
  addSelectId?: string;
  addButtonId?: string;
}

const priorityLists = new Map<string, PriorityListSpec>();

/** Enregistre une liste et effectue son premier rendu. */
function registerPriorityList(spec: PriorityListSpec): void {
  priorityLists.set(spec.containerId, spec);
  renderPriorityList(spec.containerId);
}

function renderPriorityList(containerId: string): void {
  const spec = priorityLists.get(containerId);
  const container = document.getElementById(containerId);
  if (!spec || !container) return;

  const items = spec.getItems();
  container.innerHTML = '';
  const elements = items.map((value, index) =>
    container.appendChild(createPriorityItem(spec, value, index, items.length)));

  makeReorderable({
    items: elements,
    onReorder: (from, to) => movePriorityItem(containerId, from, to)
  });

  renderPriorityAddControl(spec, items);
}

function createPriorityItem(
  spec: PriorityListSpec, value: string, index: number, total: number
): HTMLElement {
  // `draggable` et l'identification de la liste sont posés par makeReorderable() :
  // l'index vit dans la fermeture du helper, plus besoin de le refléter en dataset.
  const item = document.createElement('div');
  item.className = 'format-priority-item';

  const order = document.createElement('span');
  order.className = 'format-order';
  order.textContent = `${index + 1}.`;

  const name = document.createElement('span');
  name.className = `format-name format-${spec.cssSuffix ? spec.cssSuffix(value) : value}`;
  name.textContent = spec.displayName ? spec.displayName(value) : value;

  const actions = document.createElement('div');
  actions.className = 'format-actions';

  if (index > 0) {
    const upBtn = document.createElement('button');
    upBtn.className = 'btn-icon';
    upBtn.textContent = '↑';
    upBtn.onclick = () => movePriorityItem(spec.containerId, index, index - 1);
    actions.appendChild(upBtn);
  }
  if (index < total - 1) {
    const downBtn = document.createElement('button');
    downBtn.className = 'btn-icon';
    downBtn.textContent = '↓';
    downBtn.onclick = () => movePriorityItem(spec.containerId, index, index + 1);
    actions.appendChild(downBtn);
  }
  if (spec.removable) {
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-icon';
    delBtn.textContent = '✕';
    delBtn.title = t('settings.oneGameOneRom.removeEntry');
    delBtn.onclick = () => {
      spec.getItems().splice(index, 1);
      renderPriorityList(spec.containerId);
    };
    actions.appendChild(delBtn);
  }

  item.appendChild(order);
  item.appendChild(name);
  item.appendChild(actions);

  // Le glisser-déposer est câblé par makeReorderable() dans renderPriorityList(),
  // une fois tous les éléments créés.
  return item;
}

/** Repeuple le `<select>` d'ajout avec les valeurs non encore présentes. */
function renderPriorityAddControl(spec: PriorityListSpec, items: string[]): void {
  if (!spec.addableValues || !spec.addSelectId) return;
  const select = document.getElementById(spec.addSelectId) as HTMLSelectElement | null;
  if (!select) return;

  const remaining = spec.addableValues().filter(v => !items.includes(v.value));
  select.innerHTML = '';
  for (const { value, label } of remaining) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  }
  select.disabled = remaining.length === 0;

  const button = spec.addButtonId
    ? document.getElementById(spec.addButtonId) as HTMLButtonElement | null
    : null;
  if (button) button.disabled = remaining.length === 0;
}

function movePriorityItem(containerId: string, fromIndex: number, toIndex: number): void {
  const spec = priorityLists.get(containerId);
  if (!spec) return;
  const items = spec.getItems();
  const [moved] = items.splice(fromIndex, 1);
  items.splice(toIndex, 0, moved);
  renderPriorityList(containerId);
}

function getFormatDisplayName(format: ArchiveFormat): string {
  const names: Record<ArchiveFormat, string> = {
    '7z': '7-Zip (7Z)',
    'zip': 'ZIP',
    'chd': 'CHD (Compressed Hunks of Data)'
  };
  return names[format] || format.toUpperCase();
}

function getRarToolDisplayName(tool: RarTool): string {
  const names: Record<RarTool, string> = {
    '7zip': t('settings.tools.sevenZipRecommended'),
    'winrar': 'WinRAR',
    'unrar': 'UnRAR'
  };
  return names[tool] || tool.toUpperCase();
}

function renderFormatPriorityList(): void {
  registerPriorityList({
    containerId: 'formatPriorityList',
    getItems: () => currentFormatPriority,
    displayName: v => getFormatDisplayName(v as ArchiveFormat)
  });
}

function renderRarToolPriorityList(): void {
  registerPriorityList({
    containerId: 'rarToolPriorityList',
    getItems: () => currentRarToolPriority,
    displayName: v => getRarToolDisplayName(v as RarTool)
  });
}

// ============================================
// SÉLECTION 1G1R
// ============================================

/** Rend les trois listes de priorité et câble leurs sélecteurs d'ajout. */
function renderOneGameOneRom(): void {
  registerPriorityList({
    containerId: 'ogorRegionList',
    getItems: () => ogorRegionPriority,
    cssSuffix: () => 'region',
    removable: true,
    addableValues: () => CANONICAL_REGIONS.map(r => ({ value: r, label: r })),
    addSelectId: 'ogorRegionAdd',
    addButtonId: 'ogorRegionAddBtn'
  });
  registerPriorityList({
    containerId: 'ogorLanguageList',
    getItems: () => ogorLanguagePriority,
    cssSuffix: () => 'language',
    removable: true,
    addableValues: () => CANONICAL_LANGUAGES.map(l => ({ value: l, label: l })),
    addSelectId: 'ogorLanguageAdd',
    addButtonId: 'ogorLanguageAddBtn'
  });
  registerPriorityList({
    containerId: 'ogorVideoList',
    getItems: () => ogorVideoPriority,
    cssSuffix: () => 'video',
    removable: true,
    addableValues: () => OGOR_VIDEO_MODES.map(v => ({ value: v, label: v })),
    addSelectId: 'ogorVideoAdd',
    addButtonId: 'ogorVideoAddBtn'
  });
}

/** Câble les boutons d'ajout et l'interrupteur maître. Appelé une fois au démarrage. */
function setupOneGameOneRom(): void {
  const wire = (buttonId: string, selectId: string, list: string[], containerId: string) => {
    document.getElementById(buttonId)?.addEventListener('click', () => {
      const select = document.getElementById(selectId) as HTMLSelectElement | null;
      if (!select?.value) return;
      if (!list.includes(select.value)) list.push(select.value);
      renderPriorityList(containerId);
    });
  };
  wire('ogorRegionAddBtn', 'ogorRegionAdd', ogorRegionPriority, 'ogorRegionList');
  wire('ogorLanguageAddBtn', 'ogorLanguageAdd', ogorLanguagePriority, 'ogorLanguageList');
  wire('ogorVideoAddBtn', 'ogorVideoAdd', ogorVideoPriority, 'ogorVideoList');
}

/**
 * Renseigne le dossier effectif des clone lists en indication de saisie.
 * Le champ vide signifie « dossier applicatif », mais sans afficher lequel
 * l'utilisateur ne peut pas savoir où ses fichiers atterrissent.
 */
async function showEffectiveCloneListFolder(): Promise<void> {
  const input = document.getElementById('cloneListFolder') as HTMLInputElement | null;
  if (!input) return;
  try {
    const { folder } = await window.api.cloneList.listLocal();
    if (folder) input.placeholder = folder;
  } catch {
    // Handler indisponible : on laisse le champ sans indication plutôt qu'un texte faux.
  }
}

// ============================================
// COMPATIBILITÉ SYSTÈMES
// ============================================

function renderSystemCompatibility(): void {
  const container = document.getElementById('systemCompatibilityList');
  if (!container) return;

  // Map des overrides utilisateur par systemId
  const userOverrides = new Map<string, SystemCompatibility>();
  for (const ov of currentSettings.systemCompatibility ?? []) {
    userOverrides.set(ov.systemId.toLowerCase(), ov);
  }

  const sortSelect = document.getElementById('systemCompatSortMode') as HTMLSelectElement | null;
  const sortMode = (sortSelect?.value || 'type-then-manufacturer') as SortMode;
  const searchInput = document.getElementById('systemCompatSearch') as HTMLInputElement | null;
  const search = searchInput?.value || '';

  renderGroupedSystems({
    container,
    systems: SYSTEMS,
    sortMode,
    search,
    collapsed: collapsedCompatGroups,
    renderItem: (sys: SystemDefinition) => {
      const systemDiv = document.createElement('div');
      systemDiv.className = 'system-compatibility-item';
      systemDiv.dataset.systemId = sys.systemId;

      const headerDiv = document.createElement('div');
      headerDiv.className = 'system-compatibility-header';

      const title = document.createElement('h5');
      title.textContent = sys.fullname;
      headerDiv.appendChild(title);

      const resetBtn = document.createElement('button');
      resetBtn.className = 'btn-reset-system';
      resetBtn.title = t('settings.compatibility.resetSystemTitle', { system: sys.fullname });
      resetBtn.textContent = '↺';
      resetBtn.addEventListener('click', () => resetSystemCompatibility(sys.systemId));
      headerDiv.appendChild(resetBtn);

      systemDiv.appendChild(headerDiv);

      // Formats supportés (cases à cocher) — basés sur l'override utilisateur si présent, sinon registre
      const override = userOverrides.get(sys.systemId.toLowerCase());
      const supported = override?.supportedFormats ?? sys.supportedFormats;

      const checkboxesDiv = document.createElement('div');
      checkboxesDiv.className = 'format-checkboxes';

      (['7z', 'zip', 'chd'] as ArchiveFormat[]).forEach(format => {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.system = sys.systemId;
        checkbox.dataset.format = format;
        checkbox.checked = supported.includes(format);

        const formatText = document.createElement('span');
        formatText.textContent = format.toUpperCase();

        if (sys.warningFormats?.includes(format)) {
          const warning = document.createElement('span');
          warning.className = 'format-icon-warning';
          warning.textContent = ' ⚠️';
          warning.title = t('settings.compatibility.partialSupportTitle');
          formatText.appendChild(warning);
        }
        if (sys.unsupportedFormats?.includes(format)) {
          const unsupported = document.createElement('span');
          unsupported.className = 'format-icon-unsupported';
          unsupported.textContent = ' ❌';
          unsupported.title = t('settings.compatibility.unsupportedTitle');
          formatText.appendChild(unsupported);
        }

        label.appendChild(checkbox);
        label.appendChild(formatText);
        checkboxesDiv.appendChild(label);
      });

      systemDiv.appendChild(checkboxesDiv);

      // Affichage informatif des formats bruts
      if (sys.datRawFormats.length > 0 || sys.extraRawFormats.length > 0) {
        const rawInfo = document.createElement('div');
        rawInfo.className = 'raw-formats-info';

        if (sys.datRawFormats.length > 0) {
          const datLine = document.createElement('div');
          datLine.className = 'raw-formats-line';
          const datLabel = document.createElement('span');
          datLabel.className = 'raw-formats-label';
          datLabel.textContent = t('settings.compatibility.rawFormatsDat');
          datLine.appendChild(datLabel);
          for (const ext of sys.datRawFormats) {
            const tag = document.createElement('span');
            tag.className = 'raw-format-tag raw-format-dat';
            tag.textContent = '.' + ext;
            datLine.appendChild(tag);
          }
          rawInfo.appendChild(datLine);
        }

        if (sys.extraRawFormats.length > 0) {
          const extraLine = document.createElement('div');
          extraLine.className = 'raw-formats-line';
          const extraLabel = document.createElement('span');
          extraLabel.className = 'raw-formats-label';
          extraLabel.textContent = t('settings.compatibility.rawFormatsExtra');
          extraLine.appendChild(extraLabel);
          for (const ext of sys.extraRawFormats) {
            const tag = document.createElement('span');
            tag.className = 'raw-format-tag raw-format-extra';
            tag.textContent = '.' + ext;
            extraLine.appendChild(tag);
          }
          rawInfo.appendChild(extraLine);
        }

        systemDiv.appendChild(rawInfo);
      }

      return systemDiv;
    }
  });
}

/**
 * Réinitialise un seul système aux valeurs par défaut
 */
function resetSystemCompatibility(systemId: string): void {
  const defaultConfig = defaultSystemCompatibility.find(s => s.systemId === systemId);
  if (!defaultConfig) return;

  // Scopé à #systemCompatibilityList : l'onglet Téléchargement (Extensions par
  // système) réutilise la même classe .system-compatibility-item pour un widget
  // différent (tags d'extensions) — sans ce scope, querySelector pouvait cibler
  // la mauvaise carte (les deux onglets coexistent dans le DOM, juste masqués via CSS).
  const systemDiv = document.querySelector(`#systemCompatibilityList .system-compatibility-item[data-system-id="${systemId}"]`);
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
        <input type="text" class="source-name" value="${escapeHtml(source.name)}" placeholder="${escapeHtml(t('settings.download.sourceNamePlaceholder'))}" style="flex: 1; padding: 6px 10px; border: 1px solid #ced4da; border-radius: 4px; font-size: 13px;">
        <label style="display: flex; align-items: center; gap: 4px; font-size: 13px; white-space: nowrap;">
          <input type="checkbox" class="source-enabled" ${source.enabled ? 'checked' : ''}> ${escapeHtml(t('settings.download.sourceEnabled'))}
        </label>
      </div>
      <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
        <input type="text" class="source-url" value="${escapeHtml(source.baseUrl)}" placeholder="${escapeHtml(t('settings.download.sourceUrlPlaceholder'))}" style="flex: 1; padding: 6px 10px; border: 1px solid #ced4da; border-radius: 4px; font-size: 13px;">
      </div>
      <div class="source-system-overrides" style="margin-bottom: 8px;"></div>
      <div style="display: flex; gap: 6px; justify-content: flex-end;">
        <button class="btn-secondary source-add-system" data-index="${index}" style="font-size: 12px; padding: 4px 8px;">${escapeHtml(t('settings.download.addSystem'))}</button>
        <button class="btn-secondary source-move-up" data-index="${index}" style="font-size: 12px; padding: 4px 8px;" ${index === 0 ? 'disabled' : ''}>&#8593;</button>
        <button class="btn-secondary source-move-down" data-index="${index}" style="font-size: 12px; padding: 4px 8px;" ${index === sources.length - 1 ? 'disabled' : ''}>&#8595;</button>
        <button class="btn-danger source-delete" data-index="${index}" style="font-size: 12px; padding: 4px 8px;">&#10005;</button>
      </div>
    `;

    // Rendu dynamique des systèmes de la source (DOM, pas innerHTML car listeners)
    const overridesDiv = item.querySelector('.source-system-overrides') as HTMLElement;
    renderSourceSystems(source.systems || [], index, overridesDiv);

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
  // (Les boutons de suppression de système par source sont attachés directement
  // dans renderSourceSystems, qui crée chaque ligne avec son handler.)
}

/**
 * Rendu de la liste des systèmes associés à une source.
 * Pour chaque système :
 *  - nom + bouton ✕ supprimer
 *  - sous-dossier
 *  - case "Surcharger les extensions" : si cochée, expose un picker propre à ce
 *    couple source × système. Sinon : message indiquant que la résolution globale s'applique.
 */
function renderSourceSystems(
  sourceSystems: Array<{ systemId: string; subfolder?: string; override?: ExtensionPickerData }>,
  sourceIndex: number,
  container: HTMLElement
): void {
  container.innerHTML = '';
  if (sourceSystems.length === 0) return;

  for (const entry of sourceSystems) {
    const sys = SYSTEMS.find(s => s.systemId === entry.systemId);
    const displayName = sys?.fullname || entry.systemId;

    const row = document.createElement('div');
    row.className = 'source-system-row';
    row.dataset.systemId = entry.systemId;
    row.style.cssText = 'border: 1px dashed #dee2e6; border-radius: 4px; padding: 8px; margin-top: 6px; background: #fff;';

    // Ligne 1 : nom + bouton supprimer
    const titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex; align-items:center; gap:8px; margin-bottom:6px;';
    const name = document.createElement('span');
    name.style.cssText = 'font-size:13px; color:#2c3e50; font-weight:600; flex:1;';
    name.textContent = displayName;
    titleRow.appendChild(name);
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-danger';
    removeBtn.style.cssText = 'font-size:11px; padding:2px 6px;';
    removeBtn.innerHTML = '&#10005;';
    removeBtn.title = t('settings.download.removeSystemTitle', { system: displayName });
    removeBtn.addEventListener('click', () => removeSystemFromSource(sourceIndex, entry.systemId));
    titleRow.appendChild(removeBtn);
    row.appendChild(titleRow);

    // Ligne 2 : sous-dossier sur la source
    const subfolderRow = document.createElement('div');
    subfolderRow.style.cssText = 'display:flex; align-items:center; gap:6px; margin-bottom:6px;';
    const subfolderLabel = document.createElement('span');
    subfolderLabel.style.cssText = 'font-size:12px; color:#7f8c8d; min-width:120px;';
    subfolderLabel.textContent = t('settings.download.subfolder');
    const subfolderInput = document.createElement('input');
    subfolderInput.type = 'text';
    subfolderInput.className = 'source-system-subfolder';
    subfolderInput.dataset.sourceIndex = String(sourceIndex);
    subfolderInput.dataset.systemId = entry.systemId;
    subfolderInput.placeholder = t('settings.download.subfolderPlaceholder');
    subfolderInput.value = entry.subfolder || '';
    subfolderInput.style.cssText = 'flex:1; padding:4px 8px; border:1px solid #ced4da; border-radius:4px; font-size:12px;';
    subfolderRow.appendChild(subfolderLabel);
    subfolderRow.appendChild(subfolderInput);
    row.appendChild(subfolderRow);

    // Ligne 3 : case "Surcharger les extensions"
    const overrideRow = document.createElement('div');
    overrideRow.style.cssText = 'display:flex; align-items:center; gap:6px; margin-bottom:6px;';
    const overrideLabel = document.createElement('label');
    overrideLabel.style.cssText = 'display:flex; align-items:center; gap:4px; font-size:12px; color:#2c3e50; cursor:pointer;';
    const overrideCb = document.createElement('input');
    overrideCb.type = 'checkbox';
    overrideCb.checked = !!entry.override;
    overrideLabel.appendChild(overrideCb);
    const overrideText = document.createElement('span');
    overrideText.textContent = t('settings.download.overrideExtensions');
    overrideLabel.appendChild(overrideText);
    overrideRow.appendChild(overrideLabel);
    row.appendChild(overrideRow);

    // Bloc picker (visible uniquement si surcharge cochée), OU message "résolution globale"
    const pickerWrapper = document.createElement('div');
    row.appendChild(pickerWrapper);

    const renderPickerArea = () => {
      pickerWrapper.innerHTML = '';
      if (!overrideCb.checked) {
        const info = document.createElement('div');
        info.style.cssText = 'font-size:11px; color:#7f8c8d; padding:4px 0 0 6px; font-style:italic;';
        info.textContent = t('settings.download.globalResolutionInfo');
        pickerWrapper.appendChild(info);
        return;
      }
      if (!sys) {
        const info = document.createElement('div');
        info.style.cssText = 'font-size:11px; color:#e67e22; padding:4px 0 0 6px;';
        info.textContent = t('settings.download.unknownSystem');
        pickerWrapper.appendChild(info);
        return;
      }
      // Initialiser l'override si nécessaire (depuis la résolution globale)
      if (!entry.override) {
        const global = currentSettings.downloadSystemExtensions?.find(e => e.systemId === entry.systemId);
        entry.override = global
          ? { activeExtensions: [...global.activeExtensions] }
          : buildDefaultPickerData(buildPickerSources(sys));
      }
      renderExtensionPicker({
        container: pickerWrapper,
        data: entry.override,
        sources: buildPickerSources(sys),
        onChange: (newData) => {
          entry.override = newData;
          renderPickerArea();
        },
        onReset: () => {
          entry.override = buildDefaultPickerData(buildPickerSources(sys));
          renderPickerArea();
        }
      });
    };
    overrideCb.addEventListener('change', () => {
      if (overrideCb.checked) {
        // sera initialisé par renderPickerArea
      } else {
        delete entry.override;
      }
      renderPickerArea();
    });
    renderPickerArea();

    container.appendChild(row);
  }
}

function removeSystemFromSource(sourceIndex: number, systemId: string): void {
  if (!currentSettings?.downloadSources) return;
  syncDownloadSourcesFromDom();
  const source = currentSettings.downloadSources[sourceIndex];
  if (!source?.systems) return;
  source.systems = source.systems.filter(s => s.systemId !== systemId);
  renderDownloadSources();
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

/**
 * Ouvre une modale de sélection système (parmi ceux non encore associés à cette source).
 * Au clic sur "Valider", ajoute le système à la source avec des valeurs par défaut.
 */
function addSystemOverrideToSource(sourceIndex: number): void {
  if (!currentSettings?.downloadSources) return;
  syncDownloadSourcesFromDom();
  const source = currentSettings.downloadSources[sourceIndex];
  if (!source) return;
  if (!source.systems) source.systems = [];

  // Systèmes non encore associés
  const existingIds = new Set(source.systems.map(s => s.systemId));
  const available = SYSTEMS.filter(s => !existingIds.has(s.systemId));
  if (available.length === 0) {
    alert(t('settings.download.allSystemsUsed'));
    return;
  }

  // Modale simple : un dropdown groupé par manufacturer
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:9999; display:flex; align-items:center; justify-content:center;';
  const dialog = document.createElement('div');
  dialog.style.cssText = 'background:#fff; border-radius:8px; padding:20px; width:90%; max-width:480px; box-shadow:0 8px 32px rgba(0,0,0,0.25);';
  dialog.innerHTML = `
    <h3 style="margin:0 0 12px; color:#2c3e50;">${escapeHtml(t('settings.download.addSystemTitle'))}</h3>
    <p style="margin:0 0 12px; color:#7f8c8d; font-size:13px;">${escapeHtml(t('settings.download.addSystemDescription'))}</p>
    <select id="source-add-system-select" size="12" style="width:100%; padding:6px; border:1px solid #bdc3c7; border-radius:4px; font-size:13px; margin-bottom:12px;"></select>
    <div style="display:flex; justify-content:flex-end; gap:8px;">
      <button class="btn-secondary" id="source-add-system-cancel">${escapeHtml(t('common.cancel'))}</button>
      <button class="btn-primary" id="source-add-system-ok" disabled>${escapeHtml(t('common.validate'))}</button>
    </div>
  `;
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const select = dialog.querySelector('#source-add-system-select') as HTMLSelectElement;
  const okBtn = dialog.querySelector('#source-add-system-ok') as HTMLButtonElement;
  const cancelBtn = dialog.querySelector('#source-add-system-cancel') as HTMLButtonElement;

  // Optgroups par manufacturer triés alphabétiquement
  const byManu = new Map<string, typeof available>();
  for (const sys of available) {
    const m = sys.manufacturer || t('common.others');
    if (!byManu.has(m)) byManu.set(m, []);
    byManu.get(m)!.push(sys);
  }
  const sortedManu = [...byManu.keys()].sort((a, b) => a.localeCompare(b));
  for (const m of sortedManu) {
    const group = document.createElement('optgroup');
    group.label = m;
    for (const sys of byManu.get(m)!.sort((a, b) => a.fullname.localeCompare(b.fullname))) {
      const opt = document.createElement('option');
      opt.value = sys.systemId;
      opt.textContent = sys.fullname;
      group.appendChild(opt);
    }
    select.appendChild(group);
  }

  select.addEventListener('change', () => { okBtn.disabled = !select.value; });
  cancelBtn.addEventListener('click', () => overlay.remove());
  okBtn.addEventListener('click', () => {
    if (!select.value) return;
    source.systems!.push({ systemId: select.value, subfolder: '' });
    overlay.remove();
    renderDownloadSources();
  });
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

    // Synchroniser les systèmes (subfolder + override extensions)
    if (!source.systems) source.systems = [];
    const sysRows = item.querySelectorAll('.source-system-row');
    sysRows.forEach(row => {
      const systemId = (row as HTMLElement).dataset.systemId!;
      const entry = source.systems!.find(s => s.systemId === systemId);
      if (!entry) return;
      const subfolder = (row.querySelector('.source-system-subfolder') as HTMLInputElement)?.value.trim() || '';
      entry.subfolder = subfolder || undefined;
      // L'override est maintenu en direct dans `entry.override` par le picker (onChange).
      // Rien à synchroniser depuis le DOM ici — la case "Surcharger" l'a déjà attaché/supprimé.
    });
  });
}

function collectDownloadSources(): AppSettings['downloadSources'] {
  syncDownloadSourcesFromDom();
  return currentSettings?.downloadSources || [];
}

// ============================================
// TÉLÉCHARGEMENT — EXTENSIONS PAR SYSTÈME
// ============================================

/** Construit les sources d'extensions disponibles pour un système donné. */
function buildPickerSources(sys: SystemDefinition): ExtensionPickerSources {
  return {
    global: currentSettings.downloadExtensions || [],
    sysCompressed: [...sys.supportedFormats, ...sys.warningFormats],
    datRaw: sys.datRawFormats,
    extraRaw: sys.extraRawFormats
  };
}

/** Récupère (ou initialise) la config picker pour un système global. */
function getDownloadSysExtData(sys: SystemDefinition): ExtensionPickerData {
  const all = currentSettings.downloadSystemExtensions || [];
  const found = all.find(e => e.systemId === sys.systemId);
  if (found) {
    return {
      activeExtensions: [...found.activeExtensions]
    };
  }
  return buildDefaultPickerData(buildPickerSources(sys));
}

function setDownloadSysExtData(systemId: string, data: ExtensionPickerData): void {
  if (!currentSettings.downloadSystemExtensions) currentSettings.downloadSystemExtensions = [];
  const idx = currentSettings.downloadSystemExtensions.findIndex(e => e.systemId === systemId);
  const entry = { systemId, ...data };
  if (idx >= 0) currentSettings.downloadSystemExtensions[idx] = entry;
  else currentSettings.downloadSystemExtensions.push(entry);
}

function renderDownloadSystemExtensions(): void {
  const container = document.getElementById('downloadSystemExtensionsList');
  if (!container) return;

  const sortSelect = document.getElementById('downloadSysExtSortMode') as HTMLSelectElement | null;
  const sortMode = (sortSelect?.value || 'type-then-manufacturer') as SortMode;
  const searchInput = document.getElementById('downloadSysExtSearch') as HTMLInputElement | null;
  const search = searchInput?.value || '';

  renderGroupedSystems({
    container,
    systems: SYSTEMS,
    sortMode,
    search,
    collapsed: collapsedDownloadSysExtGroups,
    renderItem: (sys: SystemDefinition) => {
      const card = document.createElement('div');
      card.className = 'system-compatibility-item';
      card.dataset.systemId = sys.systemId;

      // Header : nom + bouton reset (le bouton ↺ sera dans le picker lui-même)
      const headerDiv = document.createElement('div');
      headerDiv.className = 'system-compatibility-header';
      const title = document.createElement('h5');
      title.textContent = sys.fullname;
      headerDiv.appendChild(title);
      card.appendChild(headerDiv);

      // Container du picker
      const pickerDiv = document.createElement('div');
      card.appendChild(pickerDiv);

      const data = getDownloadSysExtData(sys);
      const sources = buildPickerSources(sys);

      const renderHere = () => {
        renderExtensionPicker({
          container: pickerDiv,
          data,
          sources,
          onChange: (newData) => {
            setDownloadSysExtData(sys.systemId, newData);
            renderHere();
          },
          onReset: () => {
            const fresh = buildDefaultPickerData(sources);
            setDownloadSysExtData(sys.systemId, fresh);
            renderDownloadSystemExtensions();
          }
        });
      };
      renderHere();
      return card;
    }
  });
}

/** Réinitialise tous les systèmes aux valeurs par défaut (toutes les extensions sources actives). */
function resetAllDownloadSystemExtensions(): void {
  currentSettings.downloadSystemExtensions = SYSTEMS.map(s => ({
    systemId: s.systemId,
    ...buildDefaultPickerData(buildPickerSources(s))
  }));
  renderDownloadSystemExtensions();
}
(window as any).resetAllDownloadSystemExtensions = resetAllDownloadSystemExtensions;

/** Collecte la config par système depuis l'état édité en mémoire (déjà tenu à jour par les listeners). */
function collectDownloadSystemExtensions(): AppSettings['downloadSystemExtensions'] {
  return (currentSettings.downloadSystemExtensions || []).map(e => ({ ...e }));
}

// ============================================
// SAUVEGARDE
// ============================================

async function saveSettings(): Promise<void> {
  try {
    console.log('Saving settings...');
    
    // Collecter la compatibilité système.
    // Scopé à #systemCompatibilityList : sans ce scope, cette requête récupérait
    // AUSSI les cartes de l'onglet Téléchargement (Extensions par système), qui
    // réutilisent la même classe .system-compatibility-item pour un widget différent
    // (tags d'extensions, sans cases 7z/zip/chd). Résultat : un doublon par système
    // était poussé dans systemCompatibility à chaque sauvegarde, avec des formats
    // vides pour la copie fantôme — corrompant systemCompatibility en mémoire jusqu'au
    // prochain redémarrage (où le dédoublonnage au chargement rattrapait le coup).
    const systemCompatibility: SystemCompatibility[] = [];
    const systemItems = document.querySelectorAll('#systemCompatibilityList .system-compatibility-item');

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

      // Arcade — mode du set cible (MAME uniquement, ignoré pour les autres systèmes)
      arcadeTargetSetMode: ((document.querySelector('input[name="arcadeTargetSetMode"]:checked') as HTMLInputElement | null)?.value as ArcadeTargetSetMode) || 'split',
      arcadeSeparateBios: (document.getElementById('arcadeSeparateBios') as HTMLInputElement).checked,
      arcadeChdEmptyZip: (document.getElementById('arcadeChdEmptyZip') as HTMLInputElement).checked,

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

      // Sélection 1G1R
      oneGameOneRom: {
        enabled: (document.getElementById('ogorEnabled') as HTMLInputElement).checked,
        regionPriority: [...ogorRegionPriority],
        languagePriority: [...ogorLanguagePriority],
        languageOverRegion: (document.getElementById('ogorLanguageOverRegion') as HTMLInputElement).checked,
        videoPriority: [...ogorVideoPriority],
        preferLatestRevision: (document.getElementById('ogorPreferLatestRevision') as HTMLInputElement).checked,
        fallbackToOwned: (document.getElementById('ogorFallbackToOwned') as HTMLInputElement).checked
      },

      // Clone lists — lastDownload est piloté par le main process, pas par cet écran
      cloneLists: {
        sourceUrl: (document.getElementById('cloneListSourceUrl') as HTMLInputElement).value.trim(),
        folder: (document.getElementById('cloneListFolder') as HTMLInputElement).value.trim(),
        lastDownload: currentSettings.cloneLists?.lastDownload,
        autoApply: (document.getElementById('cloneListAutoApply') as HTMLInputElement).checked,
        autoDownload: (document.getElementById('cloneListAutoDownload') as HTMLInputElement).checked
      },

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

    console.log('New settings to save:', newSettings);

    await window.api.updateSettings(newSettings);
    console.log('Settings saved successfully');
    
    const status = document.getElementById('save-status');
    if (status) {
      status.textContent = t('settings.savedStatus');
      setTimeout(() => {
        status.textContent = '';
      }, 2000);
    }

    setTimeout(() => {
      window.close();
    }, 1000);
  } catch (error) {
    console.error('Error while saving:', error);
    alert(t('settings.saveError', { error: (error as Error).message }));
  }
}

// ============================================
// BOUTONS
// ============================================

function cancel(): void {
  window.close();
}

async function resetToDefaults(): Promise<void> {
  if (confirm(t('settings.resetConfirm'))) {
    try {
      await window.api.resetSettings();
      await loadSettings();
      alert(t('settings.resetDone'));
    } catch (error) {
      console.error('Error while resetting:', error);
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
