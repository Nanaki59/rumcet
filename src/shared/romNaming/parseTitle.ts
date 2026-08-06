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

// src/shared/romNaming/parseTitle.ts
// Parseur des noms de jeux selon la convention de nommage No-Intro (également suivie
// par Redump), et selon les descriptions MAME.
//
// Fonction pure, sans I/O : utilisable côté main (remplissage à l'import du DAT) comme
// côté renderer (regroupement 1G1R, facettes de filtre) et depuis un script Node.
//
// Convention No-Intro :
//   Titre (Région) (Langues) (Version) (StatutDev) (Divers) [Tags]
// Exemples :
//   Astérix (Europe) (En,Fr,De,Es,It)
//   Legend of Zelda, The (USA) (Rev 1)
//   Sonic the Hedgehog (Japan, Korea) (NTSC)
//   [BIOS] Super Game Boy (World)
//   Final Fantasy VII (USA) (Disc 2)
//
// Convention MAME : les tags vivent dans <description>, pas dans le nom court.
//   Metal Slug (World) / Metal Slug (Japan) / Puzzle Bobble (Japan, B-System)
//   Street Fighter II: The World Warrior (World 910522)

import { canonicalizeRegion, impliedLanguagesFor, type RegionCode } from './regions.js';
import { parseLanguageList, type LanguageCode } from './languages.js';

/** Origine du nom à parser : la convention diffère radicalement entre les deux. */
export type NamingMode = 'nointro' | 'mame';

/** Mode vidéo canonique. `null` quand le nom n'en déclare aucun. */
export type VideoMode = 'NTSC' | 'PAL' | 'PAL 60Hz' | 'PAL-M' | 'SECAM';

/** Statut de préproduction canonique. `null` = version de production. */
export type DevStatus = 'proto' | 'beta' | 'alpha' | 'demo' | 'sample';

export interface ParsedTitle {
  /** Titre nu normalisé (sans tag, sans diacritique, minuscules) — clé de regroupement. */
  baseTitle: string;
  /** Titre nu tel qu'écrit dans le DAT, sans les tags mais sans normalisation. */
  displayTitle: string;
  regions: RegionCode[];
  /** Langues explicites du nom, complétées par celles impliquées par la région. */
  languages: LanguageCode[];
  /** `true` si les langues ont été déduites de la région faute de groupe explicite. */
  languagesAreImplied: boolean;
  videoMode: VideoMode | null;
  /** Libellé de révision tel qu'écrit (« Rev 1 », « Rev A », « v1.02 »). */
  revision: string | null;
  /** Rang comparable de la révision. 0 = absence de révision (édition d'origine). */
  revisionRank: number;
  devStatus: DevStatus | null;
  /**
   * Date de build déclarée dans le nom, au format ISO (« 2021-10-19 »).
   * Signal de départage de DERNIER RECOURS : deux entrées peuvent ne différer que
   * par elle (« Unearthed Zero (World) (2021-10-19) (2021 Jam Version) » et son
   * homologue du 2024-07-28), et un arbitrage alphabétique retiendrait alors la
   * plus ancienne. À n'utiliser qu'après la révision explicite, qui fait autorité.
   */
  releaseDate: string | null;
  /** Marqueurs de diffusion canoniques (« Unl », « Aftermarket », « Bootleg »…). */
  releaseFlags: string[];
  discNumber: number | null;
  isBiosTag: boolean;
  /** Tous les groupes de tags rencontrés, bruts et dans l'ordre. Debug et affichage. */
  tags: string[];
}

// ── Référentiels de classification ──────────────────────────────────────────────

/**
 * Forme d'une liste de langues No-Intro : jetons « Xx » séparés par virgules, avec
 * une variante régionale facultative (« Pt-BR », « Zh-Hans »).
 *
 * La casse est significative et discriminante : « UK » (région) échoue sur le second
 * caractère, « Uk » (ukrainien) passe. Sans cette contrainte, les deux seraient
 * indiscernables — ce sont les seules valeurs de 2 lettres partagées entre les deux
 * référentiels.
 *
 * Le suffixe régional a été ajouté après avoir constaté que « (En,Ja,Fr,De,Es,It,
 * Pt-BR,Zh) » faisait échouer le groupe ENTIER : les 8 langues déclarées étaient
 * perdues et remplacées par la seule langue déduite de la région.
 */
const LANGUAGE_LIST_SHAPE =
  /^[A-Z][a-z](?:-[A-Za-z]{2,4})?(\s*,\s*[A-Z][a-z](?:-[A-Za-z]{2,4})?)*$/;

const VIDEO_MODES: Array<{ re: RegExp; mode: VideoMode }> = [
  { re: /^PAL[\s-]*60\s*Hz$/i, mode: 'PAL 60Hz' },
  { re: /^PAL[\s-]*M$/i, mode: 'PAL-M' },
  { re: /^PAL$/i, mode: 'PAL' },
  { re: /^SECAM$/i, mode: 'SECAM' },
  // NTSC-U / NTSC-J / NTSC-C sont ramenés à NTSC : la distinction utile pour une
  // priorité de mode vidéo est PAL / PAL 60Hz / NTSC, la sous-zone relève de la région.
  { re: /^NTSC(?:[\s-]*[UJC])?$/i, mode: 'NTSC' }
];

const DEV_STATUSES: Array<{ re: RegExp; status: DevStatus }> = [
  { re: /^Proto(?:type)?(?:\s+\d+)?$/i, status: 'proto' },
  { re: /^Possible Proto(?:type)?$/i, status: 'proto' },
  { re: /^Beta(?:\s+\d+)?$/i, status: 'beta' },
  { re: /^Prerelease$/i, status: 'beta' },
  { re: /^Alpha(?:\s+\d+)?$/i, status: 'alpha' },
  { re: /^Demo(?:\s+\d+)?$/i, status: 'demo' },
  { re: /^Preview$/i, status: 'demo' },
  { re: /^Taikenban$/i, status: 'demo' },   // « version d'essai » — démos japonaises
  { re: /^Sample(?:\s+\d+)?$/i, status: 'sample' }
];

/**
 * Marqueurs de diffusion. Clé = motif reconnu, valeur = libellé canonique stocké.
 * Volontairement non exhaustif : un tag non reconnu reste disponible dans `tags`.
 */
const RELEASE_FLAGS: Array<{ re: RegExp; flag: string }> = [
  { re: /^Unl$/i, flag: 'Unl' },
  { re: /^Unlicensed$/i, flag: 'Unl' },
  { re: /^Aftermarket$/i, flag: 'Aftermarket' },
  { re: /^Homebrew$/i, flag: 'Homebrew' },
  { re: /^Pirate$/i, flag: 'Pirate' },
  { re: /^Bootleg$/i, flag: 'Bootleg' },
  { re: /^Hack$/i, flag: 'Hack' },
  { re: /^Kiosk$/i, flag: 'Kiosk' },
  { re: /^Promo$/i, flag: 'Promo' },
  { re: /^Debug$/i, flag: 'Debug' },
  { re: /^Alt$/i, flag: 'Alt' },
  { re: /^Virtual Console$/i, flag: 'Virtual Console' },
  { re: /^(?:3DS|Wii U?|GameCube|Switch)\s+Virtual Console$/i, flag: 'Virtual Console' },
  { re: /^Switch Online$/i, flag: 'Switch Online' },
  { re: /^Classic Mini$/i, flag: 'Classic Mini' },
  { re: /^Steam$/i, flag: 'Steam' },
  { re: /^e-Reader$/i, flag: 'e-Reader' },
  { re: /^Competition Cart$/i, flag: 'Competition Cart' },
  { re: /^Enhancement Chip$/i, flag: 'Enhancement Chip' },
  { re: /^Rumble Version$/i, flag: 'Rumble Version' },
  { re: /^Test Program$/i, flag: 'Test Program' },
  { re: /^Educational$/i, flag: 'Educational' },
  { re: /^Bonus Disc$/i, flag: 'Bonus Disc' },
  // Tags de compatibilité matérielle Game Boy / Game Boy Color : très fréquents sur
  // ces systèmes (« GB Compatible » couvre un tiers du DAT GBC) et utiles comme facette.
  { re: /^GB Compatible$/i, flag: 'GB Compatible' },
  { re: /^SGB Enhanced$/i, flag: 'SGB Enhanced' },
  { re: /^GBA Enhanced$/i, flag: 'GBA Enhanced' },
  { re: /^NP$/, flag: 'Nintendo Power' },        // service de réécriture de cartouches
  { re: /^Nintendo Power$/i, flag: 'Nintendo Power' },
  // Productions issues d'un concours ou d'une game jam : « (2021 Jam Version) »,
  // « (GB Compo 2023) », « (GB Showdown) », « (GBJam 10) », « (Mini Jam 153) ».
  //
  // C'est un marqueur de DIFFUSION, délibérément pas un statut de développement :
  // « jam » décrit la manière dont le jeu a été produit (un événement chronométré),
  // pas ce qu'il est. Beaucoup de ces titres sont des jeux complets. Quand No-Intro
  // considère une production comme une démo, il pose le tag « (Demo) » — largement
  // employé par ailleurs. Le cas particulier d'un jam qui SERAIT la démo d'un autre
  // titre relève d'une donnée éditoriale, donc des clone lists, pas du parseur.
  //
  // Ancrage en FIN de mot uniquement (`jam\b`, pas `\bjam\b`) : le préfixe est libre,
  // ce qui couvre « GBJam 10 » comme « 2021 Jam Version » sans énumérer les composés,
  // et couvrira un futur « NESJam » sans modification.
  //
  // La borne finale est en revanche indispensable. Mesuré sur les DAT GBC + MAME
  // (18 746 tags distincts), une simple recherche de sous-chaîne capture à tort :
  //   - « JAMMA PCB », « Japan, JAMMA PCB », « US JAMMA » — la norme de câblage des
  //     bornes d'arcade, ~26 occurrences dans MAME ;
  //   - « composite », « composite/RGB » — le mode vidéo Apple II, via « compo » ;
  //   - « Ninja JaJaMaru Retro Collection ».
  // Autoriser en plus un suffixe numérique (`(?![a-z])`) ferait entrer « JAM1 Ver. A »,
  // le code de révision de Capcom Fighting Jam : le gain ne vaut pas le risque.
  { re: /(?:jam|compo|showdown)\b/i, flag: 'Jam / Competition' }
];

/** Articles rejetés en fin de titre par la convention (« Legend of Zelda, The »). */
const TRAILING_ARTICLE =
  /,\s*(the|an?|le|la|les|der|die|das|ein|eine|el|los|las|il|lo|gli|de|het|een|os|as)\s*$/i;

// ── Helpers ─────────────────────────────────────────────────────────────────────

/**
 * Normalise un titre pour le regroupement : sans diacritique, minuscules, ponctuation
 * réduite à des espaces. Volontairement conservateur — sur-normaliser fusionnerait des
 * jeux distincts, et les titres réellement différents d'une région à l'autre
 * (Biohazard / Resident Evil) relèvent des clone lists, pas d'une heuristique.
 */
export function normalizeForGrouping(raw: string): string {
  return raw
    .replace(TRAILING_ARTICLE, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Rang comparable d'un libellé de révision.
 * Numérique (« 1 », « 1.02 ») et alphabétique (« A », « B ») sont mis à la même
 * échelle : `Rev 1` et `Rev A` valent tous deux 1 000 000. Les deux conventions ne
 * cohabitent jamais dans un même DAT, l'ordre reste donc monotone là où il compte.
 * L'absence de révision vaut 0 : l'édition d'origine est bien la plus ancienne.
 */
function revisionRankOf(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;

  // Numérique éventuellement pointé : 1, 1.1, 1.02, 2.0.1
  if (/^\d[\d.]*$/.test(trimmed)) {
    const parts = trimmed.split('.').map(p => parseInt(p, 10) || 0);
    return (parts[0] ?? 0) * 1_000_000 + (parts[1] ?? 0) * 1_000 + (parts[2] ?? 0);
  }

  // Alphabétique simple : A → 1, B → 2…
  if (/^[A-Za-z]$/.test(trimmed)) {
    return (trimmed.toUpperCase().charCodeAt(0) - 64) * 1_000_000;
  }

  // Mixte rencontré sur quelques systèmes : « 0A », « 1B »
  const mixed = trimmed.match(/^(\d+)\s*([A-Za-z])$/);
  if (mixed) {
    const major = parseInt(mixed[1], 10) || 0;
    const minor = mixed[2].toUpperCase().charCodeAt(0) - 64;
    return major * 1_000_000 + minor * 1_000;
  }

  return 0;
}

/** Découpe une chaîne en groupes `(...)` / `[...]` et titre résiduel. */
function splitTags(raw: string): { title: string; groups: string[] } {
  const groups: string[] = [];
  // Pas de gestion de l'imbrication : elle n'existe pas dans les conventions visées.
  const title = raw.replace(/[([]([^()[\]]*)[)\]]/g, (_match, content: string) => {
    const trimmed = String(content).trim();
    if (trimmed) groups.push(trimmed);
    return ' ';
  });
  return { title: title.replace(/\s+/g, ' ').trim(), groups };
}

/** Liste de régions si tous les segments séparés par virgule sont des régions connues. */
function tryRegionList(content: string): RegionCode[] | null {
  const parts = content.split(',').map(p => p.trim()).filter(p => p.length > 0);
  if (parts.length === 0) return null;
  const out: RegionCode[] = [];
  for (const part of parts) {
    const region = canonicalizeRegion(part);
    if (!region) return null;
    if (!out.includes(region)) out.push(region);
  }
  return out;
}

/**
 * Régions d'un groupe de description MAME, où la région est souvent suivie d'autre
 * chose : « World 910522 », « Japan, B-System », « Euro, Rev A ».
 * On teste chaque segment, puis ses préfixes de mots décroissants (les régions à deux
 * mots comme « Hong Kong » doivent rester détectables).
 */
function tryMameRegions(content: string): RegionCode[] {
  const out: RegionCode[] = [];
  for (const segment of content.split(',')) {
    const words = segment.trim().split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) continue;
    for (let len = Math.min(3, words.length); len >= 1; len--) {
      const region = canonicalizeRegion(words.slice(0, len).join(' '));
      if (region) {
        if (!out.includes(region)) out.push(region);
        break;
      }
    }
  }
  return out;
}

// ── Parseur principal ───────────────────────────────────────────────────────────

export interface ParseTitleOptions {
  mode?: NamingMode;
  /** Description du DAT. En mode `mame`, c'est elle qui porte les tags. */
  description?: string | null;
}

/**
 * Extrait les métadonnées d'un nom de jeu de DAT.
 * Ne lève jamais : un nom hors convention retourne un `ParsedTitle` où seuls
 * `baseTitle` et `displayTitle` sont renseignés.
 */
export function parseTitle(name: string, options: ParseTitleOptions = {}): ParsedTitle {
  const mode: NamingMode = options.mode ?? 'nointro';
  // En mode MAME les tags vivent dans la description ; le nom court (« mslugj ») n'en
  // porte aucun. On retombe sur le nom si la description manque.
  const source = mode === 'mame' ? (options.description || name) : name;

  const result: ParsedTitle = {
    baseTitle: '',
    displayTitle: '',
    regions: [],
    languages: [],
    languagesAreImplied: false,
    videoMode: null,
    revision: null,
    revisionRank: 0,
    devStatus: null,
    releaseDate: null,
    releaseFlags: [],
    discNumber: null,
    isBiosTag: false,
    tags: []
  };

  if (!source) return result;

  const { title, groups } = splitTags(source);
  result.tags = groups;
  result.displayTitle = title;
  result.baseTitle = normalizeForGrouping(title);

  const explicitLanguages: LanguageCode[] = [];

  for (const group of groups) {
    // [BIOS] — préfixe No-Intro. La casse varie selon les DAT.
    if (/^BIOS$/i.test(group)) {
      result.isBiosTag = true;
      continue;
    }

    // Langues : forme « En,Fr,De ». Testée avant les régions car « UK » (région) et
    // « Uk » (ukrainien) ne se distinguent que par la casse, que cette forme impose.
    if (mode === 'nointro' && LANGUAGE_LIST_SHAPE.test(group)) {
      const langs = parseLanguageList(group);
      if (langs) {
        for (const lang of langs) {
          if (!explicitLanguages.includes(lang)) explicitLanguages.push(lang);
        }
        continue;
      }
    }

    // Régions
    if (mode === 'nointro') {
      const regions = tryRegionList(group);
      if (regions) {
        for (const region of regions) {
          if (!result.regions.includes(region)) result.regions.push(region);
        }
        continue;
      }
    } else {
      const regions = tryMameRegions(group);
      if (regions.length > 0) {
        for (const region of regions) {
          if (!result.regions.includes(region)) result.regions.push(region);
        }
        // Pas de `continue` : un groupe MAME comme « Euro, Rev A » porte aussi la
        // révision, il doit continuer à être analysé par les règles suivantes.
      }
    }

    // Mode vidéo
    const video = VIDEO_MODES.find(v => v.re.test(group));
    if (video) {
      result.videoMode = video.mode;
      continue;
    }

    // Révision / version
    // Libellé normalisé plutôt que brut : les DAT MAME écrivent « Rev 1 » et « rev 1 »
    // indifféremment, ce qui produirait deux entrées distinctes dans une facette.
    // La capture s'arrête à la virgule : MAME agrège volontiers plusieurs informations
    // dans une seule parenthèse (« Rev A, bootleg »), et tout prendre donnerait un
    // libellé absurde ET un rang de 0, qui ferait passer la révision pour une édition
    // d'origine dans l'arbitrage 1G1R.
    const revMatch = group.match(/^(?:Rev(?:ision)?|Version)\s+([^,]+)/i);
    if (revMatch && !result.revision) {
      const raw = revMatch[1].trim();
      result.revision = `Rev ${raw}`;
      result.revisionRank = revisionRankOf(raw);
      // Groupe composite : les segments restants doivent encore être analysés.
      if (!group.includes(',')) continue;
    }
    const versionMatch = group.match(/^v\s*(\d[\d.]*)$/i);
    if (versionMatch) {
      result.revision = `v${versionMatch[1]}`;
      result.revisionRank = revisionRankOf(versionMatch[1]);
      continue;
    }

    // Statut de préproduction
    const dev = DEV_STATUSES.find(d => d.re.test(group));
    if (dev) {
      result.devStatus = dev.status;
      continue;
    }

    // Numéro de disque
    const discMatch = group.match(/^Dis[ck]\s*(\d+)/i);
    if (discMatch) {
      result.discNumber = parseInt(discMatch[1], 10);
      continue;
    }

    // Date de build. On garde la PREMIÈRE rencontrée : No-Intro la place juste après
    // la région, avant les tags d'édition.
    const dateMatch = group.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateMatch && !result.releaseDate) {
      const [, y, m, d] = dateMatch;
      // Garde-fou : une date manifestement absurde est plus probablement autre chose.
      const month = parseInt(m, 10);
      const day = parseInt(d, 10);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        result.releaseDate = `${y}-${m}-${d}`;
        continue;
      }
    }

    // Marqueurs de diffusion (plusieurs peuvent coexister sur un même titre)
    const flag = RELEASE_FLAGS.find(f => f.re.test(group));
    if (flag) {
      if (!result.releaseFlags.includes(flag.flag)) result.releaseFlags.push(flag.flag);
      continue;
    }

    // Plusieurs marqueurs peuvent aussi être groupés dans une seule parenthèse :
    // « (SGB Enhanced, GB Compatible) ». On n'accepte le découpage que si TOUS les
    // segments sont des marqueurs connus, pour ne pas grignoter un tag composite.
    const segments = group.split(',').map(s => s.trim()).filter(s => s.length > 0);
    if (segments.length > 1) {
      const matched = segments.map(s => RELEASE_FLAGS.find(f => f.re.test(s)));
      if (matched.every(Boolean)) {
        for (const m of matched) {
          if (!result.releaseFlags.includes(m!.flag)) result.releaseFlags.push(m!.flag);
        }
        continue;
      }
    }

    // En MAME, « bootleg » et « prototype » apparaissent souvent en fin de groupe
    // composite : « bootleg of Metal Slug », « prototype, set 2 ».
    if (mode === 'mame') {
      if (/\bbootleg\b/i.test(group) && !result.releaseFlags.includes('Bootleg')) {
        result.releaseFlags.push('Bootleg');
      }
      if (/\bhack\b/i.test(group) && !result.releaseFlags.includes('Hack')) {
        result.releaseFlags.push('Hack');
      }
      if (/\bprototype\b/i.test(group) && !result.devStatus) {
        result.devStatus = 'proto';
      }
      const mameRev = group.match(/\bRev(?:ision)?\s+([\dA-Za-z.]+)/i);
      if (mameRev && !result.revision) {
        result.revision = `Rev ${mameRev[1]}`;
        result.revisionRank = revisionRankOf(mameRev[1]);
      }
      // Codes de version Konami : « ver JAA », « ver EAA », « ver UAA ». La première
      // lettre encode la zone de commercialisation — souvent la seule indication de
      // région disponible sur ces machines.
      if (result.regions.length === 0) {
        const konami = group.match(/\bver\s+([JEUAK])[A-Z]{2}\b/);
        if (konami) {
          const zone = ({ J: 'Japan', E: 'Europe', U: 'USA', A: 'Asia', K: 'Korea' } as const)[
            konami[1] as 'J' | 'E' | 'U' | 'A' | 'K'
          ];
          if (zone) result.regions.push(zone);
        }
      }
    }
  }

  // Un nom peut porter « [BIOS] » collé au titre plutôt qu'en groupe séparé.
  if (!result.isBiosTag && /^\[?BIOS\]?\s/i.test(name)) {
    result.isBiosTag = true;
  }

  // Langues : explicites si déclarées, sinon déduites de la région. Sans cette
  // déduction, une priorité par langue serait inexploitable — No-Intro ne déclare les
  // langues que sur les titres multilingues.
  if (explicitLanguages.length > 0) {
    result.languages = explicitLanguages;
  } else {
    result.languages = impliedLanguagesFor(result.regions);
    result.languagesAreImplied = result.languages.length > 0;
  }

  return result;
}
