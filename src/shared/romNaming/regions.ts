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

// src/shared/romNaming/regions.ts
// Référentiel des régions de la convention de nommage No-Intro (également utilisée
// par Redump), plus les libellés spécifiques rencontrés dans les descriptions MAME.
//
// Les régions sont stockées sous leur forme canonique (celle de No-Intro, en anglais)
// et non traduites : elles servent de clés de comparaison et de priorité, pas de texte
// d'interface. L'UI peut les afficher telles quelles — ce sont des noms propres.

/** Région canonique No-Intro. Chaîne libre plutôt qu'union fermée : les DAT évoluent. */
export type RegionCode = string;

/**
 * Régions canoniques reconnues. L'ordre n'a aucune signification ici (les priorités
 * sont un réglage utilisateur) ; c'est un simple jeu d'appartenance servant à
 * distinguer un groupe de parenthèses « région » d'un groupe « langues » ou autre.
 */
export const CANONICAL_REGIONS: readonly RegionCode[] = [
  'Argentina', 'Asia', 'Australia', 'Austria', 'Belgium', 'Brazil', 'Bulgaria',
  'Canada', 'Chile', 'China', 'Croatia', 'Czech', 'Denmark', 'Europe', 'Finland',
  'France', 'Germany', 'Greece', 'Hong Kong', 'Hungary', 'India', 'Ireland',
  'Israel', 'Italy', 'Japan', 'Korea', 'Latin America', 'Mexico', 'Netherlands',
  'New Zealand', 'Norway', 'Poland', 'Portugal', 'Russia', 'Scandinavia', 'Serbia',
  'Singapore', 'Slovakia', 'South Africa', 'Spain', 'Sweden', 'Switzerland',
  'Taiwan', 'Thailand', 'Turkey', 'UAE', 'UK', 'Ukraine', 'USA', 'Unknown', 'World'
];

const CANONICAL_SET = new Set(CANONICAL_REGIONS.map(r => r.toLowerCase()));

/**
 * Variantes rencontrées dans les DAT, ramenées à la forme canonique.
 * Couvre les abréviations MAME (`Euro`, `US`) et les libellés longs No-Intro.
 */
const REGION_ALIASES: Record<string, RegionCode> = {
  // MAME et divers
  'euro': 'Europe',
  'eur': 'Europe',
  'us': 'USA',
  'u': 'USA',
  'usa, europe': 'USA',            // sécurité : ne devrait pas arriver (géré par split)
  'united states': 'USA',
  'united kingdom': 'UK',
  'great britain': 'UK',
  'gb': 'UK',
  'england': 'UK',
  'jpn': 'Japan',
  'jap': 'Japan',
  'jp': 'Japan',
  'j': 'Japan',
  'kor': 'Korea',
  'south korea': 'Korea',
  'chn': 'China',
  'prc': 'China',
  'twn': 'Taiwan',
  'hk': 'Hong Kong',
  'hongkong': 'Hong Kong',
  'ned': 'Netherlands',
  'holland': 'Netherlands',
  'nl': 'Netherlands',
  'ger': 'Germany',
  'de': 'Germany',
  'fra': 'France',
  'fr': 'France',
  'spa': 'Spain',
  'esp': 'Spain',
  'ita': 'Italy',
  'bra': 'Brazil',
  'brazilian': 'Brazil',
  'swe': 'Sweden',
  'nor': 'Norway',
  'den': 'Denmark',
  'fin': 'Finland',
  'rus': 'Russia',
  'pol': 'Poland',
  'aus': 'Australia',
  'nz': 'New Zealand',
  'can': 'Canada',
  'mex': 'Mexico',
  'united arab emirates': 'UAE',
  'czech republic': 'Czech',
  'czechia': 'Czech',
  'scandinavian': 'Scandinavia',
  'latin american': 'Latin America',

  // Formes adjectivales : MAME décrit fréquemment ses variantes ainsi
  // (« Bombjack (German) », « Pac-Man (Japanese) »).
  'american': 'USA',
  'british': 'UK',
  'english': 'UK',
  'european': 'Europe',
  'japanese': 'Japan',
  'german': 'Germany',
  'french': 'France',
  'italian': 'Italy',
  'spanish': 'Spain',
  'dutch': 'Netherlands',
  'korean': 'Korea',
  'chinese': 'China',
  'taiwanese': 'Taiwan',
  'portuguese': 'Portugal',
  'russian': 'Russia',
  'polish': 'Poland',
  'greek': 'Greece',
  'turkish': 'Turkey',
  'swedish': 'Sweden',
  'norwegian': 'Norway',
  'danish': 'Denmark',
  'finnish': 'Finland',
  'australian': 'Australia',
  'canadian': 'Canada',
  'mexican': 'Mexico',
  'argentinian': 'Argentina'
};

/**
 * Ramène un libellé brut de région à sa forme canonique.
 * Retourne `null` si le libellé n'est pas une région connue — c'est ce test qui permet
 * de décider si un groupe de parenthèses est une région ou autre chose.
 */
export function canonicalizeRegion(raw: string): RegionCode | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (CANONICAL_SET.has(lower)) {
    // Retrouver la casse canonique
    return CANONICAL_REGIONS.find(r => r.toLowerCase() === lower)!;
  }
  return REGION_ALIASES[lower] ?? null;
}

/**
 * Langue implicite d'une région, utilisée quand le nom ne déclare aucun groupe de
 * langues. Sans cela, une priorité par langue serait inexploitable sur la majorité
 * des titres (No-Intro n'écrit les langues que lorsqu'un titre est multilingue).
 *
 * Une région peut impliquer plusieurs langues (Suisse, Belgique, Canada) ; la première
 * est celle qui domine dans les faits pour les jeux de l'époque considérée.
 */
const IMPLIED_LANGUAGES: Record<RegionCode, readonly string[]> = {
  'Argentina': ['Es'],
  'Asia': ['En'],
  'Australia': ['En'],
  'Austria': ['De'],
  'Belgium': ['Nl', 'Fr'],
  'Brazil': ['Pt'],
  'Bulgaria': ['Bg'],
  'Canada': ['En', 'Fr'],
  'Chile': ['Es'],
  'China': ['Zh'],
  'Croatia': ['Hr'],
  'Czech': ['Cs'],
  'Denmark': ['Da'],
  'Europe': ['En'],
  'Finland': ['Fi'],
  'France': ['Fr'],
  'Germany': ['De'],
  'Greece': ['El'],
  'Hong Kong': ['Zh'],
  'Hungary': ['Hu'],
  'India': ['En'],
  'Ireland': ['En'],
  'Israel': ['He'],
  'Italy': ['It'],
  'Japan': ['Ja'],
  'Korea': ['Ko'],
  'Latin America': ['Es'],
  'Mexico': ['Es'],
  'Netherlands': ['Nl'],
  'New Zealand': ['En'],
  'Norway': ['No'],
  'Poland': ['Pl'],
  'Portugal': ['Pt'],
  'Russia': ['Ru'],
  'Scandinavia': ['Sv'],
  'Serbia': ['Sr'],
  'Singapore': ['En'],
  'Slovakia': ['Sk'],
  'South Africa': ['En'],
  'Spain': ['Es'],
  'Sweden': ['Sv'],
  'Switzerland': ['De', 'Fr', 'It'],
  'Taiwan': ['Zh'],
  'Thailand': ['Th'],
  'Turkey': ['Tr'],
  'UAE': ['Ar'],
  'UK': ['En'],
  'Ukraine': ['Uk'],
  'USA': ['En'],
  'Unknown': [],
  'World': ['En']
};

/** Langues déduites d'une liste de régions, dédoublonnées, dans l'ordre des régions. */
export function impliedLanguagesFor(regions: readonly RegionCode[]): string[] {
  const out: string[] = [];
  for (const region of regions) {
    for (const lang of IMPLIED_LANGUAGES[region] ?? []) {
      if (!out.includes(lang)) out.push(lang);
    }
  }
  return out;
}
