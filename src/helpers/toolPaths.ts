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

// src/helpers/toolPaths.ts
// Résolution multiplateforme des chemins des outils externes (7-Zip, RAR, chdman…),
// selon le système d'exploitation et selon que l'application est packagée ou non.
// Les binaires embarqués sont rangés par plateforme : resources/bin/<platform>-<arch>/

import { app } from 'electron';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { constants as fsConstants, accessSync, chmodSync } from 'fs';
import { spawn } from 'child_process';
import sevenBin from '7zip-bin';
import { compareMameVersions } from '../shared/mameVersion.js';

const IS_WINDOWS = process.platform === 'win32';

/** Nom de l'exécutable selon l'OS (ajoute .exe sous Windows) */
export function executableName(baseName: string): string {
  return IS_WINDOWS ? `${baseName}.exe` : baseName;
}

/**
 * Dossier des binaires embarqués pour la plateforme courante.
 * - App packagée : <resources>/bin/<platform>-<arch> (copié via extraResources)
 * - Développement : <racine projet>/resources/bin/<platform>-<arch>
 */
export function getEmbeddedBinDir(): string {
  const resourcesRoot = app.isPackaged
    ? process.resourcesPath
    : path.join(app.getAppPath(), 'resources');
  return path.join(resourcesRoot, 'bin', `${process.platform}-${process.arch}`);
}

/** Chemin du chdman embarqué (peut ne pas exister si aucun binaire n'est fourni pour cette plateforme) */
export function getEmbeddedChdmanPath(): string {
  return path.join(getEmbeddedBinDir(), executableName('chdman'));
}

/**
 * Un exécutable rangé dans app.asar ne peut pas être lancé par le système :
 * electron-builder le décompresse dans app.asar.unpacked. Sans effet en
 * développement (le chemin ne contient pas app.asar).
 */
export function toUnpackedPath(filePath: string): string {
  const marker = `${path.sep}app.asar${path.sep}`;
  return filePath.includes(marker)
    ? filePath.replace(marker, `${path.sep}app.asar.unpacked${path.sep}`)
    : filePath;
}

let bundled7zaPath: string | null = null;

/** Chemin du 7za fourni par 7zip-bin, utilisable en développement comme en version packagée */
export function getBundled7zaPath(): string {
  if (bundled7zaPath) return bundled7zaPath;
  bundled7zaPath = toUnpackedPath(sevenBin.path7za);
  if (!IS_WINDOWS) {
    try {
      accessSync(bundled7zaPath, fsConstants.X_OK);
    } catch {
      try {
        chmodSync(bundled7zaPath, 0o755);
      } catch (error) {
        console.warn(`Unable to set executable bit on ${bundled7zaPath}:`, error);
      }
    }
  }
  return bundled7zaPath;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Sous Linux/macOS, le bit exécutable peut être perdu (copie, extraction d'archive…).
 * On tente de le rétablir ; échec silencieux si le fichier est en lecture seule.
 */
async function ensureExecutable(filePath: string): Promise<void> {
  if (IS_WINDOWS) return;
  try {
    await fs.access(filePath, fsConstants.X_OK);
  } catch {
    try {
      await fs.chmod(filePath, 0o755);
    } catch (error) {
      console.warn(`Unable to set executable bit on ${filePath}:`, error);
    }
  }
}

/**
 * Dossiers où les gestionnaires de paquets installent les outils. Une application
 * graphique lancée depuis le Finder (macOS) ou un menu ne reçoit souvent qu'un
 * PATH réduit qui ne les contient pas : on les ajoute explicitement.
 */
function extraSearchDirs(): string[] {
  switch (process.platform) {
    case 'darwin':
      return ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin'];
    case 'linux':
      return ['/usr/bin', '/usr/local/bin', path.join(os.homedir(), '.local', 'bin')];
    default:
      return [];
  }
}

/** Cherche un exécutable dans le PATH système et les dossiers usuels (équivalent de which / where) */
export async function findInPath(baseName: string): Promise<string | null> {
  const dirs = [
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean),
    ...extraSearchDirs()
  ];
  const name = executableName(baseName);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    if (await fileExists(candidate)) {
      if (IS_WINDOWS) return candidate;
      try {
        await fs.access(candidate, fsConstants.X_OK);
        return candidate;
      } catch {
        continue;
      }
    }
  }
  return null;
}

/** Dossiers Program Files de Windows (64 et 32 bits), lus depuis l'environnement */
function windowsProgramDirs(): string[] {
  const dirs = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432]
    .filter((dir): dir is string => !!dir);
  return [...new Set(dirs)];
}

/**
 * Cherche un outil : d'abord les emplacements d'installation connus sous Windows,
 * puis le PATH (et les dossiers usuels) sous les noms donnés, dans l'ordre.
 */
async function detectTool(windowsRelativePaths: string[], baseNames: string[]): Promise<string | null> {
  if (IS_WINDOWS) {
    for (const dir of windowsProgramDirs()) {
      for (const relative of windowsRelativePaths) {
        const candidate = path.join(dir, relative);
        if (await fileExists(candidate)) return candidate;
      }
    }
  }
  for (const baseName of baseNames) {
    const found = await findInPath(baseName);
    if (found) return found;
  }
  return null;
}

/** 7-Zip complet (7z.exe sous Windows ; 7zz ou 7z sous macOS/Linux) */
export function detectSevenZip(): Promise<string | null> {
  const names = process.platform === 'darwin' ? ['7zz', '7z'] : ['7z', '7zz'];
  return detectTool([path.join('7-Zip', '7z.exe')], names);
}

/** Version ligne de commande de WinRAR (Rar.exe sous Windows, rar ailleurs) */
export function detectRar(): Promise<string | null> {
  return detectTool([path.join('WinRAR', 'Rar.exe')], ['rar']);
}

/** UnRAR (fourni avec WinRAR sous Windows, paquet unrar ailleurs) */
export function detectUnrar(): Promise<string | null> {
  return detectTool([path.join('WinRAR', 'UnRAR.exe'), path.join('UnRAR', 'UnRAR.exe')], ['unrar']);
}

/**
 * Le réglage WinRAR peut pointer vers l'interface graphique (WinRAR.exe) :
 * on utilise alors Rar.exe, la version ligne de commande du même dossier.
 * Tout autre chemin (Rar.exe, rar sous Linux/macOS) est utilisé tel quel.
 */
export function rarCliPath(toolPath: string): string {
  return path.basename(toolPath).toLowerCase() === 'winrar.exe'
    ? path.join(path.dirname(toolPath), 'Rar.exe')
    : toolPath;
}

// ============================================
// chdman : versions embarquée / téléchargées
// ============================================

/** Choix de version : 'latest' (la plus récente), 'default' (embarquée), 'manual' (chdmanPath) ou un tag (ex. mame0289) */
export type ChdmanVersionChoice = 'latest' | 'default' | string;

export type ChdmanSource = 'custom' | 'downloaded' | 'embedded' | 'path';

export interface ChdmanVersionEntry {
  /** 'default' pour la version embarquée, sinon le tag du dossier téléchargé */
  id: string;
  version: string | null;
  path: string;
  source: 'downloaded' | 'embedded';
}

export interface ChdmanInfo {
  path: string | null;
  version: string | null;
  source: ChdmanSource | null;
}

/** Tag d'une release MAME (nom des dossiers de versions téléchargées) */
export const MAME_TAG_PATTERN = /^mame\d+$/;

/**
 * Dossier des versions de chdman téléchargées : <userData>/bin/chdman/<tag>/.
 * Le dossier d'installation (Program Files) n'est pas accessible en écriture.
 */
export function getDownloadedChdmanDir(): string {
  return path.join(app.getPath('userData'), 'bin', 'chdman');
}

/** Versions de chdman téléchargées présentes sur le disque */
export async function listDownloadedChdmans(): Promise<{ tag: string; path: string }[]> {
  const root = getDownloadedChdmanDir();
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return [];
  }
  const result: { tag: string; path: string }[] = [];
  for (const tag of entries) {
    if (!MAME_TAG_PATTERN.test(tag)) continue;
    const candidate = path.join(root, tag, executableName('chdman'));
    if (await fileExists(candidate)) result.push({ tag, path: candidate });
  }
  return result;
}

const chdmanVersionCache = new Map<string, string | null>();

/**
 * Version d'un chdman (ex. "0.288"), lue dans la première ligne de son aide :
 * « chdman - MAME Compressed Hunks of Data (CHD) manager 0.288 (mame0288) ».
 * Mise en cache par chemin + date de modification.
 */
export async function getChdmanVersion(chdmanPath: string): Promise<string | null> {
  let cacheKey: string;
  try {
    const stat = await fs.stat(chdmanPath);
    cacheKey = `${chdmanPath}|${stat.mtimeMs}`;
  } catch {
    return null;
  }
  if (chdmanVersionCache.has(cacheKey)) return chdmanVersionCache.get(cacheKey)!;

  const version = await new Promise<string | null>((resolve) => {
    let output = '';
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const match = output.match(/manager\s+(\d+\.\d+)/i) || output.match(/(\d+\.\d+)/);
      resolve(match ? match[1] : null);
    };
    let child: ReturnType<typeof spawn>;
    try {
      // Sans argument, chdman affiche son aide et se termine (code de sortie non nul)
      child = spawn(chdmanPath, [], { windowsHide: true });
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      done();
    }, 5000);
    child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.on('error', done);
    child.on('close', done);
  });

  chdmanVersionCache.set(cacheKey, version);
  return version;
}

/**
 * Versions de chdman disponibles (embarquée + téléchargées), de la plus récente
 * à la plus ancienne. À version égale, l'embarquée passe en premier.
 */
export async function listChdmanVersions(): Promise<ChdmanVersionEntry[]> {
  const entries: ChdmanVersionEntry[] = [];
  const embedded = getEmbeddedChdmanPath();
  if (await fileExists(embedded)) {
    await ensureExecutable(embedded);
    entries.push({ id: 'default', version: await getChdmanVersion(embedded), path: embedded, source: 'embedded' });
  }
  for (const downloaded of await listDownloadedChdmans()) {
    entries.push({ id: downloaded.tag, version: await getChdmanVersion(downloaded.path), path: downloaded.path, source: 'downloaded' });
  }
  // Tri stable : l'embarquée (en tête) reste devant une téléchargée de même version
  return entries.sort((a, b) => compareMameVersions(b.version, a.version));
}

/**
 * Résout le chdman à utiliser selon chdmanVersion :
 * - 'manual' : le chemin configuré (chdmanPath), s'il existe ;
 * - 'default' : la version embarquée ; un tag : cette version téléchargée ;
 * - 'latest' (par défaut, et repli si le choix est introuvable) : la plus
 *   récente entre l'embarquée et les téléchargées.
 * En dernier recours : chdman présent dans le PATH (mame-tools, rom-tools…).
 * Hors 'manual', chdmanPath est conservé mais ignoré.
 */
export async function resolveChdmanInfo(settings: { chdmanPath?: string; chdmanVersion?: ChdmanVersionChoice }): Promise<ChdmanInfo> {
  const choice = settings.chdmanVersion || 'latest';
  if (choice === 'manual') {
    if (settings.chdmanPath && await fileExists(settings.chdmanPath)) {
      await ensureExecutable(settings.chdmanPath);
      return { path: settings.chdmanPath, version: await getChdmanVersion(settings.chdmanPath), source: 'custom' };
    }
    console.warn(`Configured chdman not found (${settings.chdmanPath || 'empty path'}), using the latest available version`);
  }

  const versions = await listChdmanVersions();
  let selected = versions[0];
  if (choice !== 'latest' && choice !== 'manual') {
    const chosen = versions.find(entry => entry.id === choice);
    if (chosen) {
      selected = chosen;
    } else {
      console.warn(`Selected chdman version not found (${choice}), using the latest one`);
    }
  }
  if (selected) {
    return { path: selected.path, version: selected.version, source: selected.source };
  }

  const fromPath = await findInPath('chdman');
  return fromPath
    ? { path: fromPath, version: await getChdmanVersion(fromPath), source: 'path' }
    : { path: null, version: null, source: null };
}

/** Chemin de chdman résolu (voir resolveChdmanInfo), ou null si aucun n'est trouvé */
export async function resolveChdmanPath(settings: { chdmanPath?: string; chdmanVersion?: ChdmanVersionChoice }): Promise<string | null> {
  return (await resolveChdmanInfo(settings)).path;
}

let currentChdmanPath: string | null = null;

/**
 * Chemin de chdman actuellement retenu, partagé par toutes les instances de
 * ChdHandler (les ArchiveManager créés pendant une consolidation, un scan…).
 */
export function getCurrentChdmanPath(): string | null {
  return currentChdmanPath;
}

export function setCurrentChdmanPath(chdmanPath: string | null): void {
  currentChdmanPath = chdmanPath;
}
