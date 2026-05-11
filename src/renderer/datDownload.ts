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

interface DatSystemInfo {
  name: string;
  sources: Array<{
    type: 'no-intro' | 'redump';
    id: string;
    recommended: boolean;
  }>;
}

interface MameVersion {
  version: string;
  date?: string;
  isLatest?: boolean;
  recalboxTag?: string;
  downloadUrl: string;
}

// État
let allSystems: DatSystemInfo[] = [];
let allMameVersions: MameVersion[] = [];
let selectedSystem: DatSystemInfo | null = null;
let selectedSource: 'no-intro' | 'redump' | null = null;
let selectedMameVersion: MameVersion | null = null;
let currentTab: 'systems' | 'mame' = 'systems';

// Éléments DOM
const systemList = document.getElementById('system-list') as HTMLDivElement;
const mameList = document.getElementById('mame-list') as HTMLDivElement;
const systemSearch = document.getElementById('system-search') as HTMLInputElement;
const mameSearch = document.getElementById('mame-search') as HTMLInputElement;
const systemCounter = document.getElementById('system-counter') as HTMLDivElement;
const mameCounter = document.getElementById('mame-counter') as HTMLDivElement;
const sourceSelection = document.getElementById('source-selection') as HTMLDivElement;
const sourceRadioGroup = document.getElementById('source-radio-group') as HTMLDivElement;
const nointroParams = document.getElementById('nointro-params') as HTMLDivElement;
const destFolderInput = document.getElementById('dest-folder') as HTMLInputElement;
const btnDownload = document.getElementById('btn-download') as HTMLButtonElement;
const statusMessage = document.getElementById('status-message') as HTMLSpanElement;
const systemLoading = document.getElementById('system-loading') as HTMLDivElement;
const mameLoading = document.getElementById('mame-loading') as HTMLDivElement;

// ==========================================
// Initialisation
// ==========================================

async function init() {
  // Charger le dossier par défaut depuis les settings
  try {
    const settings = await window.api.getSettings();
    destFolderInput.value = settings.defaultDatFolder || '';

    // Charger les paramètres No-Intro par défaut
    if (settings.noIntroDefaults) {
      (document.getElementById('param-bios') as HTMLInputElement).checked = settings.noIntroDefaults.includeBios;
      (document.getElementById('param-proto') as HTMLInputElement).checked = settings.noIntroDefaults.includeProto;
      (document.getElementById('param-beta') as HTMLInputElement).checked = settings.noIntroDefaults.includeBeta;
      (document.getElementById('param-demo') as HTMLInputElement).checked = settings.noIntroDefaults.includeDemo;
      (document.getElementById('param-sample') as HTMLInputElement).checked = settings.noIntroDefaults.includeSample;
    }
  } catch {
    // Pas de settings disponibles
  }

  // Charger la liste des systèmes
  loadSystems();

  // Setup des événements
  setupTabSwitching();
  setupSearch();
  setupBrowseFolder();
  setupDownloadButton();
  setupCloseButton();
}

// ==========================================
// Chargement des données
// ==========================================

async function loadSystems() {
  systemLoading.classList.add('visible');
  try {
    allSystems = await window.api.getDownloadSystems();
    renderSystems(allSystems);
  } catch (error: any) {
    systemList.innerHTML = `<div style="padding: 20px; text-align: center; color: #e74c3c;">Erreur de chargement: ${error.message}</div>`;
  }
  systemLoading.classList.remove('visible');
}

async function loadMameVersions() {
  if (allMameVersions.length > 0) return; // Déjà chargées

  mameLoading.classList.add('visible');
  try {
    allMameVersions = await window.api.getMameVersions();
    renderMameVersions(allMameVersions);
  } catch (error: any) {
    mameList.innerHTML = `<div style="padding: 20px; text-align: center; color: #e74c3c;">Erreur de chargement: ${error.message}</div>`;
  }
  mameLoading.classList.remove('visible');
}

// ==========================================
// Rendu
// ==========================================

function renderSystems(systems: DatSystemInfo[]) {
  // Supprimer les anciens items (garder le loader)
  const existingItems = systemList.querySelectorAll('.system-item');
  existingItems.forEach(item => item.remove());

  systems.forEach(sys => {
    const item = document.createElement('div');
    item.className = 'system-item';
    if (selectedSystem && selectedSystem.name === sys.name) {
      item.classList.add('selected');
    }

    const nameSpan = document.createElement('span');
    nameSpan.className = 'system-name';
    nameSpan.textContent = sys.name;

    const sourcesDiv = document.createElement('span');
    sourcesDiv.className = 'system-sources';

    sys.sources.forEach(src => {
      const badge = document.createElement('span');
      badge.className = `source-badge ${src.type}${src.recommended ? ' recommended' : ''}`;
      badge.textContent = src.type === 'no-intro' ? 'No-Intro' : 'Redump';
      sourcesDiv.appendChild(badge);
    });

    item.appendChild(nameSpan);
    item.appendChild(sourcesDiv);

    item.addEventListener('click', () => selectSystem(sys));
    systemList.appendChild(item);
  });

  systemCounter.textContent = `${systems.length} système${systems.length > 1 ? 's' : ''}`;
}

function renderMameVersions(versions: MameVersion[]) {
  const existingItems = mameList.querySelectorAll('.mame-item');
  existingItems.forEach(item => item.remove());

  versions.forEach(ver => {
    const item = document.createElement('div');
    item.className = 'mame-item';
    if (selectedMameVersion && selectedMameVersion.version === ver.version) {
      item.classList.add('selected');
    }

    const leftDiv = document.createElement('div');
    const versionSpan = document.createElement('span');
    versionSpan.className = 'mame-version';
    versionSpan.textContent = `MAME ${ver.version}`;
    leftDiv.appendChild(versionSpan);

    if (ver.date) {
      const dateSpan = document.createElement('span');
      dateSpan.className = 'mame-date';
      dateSpan.textContent = ` (${ver.date})`;
      leftDiv.appendChild(dateSpan);
    }

    item.appendChild(leftDiv);

    const rightDiv = document.createElement('div');
    if (ver.isLatest) {
      const badge = document.createElement('span');
      badge.className = 'mame-badge';
      badge.textContent = 'Dernière version';
      rightDiv.appendChild(badge);
    }
    if (ver.recalboxTag) {
      const badge = document.createElement('span');
      badge.className = 'mame-badge recalbox';
      badge.textContent = ver.recalboxTag;
      rightDiv.appendChild(badge);
    }
    item.appendChild(rightDiv);

    item.addEventListener('click', () => selectMameVersion(ver));
    mameList.appendChild(item);
  });

  mameCounter.textContent = `${versions.length} version${versions.length > 1 ? 's' : ''}`;
}

// ==========================================
// Sélection
// ==========================================

function selectSystem(sys: DatSystemInfo) {
  selectedSystem = sys;

  // Mettre à jour la sélection visuelle
  systemList.querySelectorAll('.system-item').forEach(item => {
    const name = item.querySelector('.system-name')?.textContent;
    item.classList.toggle('selected', name === sys.name);
  });

  // Afficher la sélection de source si plusieurs sources
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
        tag.textContent = ' (recommandé)';
        label.appendChild(tag);
        selectedSource = src.type;
      }

      radio.addEventListener('change', () => {
        selectedSource = src.type;
        updateNoIntroParamsVisibility();
        updateDownloadButton();
      });

      sourceRadioGroup.appendChild(label);
    });
  } else {
    sourceSelection.classList.remove('visible');
    selectedSource = sys.sources[0]?.type || null;
  }

  updateNoIntroParamsVisibility();
  updateDownloadButton();
}

function selectMameVersion(ver: MameVersion) {
  selectedMameVersion = ver;

  mameList.querySelectorAll('.mame-item').forEach(item => {
    const versionText = item.querySelector('.mame-version')?.textContent;
    item.classList.toggle('selected', versionText === `MAME ${ver.version}`);
  });

  updateDownloadButton();
}

function updateNoIntroParamsVisibility() {
  const showParams = selectedSource === 'no-intro';
  nointroParams.classList.toggle('visible', showParams);
}

function updateDownloadButton() {
  if (currentTab === 'systems') {
    btnDownload.disabled = !selectedSystem || !selectedSource;
  } else {
    btnDownload.disabled = !selectedMameVersion;
  }
}

// ==========================================
// Gestion des onglets
// ==========================================

function setupTabSwitching() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = (btn as HTMLElement).dataset.tab as 'systems' | 'mame';
      currentTab = tabId;

      // Activer l'onglet
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      document.getElementById(`tab-${tabId}`)?.classList.add('active');

      // Charger les données MAME au premier accès
      if (tabId === 'mame' && allMameVersions.length === 0) {
        loadMameVersions();
      }

      updateDownloadButton();
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
    const filtered = allSystems.filter(sys => sys.name.toLowerCase().includes(query));
    renderSystems(filtered);
  });

  mameSearch.addEventListener('input', () => {
    const query = mameSearch.value.toLowerCase().trim();
    if (!query) {
      renderMameVersions(allMameVersions);
      return;
    }
    const filtered = allMameVersions.filter(ver =>
      ver.version.includes(query) ||
      (ver.date && ver.date.toLowerCase().includes(query)) ||
      (ver.recalboxTag && ver.recalboxTag.toLowerCase().includes(query))
    );
    renderMameVersions(filtered);
  });
}

// ==========================================
// Dossier de destination
// ==========================================

function setupBrowseFolder() {
  document.getElementById('browse-folder')?.addEventListener('click', async () => {
    const folder = await window.api.selectDownloadFolder();
    if (folder) {
      destFolderInput.value = folder;
    }
  });
}

// ==========================================
// Téléchargement
// ==========================================

function setupDownloadButton() {
  btnDownload.addEventListener('click', async () => {
    const destFolder = destFolderInput.value;
    if (!destFolder) {
      setStatus('Veuillez sélectionner un dossier de destination', 'error');
      return;
    }

    btnDownload.disabled = true;

    if (currentTab === 'systems' && selectedSystem && selectedSource) {
      const sourceInfo = selectedSystem.sources.find(s => s.type === selectedSource);
      if (!sourceInfo) return;

      setStatus(`Téléchargement du DAT ${selectedSystem.name} depuis ${selectedSource === 'no-intro' ? 'No-Intro' : 'Redump'}...`, 'loading');

      const noIntroParams = selectedSource === 'no-intro' ? {
        includeBios: (document.getElementById('param-bios') as HTMLInputElement).checked,
        includeProto: (document.getElementById('param-proto') as HTMLInputElement).checked,
        includeBeta: (document.getElementById('param-beta') as HTMLInputElement).checked,
        includeDemo: (document.getElementById('param-demo') as HTMLInputElement).checked,
        includeSample: (document.getElementById('param-sample') as HTMLInputElement).checked,
      } : undefined;

      const result = await window.api.downloadDat({
        type: 'system',
        source: selectedSource,
        systemId: sourceInfo.id,
        destFolder,
        noIntroParams
      });

      if (result.success) {
        setStatus(`DAT téléchargé : ${result.filePath}`, 'success');
      } else {
        setStatus(result.error || 'Erreur inconnue', 'error');
      }
    } else if (currentTab === 'mame' && selectedMameVersion) {
      setStatus(`Téléchargement MAME ${selectedMameVersion.version}...`, 'loading');

      const result = await window.api.downloadDat({
        type: 'mame',
        mameVersion: selectedMameVersion.version,
        destFolder
      });

      if (result.success) {
        setStatus(`DAT MAME téléchargé : ${result.filePath}`, 'success');
      } else {
        setStatus(result.error || 'Erreur inconnue', 'error');
      }
    }

    updateDownloadButton();
  });
}

function setStatus(message: string, type: '' | 'success' | 'error' | 'loading' = '') {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`;
}

// ==========================================
// Fermeture
// ==========================================

function setupCloseButton() {
  document.getElementById('btn-close')?.addEventListener('click', () => {
    window.close();
  });
}

// ==========================================
// Lancement
// ==========================================

document.addEventListener('DOMContentLoaded', init);
