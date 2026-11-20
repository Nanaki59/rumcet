// src/renderer/settings.ts

import { SYSTEMS, getSystemsOverlay, getSystemById, type SystemDefinition } from '../config/systems.js';
import { applyCompatRule, compatEntryForRule, isCompatRule } from '../shared/compatRules.js';
import type { ChdmanStatus, ConsolidationProfile, ProfileSettings } from '../types/global.js';
import { compareMameVersions } from '../shared/mameVersion.js';
import { initI18n, refreshTranslations, t, getLanguage } from './i18n.js';
import { setupConsoleCapture } from './consoleCapture.js';
import { initHelpTips } from './helpTip.js';

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
import { CANONICAL_REGIONS, CANONICAL_LANGUAGES, languageDisplayName } from '../shared/romNaming/index.js';
import { registerPriorityList } from './priorityList.js';
import { escapeHtml } from './htmlEscape.js';
import { initSystems } from './systemsInit.js';
import { openSystemsUpdateModal } from './systemsUpdateModal.js';

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
  moveUnmatchedFiles: boolean;
  unmatchedInReadOnlyArchives: 'repack' | 'move';
  autoSelectNewGames: boolean;
  arcadeTargetSetMode?: ArcadeTargetSetMode;
  arcadeSeparateBios?: boolean;
  arcadeChdEmptyZip?: boolean;
  generateM3u?: boolean;
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
  chdmanVersion?: string;
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
    autoUpdate: boolean;
    etags?: Record<string, string>;
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

let currentFormatPriority: ArchiveFormat[] = ['chd', '7z', 'zip'];
let currentRarToolPriority: RarTool[] = ['7zip', 'winrar', 'unrar'];
/** Paramètres globaux (les clés de profil y reflètent le profil courant ; on ne les lit pas ici). */
let currentSettings: AppSettings;

// Profils : copies de travail, enregistrées toutes ensemble par « Enregistrer ».
// La liste déroulante choisit le profil ÉDITÉ ; le profil courant (utilisé par la
// consolidation) se choisit dans la fenêtre principale.
let profileDrafts: ConsolidationProfile[] = [];
let activeProfileId = '';
let editedProfileId = '';

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
  initHelpTips();
  // Registre des systèmes (surcharge Recalbox éventuelle) avant tout rendu qui le lit
  await initSystems({ onUpdated: refreshSystemsViews });
  console.log('Loading settings...');
  await loadSettings();
  setupTabs();
  setupSystemsUpdate();
  setupChdmanVersion();

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

  // Réagir au changement de la checkbox "Déplacer les fichiers non matchés" pour l'avertissement
  document.getElementById('moveUnmatchedFiles')?.addEventListener('change', updateUnmatchedFolderEnabled);
  // Rappel du dossier non matchés (onglet Nettoyage) : suit les champs de l'onglet Dossiers
  document.getElementById('unmatchedRomsFolder')?.addEventListener('input', updateUnmatchedFolderReminder);
  document.getElementById('validatedRomsMultiSystem')?.addEventListener('change', updateUnmatchedFolderReminder);
  document.getElementById('generateM3u')?.addEventListener('change', updateM3uNotices);

  // Liens vers un autre onglet ("aller aux paramètres de nettoyage", "onglet Dossiers")
  document.getElementById('unmatchedGoToCleanup')?.addEventListener('click', (e) => {
    e.preventDefault();
    goToTab('cleanup');
  });
  // Délégation : ces liens vivent dans des textes data-i18n-html, recréés à chaque traduction
  document.addEventListener('click', (e) => {
    const link = (e.target as HTMLElement).closest<HTMLElement>('[data-goto-tab]');
    if (!link) return;
    e.preventDefault();
    goToTab(link.dataset.gotoTab!);
  });

  setupProfiles();
});

function goToTab(tabId: string): void {
  (document.querySelector(`.tab-button[data-tab="${tabId}"]`) as HTMLElement | null)?.click();
}

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

  // Onglet d'arrivée demandé à l'ouverture (?tab=archives, bouton 🔧 de la fenêtre principale)
  const requestedTab = new URLSearchParams(window.location.search).get('tab');
  if (requestedTab) {
    document.querySelector<HTMLButtonElement>(`.tab-button[data-tab="${CSS.escape(requestedTab)}"]`)?.click();
  }
}

// ============================================
// CHARGEMENT DES PARAMÈTRES
// ============================================

async function loadSettings(): Promise<void> {
  try {
    console.log('Retrieving settings from the API...');
    currentSettings = await window.api.getSettings() as AppSettings;
    const state = await window.api.profiles.list();
    profileDrafts = state.profiles;
    activeProfileId = state.activeProfileId;
    editedProfileId = activeProfileId;
    console.log('Settings received:', currentSettings);

    await fillGlobal();
    renderProfileSelect();
    fillProfile();

    console.log('Settings loaded into the interface');
  } catch (error) {
    console.error('Error while loading settings:', error);
  }
}

/** Remplit les onglets globaux (identiques pour tous les profils). */
async function fillGlobal(): Promise<void> {
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
  (document.getElementById('validatedRomsFolder') as HTMLInputElement).value = currentSettings.validatedRomsFolder || '';
  (document.getElementById('validatedRomsMultiSystem') as HTMLInputElement).checked = !!currentSettings.validatedRomsMultiSystem;
  updateUnmatchedFolderReminder();
  (document.getElementById('tempExtractionFolder') as HTMLInputElement).value = currentSettings.tempExtractionFolder || '';

  // Onglet Outils externes
  (document.getElementById('sevenZipPath') as HTMLInputElement).value = currentSettings.sevenZipPath || '';
  (document.getElementById('winrarPath') as HTMLInputElement).value = currentSettings.winrarPath || '';
  (document.getElementById('unrarPath') as HTMLInputElement).value = currentSettings.unrarPath || '';
  (document.getElementById('chdmanPath') as HTMLInputElement).value = currentSettings.chdmanPath || '';

  if (currentSettings.rarToolPriority && Array.isArray(currentSettings.rarToolPriority)) {
    currentRarToolPriority = currentSettings.rarToolPriority;
  }
  renderRarToolPriorityList();

  // Onglet Clone lists
  const cloneLists = currentSettings.cloneLists;
  (document.getElementById('cloneListSourceUrl') as HTMLInputElement).value = cloneLists?.sourceUrl || '';
  (document.getElementById('cloneListFolder') as HTMLInputElement).value = cloneLists?.folder || '';
  (document.getElementById('cloneListAutoUpdate') as HTMLInputElement).checked = cloneLists?.autoUpdate !== false;
  await showEffectiveCloneListFolder();

  // Onglet Téléchargement
  renderDownloadSources();
  (document.getElementById('downloadExtensions') as HTMLInputElement).value =
    (currentSettings.downloadExtensions || ['7z', 'zip', 'chd', 'rar', 'iso', 'cso', 'pbp']).join(', ');
  renderDownloadSystemExtensions();
  (document.getElementById('incompleteRomsFolder') as HTMLInputElement).value =
    currentSettings.incompleteRomsFolder || '';
}

/** Remplit les onglets du profil édité (Compression, Compatibilité, Nettoyage, Arcade, 1G1R). */
function fillProfile(): void {
  const profile = getEditedProfile();
  const settings = profile.settings;

  // Onglet Nettoyage
  (document.getElementById('cleanSourceAfterConsolidation') as HTMLInputElement).checked = settings.cleanSourceAfterConsolidation !== undefined ? settings.cleanSourceAfterConsolidation : true;
  (document.getElementById('cleanupScope') as HTMLSelectElement).value = settings.cleanupScope || 'used-only';
  (document.getElementById('protectFilesForUnselectedGames') as HTMLInputElement).checked = settings.protectFilesForUnselectedGames !== undefined ? settings.protectFilesForUnselectedGames : true;
  (document.getElementById('moveUnmatchedFiles') as HTMLInputElement).checked = settings.moveUnmatchedFiles !== false;
  (document.getElementById('unmatchedInReadOnlyArchives') as HTMLSelectElement).value = settings.unmatchedInReadOnlyArchives === 'move' ? 'move' : 'repack';
  toggleCleanupOptions();

  // Onglet Arcade — mode du set cible
  const arcadeMode: ArcadeTargetSetMode = settings.arcadeTargetSetMode || 'split';
  const arcadeRadio = document.querySelector(
    `input[name="arcadeTargetSetMode"][value="${arcadeMode}"]`
  ) as HTMLInputElement | null;
  if (arcadeRadio) arcadeRadio.checked = true;

  // Onglet Arcade — organisation des dossiers (BIOS / CHD)
  (document.getElementById('arcadeSeparateBios') as HTMLInputElement).checked = !!settings.arcadeSeparateBios;
  (document.getElementById('arcadeChdEmptyZip') as HTMLInputElement).checked = !!settings.arcadeChdEmptyZip;

  // Onglet Multi-disques
  (document.getElementById('generateM3u') as HTMLInputElement).checked = !!settings.generateM3u;
  updateM3uNotices();

  // Onglet Archives
  (document.getElementById('compressionLevel') as HTMLSelectElement).value = settings.compressionLevel || 'normal';
  (document.getElementById('recreateArchivesIfNeeded') as HTMLInputElement).checked = settings.recreateArchivesIfNeeded || false;
  (document.getElementById('useBestCompression') as HTMLInputElement).checked = settings.useBestCompression || false;
  (document.getElementById('solidArchive') as HTMLInputElement).checked = settings.solidArchive !== undefined ? settings.solidArchive : true;
  (document.getElementById('multithreading') as HTMLInputElement).checked = settings.multithreading !== undefined ? settings.multithreading : true;

  toggleBestCompressionWarning((document.getElementById('useBestCompression') as HTMLInputElement).checked);

  // Copie : le widget de priorité mute le tableau en place
  currentFormatPriority = Array.isArray(settings.archiveFormatPriority)
    ? [...settings.archiveFormatPriority]
    : ['chd', '7z', 'zip'];
  renderFormatPriorityList();

  // Onglet 1G1R — désactivé tant que l'utilisateur ne l'a pas coché.
  // Les valeurs par défaut ne servent que si la clé est absente des paramètres.
  const ogor = settings.oneGameOneRom;
  (document.getElementById('ogorEnabled') as HTMLInputElement).checked = ogor?.enabled === true;
  (document.getElementById('ogorLanguageOverRegion') as HTMLInputElement).checked = ogor?.languageOverRegion === true;
  (document.getElementById('ogorPreferLatestRevision') as HTMLInputElement).checked = ogor?.preferLatestRevision !== false;
  (document.getElementById('ogorFallbackToOwned') as HTMLInputElement).checked = ogor?.fallbackToOwned !== false;
  ogorRegionPriority = [...(ogor?.regionPriority ?? ['World', 'Europe', 'USA', 'Japan'])];
  ogorLanguagePriority = [...(ogor?.languagePriority ?? ['En', 'Fr', 'Ja'])];
  ogorVideoPriority = [...(ogor?.videoPriority ?? ['PAL', 'PAL 60Hz', 'NTSC'])];
  renderOneGameOneRom();

  // Onglet Compatibilité
  const ruleSelect = document.getElementById('compatRuleSelect') as HTMLSelectElement | null;
  if (ruleSelect && profile.compatRule) ruleSelect.value = profile.compatRule;
  renderCompatRuleInfo();
  renderSystemCompatibility();

  renderProfileContext();
}

/**
 * Relit les onglets du profil dans sa copie de travail. La compatibilité par
 * système est déjà tenue à jour en mémoire par les cases à cocher.
 */
function readProfileIntoDraft(): void {
  const profile = getEditedProfile();
  profile.settings = {
    ...profile.settings,

    // Nettoyage
    cleanSourceAfterConsolidation: (document.getElementById('cleanSourceAfterConsolidation') as HTMLInputElement).checked,
    cleanupScope: (document.getElementById('cleanupScope') as HTMLSelectElement).value as CleanupScope,
    protectFilesForUnselectedGames: (document.getElementById('protectFilesForUnselectedGames') as HTMLInputElement).checked,
    moveUnmatchedFiles: (document.getElementById('moveUnmatchedFiles') as HTMLInputElement).checked,
    unmatchedInReadOnlyArchives: (document.getElementById('unmatchedInReadOnlyArchives') as HTMLSelectElement).value === 'move' ? 'move' : 'repack',

    // Arcade — mode du set cible (MAME uniquement, ignoré pour les autres systèmes)
    arcadeTargetSetMode: ((document.querySelector('input[name="arcadeTargetSetMode"]:checked') as HTMLInputElement | null)?.value as ArcadeTargetSetMode) || 'split',
    arcadeSeparateBios: (document.getElementById('arcadeSeparateBios') as HTMLInputElement).checked,
    arcadeChdEmptyZip: (document.getElementById('arcadeChdEmptyZip') as HTMLInputElement).checked,

    // Multi-disques
    generateM3u: (document.getElementById('generateM3u') as HTMLInputElement).checked,

    // Compression
    compressionLevel: (document.getElementById('compressionLevel') as HTMLSelectElement).value as ProfileSettings['compressionLevel'],
    recreateArchivesIfNeeded: (document.getElementById('recreateArchivesIfNeeded') as HTMLInputElement).checked,
    archiveFormatPriority: [...currentFormatPriority],
    useBestCompression: (document.getElementById('useBestCompression') as HTMLInputElement).checked,
    solidArchive: (document.getElementById('solidArchive') as HTMLInputElement).checked,
    multithreading: (document.getElementById('multithreading') as HTMLInputElement).checked,

    // Sélection 1G1R
    oneGameOneRom: {
      enabled: (document.getElementById('ogorEnabled') as HTMLInputElement).checked,
      regionPriority: [...ogorRegionPriority],
      languagePriority: [...ogorLanguagePriority],
      languageOverRegion: (document.getElementById('ogorLanguageOverRegion') as HTMLInputElement).checked,
      videoPriority: [...ogorVideoPriority],
      preferLatestRevision: (document.getElementById('ogorPreferLatestRevision') as HTMLInputElement).checked,
      fallbackToOwned: (document.getElementById('ogorFallbackToOwned') as HTMLInputElement).checked
    }
  };
}

// ============================================
// PROFILS DE CONSOLIDATION
// ============================================

function getEditedProfile(): ConsolidationProfile {
  return profileDrafts.find(p => p.id === editedProfileId) ?? profileDrafts[0];
}

/** Nom affichable : nom saisi, sinon nom traduit d'après l'id (profils intégrés, « Mon profil »). */
function profileDisplayName(profile: ConsolidationProfile): string {
  return profile.name || t(`profiles.names.${profile.id}`);
}

function setupProfiles(): void {
  document.getElementById('profileSelect')?.addEventListener('change', (e) => {
    switchEditedProfile((e.target as HTMLSelectElement).value);
  });
  document.getElementById('btnProfileNew')?.addEventListener('click', () => { void createProfile(); });
  document.getElementById('btnProfileRename')?.addEventListener('click', () => { void renameProfile(); });
  document.getElementById('btnProfileReset')?.addEventListener('click', () => { void resetBuiltinProfile(); });
  document.getElementById('btnProfileDelete')?.addEventListener('click', deleteProfile);
  document.getElementById('btnApplyCompatRule')?.addEventListener('click', applySelectedCompatRule);
  document.getElementById('compatRuleSelect')?.addEventListener('change', renderCompatRuleInfo);

  // Le profil courant peut changer depuis la fenêtre principale pendant l'édition
  window.api.profiles.onChanged(async () => {
    const state = await window.api.profiles.list();
    activeProfileId = state.activeProfileId;
    renderProfileSelect();
    renderProfileContext();
  });
}

function renderProfileSelect(): void {
  const select = document.getElementById('profileSelect') as HTMLSelectElement | null;
  if (!select) return;
  select.innerHTML = '';
  for (const profile of profileDrafts) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.id === activeProfileId
      ? t('settings.profiles.activeOption', { name: profileDisplayName(profile) })
      : profileDisplayName(profile);
    select.appendChild(option);
  }
  select.value = editedProfileId;
}

/** Bandeaux des onglets du profil, aide sous la liste et état des boutons. */
function renderProfileContext(): void {
  const profile = getEditedProfile();
  const name = profileDisplayName(profile);
  const isActive = profile.id === activeProfileId;

  document.querySelectorAll<HTMLElement>('[data-profile-banner]').forEach(banner => {
    banner.textContent = isActive
      ? t('settings.profiles.bannerActive', { name })
      : t('settings.profiles.bannerOther', { name });
  });

  // But du profil (profils intégrés et « Mon profil »), puis statut courant / non courant
  const desc = document.getElementById('profileDesc');
  if (desc) {
    desc.textContent = profile.builtin || profile.id === 'custom'
      ? t(`settings.profiles.descriptions.${profile.id}`)
      : t('settings.profiles.descriptions.user');
  }

  const hint = document.getElementById('profileHint');
  if (hint) hint.textContent = isActive ? t('settings.profiles.hintActive') : t('settings.profiles.hintOther');

  (document.getElementById('btnProfileRename') as HTMLButtonElement).disabled = profile.builtin;
  (document.getElementById('btnProfileDelete') as HTMLButtonElement).disabled = profile.builtin;
  (document.getElementById('btnProfileReset') as HTMLButtonElement).disabled = !profile.builtin;
}

function switchEditedProfile(id: string): void {
  if (id === editedProfileId) return;
  readProfileIntoDraft();
  editedProfileId = id;
  renderProfileSelect();
  fillProfile();
}

async function createProfile(): Promise<void> {
  readProfileIntoDraft();
  const source = getEditedProfile();
  const name = await askProfileName(
    t('settings.profiles.newDialogTitle', { name: profileDisplayName(source) }),
    t('settings.profiles.copyName', { name: profileDisplayName(source) })
  );
  if (!name) return;
  const profile: ConsolidationProfile = {
    id: crypto.randomUUID(),
    name,
    builtin: false,
    compatRule: source.compatRule,
    settings: structuredClone(source.settings)
  };
  profileDrafts.push(profile);
  editedProfileId = profile.id;
  renderProfileSelect();
  fillProfile();
}

async function renameProfile(): Promise<void> {
  const profile = getEditedProfile();
  if (profile.builtin) return;
  const name = await askProfileName(t('settings.profiles.renameDialogTitle'), profileDisplayName(profile));
  if (!name) return;
  profile.name = name;
  renderProfileSelect();
  renderProfileContext();
}

function deleteProfile(): void {
  const profile = getEditedProfile();
  if (profile.builtin) return;
  const isActive = profile.id === activeProfileId;
  const message = isActive
    ? t('settings.profiles.deleteActiveConfirm', { name: profileDisplayName(profile) })
    : t('settings.profiles.deleteConfirm', { name: profileDisplayName(profile) });
  if (!confirm(message)) return;
  profileDrafts = profileDrafts.filter(p => p.id !== profile.id);
  editedProfileId = profileDrafts.some(p => p.id === activeProfileId) ? activeProfileId : profileDrafts[0].id;
  renderProfileSelect();
  fillProfile();
}

async function resetBuiltinProfile(): Promise<void> {
  const profile = getEditedProfile();
  if (!profile.builtin) return;
  if (!confirm(t('settings.profiles.resetConfirm', { name: profileDisplayName(profile) }))) return;
  const defaults = await window.api.profiles.getBuiltinDefaults(profile.id);
  if (!defaults) return;
  profile.settings = defaults.settings;
  profile.compatRule = defaults.compatRule;
  fillProfile();
}

/**
 * Petite fenêtre de saisie du nom d'un profil (window.prompt n'existe pas dans
 * Electron). Retourne le nom saisi, ou null si annulé.
 */
function askProfileName(title: string, initial: string): Promise<string | null> {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:9999; display:flex; align-items:center; justify-content:center;';
    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:#fff; border-radius:8px; padding:20px; width:90%; max-width:420px; box-shadow:0 8px 32px rgba(0,0,0,0.25);';
    dialog.innerHTML = `
      <h3 style="margin:0 0 12px; color:#2c3e50;">${escapeHtml(title)}</h3>
      <input type="text" id="profile-name-input" maxlength="60" style="width:100%; padding:8px 10px; border:1px solid #bdc3c7; border-radius:4px; font-size:14px; margin-bottom:14px;">
      <div style="display:flex; justify-content:flex-end; gap:8px;">
        <button class="btn-secondary" id="profile-name-cancel">${escapeHtml(t('common.cancel'))}</button>
        <button class="btn-primary" id="profile-name-ok">${escapeHtml(t('common.validate'))}</button>
      </div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const input = dialog.querySelector('#profile-name-input') as HTMLInputElement;
    const okBtn = dialog.querySelector('#profile-name-ok') as HTMLButtonElement;
    input.value = initial;
    input.select();
    input.focus();

    const close = (value: string | null) => {
      overlay.remove();
      resolve(value);
    };
    const submit = () => {
      const value = input.value.trim();
      if (value) close(value);
    };
    input.addEventListener('input', () => { okBtn.disabled = !input.value.trim(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') close(null);
    });
    okBtn.addEventListener('click', submit);
    (dialog.querySelector('#profile-name-cancel') as HTMLButtonElement).addEventListener('click', () => close(null));
  });
}

/** Applique la règle choisie à tous les systèmes du profil édité. */
function applySelectedCompatRule(): void {
  const select = document.getElementById('compatRuleSelect') as HTMLSelectElement | null;
  const rule = select?.value;
  if (!isCompatRule(rule)) return;
  const profile = getEditedProfile();
  const ruleName = t(`settings.compatibility.rules.${rule}`);
  if (!confirm(t('settings.compatibility.applyRuleConfirm', { rule: ruleName, name: profileDisplayName(profile) }))) return;
  profile.settings.systemCompatibility = applyCompatRule(rule);
  profile.compatRule = rule;
  renderCompatRuleInfo();
  renderSystemCompatibility();
}

/** Description de la règle sélectionnée + dernière règle appliquée au profil. */
function renderCompatRuleInfo(): void {
  const info = document.getElementById('compatRuleInfo');
  const select = document.getElementById('compatRuleSelect') as HTMLSelectElement | null;
  if (!info || !select) return;
  const profile = getEditedProfile();
  const parts = [t(`settings.compatibility.rulesInfo.${select.value}`)];
  parts.push(profile.compatRule
    ? t('settings.compatibility.lastRule', { rule: t(`settings.compatibility.rules.${profile.compatRule}`) })
    : t('settings.compatibility.noRule'));
  info.textContent = parts.join(' ');
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
      if (fieldId === 'unmatchedRomsFolder') updateUnmatchedFolderReminder();
    }
  } catch (error) {
    console.error('Error while selecting the folder:', error);
  }
}

// ============================================
// PARCOURIR FICHIERS (OUTILS)
// ============================================

const IS_WINDOWS = navigator.userAgent.includes('Windows');

/** Nom d'exécutable affiché selon l'OS : hors Windows, les exécutables n'ont pas d'extension */
function platformFileName(fileName: string): string {
  return IS_WINDOWS ? fileName : fileName.replace(/\.exe$/i, '').toLowerCase();
}

async function browseFile(fieldId: string, fileName: string): Promise<void> {
  console.log('Selecting a file for:', fieldId);
  
  const isWindows = IS_WINDOWS;
  fileName = platformFileName(fileName);

  try {
    // openFileDialog peut retourner string | string[] | undefined
    const result = await window.api.openFileDialog({
      title: t('settings.dialogs.selectFile', { fileName }),
      filters: isWindows
        ? [
            { name: t('common.filterExecutables'), extensions: ['exe'] },
            { name: t('common.filterAllFiles'), extensions: ['*'] }
          ]
        : [],
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
      alert(t('settings.tools.notFoundAlert', { tool: '7-Zip', file: platformFileName('7z.exe') }));
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
      alert(t('settings.tools.notFoundAlert', { tool: 'WinRAR', file: platformFileName('Rar.exe') }));
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
      alert(t('settings.tools.notFoundAlert', { tool: 'UnRAR', file: platformFileName('UnRAR.exe') }));
    }
  } catch (error) {
    console.error('Error while auto-detecting UnRAR:', error);
    alert(t('settings.tools.detectErrorAlert', { tool: 'UnRAR' }));
  }
}

// ============================================
// CHDMAN : VERSION UTILISÉE ET MISE À JOUR
// ============================================

let chdmanStatus: ChdmanStatus | null = null;

async function loadChdmanStatus(): Promise<void> {
  try {
    chdmanStatus = await window.api.chdman.getInfo();
  } catch (error) {
    console.error('Error while loading chdman status:', error);
    chdmanStatus = null;
  }
  renderChdmanStatus();
}

function chdmanVersionLabel(entry: ChdmanStatus['versions'][number]): string {
  const version = entry.version || '?';
  return entry.source === 'embedded'
    ? t('settings.tools.chdmanVersionDefault', { version })
    : version;
}

function renderChdmanStatus(): void {
  const statusEl = document.getElementById('chdmanStatus');
  const select = document.getElementById('chdmanVersion') as HTMLSelectElement | null;
  if (!statusEl || !select) return;

  const status = chdmanStatus;
  if (!status) {
    statusEl.textContent = t('settings.tools.chdmanNotFound');
    return;
  }

  statusEl.textContent = status.current.path
    ? t('settings.tools.chdmanCurrent', {
        version: status.current.version || '?',
        source: t(`settings.tools.chdmanSource.${status.current.source}`)
      })
    : t('settings.tools.chdmanNotFound');
  statusEl.title = status.current.path || '';

  (document.getElementById('btnCheckChdmanUpdate') as HTMLElement).style.display = status.updateSupported ? '' : 'none';
  (document.getElementById('chdmanUpdateUnsupported') as HTMLElement).style.display = status.updateSupported ? 'none' : '';

  // Conserver un choix non encore enregistré, sinon reprendre le réglage
  const previous = select.options.length > 0 ? select.value : status.selected;
  select.innerHTML = '';
  select.add(new Option(t('settings.tools.chdmanVersionLatest'), 'latest'));
  for (const entry of status.versions) {
    select.add(new Option(chdmanVersionLabel(entry), entry.id));
  }
  select.add(new Option(t('settings.tools.chdmanVersionManual'), 'manual'));
  select.value = Array.from(select.options).some(o => o.value === previous) ? previous : 'latest';

  updateChdmanControls();
}

function updateChdmanControls(): void {
  const select = document.getElementById('chdmanVersion') as HTMLSelectElement | null;
  const deleteBtn = document.getElementById('btnDeleteChdmanVersion') as HTMLButtonElement | null;
  if (select && deleteBtn) {
    deleteBtn.disabled = !chdmanStatus?.versions.some(v => v.id === select.value && v.source === 'downloaded');
  }
  // Le chemin n'est utilisé (et affiché) qu'en sélection manuelle, mais reste mémorisé sinon
  const pathRow = document.getElementById('chdmanPathRow');
  if (select && pathRow) pathRow.style.display = select.value === 'manual' ? '' : 'none';
}

function showChdmanProgress(text: string | null): void {
  const el = document.getElementById('chdmanUpdateProgress') as HTMLElement;
  el.textContent = text || '';
  el.style.display = text ? '' : 'none';
}

async function checkChdmanUpdate(): Promise<void> {
  const button = document.getElementById('btnCheckChdmanUpdate') as HTMLButtonElement;
  button.disabled = true;
  showChdmanProgress(t('settings.tools.chdmanChecking'));
  try {
    const check = await window.api.chdman.checkUpdate();
    if (!check.success || !check.latest) {
      showChdmanProgress(null);
      alert(t('settings.tools.chdmanUpdateError', { error: check.error || '' }));
      return;
    }
    const latest = check.latest;
    const newest = chdmanStatus?.versions[0]?.version ?? null;
    if (compareMameVersions(latest.version, newest) <= 0) {
      showChdmanProgress(null);
      alert(t('settings.tools.chdmanUpToDate', { version: newest || latest.version }));
      return;
    }
    const size = (latest.size / (1024 * 1024)).toFixed(0);
    if (!confirm(t('settings.tools.chdmanUpdateConfirm', { version: latest.version, size }))) {
      showChdmanProgress(null);
      return;
    }

    window.api.chdman.onUpdateProgress(progress => showChdmanProgress(t(progress.key, progress.params)));
    const result = await window.api.chdman.update();
    showChdmanProgress(null);
    if (!result.success) {
      alert(t('settings.tools.chdmanUpdateError', { error: result.error || '' }));
      return;
    }
    if (result.status) {
      chdmanStatus = result.status;
      renderChdmanStatus();
    }
    alert(t('settings.tools.chdmanUpdateDone', { version: result.version || latest.version }));
  } catch (error) {
    showChdmanProgress(null);
    alert(t('settings.tools.chdmanUpdateError', { error: String(error) }));
  } finally {
    button.disabled = false;
  }
}

async function deleteChdmanVersion(): Promise<void> {
  const select = document.getElementById('chdmanVersion') as HTMLSelectElement;
  const entry = chdmanStatus?.versions.find(v => v.id === select.value && v.source === 'downloaded');
  if (!entry) return;
  if (!confirm(t('settings.tools.chdmanDeleteConfirm', { version: entry.version || entry.id }))) return;

  const result = await window.api.chdman.deleteVersion(entry.id);
  if (result.inUse) {
    alert(t('settings.tools.chdmanDeleteInUse'));
    return;
  }
  if (!result.success) {
    alert(t('settings.tools.chdmanUpdateError', { error: result.error || '' }));
    return;
  }
  if (result.status) {
    chdmanStatus = result.status;
    renderChdmanStatus();
  }
}

function setupChdmanVersion(): void {
  document.getElementById('chdmanVersion')?.addEventListener('change', updateChdmanControls);
  document.getElementById('btnCheckChdmanUpdate')?.addEventListener('click', checkChdmanUpdate);
  document.getElementById('btnDeleteChdmanVersion')?.addEventListener('click', deleteChdmanVersion);
  void loadChdmanStatus();
}


// ============================================
// LISTES DE PRIORITÉ ORDONNABLES (DRAG & DROP)
// ============================================
//
// Le widget lui-même vit dans ./priorityList.ts : il est partagé avec la fenêtre
// principale, où la modale de sélection automatique porte les priorités 1G1R.
// Ici, on ne fait que déclarer les listes propres aux paramètres.

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
    displayName: code => languageDisplayName(code, getLanguage()),
    // Trié par nom affiché : on cherche « Allemand », pas « De ».
    addableValues: () => CANONICAL_LANGUAGES
      .map(l => ({ value: l, label: languageDisplayName(l, getLanguage()) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
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

/**
 * Affiche le dossier effectif des clone lists sous le champ.
 *
 * Volontairement PAS en indication de saisie : un placeholder s'affiche en gris
 * clair et fait passer un champ éditable pour un champ verrouillé.
 */
async function showEffectiveCloneListFolder(): Promise<void> {
  const hint = document.getElementById('cloneListFolderEffective');
  if (!hint) return;
  try {
    const { folder } = await window.api.cloneList.listLocal();
    hint.textContent = folder ? t('settings.oneGameOneRom.cloneListFolderEffective', { folder }) : '';
  } catch {
    // Handler indisponible : pas d'indication plutôt qu'une indication fausse.
    hint.textContent = '';
  }
}

// ============================================
// COMPATIBILITÉ SYSTÈMES
// ============================================

function renderSystemCompatibility(): void {
  const container = document.getElementById('systemCompatibilityList');
  if (!container) return;

  // Formats cochés du profil édité, par systemId
  const userOverrides = new Map<string, SystemCompatibility>();
  for (const ov of getEditedProfile()?.settings.systemCompatibility ?? []) {
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
        checkbox.addEventListener('change', () => setProfileFormat(sys, format, checkbox.checked));

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
 * Coche ou décoche un format pour un système dans le profil édité. La copie de
 * travail est tenue à jour en direct : la liste affichée peut être filtrée par
 * la recherche, on ne relit donc jamais le DOM pour enregistrer.
 */
function setProfileFormat(sys: SystemDefinition, format: ArchiveFormat, checked: boolean): void {
  const profile = getEditedProfile();
  const compat = profile.settings.systemCompatibility ?? (profile.settings.systemCompatibility = []);
  let entry = compat.find(c => c.systemId.toLowerCase() === sys.systemId.toLowerCase());
  if (!entry) {
    entry = compatEntryForRule(sys, profile.compatRule ?? 'universal');
    compat.push(entry);
  }
  const formats = new Set(entry.supportedFormats.filter(f => f !== format));
  if (checked) formats.add(format);
  // Ordre stable, indépendant de l'ordre des clics
  entry.supportedFormats = (['7z', 'zip', 'chd'] as ArchiveFormat[]).filter(f => formats.has(f));
}

/**
 * Réinitialise un seul système selon la dernière règle appliquée au profil
 * (Compatibilité 100 % à défaut).
 */
function resetSystemCompatibility(systemId: string): void {
  const sys = getSystemById(systemId);
  if (!sys) return;
  const profile = getEditedProfile();
  const entry = compatEntryForRule(sys, profile.compatRule ?? 'universal');
  const compat = profile.settings.systemCompatibility ?? (profile.settings.systemCompatibility = []);
  const index = compat.findIndex(c => c.systemId.toLowerCase() === systemId.toLowerCase());
  if (index >= 0) compat[index] = entry;
  else compat.push(entry);

  // Scopé à #systemCompatibilityList : l'onglet Téléchargement (Extensions par
  // système) réutilise la même classe .system-compatibility-item pour un widget
  // différent (tags d'extensions) — sans ce scope, querySelector pouvait cibler
  // la mauvaise carte (les deux onglets coexistent dans le DOM, juste masqués via CSS).
  const systemDiv = document.querySelector(`#systemCompatibilityList .system-compatibility-item[data-system-id="${systemId}"]`);
  if (!systemDiv) return;

  const checkboxes = systemDiv.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  checkboxes.forEach(checkbox => {
    const format = checkbox.dataset.format as ArchiveFormat;
    checkbox.checked = entry.supportedFormats.includes(format);
  });
}

// ============================================
// MISE À JOUR DES SYSTÈMES (RECALBOX)
// ============================================

/** Nombre de tags proposés par canal (les plus récents). */
const RECALBOX_TAGS_PER_CHANNEL = 15;
let recalboxTagsLoaded = false;

function setupSystemsUpdate(): void {
  renderSystemsDataStatus();
  // Liste des versions chargée à la première ouverture de l'onglet (requête GitLab)
  document.querySelector('.tab-button[data-tab="compatibility"]')?.addEventListener('click', () => { void loadRecalboxTags(); });
  document.getElementById('btnCheckSystemsUpdate')?.addEventListener('click', () => { void checkSystemsUpdate(); });
  document.getElementById('btnResetSystemsData')?.addEventListener('click', () => { void resetSystemsData(); });
}

function renderSystemsDataStatus(): void {
  const status = document.getElementById('systemsDataStatus');
  const resetBtn = document.getElementById('btnResetSystemsData') as HTMLButtonElement | null;
  if (!status) return;
  const overlay = getSystemsOverlay();
  const fromRecalbox = !!overlay?.recalboxRef && overlay.systems.length > 0;
  status.textContent = fromRecalbox
    ? t('settings.systemsUpdate.statusRecalbox', {
        ref: overlay!.recalboxRef!,
        date: overlay!.fetchedAt ? new Date(overlay!.fetchedAt).toLocaleDateString(getLanguage()) : '',
        count: overlay!.systems.length
      })
    : t('settings.systemsUpdate.statusBundled');
  if (resetBtn) resetBtn.disabled = !fromRecalbox;
}

async function loadRecalboxTags(): Promise<void> {
  if (recalboxTagsLoaded) return;
  recalboxTagsLoaded = true;
  const select = document.getElementById('recalboxRefSelect') as HTMLSelectElement | null;
  const checkBtn = document.getElementById('btnCheckSystemsUpdate') as HTMLButtonElement | null;
  if (!select || !checkBtn) return;

  select.innerHTML = `<option value="">${escapeHtml(t('settings.systemsUpdate.loadingVersions'))}</option>`;
  select.disabled = true;
  checkBtn.disabled = true;

  const result = await window.api.systems.listRecalboxTags();
  if (!result.success || !result.tags) {
    select.innerHTML = `<option value="">${escapeHtml(t('settings.systemsUpdate.versionsError'))}</option>`;
    // Nouvelle tentative au prochain clic sur l'onglet
    recalboxTagsLoaded = false;
    return;
  }

  select.innerHTML = '';
  const channels: Array<'stable' | 'patron' | 'patronAlpha' | 'alpha'> = ['stable', 'patron', 'patronAlpha', 'alpha'];
  for (const channel of channels) {
    const tags = result.tags.filter(tag => tag.channel === channel).slice(0, RECALBOX_TAGS_PER_CHANNEL);
    if (tags.length === 0) continue;
    const group = document.createElement('optgroup');
    group.label = t(`settings.systemsUpdate.channel.${channel}`);
    for (const tag of tags) {
      const opt = document.createElement('option');
      opt.value = tag.name;
      opt.textContent = tag.date
        ? `${tag.name} (${new Date(tag.date).toLocaleDateString(getLanguage())})`
        : tag.name;
      group.appendChild(opt);
    }
    select.appendChild(group);
  }
  const devGroup = document.createElement('optgroup');
  devGroup.label = t('settings.systemsUpdate.channel.development');
  const master = document.createElement('option');
  master.value = 'master';
  master.textContent = 'master';
  devGroup.appendChild(master);
  select.appendChild(devGroup);

  // Par défaut : la version déjà appliquée si elle est listée, sinon la dernière stable
  const current = getSystemsOverlay()?.recalboxRef;
  const firstStable = result.tags.find(tag => tag.channel === 'stable')?.name;
  const options = Array.from(select.options).map(o => o.value);
  select.value = current && options.includes(current) ? current : (firstStable ?? 'master');
  select.disabled = false;
  checkBtn.disabled = false;
}

async function checkSystemsUpdate(): Promise<void> {
  const select = document.getElementById('recalboxRefSelect') as HTMLSelectElement | null;
  const ref = select?.value;
  if (!ref) {
    await loadRecalboxTags();
    return;
  }
  const result = await openSystemsUpdateModal(ref);
  if (result?.systemIds?.length) {
    // Le main a recalculé ces systèmes dans chaque profil (selon sa règle) : on
    // reporte ces seules entrées dans les copies de travail, sans perdre le reste.
    const updated = new Set(result.systemIds.map(id => id.toLowerCase()));
    const { profiles } = await window.api.profiles.list();
    for (const draft of profileDrafts) {
      const saved = profiles.find(p => p.id === draft.id);
      if (!saved) continue;
      const kept = (draft.settings.systemCompatibility ?? []).filter(c => !updated.has(c.systemId.toLowerCase()));
      const fresh = (saved.settings.systemCompatibility ?? []).filter(c => updated.has(c.systemId.toLowerCase()));
      draft.settings.systemCompatibility = [...kept, ...fresh];
    }
    refreshSystemsViews();
  }
}

async function resetSystemsData(): Promise<void> {
  if (!confirm(t('settings.systemsUpdate.resetConfirm'))) return;
  const result = await window.api.systems.resetToBundled();
  if (!result.success) alert(t('settings.systemsUpdate.applyError', { error: result.error ?? '' }));
}

/** Le registre des systèmes a changé (mise à jour, retour aux données intégrées). */
function refreshSystemsViews(): void {
  renderSystemsDataStatus();
  if (!currentSettings) return;
  renderSystemCompatibility();
  renderDownloadSystemExtensions();
}

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
 * Affiche l'avertissement sous le champ « ROMs non référencées » (onglet Dossiers)
 * quand le profil affiché ne l'utilise pas (nettoyage ou déplacement désactivé).
 * Le champ reste modifiable : c'est un paramètre global, commun à tous les profils.
 */
function updateUnmatchedFolderEnabled(): void {
  const cleanCb = document.getElementById('cleanSourceAfterConsolidation') as HTMLInputElement | null;
  const moveCb = document.getElementById('moveUnmatchedFiles') as HTMLInputElement | null;
  const enabled = !!cleanCb?.checked && !!moveCb?.checked;

  // Le choix pour les archives RAR n'a de sens que si les non matchés sont déplacés
  const rarSelect = document.getElementById('unmatchedInReadOnlyArchives') as HTMLSelectElement | null;
  if (rarSelect) rarSelect.disabled = !enabled;

  const msg = document.getElementById('unmatchedRomsFolderDisabledMsg');
  if (msg) msg.style.display = enabled ? 'none' : 'block';
}

/**
 * Rappelle, sous « Déplacer les fichiers non matchés » (onglet Nettoyage), le dossier
 * global « ROMs non référencées » et l'état de l'option « Dossiers cibles multi-systèmes ».
 * Lit les champs de l'onglet Dossiers pour refléter les modifications non encore enregistrées.
 */
function updateUnmatchedFolderReminder(): void {
  const container = document.getElementById('moveUnmatchedFolderReminder');
  if (!container) return;

  const folder = (document.getElementById('unmatchedRomsFolder') as HTMLInputElement | null)?.value.trim() || '';
  const multiSystem = !!(document.getElementById('validatedRomsMultiSystem') as HTMLInputElement | null)?.checked;

  const folderLine = document.createElement('div');
  folderLine.append(`📁 ${t('settings.cleanup.unmatchedFolderCurrent')} `);
  if (folder) {
    const code = document.createElement('code');
    code.textContent = folder;
    folderLine.append(code);
  } else {
    folderLine.append(t('settings.cleanup.unmatchedFolderNotSet'));
  }

  // Rien à signaler si l'option est désactivée : le dossier affiché est la cible réelle
  if (!multiSystem) {
    container.replaceChildren(folderLine);
    return;
  }

  const multiLine = document.createElement('div');
  const sep = folder.includes('\\') ? '\\' : '/';
  const example = folder ? `${folder.replace(/[\\/]+$/, '')}${sep}psx` : 'psx';
  const [before, after = ''] = t('settings.cleanup.unmatchedMultiSystemOn').split('{example}');
  const code = document.createElement('code');
  code.textContent = example;
  multiLine.append(`🗂️ ${before}`, code, after);

  container.replaceChildren(folderLine, multiLine);
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

/**
 * Option .m3u : les jeux multi-disques ne sont jamais archivés en 7z/zip. Signalé
 * dans l'onglet Multi-disques et sous l'ordre de priorité des formats (Compression).
 */
function updateM3uNotices(): void {
  const enabled = (document.getElementById('generateM3u') as HTMLInputElement | null)?.checked ?? false;
  for (const id of ['m3uWarning', 'm3uPriorityNotice']) {
    const box = document.getElementById(id);
    if (box) box.style.display = enabled ? 'block' : 'none';
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

    // Profils : la copie de travail du profil affiché est relue, puis tous les
    // profils (créés, renommés, supprimés, modifiés) sont enregistrés ensemble.
    readProfileIntoDraft();
    await window.api.profiles.saveAll(profileDrafts);

    // Paramètres globaux uniquement : les clés de profil passent par saveAll
    const newSettings: Partial<AppSettings> = {
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

      // Outils externes
      sevenZipPath: (document.getElementById('sevenZipPath') as HTMLInputElement).value,
      winrarPath: (document.getElementById('winrarPath') as HTMLInputElement).value,
      unrarPath: (document.getElementById('unrarPath') as HTMLInputElement).value,
      chdmanPath: (document.getElementById('chdmanPath') as HTMLInputElement).value,
      chdmanVersion: (document.getElementById('chdmanVersion') as HTMLSelectElement).value || currentSettings.chdmanVersion,
      rarToolPriority: currentRarToolPriority,

      // Clone lists — lastDownload est piloté par le main process, pas par cet écran
      cloneLists: {
        sourceUrl: (document.getElementById('cloneListSourceUrl') as HTMLInputElement).value.trim(),
        folder: (document.getElementById('cloneListFolder') as HTMLInputElement).value.trim(),
        lastDownload: currentSettings.cloneLists?.lastDownload,
        // Le cache d'ETag est piloté par le main process : le réécrire depuis cet
        // écran perdrait les entrées posées depuis l'ouverture de la fenêtre.
        etags: currentSettings.cloneLists?.etags,
        autoUpdate: (document.getElementById('cloneListAutoUpdate') as HTMLInputElement).checked
      },

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
