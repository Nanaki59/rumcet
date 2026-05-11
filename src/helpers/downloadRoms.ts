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
import type { RomDownloadProgress, RomDownloadResult, RomDownloadGameResult, DownloadSource } from '../types/global.js';
import path from 'path';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { net } from 'electron';

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

// ============================================
// RÉSOLUTION DES EXTENSIONS
// ============================================

function resolveExtensions(
  source: DownloadSource,
  systemId: string,
  settings: ReturnType<typeof settingsManager.getAll>
): string[] {
  // 1. Extensions spécifiques à ce système sur cette source
  if (source.systemExtensions?.[systemId]?.length) {
    return source.systemExtensions[systemId];
  }
  // 2. Extensions globales de cette source
  if (source.extensions?.length) {
    return source.extensions;
  }
  // 3. Extensions globales pour ce système (settings)
  const systemExt = settings.downloadSystemExtensions?.find(s => s.systemId === systemId);
  if (systemExt?.extensions?.length) {
    return systemExt.extensions;
  }
  // 4. Extensions par défaut dérivées de la compatibilité système (registre central)
  const sysDef = getSystemById(systemId);
  if (sysDef) {
    const exts = [...sysDef.supportedFormats, ...sysDef.warningFormats];
    if (exts.length > 0) return exts;
  }
  // 5. Fallback global
  return settings.downloadExtensions || ['7z', 'zip', 'chd', 'rar', 'iso', 'cso', 'pbp'];
}

// ============================================
// TÉLÉCHARGEMENT STREAMING
// ============================================

function streamDownload(
  url: string,
  destPath: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = net.request(url);

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
        fileStream.end(() => {
          resolve();
        });
      });

      response.on('error', (err: Error) => {
        fileStream.close();
        reject(err);
      });
    });

    request.on('error', reject);
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
  totalGames?: number
): Promise<Map<number, MatchedFile>> {
  const matchedFiles = new Map<number, MatchedFile>();

  if (!incompleteFolder) return matchedFiles;

  const gameFolder = path.join(incompleteFolder, gameName);

  try {
    await fs.access(gameFolder);
  } catch {
    return matchedFiles; // Dossier inexistant
  }

  onProgress?.({
    phase: 'local-search',
    currentGame: gameName,
    currentGameIndex: gameIndex || 0,
    totalGames: totalGames || 0,
    message: `Recherche locale pour ${gameName}...`
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
    console.error(`Erreur recherche locale ${gameFolder}:`, error);
  }

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
  isCancelled?: () => boolean
): Promise<{ matchedFiles: Map<number, MatchedFile>; partial: boolean }> {
  const gameTempDir = path.join(tempFolder, gameName);
  await fs.mkdir(gameTempDir, { recursive: true });

  const archiveManager = new ArchiveManager();
  const remainingDatRoms = () => datRoms.filter(r => !matchedFiles.has(r.id));

  for (const source of sources) {
    if (!source.enabled) continue;
    if (remainingDatRoms().length === 0) break;
    if (isCancelled?.()) break;

    const extensions = resolveExtensions(source, systemId, settings);

    // ── Phase 1 : Téléchargement d'archives (gameName.ext) ──
    for (const ext of extensions) {
      if (remainingDatRoms().length === 0) break;
      if (isCancelled?.()) break;

      const url = source.baseUrl.replace(/\/+$/, '') + '/' + encodeURIComponent(gameName) + '.' + ext;
      const destPath = path.join(gameTempDir, `_download.${ext}`);

      console.log(`[Download] Tentative : ${url}`);
      onProgress?.({
        phase: 'downloading',
        currentGame: gameName,
        currentGameIndex: gameIndex || 0,
        totalGames: totalGames || 0,
        currentSource: source.name,
        currentExtension: ext,
        message: `${gameName} : ${url}`
      });

      try {
        await streamDownload(url, destPath);
        console.log(`[Download] OK : ${url}`);
      } catch (err: any) {
        console.log(`[Download] Échec (${err.message}) : ${url}`);
        // 404 ou erreur réseau → essayer l'extension suivante
        try { await fs.unlink(destPath); } catch { /* ignore */ }
        continue;
      }

      // Extraire si c'est une archive
      onProgress?.({
        phase: 'extracting',
        currentGame: gameName,
        currentGameIndex: gameIndex || 0,
        totalGames: totalGames || 0,
        message: `${gameName} : extraction...`
      });

      const extractDir = path.join(gameTempDir, `_extract_${ext}`);
      await fs.mkdir(extractDir, { recursive: true });

      let extractedFiles: string[] = [];
      try {
        // Tenter l'extraction comme archive
        await archiveManager.extractArchive(destPath, extractDir);
        extractedFiles = await getAllFilesRecursive(extractDir);
      } catch {
        // Pas une archive valide — considérer le fichier téléchargé comme un fichier brut
        extractedFiles = [destPath];
      }

      // Hasher et matcher chaque fichier extrait
      for (const filePath of extractedFiles) {
        if (remainingDatRoms().length === 0) break;

        onProgress?.({
          phase: 'hashing',
          currentGame: gameName,
          currentGameIndex: gameIndex || 0,
          totalGames: totalGames || 0,
          message: `${gameName} : vérification de ${path.basename(filePath)}...`
        });

        const hashes = await calculateFileHashes(filePath);

        for (const datRom of remainingDatRoms()) {
          const result = compareHashes(
            { crc32: datRom.crc32, md5: datRom.md5, sha1: datRom.sha1 },
            { crc32: hashes.crc32, md5: hashes.md5, sha1: hashes.sha1 }
          );

          if (result.matched) {
            // Conserver le fichier matché dans un dossier dédié
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

      // Nettoyage des fichiers d'extraction temporaires
      try { await fs.rm(extractDir, { recursive: true, force: true }); } catch { /* ignore */ }
      try { await fs.unlink(destPath); } catch { /* ignore */ }
    }

    // ── Phase 2 : Fallback fichiers individuels ──
    if (remainingDatRoms().length > 0) {
      for (const datRom of [...remainingDatRoms()]) {
        if (isCancelled?.()) break;

        const url = source.baseUrl.replace(/\/+$/, '') + '/' + encodeURIComponent(datRom.name);
        const destPath = path.join(gameTempDir, datRom.name);

        console.log(`[ROM Download] Téléchargement individuel : ${url}`);
        onProgress?.({
          phase: 'downloading',
          currentGame: gameName,
          currentGameIndex: gameIndex || 0,
          totalGames: totalGames || 0,
          currentSource: source.name,
          message: `${gameName} : téléchargement individuel ${url}`
        });

        try {
          await streamDownload(url, destPath);
          console.log(`[ROM Download] Téléchargement individuel réussi : ${url}`);
        } catch {
          console.log(`[ROM Download] Téléchargement individuel échoué : ${url}`);
          try { await fs.unlink(destPath); } catch { /* ignore */ }
          continue;
        }

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
        } else {
          try { await fs.unlink(destPath); } catch { /* ignore */ }
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
  onProgress: ProgressCallback,
  isCancelled: () => boolean
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
    stats: { totalGames: gameIds.length, downloaded: 0, matched: 0, consolidated: 0, failed: 0 },
    results: []
  };

  onProgress({
    phase: 'preparing',
    currentGameIndex: 0,
    totalGames: gameIds.length,
    message: `Préparation du téléchargement de ${gameIds.length} jeu(x)...`
  });

  for (let i = 0; i < gameIds.length; i++) {
    if (isCancelled()) break;

    const gameId = gameIds[i];

    // Charger les infos du jeu
    const game = await db.get<{ id: number; name: string }>('SELECT id, name FROM games WHERE id = ?', [gameId]);
    if (!game) continue;

    // Charger les dat_roms
    const datRoms = await db.all<DatRomInfo>(
      'SELECT id, name, size, crc32, md5, sha1 FROM dat_roms WHERE game_id = ?',
      [gameId]
    );

    if (datRoms.length === 0) continue;

    // Phase 1 : Recherche locale (incompleteRomsFolder)
    const matchedFiles = await searchLocalFiles(
      game.name, datRoms, settings.incompleteRomsFolder,
      onProgress, i + 1, gameIds.length
    );

    if (matchedFiles.size === datRoms.length) {
      // Tous les fichiers trouvés localement
      onProgress({
        phase: 'matching',
        currentGame: game.name,
        currentGameIndex: i + 1,
        totalGames: gameIds.length,
        message: `${game.name} : tous les fichiers trouvés localement`
      });
    }

    // Phase 2 : Téléchargement (si fichiers manquants)
    let partial = matchedFiles.size < datRoms.length;
    if (partial) {
      const downloadResult = await tryDownloadAndVerifyGame(
        game.name, datRoms, sources, systemId, settings, tempFolder,
        matchedFiles, onProgress, i + 1, gameIds.length, isCancelled
      );
      partial = downloadResult.partial;
    }

    const gameResult: RomDownloadGameResult = {
      gameName: game.name,
      success: false,
    };

    if (matchedFiles.size === datRoms.length) {
      // Jeu complet → consolider
      onProgress({
        phase: 'consolidating',
        currentGame: game.name,
        currentGameIndex: i + 1,
        totalGames: gameIds.length,
        message: `${game.name} : consolidation...`
      });

      try {
        const extractedFiles = Array.from(matchedFiles.values()).map(m => m.filePath);
        // Map filename → datRomId pour permettre l'enregistrement direct des rom_matches
        const datRomMap = new Map<string, number>();
        for (const m of matchedFiles.values()) {
          datRomMap.set(path.basename(m.filePath), m.datRomId);
        }
        await consolidateSingleGame(db, game.name, extractedFiles, systemId, datRomMap);

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
      } catch (error: any) {
        gameResult.error = `Erreur consolidation : ${error.message}`;
        result.stats.failed++;
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

        onProgress({
          phase: 'incomplete',
          currentGame: game.name,
          currentGameIndex: i + 1,
          totalGames: gameIds.length,
          message: `${game.name} : ${matchedFiles.size}/${datRoms.length} fichiers trouvés, stockés dans le dossier des ROMs incomplètes`
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
  }

  // Nettoyage du dossier temporaire
  try { await fs.rm(tempFolder, { recursive: true, force: true }); } catch { /* ignore */ }

  // Nettoyer les entrées scanned_files dont le fichier n'existe plus
  // (au cas où des fichiers source auraient été déplacés/supprimés en cours de route)
  try {
    const { cleanupStaleScannedFiles } = await import('./recordConsolidation.js');
    const stale = await cleanupStaleScannedFiles(db);
    if (stale > 0) console.log(`[Cleanup] ${stale} entrée(s) scanned_files obsolète(s) retirée(s)`);
  } catch (err) {
    console.warn(`[Cleanup] échec nettoyage des fichiers obsolètes : ${err}`);
  }

  onProgress({
    phase: 'complete',
    currentGameIndex: gameIds.length,
    totalGames: gameIds.length,
    message: `Téléchargement terminé : ${result.stats.consolidated} consolidé(s), ${result.stats.failed} échec(s)`
  });

  return result;
}
