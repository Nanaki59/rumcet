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

// src/shared/romNaming/multiDisc.ts
// Détection des jeux multi-disques / multi-supports à partir du nom DAT, pour
// regrouper leurs entrées dans un .m3u. Fonction pure, sans I/O.
//
// Exemples reconnus :
//   Final Fantasy VII (USA) (Disc 2)             → clé « Final Fantasy VII (USA) », n° 2
//   Monkey Island (Europe) (Disk 1 of 4)         → clé « Monkey Island (Europe) », n° 1
//   Elite (Europe) (Tape 2)                      → clé « Elite (Europe) », n° 2
//   Bard's Tale (USA) (Disk 1 Side B)            → clé « Bard's Tale (USA) », n° 1, face B
//   Ultima IV (USA) (Side A)                     → clé « Ultima IV (USA) », face A

/** Support numéroté : « Disc 1 », « Disk 2 of 3 », « CD 1 », « Tape 1 », avec face éventuelle. */
const NUMBERED_MEDIA = /^(?:Dis[ck]|CD|Tape|Cassette)\s*(\d+)(?:\s+of\s+\d+)?(?:\s*,?\s*Side\s+([A-Z]))?$/i;
/** Face seule : « Side A ». */
const SIDE_ONLY = /^Side\s+([A-Z])$/i;

export interface MultiDiscInfo {
  /** Nom du jeu sans le groupe de support : clé de regroupement et nom du .m3u. */
  groupKey: string;
  /** Rang du support dans le jeu (disque × 100 + face), pour trier les entrées. */
  index: number;
}

/**
 * Repère un support numéroté dans le nom d'un jeu. `null` si le nom n'en déclare
 * aucun (jeu mono-support).
 */
export function multiDiscInfo(name: string): MultiDiscInfo | null {
  const media = { found: false, index: 0 };

  const groupKey = name.replace(/\s*\(([^()]*)\)/g, (whole, inner: string) => {
    const text = inner.trim();
    const numbered = text.match(NUMBERED_MEDIA);
    if (numbered) {
      const side = numbered[2] ? sideRank(numbered[2]) : 0;
      media.found = true;
      media.index += parseInt(numbered[1], 10) * 100 + side;
      return '';
    }
    const sideOnly = text.match(SIDE_ONLY);
    if (sideOnly) {
      media.found = true;
      media.index += sideRank(sideOnly[1]);
      return '';
    }
    return whole;
  }).replace(/\s{2,}/g, ' ').trim();

  if (!media.found || groupKey.length === 0) return null;
  return { groupKey, index: media.index };
}

/** A → 1, B → 2… */
function sideRank(letter: string): number {
  return letter.toUpperCase().charCodeAt(0) - 64;
}
