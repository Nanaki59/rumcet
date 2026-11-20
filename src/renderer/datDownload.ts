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

// src/renderer/datDownload.ts
//
// Écran unifié de chargement d'un DAT/XML :
//  1. Choix du fichier — local (Parcourir) ou téléchargement en ligne
//     (No-Intro « ouvrir la page », Redump, MAME Progetto-Snaps / Pleasuredome).
//  2. Base de données — chemin auto dérivé du nom du DAT, personnalisable.
//  3. « Charger le DAT/XML » — crée la base + charge le DAT (primaire), ou
//     fusionne dans la base active (complémentaire) si une base est ouverte.

import { initI18n, t } from './i18n.js';
import { initHelpTips } from './helpTip.js';
import { setupConsoleCapture } from './consoleCapture.js';
import { renderDbFoldersForm, type DbFoldersForm } from './dbFoldersForm.js';
import { escapeHtml } from './htmlEscape.js';

// Capturer les console.* de cette page vers le fichier de logs dès le chargement
setupConsoleCapture();

interface DatSystemInfo {
  name: string;
  systemId: string;
  sources: Array<{
    type: 'no-intro' | 'redump';
    id: string;
    recommended: boolean;
  }>;
  /** Système ajouté par une mise à jour Recalbox, sans source DAT connue. */
  unknownSource?: boolean;
  /** Sources associées manuellement par l'utilisateur. */
  userDefinedSources?: boolean;
}

interface MameVersion {
  version: string;
  date?: string;
  isLatest?: boolean;
  recalboxTag?: string;
  /** Derniers tags Stable / Patron / Alpha de Recalbox utilisant cette version. */
  recalboxRefs?: Array<{ channel: string; ref: string }>;
  downloadUrl: string;
}

interface PleasuredomeDatEntry {
  name: string;
  url: string;
}

interface DatDownloadContext {
  dbOpen: boolean;
  dbPath: string | null;
  datName: string | null;
  defaultDatFolder: string;
}

// ==========================================
// État
// ==========================================

let context: DatDownloadContext = { dbOpen: false, dbPath: null, datName: null, defaultDatFolder: '' };

/** Fichier DAT retenu (local ou fraîchement téléchargé). */
let selectedDatPath: string | null = null;
/** Chemin .sqlite proposé automatiquement (mode primaire). */
let dbAutoPath: string | null = null;

// Téléchargement en ligne
let allSystems: DatSystemInfo[] = [];
let allMameVersions: MameVersion[] = [];
let allPleasuredomeDats: PleasuredomeDatEntry[] = [];
let selectedSystem: DatSystemInfo | null = null;
let selectedSource: 'no-intro' | 'redump' | null = null;
let selectedMameVersion: MameVersion | null = null;
let selectedPleasuredome: PleasuredomeDatEntry | null = null;
let currentOnlineTab: 'systems' | 'mame' = 'systems';
let mameSource: 'progetto' | 'pleasuredome' = 'progetto';

// ==========================================
// Éléments DOM
// ==========================================

const modeBanner = document.getElementById('mode-banner') as HTMLDivElement;
const modeBannerDat = document.getElementById('mode-banner-dat') as HTMLSpanElement;
const windowSubtitle = document.getElementById('window-subtitle') as HTMLParagraphElement;

const srcLocalBtn = document.getElementById('src-local') as HTMLButtonElement;
const srcOnlineBtn = document.getElementById('src-online') as HTMLButtonElement;
const paneLocal = document.getElementById('pane-local') as HTMLDivElement;
const paneOnline = document.getElementById('pane-online') as HTMLDivElement;

const systemList = document.getElementById('system-list') as HTMLDivElement;
const mameList = document.getElementById('mame-list') as HTMLDivElement;
const systemSearch = document.getElementById('system-search') as HTMLInputElement;
const mameSearch = document.getElementById('mame-search') as HTMLInputElement;
const systemCounter = document.getElementById('system-counter') as HTMLDivElement;
const mameCounter = document.getElementById('mame-counter') as HTMLDivElement;
const sourceSelection = document.getElementById('source-selection') as HTMLDivElement;
const sourceRadioGroup = document.getElementById('source-radio-group') as HTMLDivElement;
const nointroNotice = document.getElementById('nointro-notice') as HTMLDivElement;
const pleasuredomeNotice = document.getElementById('pleasuredome-notice') as HTMLDivElement;
const mameRecalboxNotice = document.getElementById('mame-recalbox-notice') as HTMLDivElement;
const destFolderInput = document.getElementById('dest-folder') as HTMLInputElement;
const btnDownload = document.getElementById('btn-download') as HTMLButtonElement;
const btnOpenPage = document.getElementById('btn-open-page') as HTMLButtonElement;
const manualSource = document.getElementById('manual-source') as HTMLDivElement;
const manualSourceInfo = document.getElementById('manual-source-info') as HTMLParagraphElement;
const manualSourceError = document.getElementById('manual-source-error') as HTMLParagraphElement;
const manualNoIntroId = document.getElementById('manual-nointro-id') as HTMLInputElement;
const manualRedumpSlug = document.getElementById('manual-redump-slug') as HTMLInputElement;
const systemLoading = document.getElementById('system-loading') as HTMLDivElement;
const mameLoading = document.getElementById('mame-loading') as HTMLDivElement;

const selectedDatBar = document.getElementById('selected-dat') as HTMLDivElement;
const selectedDatIcon = document.getElementById('selected-dat-icon') as HTMLSpanElement;
const selectedDatPathEl = document.getElementById('selected-dat-path') as HTMLSpanElement;

const stepDb = document.getElementById('step-db') as HTMLDivElement;
const dbPathInput = document.getElementById('db-path') as HTMLInputElement;
const btnBrowseDb = document.getElementById('btn-browse-db') as HTMLButtonElement;
// Vrai si l'utilisateur a explicitement choisi un emplacement via « Parcourir » : on ne
// réécrase alors plus le chemin par la valeur automatique lors d'un changement de DAT.
let dbPathCustomized = false;

const stepTarget = document.getElementById('step-target') as HTMLDivElement;
/** Formulaire du dossier cible (mode primaire uniquement) */
let foldersForm: DbFoldersForm | null = null;
const statusMessage = document.getElementById('status-message') as HTMLSpanElement;
const btnLoad = document.getElementById('btn-load') as HTMLButtonElement;

// ==========================================
// Initialisation
// ==========================================

async function init() {
  try {
    context = await window.api.getDatDownloadContext();
  } catch {
    // Contexte indisponible — on reste en mode primaire par défaut
  }

  if (context.dbOpen) {
    // Mode complémentaire : bannière + pas de section base de données
    modeBanner.classList.add('visible');
    const datName = context.datName || context.dbPath || t('datDownload.activeDb');
    modeBanner.innerHTML = t('datDownload.modeBanner', { dat: escapeHtml(datName) });
    stepDb.style.display = 'none';
    stepTarget.style.display = 'none';
    windowSubtitle.textContent = t('datDownload.subtitleComplementary');
  } else {
    // Mode primaire : dossier cible de la future base (pré-rempli avec les paramètres)
    try {
      const folderInfo = await window.api.getDbFolderSettings();
      foldersForm = renderDbFoldersForm(document.getElementById('db-folders-form') as HTMLDivElement, folderInfo);
      foldersForm.onChange(updateLoadButton);
    } catch (error) {
      console.error('Unable to load the default folders:', error);
      stepTarget.style.display = 'none';
    }
  }

  destFolderInput.value = context.defaultDatFolder || '';

  setupSourceToggle();
  setupOnlineTabs();
  setupMameSourceRadios();
  setupSearch();
  setupBrowseFolder();
  setupLocalBrowse();
  setupDbSection();
  setupDownloadButtons();
  setupLoadButton();
  setupCloseButton();
  setupManualSource();

  // Charger la liste des systèmes en arrière-plan (pane online affiché à la demande)
  loadSystems();
}

// ==========================================
// Bascule Fichier local / En ligne
// ==========================================

function setupSourceToggle() {
  srcLocalBtn.addEventListener('click', () => {
    srcLocalBtn.classList.add('active');
    srcOnlineBtn.classList.remove('active');
    paneLocal.classList.add('active');
    paneOnline.classList.remove('active');
  });
  srcOnlineBtn.addEventListener('click', () => {
    srcOnlineBtn.classList.add('active');
    srcLocalBtn.classList.remove('active');
    paneOnline.classList.add('active');
    paneLocal.classList.remove('active');
  });
}

// ==========================================
// Fichier local
// ==========================================

function setupLocalBrowse() {
  document.getElementById('btn-browse-local')?.addEventListener('click', async () => {
    const filePath = await window.api.selectLocalDat();
    if (filePath) {
      await setSelectedDat(filePath);
      setStatus('', '');
    }
  });
}

// ==========================================
// Fichier DAT retenu (commun)
// ==========================================

async function setSelectedDat(datPath: string) {
  selectedDatPath = datPath;
  selectedDatBar.classList.add('has-file');
  selectedDatIcon.textContent = '✅';
  selectedDatPathEl.textContent = datPath;
  selectedDatPathEl.title = datPath;

  // Mode primaire : proposer automatiquement le chemin de la base
  if (!context.dbOpen) {
    try {
      dbAutoPath = await window.api.getDefaultDbPath(datPath);
    } catch {
      dbAutoPath = null;
    }
    // Ne pas écraser un chemin choisi manuellement par l'utilisateur
    if (!dbPathCustomized) {
      dbPathInput.value = dbAutoPath || '';
    }
  }

  updateLoadButton();
}

function updateLoadButton() {
  if (!selectedDatPath) {
    btnLoad.disabled = true;
    return;
  }
  if (context.dbOpen) {
    btnLoad.disabled = false;
    return;
  }
  btnLoad.disabled = !dbPathInput.value.trim() || (!!foldersForm && !foldersForm.getValues().targetFolder);
}

// ==========================================
// Section base de données (mode primaire)
// ==========================================

function setupDbSection() {
  // Le champ est éditable (saisie ou copier-coller d'un chemin). Toute frappe vaut
  // choix explicite : sans ce marquage, changer de DAT réécraserait la saisie par le
  // chemin déduit automatiquement.
  dbPathInput.addEventListener('input', () => {
    dbPathCustomized = dbPathInput.value.trim().length > 0;
    updateLoadButton();
  });

  // Le chemin par défaut vient des paramètres ; « Parcourir » permet de le changer.
  btnBrowseDb.addEventListener('click', async () => {
    const chosen = await window.api.browseDbPath(dbPathInput.value || dbAutoPath || undefined);
    if (chosen) {
      dbPathInput.value = chosen;
      dbPathCustomized = true;
      updateLoadButton();
    }
  });
}

// ==========================================
// Chargement final
// ==========================================

function setupLoadButton() {
  btnLoad.addEventListener('click', async () => {
    if (!selectedDatPath) return;

    btnLoad.disabled = true;
    setStatus(context.dbOpen ? t('datDownload.status.merging') : t('datDownload.status.creating'), 'loading');

    try {
      const dbPath = context.dbOpen ? undefined : (dbPathInput.value.trim() || undefined);
      const folders = context.dbOpen ? undefined : foldersForm?.getValues();
      let result = await window.api.loadDatUnified({ datPath: selectedDatPath, dbPath, folders });

      // La base cible existe déjà → demander confirmation avant écrasement
      if (result?.fileExists) {
        const ok = window.confirm(t('datDownload.status.dbExistsConfirm', { path: result.dbPath }));
        if (!ok) {
          setStatus(t('datDownload.status.cancelled'), '');
          btnLoad.disabled = false;
          return;
        }
        setStatus(t('datDownload.status.creating'), 'loading');
        result = await window.api.loadDatUnified({ datPath: selectedDatPath, dbPath, overwrite: true, folders });
      }

      if (result?.mode === 'complementary') {
        setStatus(
          t('datDownload.status.mergedSuccess', {
            games: result.gamesCount,
            roms: result.romsCount,
            disks: result.disksCount
          }),
          'success'
        );
      } else {
        setStatus(
          t('datDownload.status.createdSuccess', { games: result.gamesCount, roms: result.romsCount }),
          'success'
        );
      }

      // Laisser le temps de lire le statut, puis fermer — la fenêtre principale
      // a été notifiée via l'événement 'dat-download:loaded'.
      setTimeout(() => window.close(), 1400);
    } catch (error: any) {
      setStatus(t('datDownload.status.error', { error: error?.message || String(error) }), 'error');
      btnLoad.disabled = false;
    }
  });
}

// ==========================================
// Téléchargement en ligne — chargement des listes
// ==========================================

async function loadSystems() {
  systemLoading.classList.add('visible');
  try {
    allSystems = await window.api.getDownloadSystems();
    renderSystems(allSystems);
  } catch (error: any) {
    systemList.innerHTML = `<div style="padding: 20px; text-align: center; color: #e74c3c;">${escapeHtml(t('datDownload.status.loadError', { error: error.message }))}</div>`;
  }
  systemLoading.classList.remove('visible');
}

async function loadMameVersions() {
  if (allMameVersions.length > 0) {
    renderMameList();
    return;
  }
  mameLoading.classList.add('visible');
  try {
    allMameVersions = await window.api.getMameVersions();
    renderMameList();
  } catch (error: any) {
    mameList.innerHTML = `<div style="padding: 20px; text-align: center; color: #e74c3c;">${escapeHtml(t('datDownload.status.loadError', { error: error.message }))}</div>`;
  }
  mameLoading.classList.remove('visible');
}

async function loadPleasuredomeDats() {
  if (allPleasuredomeDats.length > 0) {
    renderMameList();
    return;
  }
  mameLoading.classList.add('visible');
  try {
    allPleasuredomeDats = await window.api.getPleasuredomeDats();
    renderMameList();
  } catch (error: any) {
    mameList.innerHTML = `<div style="padding: 20px; text-align: center; color: #e74c3c;">${escapeHtml(t('datDownload.status.loadError', { error: error.message }))}</div>`;
  }
  mameLoading.classList.remove('visible');
}

// ==========================================
// Rendu des listes
// ==========================================

function renderSystems(systems: DatSystemInfo[]) {
  systemList.querySelectorAll('.list-item').forEach(item => item.remove());

  systems.forEach(sys => {
    const item = document.createElement('div');
    item.className = 'list-item';
    if (selectedSystem && selectedSystem.name === sys.name) {
      item.classList.add('selected');
    }

    const nameSpan = document.createElement('span');
    nameSpan.className = 'item-name';
    nameSpan.textContent = sys.name;

    const badges = document.createElement('span');
    badges.className = 'item-badges';
    sys.sources.forEach(src => {
      const badge = document.createElement('span');
      badge.className = `badge ${src.type}${src.recommended ? ' recommended' : ''}`;
      badge.textContent = src.type === 'no-intro' ? 'No-Intro' : 'Redump';
      badges.appendChild(badge);
    });
    if (sys.unknownSource || sys.userDefinedSources) {
      const badge = document.createElement('span');
      badge.className = sys.unknownSource ? 'badge unknown' : 'badge user';
      badge.textContent = t(sys.unknownSource ? 'datDownload.manualSource.badgeUnknown' : 'datDownload.manualSource.badgeUser');
      badge.title = t('datDownload.manualSource.badgeTitle');
      badges.appendChild(badge);
    }

    item.appendChild(nameSpan);
    item.appendChild(badges);
    item.addEventListener('click', () => selectSystem(sys));
    systemList.appendChild(item);
  });

  systemCounter.textContent = systems.length > 1
    ? t('datDownload.counter.systemsPlural', { count: systems.length })
    : t('datDownload.counter.systemSingular', { count: systems.length });
}

/** Rendu de la liste MAME selon la source active (Progetto-Snaps ou Pleasuredome). */
function renderMameList() {
  mameList.querySelectorAll('.list-item').forEach(item => item.remove());

  const query = mameSearch.value.toLowerCase().trim();

  if (mameSource === 'progetto') {
    const versions = query
      ? allMameVersions.filter(v =>
          v.version.includes(query) ||
          (v.date && v.date.toLowerCase().includes(query)) ||
          (v.recalboxTag && v.recalboxTag.toLowerCase().includes(query)))
      : allMameVersions;

    versions.forEach(ver => {
      const item = document.createElement('div');
      item.className = 'list-item';
      if (selectedMameVersion && selectedMameVersion.version === ver.version) {
        item.classList.add('selected');
      }

      const leftDiv = document.createElement('div');
      const versionSpan = document.createElement('span');
      versionSpan.className = 'item-name';
      versionSpan.textContent = `MAME ${ver.version}`;
      leftDiv.appendChild(versionSpan);
      if (ver.date) {
        const dateSpan = document.createElement('span');
        dateSpan.className = 'item-meta';
        dateSpan.textContent = ` (${ver.date})`;
        leftDiv.appendChild(dateSpan);
      }
      item.appendChild(leftDiv);

      const badges = document.createElement('span');
      badges.className = 'item-badges';
      if (ver.isLatest) {
        const badge = document.createElement('span');
        badge.className = 'badge latest';
        badge.textContent = t('datDownload.badgeLatest');
        badges.appendChild(badge);
      }
      if (ver.recalboxTag) {
        const badge = document.createElement('span');
        // Un badge par canal ; ils reflètent les DERNIÈRES versions de chaque canal Recalbox
        for (const r of ver.recalboxRefs ?? []) {
          const channel = t(`datDownload.recalboxChannel.${r.channel}`);
          const badge = document.createElement('span');
          badge.className = 'badge recalbox';
          badge.textContent = t('datDownload.badgeRecalbox', { channel });
          badge.title = t('datDownload.badgeRecalboxTitle', { channel, ref: r.ref });
          badges.appendChild(badge);
        }
      }
      item.appendChild(badges);

      item.addEventListener('click', () => {
        selectedMameVersion = ver;
        selectedPleasuredome = null;
        renderMameList();
        updateOnlineButtons();
      });
      mameList.appendChild(item);
    });

    mameCounter.textContent = versions.length > 1
      ? t('datDownload.counter.versionsPlural', { count: versions.length })
      : t('datDownload.counter.versionSingular', { count: versions.length });
  } else {
    const entries = query
      ? allPleasuredomeDats.filter(e => e.name.toLowerCase().includes(query))
      : allPleasuredomeDats;

    entries.forEach(entry => {
      const item = document.createElement('div');
      item.className = 'list-item';
      if (selectedPleasuredome && selectedPleasuredome.url === entry.url) {
        item.classList.add('selected');
      }

      const nameSpan = document.createElement('span');
      nameSpan.className = 'item-name';
      nameSpan.textContent = entry.name;
      item.appendChild(nameSpan);

      item.addEventListener('click', () => {
        selectedPleasuredome = entry;
        selectedMameVersion = null;
        renderMameList();
        updateOnlineButtons();
      });
      mameList.appendChild(item);
    });

    mameCounter.textContent = t('datDownload.counter.dats', { count: entries.length, plural: entries.length > 1 ? 's' : '' });
  }
}

// ==========================================
// Sélection système + boutons
// ==========================================

function selectSystem(sys: DatSystemInfo) {
  selectedSystem = sys;

  systemList.querySelectorAll('.list-item').forEach(item => {
    const name = item.querySelector('.item-name')?.textContent;
    item.classList.toggle('selected', name === sys.name);
  });

  if (sys.sources.length > 1) {
    sourceSelection.classList.add('visible');
    sourceRadioGroup.innerHTML = '';

    sys.sources.forEach(src => {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'source';
      radio.value = src.type;
      radio.checked = src.recommended;

      const text = document.createTextNode(src.type === 'no-intro' ? 'No-Intro' : 'Redump');
      label.appendChild(radio);
      label.appendChild(text);

      if (src.recommended) {
        const tag = document.createElement('span');
        tag.className = 'recommended-tag';
        tag.textContent = ' ' + t('datDownload.recommendedTag');
        label.appendChild(tag);
        selectedSource = src.type;
      }

      radio.addEventListener('change', () => {
        selectedSource = src.type;
        updateOnlineButtons();
      });

      sourceRadioGroup.appendChild(label);
    });
  } else {
    sourceSelection.classList.remove('visible');
    selectedSource = sys.sources[0]?.type || null;
  }

  renderManualSource(sys);
  updateOnlineButtons();
}

/**
 * Panneau de recherche / association manuelle, pour les systèmes ajoutés par une
 * mise à jour Recalbox. Rumcet ne peut pas savoir s'ils ont un DAT No-Intro ou
 * Redump : les boutons ouvrent les pages d'index dans le navigateur (jamais de
 * requête de l'application vers DAT-o-Matic).
 */
function renderManualSource(sys: DatSystemInfo | null) {
  const show = !!sys && (!!sys.unknownSource || !!sys.userDefinedSources);
  manualSource.classList.toggle('visible', show);
  manualSourceError.textContent = '';
  if (!show || !sys) return;
  manualSourceInfo.textContent = t(sys.unknownSource ? 'datDownload.manualSource.infoUnknown' : 'datDownload.manualSource.infoUser');
  manualNoIntroId.value = sys.sources.find(s => s.type === 'no-intro')?.id ?? '';
  manualRedumpSlug.value = sys.sources.find(s => s.type === 'redump')?.id ?? '';
}

function setupManualSource() {
  const openIndex = async (source: 'no-intro' | 'redump') => {
    const result = await window.api.openDatPage({ type: 'source-index', source, destFolder: '' });
    if (result?.success) setStatus(t('datDownload.status.pageOpened'), 'success');
    else setStatus(t('datDownload.manualSource.error', { error: result?.error ?? '' }), 'error');
  };
  document.getElementById('btn-search-nointro')!.addEventListener('click', () => { void openIndex('no-intro'); });
  document.getElementById('btn-search-redump')!.addEventListener('click', () => { void openIndex('redump'); });

  document.getElementById('btn-save-manual-source')!.addEventListener('click', async () => {
    if (!selectedSystem) return;
    manualSourceError.textContent = '';
    const result = await window.api.systems.setUserDatSources(selectedSystem.systemId, {
      noIntroId: manualNoIntroId.value,
      redumpSlug: manualRedumpSlug.value
    });
    if (!result.success) {
      manualSourceError.textContent =
        result.error === 'invalid-nointro-id' ? t('datDownload.manualSource.invalidNoIntroId')
        : result.error === 'invalid-redump-slug' ? t('datDownload.manualSource.invalidRedumpSlug')
        : t('datDownload.manualSource.error', { error: result.error ?? '' });
      return;
    }
    // La liste est rechargée via l'événement systems:updated
    setStatus(t('datDownload.manualSource.saved'), 'success');
  });

  // Registre modifié (association, mise à jour Recalbox) : recharger la liste en
  // conservant la recherche et la sélection
  window.api.systems.onUpdated(async () => {
    const selectedId = selectedSystem?.systemId;
    await loadSystems();
    const query = systemSearch.value.toLowerCase().trim();
    if (query) renderSystems(allSystems.filter(sys => sys.name.toLowerCase().includes(query)));
    const reselected = selectedId ? allSystems.find(sys => sys.systemId === selectedId) : undefined;
    if (reselected) {
      selectSystem(reselected);
    } else {
      selectedSystem = null;
      selectedSource = null;
      sourceSelection.classList.remove('visible');
      renderManualSource(null);
      updateOnlineButtons();
    }
  });
}

function updateOnlineButtons() {
  if (currentOnlineTab === 'systems') {
    const hasSelection = !!selectedSystem && !!selectedSource;
    btnOpenPage.disabled = !hasSelection;
    // No-Intro : téléchargement direct désactivé (risque de ban IP)
    btnDownload.disabled = !hasSelection || selectedSource === 'no-intro';
    nointroNotice.classList.toggle('visible', selectedSource === 'no-intro' && hasSelection);
  } else {
    if (mameSource === 'progetto') {
      btnOpenPage.disabled = !selectedMameVersion;
      btnDownload.disabled = !selectedMameVersion;
    } else {
      // Pleasuredome : « Ouvrir la page » toujours possible (page d'index)
      btnOpenPage.disabled = false;
      btnDownload.disabled = !selectedPleasuredome;
    }
    nointroNotice.classList.remove('visible');
  }
}

// ==========================================
// Onglets en ligne + source MAME
// ==========================================

function setupOnlineTabs() {
  document.querySelectorAll('.online-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = (btn as HTMLElement).dataset.tab as 'systems' | 'mame';
      currentOnlineTab = tabId;

      document.querySelectorAll('.online-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.online-tab-content').forEach(t => t.classList.remove('active'));
      document.getElementById(`online-tab-${tabId}`)?.classList.add('active');

      if (tabId === 'mame') {
        if (mameSource === 'progetto') loadMameVersions();
        else loadPleasuredomeDats();
      }

      updateOnlineButtons();
    });
  });
}

function setupMameSourceRadios() {
  document.querySelectorAll<HTMLInputElement>('input[name="mame-source"]').forEach(radio => {
    radio.addEventListener('change', () => {
      mameSource = radio.value as 'progetto' | 'pleasuredome';
      pleasuredomeNotice.classList.toggle('visible', mameSource === 'pleasuredome');
      // Badges Recalbox : seulement pour la liste Progetto-Snaps
      mameRecalboxNotice.classList.toggle('visible', mameSource === 'progetto');
      if (mameSource === 'progetto') loadMameVersions();
      else loadPleasuredomeDats();
      updateOnlineButtons();
    });
  });
}

// ==========================================
// Recherche
// ==========================================

function setupSearch() {
  systemSearch.addEventListener('input', () => {
    const query = systemSearch.value.toLowerCase().trim();
    if (!query) {
      renderSystems(allSystems);
      return;
    }
    renderSystems(allSystems.filter(sys => sys.name.toLowerCase().includes(query)));
  });

  mameSearch.addEventListener('input', () => renderMameList());
}

// ==========================================
// Dossier de destination
// ==========================================

function setupBrowseFolder() {
  document.getElementById('browse-folder')?.addEventListener('click', async () => {
    const folder = await window.api.selectDownloadFolder(destFolderInput.value || undefined);
    if (folder) {
      destFolderInput.value = folder;
    }
  });
}

// ==========================================
// Téléchargement
// ==========================================

function setupDownloadButtons() {
  // « Ouvrir la page » — No-Intro (obligatoire), Redump/MAME/Pleasuredome (fallback)
  btnOpenPage.addEventListener('click', async () => {
    btnOpenPage.disabled = true;
    try {
      let result;
      if (currentOnlineTab === 'systems' && selectedSystem && selectedSource) {
        const sourceInfo = selectedSystem.sources.find(s => s.type === selectedSource);
        if (!sourceInfo) return;
        result = await window.api.openDatPage({
          type: 'system',
          source: selectedSource,
          systemId: sourceInfo.id,
          destFolder: ''
        });
      } else if (currentOnlineTab === 'mame' && mameSource === 'progetto' && selectedMameVersion) {
        result = await window.api.openDatPage({
          type: 'mame',
          mameVersion: selectedMameVersion.version,
          destFolder: ''
        });
      } else if (currentOnlineTab === 'mame' && mameSource === 'pleasuredome') {
        // Ouvre la page d'index Pleasuredome (téléchargement manuel possible)
        result = await window.api.openDatPage({
          type: 'pleasuredome',
          destFolder: ''
        });
      } else {
        return;
      }
      if (result?.success) {
        setStatus(t('datDownload.status.pageOpened'), 'success');
      } else {
        setStatus(result?.error || t('datDownload.status.pageOpenFailed'), 'error');
      }
    } finally {
      updateOnlineButtons();
    }
  });

  // « Télécharger et utiliser » — télécharge puis retient le fichier comme DAT sélectionné
  btnDownload.addEventListener('click', async () => {
    const destFolder = destFolderInput.value;
    if (!destFolder) {
      setStatus(t('datDownload.status.noDestFolder'), 'error');
      return;
    }

    btnDownload.disabled = true;

    try {
      let result;
      if (currentOnlineTab === 'systems' && selectedSystem && selectedSource) {
        const sourceInfo = selectedSystem.sources.find(s => s.type === selectedSource);
        if (!sourceInfo) return;
        setStatus(t('datDownload.status.downloadingSystem', {
          name: selectedSystem.name,
          source: selectedSource === 'no-intro' ? 'No-Intro' : 'Redump'
        }), 'loading');
        result = await window.api.downloadDat({
          type: 'system',
          source: selectedSource,
          systemId: sourceInfo.id,
          destFolder
        });
      } else if (currentOnlineTab === 'mame' && mameSource === 'progetto' && selectedMameVersion) {
        setStatus(t('datDownload.status.downloadingMame', { version: selectedMameVersion.version }), 'loading');
        result = await window.api.downloadDat({
          type: 'mame',
          mameVersion: selectedMameVersion.version,
          destFolder
        });
      } else if (currentOnlineTab === 'mame' && mameSource === 'pleasuredome' && selectedPleasuredome) {
        setStatus(t('datDownload.status.downloadingPleasuredome', { name: selectedPleasuredome.name }), 'loading');
        result = await window.api.downloadDat({
          type: 'pleasuredome',
          url: selectedPleasuredome.url,
          destFolder
        });
      } else {
        return;
      }

      if (result.success && result.filePath) {
        await setSelectedDat(result.filePath);
        setStatus(t('datDownload.status.downloaded', { path: result.filePath }), 'success');
      } else {
        setStatus(result.error || t('common.unknownError'), 'error');
      }
    } finally {
      updateOnlineButtons();
    }
  });
}

// ==========================================
// Statut + fermeture
// ==========================================

function setStatus(message: string, type: '' | 'success' | 'error' | 'loading' = '') {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`;
}

function setupCloseButton() {
  document.getElementById('btn-close')?.addEventListener('click', () => {
    window.close();
  });
}

// ==========================================
// Lancement
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
  // Traductions d'abord : le DOM statique et tous les textes dynamiques en dépendent
  await initI18n();
  initHelpTips();
  await init();
});
