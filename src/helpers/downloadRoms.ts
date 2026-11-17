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

// src/helpers/downloadRoms.ts

import { Database, getMetadata } from '../database/init.js';
import {
  settingsManager,
  getEffectiveIncompleteRomsFolder,
  getEffectiveTempExtractionFolder
} from './settingsManager.js';
import { consolidateSingleGame } from './consolidateRoms.js';
import { detectSystemFromDatName, getSystemById } from '../config/systems.js';
import { compareHashes } from './matchRoms.js';
import { calculateFileHashes } from './hashCalculator.js';
import { ArchiveManager } from './archives/ArchiveManager.js';
import { OperationSignal, OperationAbortedError, raceAbort, throwIfAborted } from './operationSignal.js';
import type { RomDownloadProgress, RomDownloadResult, RomDownloadGameResult, DownloadSource, DownloadAttempt } from '../types/global.js';
import path from 'path';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { net, ClientRequest } from 'electron';

// ============================================
// TYPES INTERNES
// ============================================

interface DatRomInfo {
  id: number;
  name: string;
  size: number | null;
  crc32: string | null;
  md5: string | null;
  sha1: string | null;
}

interface MatchedFile {
  datRomId: number;
  datRomName: string;
  filePath: string;
  source: string; // nom de la source ayant fourni le fichier
}

type ProgressCallback = (progress: RomDownloadProgress) => void;

/**
 * Tentatives de téléchargement du jeu en cours (recherche locale, puis chaque
 * source × archive/fichier), affichées en tableau dans la modale. Chaque
 * modification réémet la progression du jeu.
 */
class AttemptReporter {
  private attempts: DownloadAttempt[] = [];

  constructor(private readonly emit: () => void) {}

  set(attempts: DownloadAttempt[]): void {
    this.attempts = attempts.map(a => ({ ...a }));
    this.emit();
  }

  update(id: string, patch: Partial<DownloadAttempt>): void {
    const attempt = this.attempts.find(a => a.id === id);
    if (attempt) {
      Object.assign(attempt, patch);
      this.emit();
    }
  }

  /** Les tentatives jamais lancées deviennent « inutiles » (jeu complet ou interrompu) */
  skipPending(): void {
    let changed = false;
    for (const attempt of this.attempts) {
      if (attempt.status === 'pending') {
        attempt.status = 'skipped';
        attempt.note = 'notNeeded';
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  snapshot(): DownloadAttempt[] {
    return this.attempts.map(a => ({ ...a }));
  }
}

const sourceKey = (source: DownloadSource, index: number) => source.id || `source-${index}`;
const archiveAttemptId = (source: DownloadSource, index: number, ext: string) => `${sourceKey(source, index)}|archive|${ext}`;
const fileAttemptId = (source: DownloadSource, index: number, fileName: string) => `${sourceKey(source, index)}|file|${fileName}`;
const LOCAL_ATTEMPT_ID = 'local';

/** Statut d'une tentative après vérification des fichiers obtenus */
function verificationStatus(matchedHere: number, remaining: number): DownloadAttempt['status'] {
  if (matchedHere === 0) return 'mismatch';
  return remaining === 0 ? 'verified' : 'partial';
}

/** Statut d'un téléchargement en échec : 404 = introuvable, sinon erreur */
function failureStatus(error: any): Pick<DownloadAttempt, 'status' | 'detail'> {
  const message = String(error?.message || error);
  return /HTTP 404/.test(message) ? { status: 'notFound' } : { status: 'failed', detail: message };
}

// ============================================
// RÉSOLUTION DES EXTENSIONS
// ============================================

/**
 * Construit l'URL de base pour une source × système en concaténant baseUrl et
 * le sous-dossier paramétré pour ce système (s'il existe), en éliminant les
 * doublons de '/' à la jointure.
 *
 * Exemple : baseUrl="https://site.com/" + subfolder="/psx/" → "https://site.com/psx"
 */
function resolveSourceBase(source: DownloadSource, systemId: string): string {
  const base = source.baseUrl.replace(/\/+$/, '');
  const sourceSystem = source.systems?.find(s => s.systemId === systemId);
  const sub = (sourceSystem?.subfolder || '').replace(/^\/+|\/+$/g, '');
  return sub ? `${base}/${sub}` : base;
}

/**
 * Résout la liste ordonnée des extensions à tester pour un couple source × système.
 * Retourne des entries `{ ext, isArchive }` où isArchive détermine le mode de recherche :
 *   - true  : tenter `gameName.ext`
 *   - false : tenter chaque `datRom.name` qui se termine par `.ext`
 *
 * 1) Si la source a un override pour ce système → utiliser activeExtensions tel quel
 * 2) Sinon, résolution globale via downloadSystemExtensions[systemId] → activeExtensions
 * 3) Si aucune entrée existante : fallback prudent ['7z', 'zip', 'rar'] en mode archive.
 */
type ResolvedExtensionEntry = { ext: string; isArchive: boolean };

function resolveExtensions(
  source: DownloadSource,
  systemId: string,
  settings: ReturnType<typeof settingsManager.getAll>
): ResolvedExtensionEntry[] {
  const dedup = (entries: { ext: string; isArchive: boolean }[]): ResolvedExtensionEntry[] => {
    const seen = new Set<string>();
    const out: ResolvedExtensionEntry[] = [];
    for (const e of entries) {
      const key = `${e.isArchive ? 'A' : 'R'}:${e.ext}`;
      if (e.ext && !seen.has(key)) { seen.add(key); out.push({ ext: e.ext, isArchive: e.isArchive }); }
    }
    return out;
  };

  // 1) Override au niveau source × système
  const sourceSystem = source.systems?.find(s => s.systemId === systemId);
  if (sourceSystem?.override?.activeExtensions?.length) {
    return dedup(sourceSystem.override.activeExtensions);
  }

  // 2) Résolution globale via downloadSystemExtensions
  const sysCfg = settings.downloadSystemExtensions?.find(s => s.systemId === systemId);
  if (sysCfg?.activeExtensions?.length) {
    return dedup(sysCfg.activeExtensions);
  }

  // 3) Fallback : extensions globales en mode archive
  const globals = settings.downloadExtensions ?? ['7z', 'zip', 'rar'];
  return dedup(globals.map(e => ({ ext: e.replace(/^\./, '').toLowerCase(), isArchive: true })));
}

// ============================================
// TÉLÉCHARGEMENT STREAMING
// ============================================

/** Requêtes HTTP en cours (pour l'arrêt forcé) */
const activeRequests = new Set<ClientRequest>();

/** Arrêt forcé : interrompt tous les téléchargements en cours. */
export function abortActiveDownloads(): void {
  for (const request of activeRequests) {
    try { request.abort(); } catch { /* déjà terminée */ }
  }
  activeRequests.clear();
}

function streamDownload(
  url: string,
  destPath: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = net.request(url);
    activeRequests.add(request);
    const forget = () => activeRequests.delete(request);
    request.on('abort', () => {
      forget();
      reject(new Error('Download aborted'));
    });

    request.on('response', (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400) {
        const location = response.headers['location'];
        const redirectUrl = Array.isArray(location) ? location[0] : location;
        if (redirectUrl) {
          const resolvedUrl = new URL(redirectUrl, url).toString();
          streamDownload(resolvedUrl, destPath, onProgress).then(resolve).catch(reject);
          return;
        }
      }

      if (response.statusCode === 404) {
        reject(new Error('HTTP 404'));
        return;
      }

      if (response.statusCode >= 400) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      const contentLength = response.headers['content-length'];
      const totalSize = parseInt(
        (Array.isArray(contentLength) ? contentLength[0] : contentLength) || '0',
        10
      );
      let downloaded = 0;

      const fileStream = createWriteStream(destPath);

      response.on('data', (chunk: Buffer) => {
        downloaded += chunk.length;
        fileStream.write(chunk);
        if (totalSize > 0 && onProgress) {
          onProgress(Math.round((downloaded / totalSize) * 100));
        }
      });

      response.on('end', () => {
        forget();
        fileStream.end(() => {
          resolve();
        });
      });

      response.on('error', (err: Error) => {
        forget();
        fileStream.close();
        reject(err);
      });
    });

    request.on('error', (err: Error) => {
      forget();
      reject(err);
    });
    request.end();
  });
}

// ============================================
// RECHERCHE LOCALE
// ============================================

async function searchLocalFiles(
  gameName: string,
  datRoms: DatRomInfo[],
  incompleteFolder: string | undefined,
  onProgress?: ProgressCallback,
  gameIndex?: number,
  totalGames?: number,
  attempts?: AttemptReporter
): Promise<Map<number, MatchedFile>> {
  const matchedFiles = new Map<number, MatchedFile>();

  if (!incompleteFolder) return matchedFiles;

  const gameFolder = path.join(incompleteFolder, gameName);

  try {
    await fs.access(gameFolder);
  } catch {
    attempts?.update(LOCAL_ATTEMPT_ID, { status: 'notFound' });
    return matchedFiles; // Dossier inexistant
  }
  attempts?.update(LOCAL_ATTEMPT_ID, { status: 'verifying' });

  onProgress?.({
    phase: 'local-search',
    currentGame: gameName,
    currentGameIndex: gameIndex || 0,
    totalGames: totalGames || 0,
    key: 'logs.download.progress.localSearch',
    params: { game: gameName }
  });

  try {
    const files = await fs.readdir(gameFolder);

    for (const fileName of files) {
      const filePath = path.join(gameFolder, fileName);
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;

      const hashes = await calculateFileHashes(filePath);

      for (const datRom of datRoms) {
        if (matchedFiles.has(datRom.id)) continue;

        const result = compareHashes(
          { crc32: datRom.crc32, md5: datRom.md5, sha1: datRom.sha1 },
          { crc32: hashes.crc32, md5: hashes.md5, sha1: hashes.sha1 }
        );

        if (result.matched) {
          matchedFiles.set(datRom.id, {
            datRomId: datRom.id,
            datRomName: datRom.name,
            filePath,
            source: 'local (incomplete)'
          });
          break;
        }
      }
    }
  } catch (error) {
    console.error(`Local search error ${gameFolder}:`, error);
  }

  attempts?.update(LOCAL_ATTEMPT_ID, {
    status: verificationStatus(matchedFiles.size, datRoms.length - matchedFiles.size),
    matched: matchedFiles.size,
    total: datRoms.length
  });
  return matchedFiles;
}

// ============================================
// TÉLÉCHARGEMENT ET VÉRIFICATION D'UN JEU
// ============================================

async function tryDownloadAndVerifyGame(
  gameName: string,
  datRoms: DatRomInfo[],
  sources: DownloadSource[],
  systemId: string,
  settings: ReturnType<typeof settingsManager.getAll>,
  tempFolder: string,
  matchedFiles: Map<number, MatchedFile>,
  onProgress?: ProgressCallback,
  gameIndex?: number,
  totalGames?: number,
  isCancelled?: () => boolean,
  attempts?: AttemptReporter
): Promise<{ matchedFiles: Map<number, MatchedFile>; partial: boolean }> {
  const gameTempDir = path.join(tempFolder, gameName);
  await fs.mkdir(gameTempDir, { recursive: true });

  const archiveManager = new ArchiveManager();
  const remainingDatRoms = () => datRoms.filter(r => !matchedFiles.has(r.id));

  for (const [sourceIndex, source] of sources.entries()) {
    if (!source.enabled) continue;
    if (remainingDatRoms().length === 0) break;
    if (isCancelled?.()) break;

    const entries = resolveExtensions(source, systemId, settings);
    const baseUrl = resolveSourceBase(source, systemId);

    // Une seule boucle : ordre = priorité de recherche définie dans activeExtensions
    for (const entry of entries) {
      if (remainingDatRoms().length === 0) break;
      if (isCancelled?.()) break;

      if (entry.isArchive) {
        // ─── Mode archive : tenter gameName.ext, extraire, hasher, matcher ───
        const url = `${baseUrl}/${encodeURIComponent(gameName)}.${entry.ext}`;
        const destPath = path.join(gameTempDir, `_download.${entry.ext}`);
        const attemptId = archiveAttemptId(source, sourceIndex, entry.ext);
        const remainingBefore = remainingDatRoms().length;
        attempts?.update(attemptId, { status: 'running' });

        console.log(`[Download archive] Trying: ${url}`);
        const downloadProgress: RomDownloadProgress = {
          phase: 'downloading',
          currentGame: gameName,
          currentGameIndex: gameIndex || 0,
          totalGames: totalGames || 0,
          currentSource: source.name,
          currentExtension: entry.ext,
          key: 'logs.download.progress.trying',
          params: { game: gameName, url }
        };
        onProgress?.(downloadProgress);

        try {
          await streamDownload(url, destPath, percent => {
            attempts?.update(attemptId, { percent });
            onProgress?.({ ...downloadProgress, downloadPercent: percent });
          });
          console.log(`[Download archive] OK : ${url}`);
        } catch (err: any) {
          console.log(`[Download archive] Failed (${err.message}): ${url}`);
          attempts?.update(attemptId, failureStatus(err));
          try { await fs.unlink(destPath); } catch { /* ignore */ }
          continue;
        }
        const downloadedSize = await fs.stat(destPath).then(st => st.size).catch(() => undefined);
        attempts?.update(attemptId, { status: 'extracting', size: downloadedSize, percent: undefined });

        onProgress?.({
          phase: 'extracting',
          currentGame: gameName,
          currentGameIndex: gameIndex || 0,
          totalGames: totalGames || 0,
          key: 'logs.download.progress.extracting',
          params: { game: gameName }
        });

        const extractDir = path.join(gameTempDir, `_extract_${entry.ext}`);
        await fs.mkdir(extractDir, { recursive: true });

        let extractedFiles: string[] = [];
        try {
          await archiveManager.extractArchive(destPath, extractDir);
          extractedFiles = await getAllFilesRecursive(extractDir);
        } catch {
          // Pas une archive valide — considérer le fichier téléchargé comme un fichier brut
          extractedFiles = [destPath];
        }

        attempts?.update(attemptId, { status: 'verifying' });
        for (const filePath of extractedFiles) {
          if (remainingDatRoms().length === 0) break;

          onProgress?.({
            phase: 'hashing',
            currentGame: gameName,
            currentGameIndex: gameIndex || 0,
            totalGames: totalGames || 0,
            key: 'logs.download.progress.hashing',
            params: { game: gameName, file: path.basename(filePath) }
          });

          const hashes = await calculateFileHashes(filePath);
          for (const datRom of remainingDatRoms()) {
            const result = compareHashes(
              { crc32: datRom.crc32, md5: datRom.md5, sha1: datRom.sha1 },
              { crc32: hashes.crc32, md5: hashes.md5, sha1: hashes.sha1 }
            );
            if (result.matched) {
              const keepPath = path.join(gameTempDir, datRom.name);
              if (filePath !== keepPath) {
                await fs.mkdir(path.dirname(keepPath), { recursive: true });
                await fs.copyFile(filePath, keepPath);
              }
              matchedFiles.set(datRom.id, {
                datRomId: datRom.id,
                datRomName: datRom.name,
                filePath: keepPath,
                source: source.name
              });
              break;
            }
          }
        }

        try { await fs.rm(extractDir, { recursive: true, force: true }); } catch { /* ignore */ }
        try { await fs.unlink(destPath); } catch { /* ignore */ }

        const matchedHere = remainingBefore - remainingDatRoms().length;
        attempts?.update(attemptId, {
          status: verificationStatus(matchedHere, remainingDatRoms().length),
          matched: datRoms.length - remainingDatRoms().length,
          total: datRoms.length
        });
      } else {
        // ─── Mode raw : tenter chaque datRom dont le nom se termine par .ext ───
        const targetRoms = remainingDatRoms().filter(r =>
          r.name.toLowerCase().endsWith(`.${entry.ext.toLowerCase()}`)
        );
        if (targetRoms.length === 0) continue;

        for (const datRom of targetRoms) {
          if (isCancelled?.()) break;

          const url = `${baseUrl}/${encodeURIComponent(datRom.name)}`;
          const destPath = path.join(gameTempDir, datRom.name);
          const attemptId = fileAttemptId(source, sourceIndex, datRom.name);
          attempts?.update(attemptId, { status: 'running' });

          console.log(`[Download raw] Trying: ${url}`);
          const downloadProgress: RomDownloadProgress = {
            phase: 'downloading',
            currentGame: gameName,
            currentGameIndex: gameIndex || 0,
            totalGames: totalGames || 0,
            currentSource: source.name,
            currentExtension: entry.ext,
            key: 'logs.download.progress.individualDownload',
            params: { game: gameName, url }
          };
          onProgress?.(downloadProgress);

          try {
            await streamDownload(url, destPath, percent => {
              attempts?.update(attemptId, { percent });
              onProgress?.({ ...downloadProgress, downloadPercent: percent });
            });
            console.log(`[Download raw] OK : ${url}`);
          } catch (err: any) {
            console.log(`[Download raw] Failed (${err.message}): ${url}`);
            attempts?.update(attemptId, failureStatus(err));
            try { await fs.unlink(destPath); } catch { /* ignore */ }
            continue;
          }
          const downloadedSize = await fs.stat(destPath).then(st => st.size).catch(() => undefined);
          attempts?.update(attemptId, { status: 'verifying', size: downloadedSize, percent: undefined });

          const hashes = await calculateFileHashes(destPath);
          const result = compareHashes(
            { crc32: datRom.crc32, md5: datRom.md5, sha1: datRom.sha1 },
            { crc32: hashes.crc32, md5: hashes.md5, sha1: hashes.sha1 }
          );

          if (result.matched) {
            matchedFiles.set(datRom.id, {
              datRomId: datRom.id,
              datRomName: datRom.name,
              filePath: destPath,
              source: source.name
            });
            attempts?.update(attemptId, { status: 'verified', matched: 1, total: 1 });
          } else {
            attempts?.update(attemptId, { status: 'mismatch', matched: 0, total: 1 });
            try { await fs.unlink(destPath); } catch { /* ignore */ }
          }
        }
      }
    }
  }

  const partial = remainingDatRoms().length > 0;
  return { matchedFiles, partial };
}

// ============================================
// UTILITAIRES
// ============================================

/**
 * Liste prévisionnelle des tentatives d'un jeu, dans l'ordre où elles seront
 * essayées : fichiers déjà récupérés lors d'un téléchargement précédent incomplet
 * (dossier des ROMs incomplètes, seulement s'il existe pour ce jeu), puis chaque
 * source × extension dans l'ordre de priorité des paramètres (archive `Jeu.ext`,
 * ou fichier brut par ROM concernée).
 */
async function planAttempts(
  gameName: string,
  datRoms: DatRomInfo[],
  sources: DownloadSource[],
  systemId: string,
  settings: ReturnType<typeof settingsManager.getAll>
): Promise<DownloadAttempt[]> {
  const plan: DownloadAttempt[] = [];
  if (settings.incompleteRomsFolder) {
    const localFolder = path.join(settings.incompleteRomsFolder, gameName);
    if (await fs.access(localFolder).then(() => true, () => false)) {
      plan.push({ id: LOCAL_ATTEMPT_ID, kind: 'local', ext: '', source: '', target: localFolder, status: 'pending' });
    }
  }
  for (const [sourceIndex, source] of sources.entries()) {
    if (!source.enabled) continue;
    for (const entry of resolveExtensions(source, systemId, settings)) {
      if (entry.isArchive) {
        plan.push({
          id: archiveAttemptId(source, sourceIndex, entry.ext),
          kind: 'archive',
          ext: entry.ext,
          source: source.name,
          target: `${gameName}.${entry.ext}`,
          status: 'pending'
        });
      } else {
        for (const datRom of datRoms.filter(r => r.name.toLowerCase().endsWith(`.${entry.ext.toLowerCase()}`))) {
          plan.push({
            id: fileAttemptId(source, sourceIndex, datRom.name),
            kind: 'file',
            ext: entry.ext,
            source: source.name,
            target: datRom.name,
            status: 'pending'
          });
        }
      }
    }
  }
  return plan;
}


async function getAllFilesRecursive(dir: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...await getAllFilesRecursive(fullPath));
    } else {
      result.push(fullPath);
    }
  }
  return result;
}

// ============================================
// ALGORITHME PRINCIPAL
// ============================================

export async function downloadRoms(
  db: Database,
  gameIds: number[],
  rawOnProgress: ProgressCallback,
  isCancelled: () => boolean,
  signal?: OperationSignal
): Promise<RomDownloadResult> {
  const settings = settingsManager.getAll();
  const datName = await getMetadata(db, 'dat_name') || '';
  const systemId = detectSystemFromDatName(datName)?.systemId ?? 'default';

  const sources = (settings.downloadSources || []).filter(s => s.enabled);
  if (sources.length === 0) {
    throw new Error('Aucune source de téléchargement configurée. Allez dans Paramètres > Téléchargement.');
  }

  // Résoudre les dossiers cibles effectifs (avec sous-dossier système si mode multi-système)
  settings.tempExtractionFolder = await getEffectiveTempExtractionFolder(db);
  settings.incompleteRomsFolder = await getEffectiveIncompleteRomsFolder(db);

  const tempFolder = path.join(settings.tempExtractionFolder, `rom-download-${Date.now()}`);
  await fs.mkdir(tempFolder, { recursive: true });

  const result: RomDownloadResult = {
    stats: { totalGames: gameIds.length, downloaded: 0, matched: 0, consolidated: 0, failed: 0, remaining: 0 },
    results: []
  };
  // Chaque événement porte les compteurs cumulés
  const onProgress: ProgressCallback = progress => rawOnProgress({
    ...progress,
    consolidated: result.stats.consolidated,
    failed: result.stats.failed
  });

  onProgress({
    phase: 'preparing',
    currentGameIndex: 0,
    totalGames: gameIds.length,
    key: 'logs.download.progress.preparing',
    params: { count: gameIds.length }
  });

  let gamesHandled = 0;
  for (let i = 0; i < gameIds.length; i++) {
    if (isCancelled() || signal?.abort.signal.aborted) {
      result.cancelled = true;
      break;
    }

    const gameId = gameIds[i];

    // Charger les infos du jeu
    const game = await db.get<{ id: number; name: string }>('SELECT id, name FROM games WHERE id = ?', [gameId]);
    if (!game) { gamesHandled++; continue; }

    // Charger les dat_roms
    const datRoms = await db.all<DatRomInfo>(
      'SELECT id, name, size, crc32, md5, sha1 FROM dat_roms WHERE game_id = ?',
      [gameId]
    );

    if (datRoms.length === 0) { gamesHandled++; continue; }

    // Progression du jeu : chaque événement porte le tableau des tentatives, et
    // chaque mise à jour du tableau réémet le dernier événement du jeu
    let lastGameProgress: RomDownloadProgress | null = null;
    const attempts = new AttemptReporter(() => {
      if (lastGameProgress) gameOnProgress(lastGameProgress);
    });
    const gameOnProgress: ProgressCallback = progress => {
      lastGameProgress = progress;
      onProgress({ ...progress, attempts: attempts.snapshot() });
    };
    gameOnProgress({
      phase: 'local-search',
      currentGame: game.name,
      currentGameIndex: i + 1,
      totalGames: gameIds.length,
      key: 'logs.download.progress.localSearch',
      params: { game: game.name }
    });
    attempts.set(await planAttempts(game.name, datRoms, sources, systemId, settings));

    // Traitement du jeu (recherche, téléchargement, consolidation), abandonnable
    // immédiatement par un arrêt forcé
    const processGame = async (): Promise<void> => {
      // Phase 1 : Recherche locale (incompleteRomsFolder)
      const matchedFiles = await searchLocalFiles(
        game.name, datRoms, settings.incompleteRomsFolder,
        gameOnProgress, i + 1, gameIds.length, attempts
      );

      if (matchedFiles.size === datRoms.length) {
        // Tous les fichiers trouvés localement
        gameOnProgress({
          phase: 'matching',
          currentGame: game.name,
          currentGameIndex: i + 1,
          totalGames: gameIds.length,
          key: 'logs.download.progress.allFoundLocally',
          params: { game: game.name }
        });
      }

      // Phase 2 : Téléchargement (si fichiers manquants)
      let partial = matchedFiles.size < datRoms.length;
      if (partial) {
        const downloadResult = await tryDownloadAndVerifyGame(
          game.name, datRoms, sources, systemId, settings, tempFolder,
          matchedFiles, gameOnProgress, i + 1, gameIds.length,
          // Seul l'arrêt forcé interrompt le jeu en cours : une interruption normale
          // laisse le jeu se terminer (toutes ses sources sont essayées)
          () => !!signal?.abort.signal.aborted,
          attempts
        );
        partial = downloadResult.partial;
      }
      // Arrêt forcé pendant la recherche/le téléchargement : le jeu est abandonné,
      // il ne doit être compté ni comme réussi ni comme en échec
      throwIfAborted(signal);
      attempts.skipPending();

      const gameResult: RomDownloadGameResult = {
        gameName: game.name,
        success: false,
      };

      if (matchedFiles.size === datRoms.length) {
        // Jeu complet → consolider
        gameOnProgress({
          phase: 'consolidating',
          currentGame: game.name,
          currentGameIndex: i + 1,
          totalGames: gameIds.length,
          key: 'logs.download.progress.consolidating',
          params: { game: game.name }
        });

        const consolidationProgress = (state: Partial<RomDownloadProgress>) => gameOnProgress({
          phase: 'consolidating',
          currentGame: game.name,
          currentGameIndex: i + 1,
          totalGames: gameIds.length,
          key: 'logs.download.progress.consolidating',
          params: { game: game.name },
          ...state
        });
        try {
          throwIfAborted(signal);
          const extractedFiles = Array.from(matchedFiles.values()).map(m => m.filePath);
          // Map filename → datRomId pour permettre l'enregistrement direct des rom_matches
          const datRomMap = new Map<string, number>();
          for (const m of matchedFiles.values()) {
            datRomMap.set(path.basename(m.filePath), m.datRomId);
          }
          let lastState: Partial<RomDownloadProgress> = {};
          await consolidateSingleGame(db, game.name, extractedFiles, systemId, datRomMap, {
            onProgress: state => { lastState = state as Partial<RomDownloadProgress>; consolidationProgress(lastState); },
            signal
          });

          // Nettoyer le dossier incomplet s'il existait
          if (settings.incompleteRomsFolder) {
            const incompleteDir = path.join(settings.incompleteRomsFolder, game.name);
            try { await fs.rm(incompleteDir, { recursive: true, force: true }); } catch { /* ignore */ }
          }

          // Auto-sélectionner le jeu après téléchargement réussi
          try {
            await db.run('UPDATE games SET is_selected = 1 WHERE id = ?', [game.id]);
          } catch { /* ignore */ }

          gameResult.success = true;
          gameResult.sourcesUsed = [...new Set(Array.from(matchedFiles.values()).map(m => m.source))];
          result.stats.consolidated++;
          result.stats.matched++;
          consolidationProgress({ ...lastState, step: 'done' });
        } catch (error: any) {
          if (error instanceof OperationAbortedError || signal?.abort.signal.aborted) throw error;
          gameResult.error = `Erreur consolidation : ${error.message}`;
          result.stats.failed++;
          consolidationProgress({ step: 'error', error: error.message || String(error) });
        }
      } else if (matchedFiles.size > 0) {
        // Jeu incomplet → stocker dans incompleteRomsFolder
        if (settings.incompleteRomsFolder) {
          const incompleteDir = path.join(settings.incompleteRomsFolder, game.name);
          await fs.mkdir(incompleteDir, { recursive: true });

          for (const matched of matchedFiles.values()) {
            const destPath = path.join(incompleteDir, matched.datRomName);
            try {
              await fs.copyFile(matched.filePath, destPath);
            } catch { /* ignore */ }
          }

          gameOnProgress({
            phase: 'incomplete',
            currentGame: game.name,
            currentGameIndex: i + 1,
            totalGames: gameIds.length,
            key: 'logs.download.progress.incomplete',
            params: { game: game.name, found: matchedFiles.size, total: datRoms.length }
          });
        }

        gameResult.error = `${matchedFiles.size}/${datRoms.length} fichiers trouvés`;
        gameResult.sourcesUsed = [...new Set(Array.from(matchedFiles.values()).map(m => m.source))];
        result.stats.failed++;
      } else {
        // Aucun fichier trouvé
        gameResult.error = 'Aucune source n\'a fourni de fichier valide';
        result.stats.failed++;
      }

      if (matchedFiles.size > 0) {
        result.stats.downloaded++;
      }

      result.results.push(gameResult);
    };

    const gamePromise = processGame();
    try {
      await (signal ? raceAbort(gamePromise, signal.abort.signal) : gamePromise);
      gamesHandled++;
    } catch (error) {
      if (!(error instanceof OperationAbortedError)) throw error;
      // Arrêt forcé : le jeu est abandonné ; laisser ses opérations (tuées) se terminer
      result.cancelled = true;
      gameOnProgress({
        phase: 'consolidating',
        currentGame: game.name,
        currentGameIndex: i + 1,
        totalGames: gameIds.length,
        key: 'logs.download.progress.consolidating',
        params: { game: game.name },
        step: 'aborted'
      });
      await Promise.race([
        gamePromise.then(() => true, () => true),
        new Promise<boolean>(resolve => setTimeout(() => resolve(false), 10000))
      ]);
      console.warn(`⏹️ Download/consolidation of ${game.name} aborted (forced stop)`);
      break;
    }
  }
  if (isCancelled()) result.cancelled = true;
  result.stats.remaining = gameIds.length - gamesHandled;

  // Nettoyage du dossier temporaire
  try { await fs.rm(tempFolder, { recursive: true, force: true }); } catch { /* ignore */ }

  // Nettoyer les entrées scanned_files dont le fichier n'existe plus
  // (au cas où des fichiers source auraient été déplacés/supprimés en cours de route)
  try {
    const { cleanupStaleScannedFiles } = await import('./recordConsolidation.js');
    const stale = await cleanupStaleScannedFiles(db);
    if (stale > 0) console.log(`[Cleanup] ${stale} stale scanned_files entry(ies) removed`);
  } catch (err) {
    console.warn(`[Cleanup] failed to clean up stale files: ${err}`);
  }

  onProgress({
    phase: 'complete',
    currentGameIndex: gameIds.length,
    totalGames: gameIds.length,
    key: 'logs.download.done',
    params: { consolidated: result.stats.consolidated, failed: result.stats.failed },
    cancelled: !!result.cancelled
  });

  return result;
}
