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

// src/helpers/m3uWriter.ts
// Création des .m3u des jeux multi-disques / multi-supports après la consolidation.
// Le .m3u est posé à côté des disques et les référence par nom relatif.

import path from 'path';
import fs from 'fs/promises';
import type { Database } from '../database/init.js';
import { multiDiscInfo } from '../shared/romNaming/index.js';

/** Un jeu multi-disques : ses entrées DAT (une par support), dans l'ordre de lecture. */
export interface M3uGroup {
  groupKey: string;
  discs: Array<{ gameId: number; name: string; index: number }>;
}

export interface M3uWriteResult {
  created: string[];
  skipped: Array<{ group: string; reason: 'noEntry' | 'notEnoughDiscs' }>;
}

/**
 * Fichier d'entrée d'un disque, par ordre de préférence. Une archive 7z/zip/rar
 * n'est jamais retenue : les cores ne la lisent pas depuis un .m3u.
 */
const ENTRY_EXTENSIONS = ['.chd', '.cue', '.gdi', '.ccd', '.toc', '.cdi', '.iso', '.cso', '.pbp'];
const ARCHIVE_EXTENSIONS = new Set(['.zip', '.7z', '.rar']);

/**
 * Regroupe les jeux par support (« (Disc N) »…). Seuls les groupes d'au moins deux
 * entrées sont retenus : un disque isolé n'a pas besoin de .m3u.
 */
export function buildM3uGroups(games: Array<{ id: number; name: string }>): M3uGroup[] {
  const byKey = new Map<string, M3uGroup>();
  for (const game of games) {
    const info = multiDiscInfo(game.name);
    if (!info) continue;
    let group = byKey.get(info.groupKey);
    if (!group) {
      group = { groupKey: info.groupKey, discs: [] };
      byKey.set(info.groupKey, group);
    }
    group.discs.push({ gameId: game.id, name: game.name, index: info.index });
  }
  const groups = [...byKey.values()].filter(g => g.discs.length >= 2);
  for (const g of groups) {
    g.discs.sort((a, b) => a.index - b.index || a.name.localeCompare(b.name));
  }
  return groups;
}

/** Chemin comparable (casse ignorée hors Linux, séparateurs normalisés). */
function comparablePath(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === 'linux' ? resolved : resolved.toLowerCase();
}

/** Fichier produit pour un disque dans le dossier de sortie, ou null si aucun n'est exploitable. */
async function discEntryFile(db: Database, gameId: number, outputFolder: string): Promise<string | null> {
  const rows = await db.all<{ file_path: string }>(
    `SELECT DISTINCT sf.file_path
       FROM dat_roms dr
       JOIN rom_matches rm ON rm.dat_rom_id = dr.id
       JOIN scanned_files sf ON sf.id = rm.scanned_file_id
      WHERE dr.game_id = ?`,
    [gameId]
  );
  const folder = comparablePath(outputFolder);
  const files = rows
    .map(r => r.file_path)
    .filter(fp => comparablePath(path.dirname(fp)) === folder)
    .filter(fp => !ARCHIVE_EXTENSIONS.has(path.extname(fp).toLowerCase()));

  for (const ext of ENTRY_EXTENSIONS) {
    const found = files.find(fp => path.extname(fp).toLowerCase() === ext);
    if (found) return found;
  }
  // Support sans fichier d'index (image disquette, cassette) : un fichier unique.
  return files.length === 1 ? files[0] : null;
}

/**
 * Écrit un .m3u par groupe dans `outputFolder` (écrase un .m3u existant). Un groupe
 * dont un disque n'a pas de fichier lisible est ignoré : un .m3u incomplet ferait
 * échouer le changement de disque en cours de partie.
 */
export async function writeM3uFiles(
  db: Database,
  groups: M3uGroup[],
  outputFolder: string,
  sanitizeFileName: (name: string) => string
): Promise<M3uWriteResult> {
  const result: M3uWriteResult = { created: [], skipped: [] };

  for (const group of groups) {
    const entries: string[] = [];
    let missing = false;
    for (const disc of group.discs) {
      const file = await discEntryFile(db, disc.gameId, outputFolder);
      if (!file) {
        console.warn(`[m3u] ${group.groupKey}: no playable file for "${disc.name}" — .m3u not created`);
        missing = true;
        break;
      }
      entries.push(path.basename(file));
    }
    if (missing) {
      result.skipped.push({ group: group.groupKey, reason: 'noEntry' });
      continue;
    }
    const unique = [...new Set(entries)];
    if (unique.length < 2) {
      result.skipped.push({ group: group.groupKey, reason: 'notEnoughDiscs' });
      continue;
    }

    const m3uPath = path.join(outputFolder, `${sanitizeFileName(group.groupKey)}.m3u`);
    await fs.writeFile(m3uPath, unique.join('\n') + '\n', 'utf8');
    console.log(`[m3u] ${path.basename(m3uPath)} created (${unique.length} discs)`);
    result.created.push(m3uPath);
  }

  return result;
}
