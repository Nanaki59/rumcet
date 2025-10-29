// src/renderer/settings.ts

type ArchiveFormat = '7z' | 'zip' | 'chd';

interface AppSettings {
  defaultDatFolder: string;
  defaultDatabaseFolder: string;
  defaultRomsFolder: string;
  unmatchedRomsFolder: string;
  theme: 'light' | 'dark';
  language: 'fr' | 'en';
  autoScanOnStartup: boolean;
  
  // Paramètres de compression
  compressionLevel: 'fastest' | 'normal' | 'maximum';
  recreateArchivesIfNeeded: boolean;
  archiveFormatPriority: ArchiveFormat[];
  useBestCompression: boolean;
  solidArchive: boolean;
  multithreading: boolean;
}

let currentFormatPriority: ArchiveFormat[] = ['chd', '7z', 'zip'];

let currentSettings: AppSettings;

// Charger les paramètres au démarrage
window.addEventListener('DOMContentLoaded', async () => {
  console.log('Chargement des paramètres...');
  await loadSettings();
});

async function loadSettings(): Promise<void> {
  try {
    console.log('Récupération des paramètres depuis l\'API...');
    currentSettings = await window.api.getSettings();
    console.log('Paramètres reçus:', currentSettings);
    
    // Remplir les champs
    const defaultDatFolder = document.getElementById('defaultDatFolder') as HTMLInputElement;
    const defaultDatabaseFolder = document.getElementById('defaultDatabaseFolder') as HTMLInputElement;
    const defaultRomsFolder = document.getElementById('defaultRomsFolder') as HTMLInputElement;
    const unmatchedRomsFolder = document.getElementById('unmatchedRomsFolder') as HTMLInputElement;
    const theme = document.getElementById('theme') as HTMLSelectElement;
    const language = document.getElementById('language') as HTMLSelectElement;
    const autoScanOnStartup = document.getElementById('autoScanOnStartup') as HTMLInputElement;

    if (defaultDatFolder) defaultDatFolder.value = currentSettings.defaultDatFolder || '';
    if (defaultDatabaseFolder) defaultDatabaseFolder.value = currentSettings.defaultDatabaseFolder || '';
    if (defaultRomsFolder) defaultRomsFolder.value = currentSettings.defaultRomsFolder || '';
    if (unmatchedRomsFolder) unmatchedRomsFolder.value = currentSettings.unmatchedRomsFolder || '';
    if (theme) theme.value = currentSettings.theme || 'light';
    if (language) language.value = currentSettings.language || 'fr';
    if (autoScanOnStartup) autoScanOnStartup.checked = currentSettings.autoScanOnStartup || false;
    
    // Charger l'ordre de priorité des formats
    if (currentSettings.archiveFormatPriority && Array.isArray(currentSettings.archiveFormatPriority)) {
      currentFormatPriority = currentSettings.archiveFormatPriority;
    }

    // Remplir les champs de compression
    const compressionLevel = document.getElementById('compressionLevel') as HTMLSelectElement;
    if (compressionLevel) compressionLevel.value = currentSettings.compressionLevel || 'normal';
    
    const recreateArchivesIfNeeded = document.getElementById('recreateArchivesIfNeeded') as HTMLInputElement;
    if (recreateArchivesIfNeeded) recreateArchivesIfNeeded.checked = currentSettings.recreateArchivesIfNeeded || false;
    
    const useBestCompression = document.getElementById('useBestCompression') as HTMLInputElement;
    if (useBestCompression) {
      useBestCompression.checked = currentSettings.useBestCompression || false;
      toggleBestCompressionWarning(useBestCompression.checked);
    }
    
    const solidArchive = document.getElementById('solidArchive') as HTMLInputElement;
    if (solidArchive) solidArchive.checked = currentSettings.solidArchive !== undefined ? currentSettings.solidArchive : true;
    
    const multithreading = document.getElementById('multithreading') as HTMLInputElement;
    if (multithreading) multithreading.checked = currentSettings.multithreading !== undefined ? currentSettings.multithreading : true;
    
    // ⭐ Afficher l'ordre de priorité
    renderFormatPriorityList();

    console.log('Paramètres chargés dans l\'interface');
  } catch (error) {
    console.error('Erreur lors du chargement des paramètres:', error);
  }
}

async function browseFolder(fieldId: string): Promise<void> {
  console.log('Sélection d\'un dossier pour:', fieldId);
  
  // Déterminer le type de dossier selon le fieldId
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
    console.log('Appel de l\'API pour sélectionner le dossier de type:', folderType);
    const folderPath = await window.api.selectSettingsFolder(folderType);
    console.log('Dossier sélectionné:', folderPath);

    if (folderPath) {
      const inputElement = document.getElementById(fieldId) as HTMLInputElement;
      if (inputElement) {
        inputElement.value = folderPath;
        (currentSettings as any)[fieldId] = folderPath;
        console.log('Valeur mise à jour dans l\'interface et les paramètres');
      }
    }
  } catch (error) {
    console.error('Erreur lors de la sélection du dossier:', error);
  }
}

async function saveSettings(): Promise<void> {
  try {
    console.log('Sauvegarde des paramètres...');
    
    // Collecter les valeurs
    const newSettings: AppSettings = {
      defaultDatFolder: (document.getElementById('defaultDatFolder') as HTMLInputElement).value,
      defaultDatabaseFolder: (document.getElementById('defaultDatabaseFolder') as HTMLInputElement).value,
      defaultRomsFolder: (document.getElementById('defaultRomsFolder') as HTMLInputElement).value,
      unmatchedRomsFolder: (document.getElementById('unmatchedRomsFolder') as HTMLInputElement).value,
      theme: (document.getElementById('theme') as HTMLSelectElement).value as 'light' | 'dark',
      language: (document.getElementById('language') as HTMLSelectElement).value as 'fr' | 'en',
      autoScanOnStartup: (document.getElementById('autoScanOnStartup') as HTMLInputElement).checked,
      
      // Paramètres de compression
      compressionLevel: (document.getElementById('compressionLevel') as HTMLSelectElement).value as any,
      recreateArchivesIfNeeded: (document.getElementById('recreateArchivesIfNeeded') as HTMLInputElement).checked,
      archiveFormatPriority: currentFormatPriority,
      useBestCompression: (document.getElementById('useBestCompression') as HTMLInputElement).checked,
      solidArchive: (document.getElementById('solidArchive') as HTMLInputElement).checked,
      multithreading: (document.getElementById('multithreading') as HTMLInputElement).checked
    };

    console.log('Nouveaux paramètres à sauvegarder:', newSettings);

    // Sauvegarder
    await window.api.updateSettings(newSettings);
    console.log('Paramètres sauvegardés avec succès');
    
    // Fermer la fenêtre
    window.close();
  } catch (error) {
    console.error('Erreur lors de l\'enregistrement:', error);
    alert('Erreur lors de l\'enregistrement : ' + (error as Error).message);
  }
}

function cancel(): void {
  window.close();
}

async function resetToDefaults(): Promise<void> {
  if (confirm('Êtes-vous sûr de vouloir réinitialiser tous les paramètres ?')) {
    try {
      await window.api.resetSettings();
      await loadSettings();
    } catch (error) {
      console.error('Erreur lors de la réinitialisation:', error);
    }
  }
}

/**
 * Affiche la liste des formats dans l'ordre de priorité
 */
function renderFormatPriorityList(): void {
  const container = document.getElementById('formatPriorityList');
  if (!container) return;
  
  container.innerHTML = '';
  
  currentFormatPriority.forEach((format, index) => {
    const item = createFormatPriorityItem(format, index);
    container.appendChild(item);
  });
  
  updateFormatAddSelect();
}

/**
 * Crée un élément de la liste de priorité
 */
function createFormatPriorityItem(format: ArchiveFormat, index: number): HTMLElement {
  const item = document.createElement('div');
  item.className = 'format-priority-item';
  item.draggable = true;
  item.dataset.format = format;
  item.dataset.index = index.toString();
  
  // Numéro d'ordre
  const order = document.createElement('span');
  order.className = 'format-order';
  order.textContent = `${index + 1}.`;
  
  // Nom du format
  const name = document.createElement('span');
  name.className = `format-name format-${format}`;
  name.textContent = getFormatDisplayName(format);
  
  // Actions
  const actions = document.createElement('div');
  actions.className = 'format-actions';
  
  // Bouton monter
  if (index > 0) {
    const btnUp = document.createElement('button');
    btnUp.className = 'btn-icon';
    btnUp.innerHTML = '⬆';
    btnUp.title = 'Monter';
    btnUp.onclick = () => moveFormat(index, index - 1);
    actions.appendChild(btnUp);
  }
  
  // Bouton descendre
  if (index < currentFormatPriority.length - 1) {
    const btnDown = document.createElement('button');
    btnDown.className = 'btn-icon';
    btnDown.innerHTML = '⬇';
    btnDown.title = 'Descendre';
    btnDown.onclick = () => moveFormat(index, index + 1);
    actions.appendChild(btnDown);
  }
  
  // Bouton supprimer (uniquement si plus d'un format)
  /*if (currentFormatPriority.length > 1) {
    const btnDelete = document.createElement('button');
    btnDelete.className = 'btn-icon btn-delete';
    btnDelete.innerHTML = '🗑';
    btnDelete.title = 'Supprimer';
    btnDelete.onclick = () => removeFormat(index);
    actions.appendChild(btnDelete);
  }*/
  
  item.appendChild(order);
  item.appendChild(name);
  item.appendChild(actions);
  
  // Gestion du drag & drop
  item.addEventListener('dragstart', handleDragStart);
  item.addEventListener('dragover', handleDragOver);
  item.addEventListener('drop', handleDrop);
  item.addEventListener('dragend', handleDragEnd);
  
  return item;
}

/**
 * Obtient le nom d'affichage d'un format
 */
function getFormatDisplayName(format: ArchiveFormat): string {
  const names: Record<ArchiveFormat, string> = {
    '7z': '7-Zip (7Z)',
    'zip': 'ZIP',
    'chd': 'CHD (Compressed Hunks of Data)'
  };
  return names[format] || format.toUpperCase();
}

/**
 * Déplace un format dans la liste
 */
function moveFormat(fromIndex: number, toIndex: number): void {
  const format = currentFormatPriority.splice(fromIndex, 1)[0];
  currentFormatPriority.splice(toIndex, 0, format);
  renderFormatPriorityList();
}

/**
 * Supprime un format de la liste
 */
function removeFormat(index: number): void {
  if (currentFormatPriority.length <= 1) {
    alert('Vous devez conserver au moins un format d\'archive !');
    return;
  }
  currentFormatPriority.splice(index, 1);
  renderFormatPriorityList();
}

/**
 * Ajoute un format à la liste
 */
function addFormat(): void {
  const select = document.getElementById('formatToAdd') as HTMLSelectElement;
  const format = select.value as ArchiveFormat;
  
  if (!format) {
    alert('Veuillez sélectionner un format à ajouter');
    return;
  }
  
  if (currentFormatPriority.includes(format)) {
    alert('Ce format est déjà dans la liste');
    return;
  }
  
  currentFormatPriority.push(format);
  renderFormatPriorityList();
  select.value = '';
}

/**
 * Met à jour le select des formats disponibles
 */
function updateFormatAddSelect(): void {
  const select = document.getElementById('formatToAdd') as HTMLSelectElement;
  if (!select) return;
  
  // Désactiver les options déjà présentes
  const allFormats: ArchiveFormat[] = ['7z', 'zip', 'chd'];
  
  Array.from(select.options).forEach(option => {
    if (option.value) {
      option.disabled = currentFormatPriority.includes(option.value as ArchiveFormat);
    }
  });
  
  // Désactiver le bouton si tous les formats sont utilisés
  const allFormatsUsed = allFormats.every(f => currentFormatPriority.includes(f));
  const btnAdd = select.nextElementSibling as HTMLButtonElement;
  if (btnAdd) {
    btnAdd.disabled = allFormatsUsed;
  }
}

/**
 * Gestion du drag & drop
 */
let draggedElement: HTMLElement | null = null;

function handleDragStart(this: HTMLElement, e: DragEvent): void {
  draggedElement = this;
  this.classList.add('dragging');
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
  }
}

function handleDragOver(this: HTMLElement, e: DragEvent): void {
  if (e.preventDefault) {
    e.preventDefault();
  }
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move';
  }
  
  // Ajouter un indicateur visuel
  const items = Array.from(document.querySelectorAll('.format-priority-item'));
  items.forEach(item => item.classList.remove('drag-over'));
  this.classList.add('drag-over');
}

function handleDrop(this: HTMLElement, e: DragEvent): void {
  if (e.stopPropagation) {
    e.stopPropagation();
  }
  
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

/**
 * Affiche/masque l'avertissement "Best compression"
 */
function toggleBestCompressionWarning(show: boolean): void {
  const warning = document.getElementById('bestCompressionWarning');
  if (!warning) return;
  
  if (show) {
    warning.style.display = 'block';
    warning.classList.add('show');
    
    // Demander confirmation
    /*const confirmed = confirm(
      '⚠️ ATTENTION : Meilleure compression\n\n' +
      'Cette option va tester TOUS les formats d\'archives disponibles pour chaque jeu.\n\n' +
      'Impact sur les performances :\n' +
      '• Temps de traitement : x3 à x5 plus lent\n' +
      '• Utilisation CPU : Maximale\n' +
      '• Utilisation disque : Temporairement doublée\n\n' +
      'Voulez-vous vraiment activer cette option ?'
    );
    
    if (!confirmed) {
      const checkbox = document.getElementById('useBestCompression') as HTMLInputElement;
      if (checkbox) checkbox.checked = false;
      warning.style.display = 'none';
    }*/
  } else {
    warning.style.display = 'none';
  }
}

// Rendre les fonctions disponibles globalement pour les onclick
(window as any).browseFolder = browseFolder;
(window as any).saveSettings = saveSettings;
(window as any).cancel = cancel;
(window as any).resetToDefaults = resetToDefaults;
(window as any).addFormat = addFormat;
(window as any).toggleBestCompressionWarning = toggleBestCompressionWarning;
