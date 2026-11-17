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

// src/main/handlers/datDownload.handlers.ts

import { ipcMain, app, shell, dialog, BrowserWindow } from 'electron';
import https from 'https';
import http from 'http';
import path from 'path';
import fs from 'fs/promises';
import AdmZip from 'adm-zip';
import Seven from 'node-7z';
import { getBundled7zaPath } from '../../helpers/toolPaths.js';
import { SYSTEMS, getBundledSystem } from '../../config/systems.js';
import { fetchRecalboxTags, type RecalboxChannel } from '../../helpers/recalboxGitlab.js';
import { settingsManager } from '../../helpers/settingsManager.js';
import { getDatabasePathFromDat } from '../../helpers/getDatabasePathFromDat.js';
import { databaseService } from '../services/database.service.js';
import { getMetadata } from '../../database/init.js';
import { createDatabaseAndLoadDat, saveDbFolderSettings, DbFolderInput } from './database.handlers.js';
import { loadComplementaryDatFromPath } from './dat.handlers.js';
import type { DatSystemInfo, MameVersion, RecalboxMameChannel, RecalboxMameRef, DatDownloadParams, DatDownloadResult, NoIntroFormParams, PleasuredomeDatEntry } from '../../types/global.js';

// 7za de 7zip-bin, hors de app.asar dans la version packagée
const pathTo7zip = getBundled7zaPath();

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT = 60000;

// ==========================================
// Utilitaires HTTP
// ==========================================

function httpGet(url: string, options: { followRedirects?: boolean; maxRedirects?: number } = {}): Promise<Buffer> {
  const { followRedirects = true, maxRedirects = 5 } = options;

  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: REQUEST_TIMEOUT
    }, (res) => {
      // Gérer les redirections
      if (followRedirects && res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (maxRedirects <= 0) {
          reject(new Error('Trop de redirections'));
          return;
        }
        let redirectUrl = res.headers.location;
        if (redirectUrl.startsWith('/')) {
          const parsed = new URL(url);
          redirectUrl = `${parsed.protocol}//${parsed.host}${redirectUrl}`;
        }
        resolve(httpGet(redirectUrl, { followRedirects, maxRedirects: maxRedirects - 1 }));
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout de la requête'));
    });
  });
}

function httpPost(url: string, body: string, contentType: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const protocol = parsed.protocol === 'https:' ? https : http;

    const req = protocol.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': contentType,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: REQUEST_TIMEOUT
    }, (res) => {
      // Gérer les redirections
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (redirectUrl.startsWith('/')) {
          redirectUrl = `${parsed.protocol}//${parsed.host}${redirectUrl}`;
        }
        resolve(httpGet(redirectUrl));
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout de la requête'));
    });

    req.write(body);
    req.end();
  });
}

// ==========================================
// Récupération des listes de systèmes
// ==========================================

/**
 * Pages d'index des sources, ouvertes dans le navigateur externe pour les systèmes
 * sans source DAT connue (jamais interrogées par l'application : DAT-o-Matic
 * bannit les IP des outils qui ne sont pas un navigateur reconnu).
 */
const SOURCE_INDEX_URLS: Record<'no-intro' | 'redump', string> = {
  'no-intro': 'https://datomatic.no-intro.org/index.php?page=download',
  'redump': 'http://redump.org/downloads/'
};

function buildUnifiedSystemList(): DatSystemInfo[] {
  // Systèmes avec sources DAT + systèmes ajoutés par une mise à jour Recalbox
  // (sans source connue : l'utilisateur peut chercher puis associer manuellement)
  return SYSTEMS
    .filter(sys => sys.datSources?.['no-intro'] || sys.datSources?.['redump'] || sys.addedByUpdate)
    .map(sys => {
      const sources: DatSystemInfo['sources'] = [];
      const ds = sys.datSources ?? {};
      if (ds['no-intro']) {
        sources.push({
          type: 'no-intro',
          id: ds['no-intro'].id,
          recommended: ds.recommended === 'no-intro'
        });
      }
      if (ds['redump']) {
        sources.push({
          type: 'redump',
          id: ds['redump'].slug,
          recommended: ds.recommended === 'redump'
        });
      }
      // Format d'affichage : "Manufacturer - Fullname" pour préserver le tri par constructeur
      const displayName = sys.manufacturer ? `${sys.manufacturer} - ${sys.fullname}` : sys.fullname;
      const info: DatSystemInfo = { name: displayName, systemId: sys.systemId, sources };
      if (sources.length === 0) info.unknownSource = true;
      else if (!getBundledSystem(sys.systemId)?.datSources) info.userDefinedSources = true;
      return info;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

interface RecalboxMameInfo {
  /**
   * Par type de release ('Stable' | 'Patron' | 'Alpha') : dernier tag Recalbox de ce
   * canal et versions MAME qu'il embarque (ex: '0278').
   */
  byRelease: Map<RecalboxMameChannel, { ref: string; versions: Set<string> }>;
}

const RECALBOX_CHANNEL_LABELS: Record<RecalboxMameChannel, string> = {
  stable: 'Stable',
  patron: 'Patron',
  patronAlpha: 'Patron Alpha',
  alpha: 'Alpha'
};

async function fetchRecalboxMameVersions(): Promise<RecalboxMameInfo> {
  const info: RecalboxMameInfo = { byRelease: new Map() };

  try {
    // 1) Dernier tag de chaque canal (tags triés du plus récent au plus ancien ;
    //    classement partagé avec la mise à jour des systèmes)
    const tags = await fetchRecalboxTags();
    const latest = (channel: RecalboxChannel) => tags.find(tag => tag.channel === channel)?.name ?? null;

    // 2) Pour chaque canal, récupérer les versions MAME
    const releases: Array<[RecalboxMameChannel, string | null]> = [
      ['stable', latest('stable')],
      ['patron', latest('patron')],
      ['patronAlpha', latest('patronAlpha')],
      ['alpha', latest('alpha')],
    ];

    await Promise.all(releases.map(async ([label, ref]) => {
      if (!ref) return;
      const versions = new Set<string>();
      try {
        let unifiedPackage = false;
        for (let page = 1; page <= 5; page++) {
          const url = `https://gitlab.com/api/v4/projects/recalbox%2Frecalbox/repository/tree?path=package&per_page=100&page=${page}&ref=${encodeURIComponent(ref)}`;
          const data = JSON.parse((await httpGet(url)).toString('utf-8'));
          if (!Array.isArray(data) || data.length === 0) break;

          for (const entry of data) {
            if (entry.type !== 'tree' || !entry.name.startsWith('libretro-mame')) continue;
            if (entry.name === 'libretro-mame') unifiedPackage = true;
            else versions.add(entry.name.replace('libretro-mame', ''));
          }
        }

        // Recalbox 11+ : un seul paquet libretro-mame (sous-paquets -latest / -old),
        // versions déclarées dans libretro-mame.mk (LIBRETRO_MAME_*_VERSION_NAME = 0287)
        if (unifiedPackage) {
          const mkPath = encodeURIComponent('package/libretro-mame/libretro-mame.mk');
          const mk = (await httpGet(
            `https://gitlab.com/api/v4/projects/recalbox%2Frecalbox/repository/files/${mkPath}/raw?ref=${encodeURIComponent(ref)}`
          )).toString('utf-8');
          for (const m of mk.matchAll(/^\s*LIBRETRO_MAME_\w*VERSION_NAME\s*=\s*(\d+)\s*$/gm)) {
            versions.add(m[1]);
          }
        }
      } catch {
        // Ignorer les erreurs par release
      }
      if (versions.size > 0) {
        info.byRelease.set(label, { ref, versions });
      }
    }));
  } catch (error) {
    console.warn('Unable to retrieve MAME Recalbox versions:', error);
  }

  return info;
}

/** Canaux Recalbox (dernier tag de chacun) utilisant cette version de MAME. */
function matchRecalboxTags(progettoVersion: string, recalboxInfo: RecalboxMameInfo): RecalboxMameRef[] {
  // progettoVersion est au format "0.278" — on cherche "0278" dans Recalbox
  const noDot = progettoVersion.replace('.', '');

  const matched: RecalboxMameRef[] = [];

  // Ordre fixe des badges (byRelease est rempli dans l'ordre d'arrivée des requêtes)
  for (const channel of Object.keys(RECALBOX_CHANNEL_LABELS) as RecalboxMameChannel[]) {
    const release = recalboxInfo.byRelease.get(channel);
    if (!release) continue;
    const { ref, versions } = release;
    let found = false;
    // Correspondance directe
    if (versions.has(noDot)) {
      found = true;
    } else {
      // Vérifier les cas spéciaux (ex: 2003-plus)
      for (const rv of versions) {
        if (noDot === rv.replace('-plus', '')) {
          found = true;
          break;
        }
      }
    }
    if (found) {
      matched.push({ channel, ref });
    }
  }

  return matched;
}

async function fetchMameVersions(): Promise<MameVersion[]> {
  // Lancer en parallèle : versions Progetto-Snaps + versions Recalbox
  const [html, recalboxVersions] = await Promise.all([
    httpGet('https://www.progettosnaps.net/dats/MAME/').then(buf => buf.toString('utf-8')),
    fetchRecalboxMameVersions()
  ]);

  const versions: MameVersion[] = [];

  // Fonction utilitaire : supprime toutes les balises HTML d'un texte
  const stripHtml = (s: string) => s.replace(/<[^>]+>/g, '').trim();

  // Approche par blocs : chercher les lignes de tableau (<TR>)
  const rows = html.split(/<TR/gi);
  for (const row of rows) {
    // Chercher un lien de téléchargement DAT MAME
    const dlMatch = row.match(/href="([^"]*tipo=dat_mame[^"]*)"/i);
    if (!dlMatch) continue;

    // Extraire les cellules <TD>...</TD>
    const cells = row.match(/<TD[^>]*>([\s\S]*?)<\/TD>/gi);
    if (!cells || cells.length < 2) continue;

    // Colonne 1 : version — supprimer toutes les balises HTML internes (span, strong, etc.)
    const versionText = stripHtml(cells[0].replace(/<TD[^>]*>/i, ''));
    if (!versionText || !/\d/.test(versionText)) continue;

    // Colonne 2 : date — même traitement
    const dateText = stripHtml(cells[1].replace(/<TD[^>]*>/i, ''));

    let downloadUrl = dlMatch[1].replace(/&amp;/g, '&');
    if (downloadUrl.startsWith('/')) {
      downloadUrl = `https://www.progettosnaps.net${downloadUrl}`;
    } else if (!downloadUrl.startsWith('http')) {
      downloadUrl = `https://www.progettosnaps.net/dats/MAME/${downloadUrl}`;
    }

    // Vérifier si cette version est utilisée par Recalbox
    const recalboxRefs = matchRecalboxTags(versionText, recalboxVersions);

    versions.push({
      version: versionText,
      date: dateText || undefined,
      // Texte de recherche (libellés non traduits) ; l'affichage traduit recalboxRefs
      recalboxTag: recalboxRefs.length > 0 ? recalboxRefs.map(r => RECALBOX_CHANNEL_LABELS[r.channel]).join(' / ') : undefined,
      recalboxRefs: recalboxRefs.length > 0 ? recalboxRefs : undefined,
      downloadUrl
    });
  }

  // La page Progetto-Snaps liste les versions de la plus ancienne à la plus récente.
  // On inverse pour afficher la plus récente en premier.
  versions.reverse();

  // Marquer la dernière version
  if (versions.length > 0) {
    versions[0].isLatest = true;
  }

  return versions;
}

// ==========================================
// Pleasuredome (DATs MAME pré-organisés par mode : split / merged / non-merged / CHDs)
// ==========================================

const PLEASUREDOME_MAME_URL = 'https://pleasuredome.github.io/pleasuredome/mame/index.html';

/**
 * Récupère la liste des DATs MAME disponibles sur la page Pleasuredome.
 * La page GitHub Pages liste des liens vers des archives .zip contenant chacune
 * un fichier .dat/.xml (ex : "MAME 0.288 ROMs (split).zip").
 *
 * ⚠️ Les DATs Pleasuredome sont strippés des attributs relationnels
 * (cloneof/romof/merge) — RUMCET affiche déjà un avertissement dans le bandeau
 * quand il détecte ce cas (mode déduit du header).
 */
async function fetchPleasuredomeDats(): Promise<PleasuredomeDatEntry[]> {
  const html = (await httpGet(PLEASUREDOME_MAME_URL)).toString('utf-8');
  const entries: PleasuredomeDatEntry[] = [];
  const seen = new Set<string>();

  // Liens <a href="xxx.zip">label</a> — la page utilise des hrefs relatifs.
  const linkRe = /<a\s+[^>]*href="([^"]+\.zip)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    let url = m[1];
    // Résoudre les URLs relatives par rapport à la page
    try {
      url = new URL(url, PLEASUREDOME_MAME_URL).toString();
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);

    // Libellé : texte du lien sans balises, sinon nom de fichier décodé
    let label = m[2].replace(/<[^>]+>/g, '').trim();
    if (!label) {
      try {
        label = decodeURIComponent(path.basename(new URL(url).pathname, '.zip'));
      } catch {
        label = path.basename(url, '.zip');
      }
    }

    entries.push({ name: label, url });
  }

  // Ne garder que les entrées MAME (la page peut lister d'autres liens de navigation)
  return entries.filter(e => /mame/i.test(e.name) || /mame/i.test(e.url));
}

// ==========================================
// Téléchargement des DAT
// ==========================================

async function downloadRedumpDat(slug: string, destFolder: string): Promise<DatDownloadResult> {
  try {
    const url = `http://redump.org/datfile/${slug}/`;
    const zipBuffer = await httpGet(url);
    return extractDatFromZip(zipBuffer, destFolder, `redump_${slug}`);
  } catch (error: any) {
    return { success: false, error: `Erreur téléchargement Redump: ${error.message}` };
  }
}

async function downloadMameDat(downloadUrl: string, destFolder: string): Promise<DatDownloadResult> {
  try {
    const archiveBuffer = await httpGet(downloadUrl);

    // Déterminer le type d'archive
    const isZip = archiveBuffer.length >= 4 && archiveBuffer[0] === 0x50 && archiveBuffer[1] === 0x4B;
    const is7z = archiveBuffer.length >= 6 &&
      archiveBuffer[0] === 0x37 && archiveBuffer[1] === 0x7A &&
      archiveBuffer[2] === 0xBC && archiveBuffer[3] === 0xAF &&
      archiveBuffer[4] === 0x27 && archiveBuffer[5] === 0x1C;

    if (isZip) {
      return extractDatFromZip(archiveBuffer, destFolder, 'mame');
    } else if (is7z) {
      return extractDatFrom7z(archiveBuffer, destFolder);
    } else {
      return { success: false, error: 'Le fichier téléchargé n\'est ni un ZIP ni un 7z' };
    }
  } catch (error: any) {
    return { success: false, error: `Erreur téléchargement MAME: ${error.message}` };
  }
}

// ==========================================
// Extraction 7z
// ==========================================

async function extractDatFrom7z(archiveBuffer: Buffer, destFolder: string): Promise<DatDownloadResult> {
  const tempDir = path.join(app.getPath('temp'), 'RUMCET', `dat-download-${Date.now()}`);
  const tempArchive = path.join(tempDir, 'archive.7z');
  const tempExtract = path.join(tempDir, 'extracted');

  try {
    // Créer les dossiers temporaires
    await fs.mkdir(tempExtract, { recursive: true });

    // Écrire le buffer dans un fichier temporaire
    await fs.writeFile(tempArchive, archiveBuffer);

    // Extraire avec 7-Zip
    await new Promise<void>((resolve, reject) => {
      const myStream = Seven.extractFull(tempArchive, tempExtract, {
        $bin: pathTo7zip,
        yes: true
      });
      myStream.on('end', () => resolve());
      myStream.on('error', (err: any) => reject(err));
    });

    // Chercher récursivement les fichiers .dat ou .xml
    const datFile = await findDatFile(tempExtract);
    if (!datFile) {
      return { success: false, error: 'Aucun fichier DAT ou XML trouvé dans l\'archive 7z' };
    }

    // Copier vers la destination
    await fs.mkdir(destFolder, { recursive: true });
    const fileName = path.basename(datFile);
    const destPath = path.join(destFolder, fileName);
    await fs.copyFile(datFile, destPath);

    return { success: true, filePath: destPath };
  } catch (error: any) {
    return { success: false, error: `Erreur extraction 7z: ${error.message}` };
  } finally {
    // Nettoyer les fichiers temporaires
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignorer les erreurs de nettoyage
    }
  }
}

async function findDatFile(dir: string): Promise<string | null> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = await findDatFile(fullPath);
      if (found) return found;
    } else if (entry.name.endsWith('.dat') || entry.name.endsWith('.xml')) {
      return fullPath;
    }
  }
  return null;
}

// ==========================================
// Extraction ZIP
// ==========================================

async function extractDatFromZip(zipBuffer: Buffer, destFolder: string, prefix: string): Promise<DatDownloadResult> {
  try {
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();

    // Trouver le fichier DAT/XML dans le ZIP
    const datEntry = entries.find(e =>
      !e.isDirectory && (
        e.entryName.endsWith('.dat') ||
        e.entryName.endsWith('.xml')
      )
    );

    if (!datEntry) {
      return { success: false, error: 'Aucun fichier DAT ou XML trouvé dans l\'archive' };
    }

    // S'assurer que le dossier de destination existe
    await fs.mkdir(destFolder, { recursive: true });

    // Nom du fichier : garder le nom original du ZIP
    const fileName = datEntry.entryName.includes('/')
      ? path.basename(datEntry.entryName)
      : datEntry.entryName;
    const destPath = path.join(destFolder, fileName);

    // Extraire le fichier
    const content = datEntry.getData();
    await fs.writeFile(destPath, content);

    return { success: true, filePath: destPath };
  } catch (error: any) {
    return { success: false, error: `Erreur extraction ZIP: ${error.message}` };
  }
}

// ==========================================
// Enregistrement des handlers IPC
// ==========================================

export function registerDatDownloadHandlers(getMainWindow?: () => BrowserWindow | null): void {
  ipcMain.handle('dat-download:get-systems', async () => {
    return buildUnifiedSystemList();
  });

  ipcMain.handle('dat-download:get-mame-versions', async () => {
    return fetchMameVersions();
  });

  ipcMain.handle('dat-download:get-pleasuredome-dats', async () => {
    return fetchPleasuredomeDats();
  });

  /**
   * Contexte pour l'écran unifié de chargement DAT :
   *  - dbOpen : une base est-elle active ? (détermine primary vs complementary)
   *  - dbPath / datName : infos de la base active (affichage du mode complémentaire)
   *  - defaultDatFolder : dossier par défaut des DATs (destination téléchargement)
   */
  ipcMain.handle('dat-download:get-context', async () => {
    const database = databaseService.getDatabase();
    let datName: string | null = null;
    if (database) {
      try { datName = await getMetadata(database, 'dat_name'); } catch { /* ignore */ }
    }
    return {
      dbOpen: !!database,
      dbPath: databaseService.getDbPath() || null,
      datName,
      defaultDatFolder: settingsManager.get('defaultDatFolder') || ''
    };
  });

  /** Sélection d'un fichier DAT/XML local (dialog depuis la fenêtre de chargement). */
  ipcMain.handle('dat-download:select-local-dat', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win!, {
      title: 'Sélectionner un fichier DAT/XML',
      defaultPath: settingsManager.get('defaultDatFolder') || undefined,
      filters: [
        { name: 'Fichiers DAT/XML', extensions: ['dat', 'xml'] },
        { name: 'Tous les fichiers', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  /** Chemin de base de données proposé automatiquement à partir du nom du DAT. */
  ipcMain.handle('dat-download:get-default-db-path', async (_event, datPath: string) => {
    try {
      return getDatabasePathFromDat(datPath);
    } catch {
      return null;
    }
  });

  /** Dialog « Enregistrer sous » pour personnaliser l'emplacement/nom de la base. */
  ipcMain.handle('dat-download:browse-db-path', async (event, suggestedPath?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win!, {
      title: 'Choisir l\'emplacement et le nom de la base de données',
      defaultPath: suggestedPath || settingsManager.get('defaultDatabaseFolder') || undefined,
      filters: [
        { name: 'Base de données SQLite', extensions: ['sqlite'] },
        { name: 'Base de données générique', extensions: ['db'] }
      ],
      properties: ['createDirectory']
    });
    if (result.canceled || !result.filePath) return null;
    return result.filePath;
  });

  /**
   * Flux unifié de chargement d'un DAT :
   *  - Base fermée → crée la base (à dbPath, ou chemin auto dérivé du DAT)
   *    et charge le DAT en PRIMAIRE.
   *  - Base ouverte → fusionne le DAT en COMPLÉMENTAIRE dans la base active.
   * Notifie la fenêtre principale via l'événement 'dat-download:loaded' pour
   * qu'elle rafraîchisse son état (bandeau, liste de jeux, workflow).
   */
  ipcMain.handle('dat-download:load', async (_event, params: { datPath: string; dbPath?: string; overwrite?: boolean; folders?: DbFolderInput }) => {
    const { datPath } = params;
    if (!datPath) throw new Error('Aucun fichier DAT spécifié.');

    const database = databaseService.getDatabase();

    if (database) {
      // ── Mode complémentaire ──
      const result = await loadComplementaryDatFromPath(datPath);
      const payload = { mode: 'complementary' as const, ...result };
      getMainWindow?.()?.webContents.send('dat-download:loaded', payload);
      return payload;
    }

    // ── Mode primaire : création de la base ──
    const dbPath = params.dbPath || getDatabasePathFromDat(datPath);

    // Protection écrasement : si le fichier existe et que l'appelant n'a pas
    // confirmé, on renvoie un marqueur pour que l'UI demande confirmation.
    if (!params.overwrite) {
      try {
        await fs.access(dbPath);
        return { mode: 'primary' as const, fileExists: true, dbPath };
      } catch {
        // Le fichier n'existe pas — on continue
      }
    }

    const result = await createDatabaseAndLoadDat(datPath, dbPath);
    // Dossiers choisis pour cette base (cible, sous-dossier système, dossiers de travail)
    const created = databaseService.getDatabase();
    if (params.folders && created) {
      await saveDbFolderSettings(created, params.folders);
    }
    const payload = { mode: 'primary' as const, datPath, ...result };
    getMainWindow?.()?.webContents.send('dat-download:loaded', payload);
    return payload;
  });

  /**
   * Téléchargement direct du DAT — utilisé pour Redump et MAME (sources sûres).
   * Le téléchargement automatisé chez No-Intro entraînant des bans IP, cette
   * source n'est PAS gérée ici : utiliser `dat-download:open-page` à la place.
   */
  ipcMain.handle('dat-download:download', async (_event, params: DatDownloadParams): Promise<DatDownloadResult> => {
    const { type, source, systemId, mameVersion, url, destFolder } = params;

    if (type === 'mame') {
      if (!mameVersion) return { success: false, error: 'Version MAME non spécifiée' };
      const versions = await fetchMameVersions();
      const version = versions.find(v => v.version === mameVersion);
      if (!version) return { success: false, error: `Version MAME ${mameVersion} non trouvée` };
      return downloadMameDat(version.downloadUrl, destFolder);
    }

    if (type === 'pleasuredome') {
      if (!url) return { success: false, error: 'URL Pleasuredome non spécifiée' };
      // downloadMameDat détecte le type d'archive (zip/7z) par magic bytes
      return downloadMameDat(url, destFolder);
    }

    if (type === 'system') {
      if (!source || !systemId) return { success: false, error: 'Source ou système non spécifié' };
      if (source === 'redump') return downloadRedumpDat(systemId, destFolder);
      if (source === 'no-intro') {
        return {
          success: false,
          error: 'Le téléchargement automatique No-Intro est désactivé (risque de bannissement IP). Utilisez « Ouvrir la page » pour télécharger manuellement.'
        };
      }
      return { success: false, error: `Source inconnue: ${source}` };
    }

    return { success: false, error: `Type de téléchargement inconnu: ${type}` };
  });

  /**
   * Ouvre la page de téléchargement officielle dans le navigateur par défaut.
   * Utilisé pour No-Intro (toujours), Redump et MAME (en complément du direct).
   *
   * URLs construites :
   *  - no-intro : https://datomatic.no-intro.org/index.php?page=download&op=dat&s={id}
   *  - redump   : http://redump.org/datfile/{slug}/
   *  - MAME     : URL fournie par fetchMameVersions()
   */
  ipcMain.handle('dat-download:open-page', async (_event, params: DatDownloadParams): Promise<DatDownloadResult> => {
    const { type, source, systemId, mameVersion } = params;

    try {
      let url: string | null = null;

      if (type === 'mame') {
        if (!mameVersion) return { success: false, error: 'Version MAME non spécifiée' };
        const versions = await fetchMameVersions();
        const version = versions.find(v => v.version === mameVersion);
        if (!version) return { success: false, error: `Version MAME ${mameVersion} non trouvée` };
        url = version.downloadUrl;
      } else if (type === 'pleasuredome') {
        url = params.url || PLEASUREDOME_MAME_URL;
      } else if (type === 'source-index') {
        if (source !== 'no-intro' && source !== 'redump') return { success: false, error: `Source inconnue: ${source}` };
        url = SOURCE_INDEX_URLS[source];
      } else if (type === 'system') {
        if (!source || !systemId) return { success: false, error: 'Source ou système non spécifié' };
        if (source === 'redump') url = `http://redump.org/datfile/${systemId}/`;
        else if (source === 'no-intro') url = `https://datomatic.no-intro.org/index.php?page=download&op=dat&s=${systemId}`;
        else return { success: false, error: `Source inconnue: ${source}` };
      } else {
        return { success: false, error: `Type de téléchargement inconnu: ${type}` };
      }

      if (!url) return { success: false, error: 'URL non déterminée' };

      await shell.openExternal(url);
      return { success: true, filePath: url };
    } catch (error: any) {
      return { success: false, error: `Impossible d'ouvrir la page : ${error.message}` };
    }
  });
}
