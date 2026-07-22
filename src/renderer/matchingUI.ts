// src/renderer/matchingUI.ts
// Module pour l'affichage du matching des ROMs dans l'UI

import { t } from './i18n.js';

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
  archiveIsPerfect: boolean;
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

/**
 * Génère le HTML du résumé de matching (volet gauche).
 * Utilisé par le rapport normal, le rapport d'erreur ("?") et le rapport initial.
 */
function buildMatchingSummaryHtml(counts: {
  total: string | number; totalRoms: string | number;
  complete: string | number; completeRoms: string | number;
  partial: string | number; partialRoms: string | number;
  missing: string | number; missingRoms: string | number;
}, overviewIcon: string = '📈'): string {
  const row = (icon: string, label: string, main: string | number, roms: string | number) => `
    <div class="summary-item">
      <span class="summary-icon">${icon}</span>
      <span class="summary-label">${label}</span>
      <span class="summary-count">
        <span class="summary-count-main">${main}</span>
        <span class="summary-count-roms">${t('matching.filesCount', { count: roms })}</span>
      </span>
    </div>`;

  return `
    <div class="matching-summary">
      ${row(overviewIcon, t('matching.overview'), counts.total, counts.totalRoms)}
      ${row('✅', t('matching.completeGames'), counts.complete, counts.completeRoms)}
      ${row('⚠️', t('matching.partialGames'), counts.partial, counts.partialRoms)}
      ${row('❌', t('matching.missingGames'), counts.missing, counts.missingRoms)}

      <div class="summary-item clickable" data-action="show-missing-roms">
        <span class="summary-icon">🔍</span>
        <span class="summary-label">${t('matching.missingRoms')}</span>
      </div>

      <div class="summary-item clickable" data-action="export-report">
        <span class="summary-icon">📄</span>
        <span class="summary-label">${t('matching.exportReport')}</span>
      </div>
    </div>
  `;
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
    container.innerHTML = buildMatchingSummaryHtml({
      total: totalCount, totalRoms: totalRomsCount,
      complete: completeCount, completeRoms: completeRomsCount,
      partial: partialCount, partialRoms: partialRomsCount,
      missing: missingCount, missingRoms: missingRomsCount
    });

    // Ajouter les event listeners uniquement pour les actions
    initMatchingReportListeners(container, hasData);
  } catch (error: any) {
    console.error('Error while displaying the matching report:', error);

    // Même en cas d'erreur, afficher le rapport avec "?"
    container.innerHTML = buildMatchingSummaryHtml({
      total: '?', totalRoms: '?',
      complete: '?', completeRoms: '?',
      partial: '?', partialRoms: '?',
      missing: '?', missingRoms: '?'
    });

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
        alert(t('matching.noDataAlert'));
      }
    });
  }

  const exportBtn = container.querySelector('[data-action="export-report"]');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      if (hasData) {
        exportMatchingReport();
      } else {
        alert(t('matching.noDataAlert'));
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
      alert(t('matching.allFound'));
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
            <h2>${t('matching.missingModalTitle', { count: missingRoms.length })}</h2>
            <button class="close-modal">×</button>
          </div>
          <div class="modal-body">
    `;

    romsByGame.forEach((roms, gameName) => {
      html += `
        <div class="missing-game-group">
          <h3>${gameName} (${t('matching.filesCount', { count: roms.length })})</h3>
          <ul>
            ${roms.map((rom: RomMatch) => `<li>${rom.datRomName}</li>`).join('')}
          </ul>
        </div>
      `;
    });

    html += `
          </div>
          <div class="modal-footer">
            <button class="btn-export-missing">${t('matching.exportList')}</button>
            <button class="btn-close-modal">${t('common.closeWindow')}</button>
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
    console.error('Error while displaying missing ROMs:', error);
    alert(t('matching.displayError'));
  }
}

/**
 * Exporte le rapport de matching complet
 */
async function exportMatchingReport(): Promise<void> {
  try {
    const result = await window.api.exportMatchingReport();
    if (result) {
      alert(t('matching.exportSuccess', { path: result.filePath }));
    }
  } catch (error) {
    console.error('Error while exporting the report:', error);
    alert(t('matching.exportError'));
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
  let text = `${t('matching.missingListHeader', { count: missingRoms.length })}\r\n`;
  text += `${t('matching.generatedOn', { date: new Date().toLocaleString() })}\r\n\r\n`;

  romsByGame.forEach((roms, gameName) => {
    text += `${gameName} (${t('matching.filesCount', { count: roms.length })}):\r\n`;
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
      alert(t('matching.noRomsForGame'));
      return;
    }

    const gameName = roms[0].game_name || t('matching.unknownGame');

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
                  <th>${t('matching.tableStatus')}</th>
                  <th>${t('matching.tableRom')}</th>
                  <th>${t('matching.tableLocation')}</th>
                  <th>${t('matching.tableType')}</th>
                </tr>
              </thead>
              <tbody>
    `;

    roms.forEach((rom: RomInfo) => {
      const match = matchMap.get(rom.id);
      const icon = match ? '✅' : '❌';
      const location = match?.scannedFileName || match?.archiveFileName || t('matching.notFound');
      const archiveType = match?.archiveType || (match?.scannedFileName ? t('matching.uncompressed') : '-');
      const statusClass = match ? 'rom-found' : 'rom-missing';

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
            <button class="btn-close-modal">${t('common.closeWindow')}</button>
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
    console.error('Error while displaying game details:', error);
    alert(t('matching.gameDetailsError'));
  }
}

// ========================================
// INITIALISATION
// ========================================

/**
 * Initialise le module de matching UI
 */
export function initMatchingUI(): void {
  console.log('📊 Matching UI initialized');
  
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

  console.log('DEBUG displayInitialReport - Container found, generating HTML');

  // Tous les jeux et fichiers sont manquants car aucun matching n'a été effectué
  container.innerHTML = buildMatchingSummaryHtml({
    total: gamesCount, totalRoms: romsCount,
    complete: 0, completeRoms: 0,
    partial: 0, partialRoms: 0,
    missing: gamesCount, missingRoms: romsCount
  }, '📊');

  // Ajouter les event listeners (mais désactiver les actions car pas de matching)
  initMatchingReportListeners(container, false);
}
