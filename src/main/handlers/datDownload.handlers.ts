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

import { ipcMain, app } from 'electron';
import https from 'https';
import http from 'http';
import path from 'path';
import fs from 'fs/promises';
import AdmZip from 'adm-zip';
import Seven from 'node-7z';
import sevenBin from '7zip-bin';
import { SYSTEMS } from '../../config/systems.js';
import type { DatSystemInfo, MameVersion, DatDownloadParams, DatDownloadResult, NoIntroFormParams } from '../../types/global.js';

const pathTo7zip = sevenBin.path7za;

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

function buildUnifiedSystemList(): DatSystemInfo[] {
  return SYSTEMS
    .filter(sys => sys.datSources && (sys.datSources['no-intro'] || sys.datSources['redump']))
    .map(sys => {
      const sources: DatSystemInfo['sources'] = [];
      const ds = sys.datSources!;
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
      return { name: displayName, sources };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

interface RecalboxMameInfo {
  /** Versions MAME par type de release : 'Stable' | 'Patron' | 'Alpha' → Set de versions Recalbox (ex: '0278') */
  byRelease: Map<string, Set<string>>;
}

async function fetchRecalboxMameVersions(): Promise<RecalboxMameInfo> {
  const info: RecalboxMameInfo = { byRelease: new Map() };

  try {
    // 1) Récupérer les tags récents pour identifier le dernier stable, patron, alpha
    const tagsJson = (await httpGet(
      'https://gitlab.com/api/v4/projects/recalbox%2Frecalbox/repository/tags?per_page=100&order_by=updated&sort=desc'
    )).toString('utf-8');
    const tags: Array<{ name: string }> = JSON.parse(tagsJson);

    let stableTag: string | null = null;
    let patronTag: string | null = null;
    let alphaTag: string | null = null;

    for (const t of tags) {
      const n = t.name;
      if (!stableTag && !n.includes('alpha') && !n.includes('patron') && !n.includes('special') && !n.includes('rpi')) {
        stableTag = n;
      }
      if (!patronTag && n.includes('patron')) {
        patronTag = n;
      }
      if (!alphaTag && n.includes('alpha') && !n.includes('patron') && !n.includes('special')) {
        alphaTag = n;
      }
      if (stableTag && patronTag && alphaTag) break;
    }

    // 2) Pour chaque type de release, récupérer les versions MAME
    const releases: Array<[string, string | null]> = [
      ['Stable', stableTag],
      ['Patron', patronTag],
      ['Alpha', alphaTag],
    ];

    await Promise.all(releases.map(async ([label, ref]) => {
      if (!ref) return;
      const versions = new Set<string>();
      try {
        for (let page = 1; page <= 5; page++) {
          const url = `https://gitlab.com/api/v4/projects/recalbox%2Frecalbox/repository/tree?path=package&per_page=100&page=${page}&ref=${encodeURIComponent(ref)}`;
          const data = JSON.parse((await httpGet(url)).toString('utf-8'));
          if (!Array.isArray(data) || data.length === 0) break;

          for (const entry of data) {
            if (entry.type === 'tree' && entry.name.startsWith('libretro-mame')) {
              versions.add(entry.name.replace('libretro-mame', ''));
            }
          }
        }
      } catch {
        // Ignorer les erreurs par release
      }
      if (versions.size > 0) {
        info.byRelease.set(label, versions);
      }
    }));
  } catch (error) {
    console.warn('Impossible de récupérer les versions MAME Recalbox:', error);
  }

  return info;
}

function matchRecalboxTags(progettoVersion: string, recalboxInfo: RecalboxMameInfo): string | undefined {
  // progettoVersion est au format "0.278" — on cherche "0278" dans Recalbox
  const noDot = progettoVersion.replace('.', '');

  const matchedLabels: string[] = [];

  for (const [label, versions] of recalboxInfo.byRelease) {
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
      matchedLabels.push(label);
    }
  }

  if (matchedLabels.length === 0) return undefined;
  return matchedLabels.join(' / ');
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
    const recalboxTag = matchRecalboxTags(versionText, recalboxVersions);

    versions.push({
      version: versionText,
      date: dateText || undefined,
      recalboxTag,
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

/**
 * Requête HTTP avec gestion des cookies de session.
 * Retourne le buffer de la réponse + les headers (pour récupérer les cookies et redirections).
 */
function httpRequest(
  url: string,
  options: {
    method?: 'GET' | 'POST';
    body?: string;
    contentType?: string;
    cookies?: string;
  } = {}
): Promise<{ buffer: Buffer; headers: http.IncomingHttpHeaders; statusCode: number; location?: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const protocol = parsed.protocol === 'https:' ? https : http;
    const method = options.method || 'GET';

    const reqHeaders: Record<string, string> = { 'User-Agent': USER_AGENT };
    if (options.cookies) reqHeaders['Cookie'] = options.cookies;
    if (options.contentType) reqHeaders['Content-Type'] = options.contentType;
    if (options.body) reqHeaders['Content-Length'] = String(Buffer.byteLength(options.body));

    const req = protocol.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method,
      headers: reqHeaders,
      timeout: REQUEST_TIMEOUT
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          buffer: Buffer.concat(chunks),
          headers: res.headers,
          statusCode: res.statusCode || 0,
          location: res.headers.location
        });
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

function extractSessionCookie(headers: http.IncomingHttpHeaders): string | null {
  const setCookie = headers['set-cookie'];
  if (!setCookie) return null;
  for (const cookie of setCookie) {
    const match = cookie.match(/PHPSESSID=([^;]+)/);
    if (match) return match[1];
  }
  return null;
}

async function downloadNoIntroDat(systemId: string, destFolder: string, params?: NoIntroFormParams): Promise<DatDownloadResult> {
  try {
    const baseUrl = 'https://datomatic.no-intro.org';

    // ── Étape 1 : GET la page de config pour obtenir le cookie de session et le nom du bouton Prepare ──
    const configUrl = `${baseUrl}/index.php?page=download&op=dat&s=${systemId}`;
    const step1 = await httpRequest(configUrl);
    const sessionId = extractSessionCookie(step1.headers);
    if (!sessionId) {
      return { success: false, error: 'No-Intro : impossible d\'obtenir une session' };
    }
    const sessionCookie = `PHPSESSID=${sessionId}`;

    // Extraire le nom dynamique du bouton Prepare (ex: dat_dl_2025-25)
    const prepareMatch = step1.buffer.toString('utf-8').match(/name="(dat_dl_[^"]+)"\s+value="Prepare"/);
    if (!prepareMatch) {
      return { success: false, error: 'No-Intro : bouton Prepare non trouvé sur la page' };
    }
    const prepareButtonName = prepareMatch[1];

    // ── Étape 2 : POST le formulaire avec les paramètres + bouton Prepare ──
    const formFields: Record<string, string> = {
      'format': '0',
      'naming': '0',
      'inc_bios': (params?.includeBios !== false) ? '1' : '0',
      'release_1': '1', // Fulltitle
      'release_2': (params?.includeProto !== false && params?.includeBeta !== false && params?.includeDemo !== false && params?.includeSample !== false) ? '1' : '0',
      'license_1': '1',
      'license_2': '1',
      'license_0': '1',
      'lifespan_1': '1',
      'inc_adult': '1',
      'storage_1': '1',
      'storage_2': '1',
      'inc_nodump': '0',
      'inc_mia': '1',
      'special1_filter': 'all_specials1',
      'special2_filter': 'all_specials2',
      'language_filter': 'all_languages',
      'region_filter': 'all_regions',
      [prepareButtonName]: 'Prepare'
    };

    const formBody = new URLSearchParams(formFields).toString();
    const step2 = await httpRequest(configUrl, {
      method: 'POST',
      body: formBody,
      contentType: 'application/x-www-form-urlencoded',
      cookies: sessionCookie
    });

    // La réponse doit être une redirection 302 vers la page manager
    if (step2.statusCode !== 302 || !step2.location) {
      return { success: false, error: 'No-Intro : redirection attendue après Prepare non reçue' };
    }

    // ── Étape 3 : GET la page manager pour obtenir le nom du bouton Download ──
    let managerUrl = step2.location;
    if (managerUrl.startsWith('/') || !managerUrl.startsWith('http')) {
      managerUrl = `${baseUrl}/${managerUrl.replace(/^\//, '')}`;
    }

    const step3 = await httpRequest(managerUrl, { cookies: sessionCookie });
    const managerHtml = step3.buffer.toString('utf-8');

    // Extraire le nom dynamique du bouton Download (un hash MD5)
    const downloadMatch = managerHtml.match(/name="([a-f0-9]{32})"\s+value="Download!!"/);
    if (!downloadMatch) {
      return { success: false, error: 'No-Intro : bouton Download non trouvé sur la page manager' };
    }
    const downloadButtonName = downloadMatch[1];

    // ── Étape 4 : POST le bouton Download pour récupérer le ZIP ──
    const step4 = await httpRequest(managerUrl, {
      method: 'POST',
      body: `${downloadButtonName}=Download%21%21`,
      contentType: 'application/x-www-form-urlencoded',
      cookies: sessionCookie
    });

    // Vérifier que c'est bien un ZIP
    if (step4.buffer.length < 4 || step4.buffer[0] !== 0x50 || step4.buffer[1] !== 0x4B) {
      return { success: false, error: 'No-Intro : le serveur n\'a pas retourné un fichier ZIP' };
    }

    return extractDatFromZip(step4.buffer, destFolder, `nointro_${systemId}`);
  } catch (error: any) {
    return { success: false, error: `Erreur téléchargement No-Intro: ${error.message}` };
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

export function registerDatDownloadHandlers(): void {
  ipcMain.handle('dat-download:get-systems', async () => {
    return buildUnifiedSystemList();
  });

  ipcMain.handle('dat-download:get-mame-versions', async () => {
    return fetchMameVersions();
  });

  ipcMain.handle('dat-download:download', async (_event, params: DatDownloadParams): Promise<DatDownloadResult> => {
    const { type, source, systemId, mameVersion, destFolder, noIntroParams } = params;

    if (type === 'mame') {
      if (!mameVersion) {
        return { success: false, error: 'Version MAME non spécifiée' };
      }
      // Trouver l'URL de téléchargement dans la liste des versions
      const versions = await fetchMameVersions();
      const version = versions.find(v => v.version === mameVersion);
      if (!version) {
        return { success: false, error: `Version MAME ${mameVersion} non trouvée` };
      }
      return downloadMameDat(version.downloadUrl, destFolder);
    }

    if (type === 'system') {
      if (!source || !systemId) {
        return { success: false, error: 'Source ou système non spécifié' };
      }

      if (source === 'redump') {
        return downloadRedumpDat(systemId, destFolder);
      }

      if (source === 'no-intro') {
        return downloadNoIntroDat(systemId, destFolder, noIntroParams);
      }

      return { success: false, error: `Source inconnue: ${source}` };
    }

    return { success: false, error: `Type de téléchargement inconnu: ${type}` };
  });
}
