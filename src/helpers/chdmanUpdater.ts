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

// src/helpers/chdmanUpdater.ts
// Mise à jour de chdman depuis la dernière release MAME officielle (GitHub mamedev/mame).
// Seul Windows dispose de binaires officiels : l'exécutable MAME est un 7z
// auto-extractible dont on extrait uniquement chdman.exe avec le 7za embarqué.
// Chaque version est installée dans <userData>/bin/chdman/<tag>/.

import { app } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { randomUUID } from 'crypto';
import Seven from 'node-7z';
import { trackProcess } from './archives/processRegistry.js';
import {
  executableName,
  getBundled7zaPath,
  getChdmanVersion,
  getDownloadedChdmanDir,
  listDownloadedChdmans,
  MAME_TAG_PATTERN
} from './toolPaths.js';

const LATEST_RELEASE_URL = 'https://api.github.com/repos/mamedev/mame/releases/latest';

export interface MameRelease {
  /** Tag de la release (ex. mame0289) */
  tag: string;
  /** Version au format chdman (ex. 0.289) */
  version: string;
  assetUrl: string;
  size: number;
}

/** Les mises à jour ne sont possibles que là où MAME publie des binaires officiels */
export function isChdmanUpdateSupported(): boolean {
  return process.platform === 'win32' && (process.arch === 'x64' || process.arch === 'arm64');
}

/** "mame0289" → "0.289" */
function tagToVersion(tag: string): string {
  const digits = tag.replace(/^mame/i, '');
  return `${digits.slice(0, 1)}.${digits.slice(1)}`;
}

/** Dernière release MAME et binaire Windows correspondant à l'architecture courante */
export async function fetchLatestMameRelease(): Promise<MameRelease> {
  const response = await fetch(LATEST_RELEASE_URL, {
    headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'RUMCET' }
  });
  if (!response.ok) {
    throw new Error(`GitHub API error (HTTP ${response.status})`);
  }
  const release = await response.json() as {
    tag_name: string;
    assets: Array<{ name: string; browser_download_url: string; size: number }>;
  };
  if (!MAME_TAG_PATTERN.test(release.tag_name)) {
    throw new Error(`Unexpected MAME release tag: ${release.tag_name}`);
  }

  const assetPattern = process.arch === 'arm64'
    ? /^mame\d+b?_arm64\.exe$/i
    : /^mame\d+b?_(x64|64bit)\.exe$/i;
  const asset = release.assets.find(a => assetPattern.test(a.name));
  if (!asset) {
    throw new Error(`No Windows ${process.arch} binary in MAME release ${release.tag_name}`);
  }

  return {
    tag: release.tag_name,
    version: tagToVersion(release.tag_name),
    assetUrl: asset.browser_download_url,
    size: asset.size
  };
}

async function downloadToFile(
  url: string,
  destPath: string,
  onProgress: (downloaded: number, total: number) => void
): Promise<void> {
  const response = await fetch(url, { headers: { 'User-Agent': 'RUMCET' } });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (HTTP ${response.status})`);
  }
  const total = parseInt(response.headers.get('content-length') || '0', 10);
  const fileStream = createWriteStream(destPath);
  let downloaded = 0;
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      downloaded += value.length;
      if (!fileStream.write(value)) {
        await new Promise<void>(resolve => fileStream.once('drain', resolve));
      }
      onProgress(downloaded, total);
    }
  } finally {
    await new Promise<void>(resolve => fileStream.end(resolve));
  }
  if (total > 0 && downloaded !== total) {
    throw new Error(`Incomplete download (${downloaded}/${total} bytes)`);
  }
}

/** Extrait le seul chdman.exe de l'auto-extractible MAME (7z) avec le 7za embarqué */
function extractChdman(archivePath: string, outputDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = Seven.extract(archivePath, outputDir, {
      $bin: getBundled7zaPath(),
      $cherryPick: [executableName('chdman')],
      yes: true
    } as any);
    trackProcess((stream as any)._childProcess);
    stream.on('end', () => resolve());
    stream.on('error', (err: any) => reject(err));
  });
}

/** Journalisation des étapes (clé i18n logs.chdman.* + paramètres), fichier de log uniquement */
export type ChdmanUpdateLogger = (
  severity: 'info' | 'warning' | 'error',
  key: string,
  params?: Record<string, string | number>
) => void;

export type ChdmanUpdateStep =
  | { step: 'download'; downloaded: number; total: number }
  | { step: 'extract' };

/**
 * Télécharge la release, en extrait chdman, vérifie qu'il s'exécute puis
 * l'installe dans <userData>/bin/chdman/<tag>/. Retourne le chemin installé.
 */
export async function downloadAndInstallChdman(
  release: MameRelease,
  onProgress: (progress: ChdmanUpdateStep) => void,
  log: ChdmanUpdateLogger = () => {}
): Promise<string> {
  const workDir = path.join(app.getPath('temp'), `rumcet-chdman-${randomUUID()}`);
  await fs.mkdir(workDir, { recursive: true });
  try {
    const archivePath = path.join(workDir, `${release.tag}.exe`);
    log('info', 'logs.chdman.downloadStarted', { tag: release.tag, url: release.assetUrl, size: release.size, path: archivePath });
    let received = 0;
    await downloadToFile(release.assetUrl, archivePath, (downloaded, total) => {
      received = downloaded;
      onProgress({ step: 'download', downloaded, total });
    });
    log('info', 'logs.chdman.downloadCompleted', { size: received });

    onProgress({ step: 'extract' });
    const extractDir = path.join(workDir, 'out');
    log('info', 'logs.chdman.extracting', { archive: archivePath });
    await extractChdman(archivePath, extractDir);
    const extracted = path.join(extractDir, executableName('chdman'));
    const version = await getChdmanVersion(extracted);
    if (!version) {
      throw new Error('Extracted chdman does not run');
    }
    log('info', 'logs.chdman.extracted', { version });

    const installDir = path.join(getDownloadedChdmanDir(), release.tag);
    await fs.mkdir(installDir, { recursive: true });
    const installed = path.join(installDir, executableName('chdman'));
    await fs.copyFile(extracted, installed);
    log('info', 'logs.chdman.installed', { path: installed });
    return installed;
  } finally {
    // Supprime l'archive MAME téléchargée et le chdman extrait, y compris en cas d'échec
    try {
      await fs.rm(workDir, { recursive: true, force: true });
      log('info', 'logs.chdman.tempCleaned', { path: workDir });
    } catch (error) {
      log('warning', 'logs.chdman.tempCleanupFailed', { path: workDir, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

/** Supprime une version téléchargée (uniquement un dossier <tag> existant) */
export async function deleteDownloadedChdman(tag: string): Promise<void> {
  if (!MAME_TAG_PATTERN.test(tag)) {
    throw new Error(`Invalid chdman version: ${tag}`);
  }
  const downloaded = await listDownloadedChdmans();
  if (!downloaded.some(entry => entry.tag === tag)) {
    throw new Error(`chdman version not found: ${tag}`);
  }
  await fs.rm(path.join(getDownloadedChdmanDir(), tag), { recursive: true, force: true });
}
