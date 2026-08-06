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

// src/shared/romNaming/languages.ts
// Codes de langue de la convention No-Intro : deux lettres, initiale majuscule
// (« En », « Fr », « Ja »…), listés entre parenthèses et séparés par des virgules
// dans le nom du jeu : « Astérix (Europe) (En,Fr,De,Es,It) ».
//
// Ce jeu fermé est ce qui permet de distinguer un groupe « langues » d'un groupe
// « régions » : les deux ont la même forme syntaxique dans un nom de DAT.

/** Code de langue No-Intro (ISO 639-1 avec initiale majuscule). */
export type LanguageCode = string;

/**
 * Codes reconnus. Liste volontairement large : un code inconnu ferait basculer tout
 * le groupe de parenthèses hors de la catégorie « langues », donc mieux vaut couvrir.
 */
export const CANONICAL_LANGUAGES: readonly LanguageCode[] = [
  'Ar', 'Bg', 'Ca', 'Cs', 'Cy', 'Da', 'De', 'El', 'En', 'Eo', 'Es', 'Et', 'Fa',
  'Fi', 'Fr', 'Ga', 'Gd', 'Gu', 'He', 'Hi', 'Hr', 'Hu', 'Id', 'Is', 'It', 'Ja',
  'Ko', 'La', 'Lt', 'Lv', 'Ms', 'Nl', 'No', 'Pl', 'Pt', 'Ro', 'Ru', 'Sk', 'Sl',
  'Sq', 'Sr', 'Sv', 'Ta', 'Th', 'Tr', 'Uk', 'Ur', 'Vi', 'Yi', 'Zh'
];

const CANONICAL_SET = new Map(CANONICAL_LANGUAGES.map(l => [l.toLowerCase(), l]));

/**
 * Ramène un code brut à sa forme canonique, ou `null` s'il est inconnu.
 *
 * Les variantes régionales (« Pt-BR », « Zh-Hans ») sont ramenées à leur langue de
 * base : pour un arbitrage 1G1R, « Pt-BR » est du portugais, et c'est la RÉGION
 * (Brazil / Portugal) qui porte la distinction géographique. Sans cette réduction,
 * une priorité « Pt » ne reconnaîtrait pas un jeu tagué « Pt-BR ».
 */
export function canonicalizeLanguage(raw: string): LanguageCode | null {
  const trimmed = raw.trim();
  const base = trimmed.includes('-') ? trimmed.split('-')[0] : trimmed;
  if (base.length !== 2) return null;
  return CANONICAL_SET.get(base.toLowerCase()) ?? null;
}

/**
 * Teste si un groupe de parenthèses est une liste de langues.
 * Exige que **tous** les éléments séparés par virgule soient des codes connus : un
 * seul intrus (« Europe ») disqualifie le groupe, qui sera traité comme région.
 */
export function parseLanguageList(raw: string): LanguageCode[] | null {
  const parts = raw.split(',').map(p => p.trim()).filter(p => p.length > 0);
  if (parts.length === 0) return null;
  const out: LanguageCode[] = [];
  for (const part of parts) {
    const code = canonicalizeLanguage(part);
    if (!code) return null;
    if (!out.includes(code)) out.push(code);
  }
  return out;
}
