// src/helpers/detectSetMode.ts
import { Database, getMetadata } from '../database/init.js';

/** Modes possibles d'un set ROM scanné. 'n/a' = DAT non arcade. */
export type ScannedSetMode = 'split' | 'non-merged' | 'merged' | 'unknown' | 'n/a';

const ARCHIVE_EXT_RE = /\.(zip|7z|rar|chd|iso|cso)$/i;

function archiveBasename(fileName: string): string {
  return fileName.replace(ARCHIVE_EXT_RE, '').toLowerCase();
}

/**
 * Détecte si l'ensemble de ROMs scannées sur disque est organisé en
 * mode split / non-merged / merged.
 *
 * Heuristique (vote par paire clone/parent) :
 *   - Récupérer les paires (clone, parent) où les deux sont présents en DB.
 *   - Pour chaque clone G de parent P :
 *     · Trouver les archives qui matchent au moins une ROM de G.
 *     · Si une archive nommée comme G ("archive propre du clone") existe :
 *         - Si elle contient des ROMs avec le même CRC32 qu'une ROM de P → vote non-merged
 *         - Sinon → vote split
 *     · Sinon, si une archive nommée comme P contient des ROMs de G → vote merged
 *     · Sinon → on n'a pas assez d'info, on ne vote pas
 *   - Le mode avec le plus de votes l'emporte.
 *
 * Retourne 'n/a' si le DAT n'est pas arcade.
 * Retourne 'unknown' si aucun clone n'existe dans le DAT ou aucun vote n'a pu être collecté.
 */
export async function detectScannedSetMode(db: Database): Promise<ScannedSetMode> {
  const datSetMode = await getMetadata(db, 'dat_set_mode');
  console.log(`[setMode] dat_set_mode = ${datSetMode}`);
  if (!datSetMode || datSetMode === 'n/a') return 'n/a';

  const clonePairs = await db.all<{
    child_id: number; child_name: string;
    parent_id: number; parent_name: string;
  }>(`
    SELECT
      c.id AS child_id, c.name AS child_name,
      p.id AS parent_id, p.name AS parent_name
    FROM game_relationships gr
    JOIN games c ON gr.child_game_id = c.id
    JOIN games p ON gr.parent_game_id = p.id
    WHERE gr.relationship_type = 'cloneof'
  `);

  console.log(`[setMode] clone pairs in DB : ${clonePairs.length}`);
  if (clonePairs.length === 0) return 'unknown';

  let splitVotes = 0;
  let nonMergedVotes = 0;
  let mergedVotes = 0;
  let skipped = 0;
  const samples: string[] = [];

  for (const pair of clonePairs) {
    // CRC32 (en majuscules) des ROMs du parent — sert à détecter les ROMs
    // partagées dupliquées dans l'archive du clone.
    const parentRoms = await db.all<{ crc32: string | null }>(
      `SELECT crc32 FROM dat_roms WHERE game_id = ? AND is_disk = 0 AND crc32 IS NOT NULL`,
      [pair.parent_id]
    );
    if (parentRoms.length === 0) continue;
    const parentCrcs = new Set(parentRoms.map(r => r.crc32!.toUpperCase()));

    // Archives distinctes qui matchent au moins une ROM du clone.
    const matchingArchives = await db.all<{
      scanned_file_id: number;
      file_name: string;
      is_archive: number;
    }>(
      `SELECT DISTINCT sf.id AS scanned_file_id, sf.file_name, sf.is_archive
       FROM rom_matches rm
       JOIN scanned_files sf ON sf.id = rm.scanned_file_id
       JOIN dat_roms dr ON rm.dat_rom_id = dr.id
       WHERE dr.game_id = ?`,
      [pair.child_id]
    );

    if (matchingArchives.length === 0) { skipped++; continue; }

    const cloneNameLower = pair.child_name.toLowerCase();
    const parentNameLower = pair.parent_name.toLowerCase();

    const cloneOwnArchive = matchingArchives.find(
      a => a.is_archive && archiveBasename(a.file_name) === cloneNameLower
    );
    const parentArchive = matchingArchives.find(
      a => a.is_archive && archiveBasename(a.file_name) === parentNameLower
    );

    if (cloneOwnArchive) {
      // Vérifier si l'archive propre du clone contient des ROMs partagées avec le parent
      const archiveCrcs = await db.all<{ crc32: string | null }>(
        `SELECT crc32 FROM archive_contents WHERE archive_id = ? AND crc32 IS NOT NULL`,
        [cloneOwnArchive.scanned_file_id]
      );

      let sharedCount = 0;
      for (const ac of archiveCrcs) {
        if (parentCrcs.has(ac.crc32!.toUpperCase())) sharedCount++;
      }

      if (sharedCount > 0) {
        nonMergedVotes++;
        if (samples.length < 10) samples.push(`non-merged: ${pair.child_name} (clone archive a ${sharedCount} ROMs partagées avec ${pair.parent_name})`);
      } else {
        splitVotes++;
        if (samples.length < 10) samples.push(`split: ${pair.child_name} (clone archive sans ROM partagée avec ${pair.parent_name})`);
      }
    } else if (parentArchive) {
      mergedVotes++;
      if (samples.length < 10) samples.push(`merged: pas d'archive ${pair.child_name}.*, ROMs trouvées dans ${pair.parent_name}.*`);
    } else {
      // Aucune archive nommée comme clone ni parent — ROMs probablement présentes
      // dans un dossier ou archive sans nom canonique. On ne vote pas.
      skipped++;
      if (samples.length < 10) samples.push(`skipped: ${pair.child_name} (matches dans ${matchingArchives.map(a => a.file_name).join(', ')} mais aucun nom canonique)`);
    }
  }

  console.log(`[setMode] votes — split:${splitVotes}, non-merged:${nonMergedVotes}, merged:${mergedVotes}, skipped:${skipped}`);
  console.log(`[setMode] sample of decisions:\n  ${samples.join('\n  ')}`);

  const total = splitVotes + nonMergedVotes + mergedVotes;
  if (total === 0) return 'unknown';

  if (mergedVotes > splitVotes && mergedVotes > nonMergedVotes) return 'merged';
  if (nonMergedVotes >= splitVotes) return 'non-merged';
  return 'split';
}
