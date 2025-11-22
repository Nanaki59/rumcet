// src/renderer/matchingUI.ts
// Module pour l'affichage du matching des ROMs dans l'UI

// ========================================
// TYPES LOCAUX (depuis global.d.ts)
// ========================================

interface GameMatchStatus {
  gameId: number;
  gameName: string;
  totalRoms: number;
  matchedRoms: number;
  status: 'complete' | 'partial' | 'missing';
}

interface RomMatch {
  datRomId: number;
  datRomName: string;
  gameName: string;
  gameId: number;
  scannedFileId?: number;
  scannedFileName?: string;
  scannedFilePath?: string;
  archiveContentId?: number;
  archiveFileName?: string;
  archiveType?: string;
  matchType: 'perfect' | 'none';
  matchedBy: string[];
  priorityScore: number;
}

interface MatchingStats {
  totalGames: number;
  completeGames: number;
  partialGames: number;
  missingGames: number;
  totalDatRoms: number;
  matchedRoms: number;
  missingRoms: number;
  extraFiles: number;
}

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
  game_name?: string;
}

// ========================================
// HELPERS D'AFFICHAGE
// ========================================

/**
 * Retourne l'icône correspondant au statut de matching d'un jeu
 */
export function getGameStatusIcon(status: 'complete' | 'partial' | 'missing'): string {
  switch (status) {
    case 'complete':
      return '✅';
    case 'partial':
      return '⚠️';
    case 'missing':
      return '❌';
    default:
      return '❓';
  }
}

/**
 * Retourne la classe CSS correspondant au statut
 */
export function getGameStatusClass(status: 'complete' | 'partial' | 'missing'): string {
  return `status-${status}`;
}

/**
 * Formate le compteur de fichiers matchés
 */
export function formatMatchCount(matched: number, total: number): string {
  return `${matched}/${total}`;
}

// ========================================
// SECTION : RAPPORT DE MATCHING (VOLET GAUCHE)
// ========================================

/**
 * Affiche le rapport de matching dans le volet gauche
 */
export async function displayMatchingReport(containerId: string = 'matching-report'): Promise<void> {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error(`Container #${containerId} not found`);
    return;
  }

  try {
    // Récupérer les statuts des jeux
    const gameStatuses = await window.api.getGameMatchStatuses();

    // Déterminer si on a des données
    const hasData = gameStatuses && gameStatuses.length > 0;

    // Calculer les stats ou utiliser "?" si pas de données
    let completeCount: string | number = '?';
    let partialCount: string | number = '?';
    let missingCount: string | number = '?';
    let totalCount: string | number = '?';
    let totalRomsCount: string | number = '?';
    let completeRomsCount: string | number = '?';
    let partialRomsCount: string | number = '?';
    let missingRomsCount: string | number = '?';

    if (hasData) {
      const completeGames = gameStatuses.filter((gs: GameMatchStatus) => gs.status === 'complete');
      const partialGames = gameStatuses.filter((gs: GameMatchStatus) => gs.status === 'partial');
      const missingGames = gameStatuses.filter((gs: GameMatchStatus) => gs.status === 'missing');

      completeCount = completeGames.length;
      partialCount = partialGames.length;
      missingCount = missingGames.length;
      totalCount = gameStatuses.length;

      // Calculer le nombre total de ROMs pour chaque catégorie
      totalRomsCount = gameStatuses.reduce((sum: number, gs: GameMatchStatus) => sum + gs.totalRoms, 0);
      completeRomsCount = completeGames.reduce((sum: number, gs: GameMatchStatus) => sum + gs.matchedRoms, 0);
      partialRomsCount = partialGames.reduce((sum: number, gs: GameMatchStatus) => sum + gs.matchedRoms, 0);
      // ROMs manquantes = Total ROMs DAT - ROMs matchées dans jeux complets - ROMs matchées dans jeux partiels
      missingRomsCount = (totalRomsCount as number) - (completeRomsCount as number) - (partialRomsCount as number);
    }

    // Générer le HTML - toujours le même format
    container.innerHTML = `
      <div class="matching-summary">
        <div class="summary-item">
          <span class="summary-icon">📈</span>
          <span class="summary-label">Vue d'ensemble</span>
          <span class="summary-count">
            <span class="summary-count-main">${totalCount}</span>
            <span class="summary-count-roms">${totalRomsCount} fichier(s)</span>
          </span>
        </div>
        
        <div class="summary-item">
          <span class="summary-icon">✅</span>
          <span class="summary-label">Jeux complets</span>
          <span class="summary-count">
            <span class="summary-count-main">${completeCount}</span>
            <span class="summary-count-roms">${completeRomsCount} fichier(s)</span>
          </span>
        </div>
        
        <div class="summary-item">
          <span class="summary-icon">⚠️</span>
          <span class="summary-label">Jeux partiels</span>
          <span class="summary-count">
            <span class="summary-count-main">${partialCount}</span>
            <span class="summary-count-roms">${partialRomsCount} fichier(s)</span>
          </span>
        </div>
        
        <div class="summary-item">
          <span class="summary-icon">❌</span>
          <span class="summary-label">Jeux manquants</span>
          <span class="summary-count">
            <span class="summary-count-main">${missingCount}</span>
            <span class="summary-count-roms">${missingRomsCount} fichier(s)</span>
          </span>
        </div>
        
        <div class="summary-item clickable" data-action="show-missing-roms">
          <span class="summary-icon">🔍</span>
          <span class="summary-label">ROMs manquantes</span>
        </div>
        
        <div class="summary-item clickable" data-action="export-report">
          <span class="summary-icon">📄</span>
          <span class="summary-label">Exporter le rapport</span>
        </div>
      </div>
    `;

    // Ajouter les event listeners uniquement pour les actions
    initMatchingReportListeners(container, hasData);
  } catch (error: any) {
    console.error('Erreur lors de l\'affichage du rapport de matching:', error);
    
    // Même en cas d'erreur, afficher le rapport avec "?"
    container.innerHTML = `
      <div class="matching-summary">
        <div class="summary-item">
          <span class="summary-icon">📈</span>
          <span class="summary-label">Vue d'ensemble</span>
          <span class="summary-count">
            <span class="summary-count-main">?</span>
            <span class="summary-count-roms">? fichier(s)</span>
          </span>
        </div>
        
        <div class="summary-item">
          <span class="summary-icon">✅</span>
          <span class="summary-label">Jeux complets</span>
          <span class="summary-count">
            <span class="summary-count-main">?</span>
            <span class="summary-count-roms">? fichier(s)</span>
          </span>
        </div>
        
        <div class="summary-item">
          <span class="summary-icon">⚠️</span>
          <span class="summary-label">Jeux partiels</span>
          <span class="summary-count">
            <span class="summary-count-main">?</span>
            <span class="summary-count-roms">? fichier(s)</span>
          </span>
        </div>
        
        <div class="summary-item">
          <span class="summary-icon">❌</span>
          <span class="summary-label">Jeux manquants</span>
          <span class="summary-count">
            <span class="summary-count-main">?</span>
            <span class="summary-count-roms">? fichier(s)</span>
          </span>
        </div>
        
        <div class="summary-item clickable" data-action="show-missing-roms">
          <span class="summary-icon">🔍</span>
          <span class="summary-label">ROMs manquantes</span>
        </div>
        
        <div class="summary-item clickable" data-action="export-report">
          <span class="summary-icon">📄</span>
          <span class="summary-label">Exporter le rapport</span>
        </div>
      </div>
    `;
    
    initMatchingReportListeners(container, false);
  }
}

/**
 * Initialise les event listeners du rapport de matching
 */
function initMatchingReportListeners(container: HTMLElement, hasData: boolean): void {
  // Ne PAS ajouter de filtres qui modifient la liste des jeux
  // Les entrées de statistiques ne sont plus cliquables
  
  // Actions uniquement sur les éléments avec data-action
  const showMissingBtn = container.querySelector('[data-action="show-missing-roms"]');
  if (showMissingBtn) {
    showMissingBtn.addEventListener('click', () => {
      if (hasData) {
        showMissingRomsModal();
      } else {
        alert('ℹ️ Aucune donnée de matching disponible.\nEffectuez d\'abord le matching des ROMs.');
      }
    });
  }

  const exportBtn = container.querySelector('[data-action="export-report"]');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      if (hasData) {
        exportMatchingReport();
      } else {
        alert('ℹ️ Aucune donnée de matching disponible.\nEffectuez d\'abord le matching des ROMs.');
      }
    });
  }
}

// ========================================
// MODALS ET ACTIONS
// ========================================

/**
 * Affiche la modal des ROMs manquantes
 */
async function showMissingRomsModal(): Promise<void> {
  try {
    const missingRoms = await window.api.getMissingRoms();
    
    if (missingRoms.length === 0) {
      alert('✅ Toutes les ROMs ont été trouvées !');
      return;
    }

    // Grouper par jeu
    const romsByGame = new Map<string, RomMatch[]>();
    missingRoms.forEach((rom: RomMatch) => {
      const existing = romsByGame.get(rom.gameName) || [];
      existing.push(rom);
      romsByGame.set(rom.gameName, existing);
    });

    // Générer le HTML
    let html = `
      <div class="modal-overlay" id="missing-roms-modal">
        <div class="modal-content">
          <div class="modal-header">
            <h2>❌ ROMs manquantes (${missingRoms.length})</h2>
            <button class="close-modal">×</button>
          </div>
          <div class="modal-body">
    `;

    romsByGame.forEach((roms, gameName) => {
      html += `
        <div class="missing-game-group">
          <h3>${gameName} (${roms.length} fichier${roms.length > 1 ? 's' : ''})</h3>
          <ul>
            ${roms.map((rom: RomMatch) => `<li>${rom.datRomName}</li>`).join('')}
          </ul>
        </div>
      `;
    });

    html += `
          </div>
          <div class="modal-footer">
            <button class="btn-export-missing">📄 Exporter la liste</button>
            <button class="btn-close-modal">Fermer</button>
          </div>
        </div>
      </div>
    `;

    // Afficher la modal
    const modalContainer = document.createElement('div');
    modalContainer.innerHTML = html;
    document.body.appendChild(modalContainer.firstElementChild!);

    // Event listeners
    const modal = document.getElementById('missing-roms-modal')!;
    modal.querySelector('.close-modal')?.addEventListener('click', () => modal.remove());
    modal.querySelector('.btn-close-modal')?.addEventListener('click', () => modal.remove());
    modal.querySelector('.btn-export-missing')?.addEventListener('click', () => {
      exportMissingRomsList(missingRoms);
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  } catch (error) {
    console.error('Erreur lors de l\'affichage des ROMs manquantes:', error);
    alert('❌ Erreur lors de l\'affichage des ROMs manquantes');
  }
}

/**
 * Exporte le rapport de matching complet
 */
async function exportMatchingReport(): Promise<void> {
  try {
    const result = await window.api.exportMatchingReport();
    if (result) {
      alert(`📄 Rapport exporté avec succès :\n${result.filePath}`);
    }
  } catch (error) {
    console.error('Erreur lors de l\'export du rapport:', error);
    alert('❌ Erreur lors de l\'export du rapport');
  }
}

/**
 * Exporte la liste des ROMs manquantes
 */
function exportMissingRomsList(missingRoms: RomMatch[]): void {
  // Grouper par jeu
  const romsByGame = new Map<string, RomMatch[]>();
  missingRoms.forEach((rom: RomMatch) => {
    const existing = romsByGame.get(rom.gameName) || [];
    existing.push(rom);
    romsByGame.set(rom.gameName, existing);
  });

  // Générer le texte
  let text = `ROMs manquantes (${missingRoms.length})\r\n`;
  text += `Générée le ${new Date().toLocaleString()}\r\n\r\n`;

  romsByGame.forEach((roms, gameName) => {
    text += `${gameName} (${roms.length} fichier${roms.length > 1 ? 's' : ''}):\r\n`;
    roms.forEach((rom: RomMatch) => {
      text += `  - ${rom.datRomName}\r\n`;
    });
    text += '\r\n';
  });

  // Télécharger le fichier
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `missing_roms_${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// ========================================
// DÉTAILS D'UN JEU
// ========================================

/**
 * Affiche les détails d'un jeu avec ses ROMs
 */
export async function showGameDetails(gameId: number): Promise<void> {
  try {
    // Récupérer les ROMs du jeu
    const roms = await window.api.listRomsByGame(gameId);
    
    if (roms.length === 0) {
      alert('❓ Aucune ROM trouvée pour ce jeu.');
      return;
    }

    const gameName = roms[0].game_name || 'Jeu inconnu';

    // Récupérer les statuts de matching existants depuis la base de données
    // NE PAS relancer le matching complet !
    const allStatuses = await window.api.getGameMatchStatuses();
    const gameStatus = allStatuses.find((s: GameMatchStatus) => s.gameId === gameId);
    
    // Récupérer les matches depuis la base de données (pas en relançant le matching)
    // On va créer une nouvelle API pour ça
    const matches = await window.api.getMatchesForGame(gameId);
    const matchMap = new Map<number, RomMatch>(matches.map((m: RomMatch) => [m.datRomId, m]));

    // Générer le HTML
    let html = `
      <div class="modal-overlay" id="game-details-modal">
        <div class="modal-content large">
          <div class="modal-header">
            <h2>${gameName}</h2>
            <button class="close-modal">×</button>
          </div>
          <div class="modal-body">
            <table class="roms-table">
              <thead>
                <tr>
                  <th>Statut</th>
                  <th>ROM</th>
                  <th>Emplacement</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
    `;

    roms.forEach((rom: RomInfo) => {
      const match = matchMap.get(rom.id);
      const icon = match?.matchType === 'perfect' ? '✅' : '❌';
      const location = match?.scannedFileName || match?.archiveFileName || 'Non trouvé';
      const archiveType = match?.archiveType || (match?.scannedFileName ? 'Non compressé' : '-');
      const statusClass = match?.matchType === 'perfect' ? 'rom-found' : 'rom-missing';

      html += `
        <tr class="${statusClass}">
          <td>${icon}</td>
          <td>${rom.name}</td>
          <td>${location}</td>
          <td>${archiveType}</td>
        </tr>
      `;
    });

    html += `
              </tbody>
            </table>
          </div>
          <div class="modal-footer">
            <button class="btn-close-modal">Fermer</button>
          </div>
        </div>
      </div>
    `;

    // Afficher la modal
    const modalContainer = document.createElement('div');
    modalContainer.innerHTML = html;
    document.body.appendChild(modalContainer.firstElementChild!);

    // Event listeners
    const modal = document.getElementById('game-details-modal')!;
    modal.querySelector('.close-modal')?.addEventListener('click', () => modal.remove());
    modal.querySelector('.btn-close-modal')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  } catch (error) {
    console.error('Erreur lors de l\'affichage des détails du jeu:', error);
    alert('❌ Erreur lors de l\'affichage des détails du jeu');
  }
}

// ========================================
// INITIALISATION
// ========================================

/**
 * Initialise le module de matching UI
 */
export function initMatchingUI(): void {
  console.log('📊 Matching UI initialisé');
  
  // Afficher le rapport de matching si le container existe
  const reportContainer = document.getElementById('matching-report');
  if (reportContainer) {
    displayMatchingReport();
  }
}

/**
 * Affiche le rapport initial après chargement du DAT (avant matching)
 * Affiche le nombre de jeux et de fichiers, avec tous en "manquants"
 */
export async function displayInitialReport(gamesCount: number, romsCount: number): Promise<void> {
  const container = document.getElementById('matching-report');

  console.log('DEBUG displayInitialReport - gamesCount:', gamesCount, 'romsCount:', romsCount);

  if (!container) {
    console.error(`Container #matching-report not found`);
    return;
  }

  console.log('DEBUG displayInitialReport - Container trouvé, génération du HTML');

  // Tous les jeux et fichiers sont manquants car aucun matching n'a été effectué
  container.innerHTML = `
    <div class="matching-summary">
      <div class="summary-item">
        <span class="summary-icon">📊</span>
        <span class="summary-label">Vue d'ensemble</span>
        <span class="summary-count">
          <span class="summary-count-main">${gamesCount}</span>
          <span class="summary-count-roms">${romsCount} fichier(s)</span>
        </span>
      </div>
      
      <div class="summary-item">
        <span class="summary-icon">✅</span>
        <span class="summary-label">Jeux complets</span>
        <span class="summary-count">
          <span class="summary-count-main">0</span>
          <span class="summary-count-roms">0 fichier(s)</span>
        </span>
      </div>
      
      <div class="summary-item">
        <span class="summary-icon">⚠️</span>
        <span class="summary-label">Jeux partiels</span>
        <span class="summary-count">
          <span class="summary-count-main">0</span>
          <span class="summary-count-roms">0 fichier(s)</span>
        </span>
      </div>
      
      <div class="summary-item">
        <span class="summary-icon">❌</span>
        <span class="summary-label">Jeux manquants</span>
        <span class="summary-count">
          <span class="summary-count-main">${gamesCount}</span>
          <span class="summary-count-roms">${romsCount} fichier(s)</span>
        </span>
      </div>
      
      <div class="summary-item clickable" data-action="show-missing-roms">
        <span class="summary-icon">🔍</span>
        <span class="summary-label">ROMs manquantes</span>
      </div>
      
      <div class="summary-item clickable" data-action="export-report">
        <span class="summary-icon">📄</span>
        <span class="summary-label">Exporter le rapport</span>
      </div>
    </div>
  `;

  // Ajouter les event listeners (mais désactiver les actions car pas de matching)
  initMatchingReportListeners(container, false);
}
