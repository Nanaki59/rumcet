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

// src/helpers/cloneLists.ts
//
// Lecture et application des clone lists — les relations entre titres d'un même jeu
// publiés sous des noms différents selon la région (« Biohazard » / « Resident Evil »).
// Aucune heuristique de normalisation ne peut les deviner ; c'est une donnée
// éditoriale, curée à la main par la communauté.
//
// RUMCET consomme ces listes, il ne les maintient pas. Format d'origine : le dépôt
// retool-clonelists-metadata (BSD-3-Clause). Voir THIRD_PARTY_NOTICES.md.
//
// Périmètre volontairement restreint (v1) : `group`, `titles[].searchTerm`,
// `titles[].nameType` et `titles[].categories`. Les clés `supersets`,
// `compilations`, `localNames`, `filters`, `priority`, `englishFriendly` et
// `isOldest` sont lues pour le rapport mais n'ont aucun effet — elles relèvent de
// mécanismes que RUMCET ne reproduit pas (et n'a pas besoin de reproduire : son
// arbitrage 1G1R a ses propres critères, alimentés par ce qu'il trouve sur disque).

import fs from 'fs/promises';
import path from 'path';
import { Database } from '../database/init.js';
import { parseTitle, normalizeForGrouping } from '../shared/romNaming/index.js';

// ── Format du fichier ───────────────────────────────────────────────────────────

/** Mode de comparaison d'un `searchTerm`. `short` est le défaut. */
export type CloneListNameType = 'short' | 'full' | 'regionFree' | 'regex';

export interface CloneListTitle {
  searchTerm: string;
  nameType?: CloneListNameType;
  categories?: string[];
  [key: string]: unknown;
}

export interface CloneListVariant {
  group: string;
  titles?: CloneListTitle[];
  categories?: string[];
  supersets?: unknown[];
  compilations?: unknown[];
  [key: string]: unknown;
}

export interface CloneListFile {
  description?: { name?: string; lastUpdated?: string; minimumVersion?: string };
  variants?: CloneListVariant[];
}

export interface CloneListApplyResult {
  /** Nom déclaré dans le fichier (`description.name`). */
  listName: string;
  lastUpdated: string | null;
  variantsTotal: number;
  /** Variantes ayant effectivement apparié au moins un jeu de la base. */
  variantsMatched: number;
  /** Jeux ayant reçu une clé de regroupement. */
  gamesGrouped: number;
  /** Jeux dont la catégorie a été surchargée. */
  categoriesOverridden: number;
  /**
   * `searchTerm` n'ayant apparié aucun jeu. Signal de décalage entre la liste et la
   * version du DAT chargée : quelques-uns sont normaux, une majorité indique un
   * mauvais appariement de fichier.
   */
  unmatchedSearchTerms: number;
  /** Clés lues mais sans effet en v1, pour information. */
  ignored: { supersets: number; compilations: number; regexTerms: number };
}

// ── Appariement d'un fichier au DAT courant ─────────────────────────────────────

/**
 * Nom de système porté par un fichier de clone list, dépouillé du seul suffixe de
 * groupe. « Nintendo - Game Boy Color (No-Intro).json » → « nintendo - game boy color »
 *
 * Les autres parenthèses sont CONSERVÉES : elles font partie du nom du système
 * (« IBM - PC and Compatibles (Digital) (Misc) », « Commodore - 64 (PP) ») et les
 * retirer confondrait des DAT distincts.
 */
function cloneListSystemName(raw: string): string {
  return raw
    .replace(/\.json$/i, '')
    .replace(/\s*\((?:No-Intro|Redump)\)\s*$/i, '')
    .trim()
    .toLowerCase();
}

/**
 * Choisit le fichier correspondant au nom de DAT donné. Égalité stricte, sans repli.
 *
 * Surtout PAS de correspondance par préfixe : les noms de systèmes s'emboîtent
 * (« Nintendo - Game Boy » ⊂ « … Game Boy Color » ⊂ « … Game Boy Advance »), et un
 * repli par préfixe appliquerait sans bruit la liste du Game Boy Color à un DAT
 * Game Boy — en regroupant des titres qui n'ont rien à voir. Faute de correspondance
 * exacte, on n'en propose aucune et l'utilisateur choisit son fichier à la main.
 */
export function matchCloneListFile(datName: string, fileNames: string[]): string | null {
  const target = cloneListSystemName(datName);
  if (!target) return null;
  return fileNames.find(f => cloneListSystemName(f) === target) ?? null;
}

// ── Application ─────────────────────────────────────────────────────────────────

/**
 * Forme comparable d'un `searchTerm` selon son `nameType`.
 * `short` (défaut) passe par le même pipeline que les noms de jeux à l'import : le
 * terme de recherche et la colonne `base_title` vivent donc dans le même espace,
 * et la comparaison est une simple égalité.
 */
function searchKey(term: string, nameType: CloneListNameType): string {
  switch (nameType) {
    case 'full':
      return term.trim().toLowerCase();
    case 'regionFree':
      // Pas de forme dédiée en base : `base_title` est déjà dépourvu de région,
      // ce qui rend ce mode équivalent à `short` côté RUMCET.
      return parseTitle(term).baseTitle;
    case 'short':
    default:
      return parseTitle(term).baseTitle;
  }
}

/**
 * Applique une clone list à la base ouverte.
 *
 * N'écrit que `games.group_key` et, si la liste le demande, `games.category`.
 * Aucune sélection n'est touchée : le regroupement change ce que le 1G1R considère
 * comme un même jeu, il ne coche ni ne décoche quoi que ce soit par lui-même.
 */
export async function applyCloneList(db: Database, list: CloneListFile): Promise<CloneListApplyResult> {
  const result: CloneListApplyResult = {
    listName: list.description?.name || '(sans nom)',
    lastUpdated: list.description?.lastUpdated || null,
    variantsTotal: list.variants?.length ?? 0,
    variantsMatched: 0,
    gamesGrouped: 0,
    categoriesOverridden: 0,
    unmatchedSearchTerms: 0,
    ignored: { supersets: 0, compilations: 0, regexTerms: 0 }
  };

  const games = await db.all<{ id: number; name: string; base_title: string | null }>(
    'SELECT id, name, base_title FROM games'
  );
  if (games.length === 0) return result;

  // Index par forme courte et par nom complet, construits une fois.
  const byShort = new Map<string, number[]>();
  const byFull = new Map<string, number[]>();
  const push = (map: Map<string, number[]>, key: string, id: number) => {
    if (!key) return;
    const bucket = map.get(key);
    if (bucket) bucket.push(id);
    else map.set(key, [id]);
  };
  for (const game of games) {
    push(byShort, game.base_title || '', game.id);
    push(byFull, game.name.trim().toLowerCase(), game.id);
  }

  // Un jeu peut être visé par plusieurs variantes ; la dernière gagne, comme pour
  // les règles de sélection. On accumule avant d'écrire, pour un seul UPDATE par jeu.
  const groupOf = new Map<number, string>();
  const categoryOf = new Map<number, string>();

  for (const variant of list.variants ?? []) {
    if (!variant?.group) continue;
    if (Array.isArray(variant.supersets)) result.ignored.supersets += variant.supersets.length;
    if (Array.isArray(variant.compilations)) result.ignored.compilations += variant.compilations.length;

    // Clé normalisée par le même pipeline que base_title : les jeux hors clone list
    // continuent de se regrouper sur base_title, dans le même espace de valeurs.
    const groupKey = normalizeForGrouping(variant.group);
    if (!groupKey) continue;

    let variantMatched = false;
    for (const title of variant.titles ?? []) {
      if (!title?.searchTerm) continue;
      const nameType = (title.nameType || 'short') as CloneListNameType;

      // `regex` porte sur le nom complet et n'est utilisé que par une poignée
      // d'entrées : non supporté en v1, compté pour le rapport.
      if (nameType === 'regex') {
        result.ignored.regexTerms++;
        continue;
      }

      const key = searchKey(title.searchTerm, nameType);
      const ids = (nameType === 'full' ? byFull : byShort).get(key);
      if (!ids || ids.length === 0) {
        result.unmatchedSearchTerms++;
        continue;
      }

      variantMatched = true;
      const categories = title.categories ?? variant.categories;
      for (const id of ids) {
        groupOf.set(id, groupKey);
        if (categories && categories.length > 0) {
          categoryOf.set(id, categories.join(', '));
        }
      }
    }
    if (variantMatched) result.variantsMatched++;
  }

  // Écriture. Le nettoyage préalable rend l'opération idempotente et permet de
  // repartir d'une base saine quand on met à jour ou change de liste : sans lui, un
  // regroupement ou une catégorie posés par une version antérieure survivraient à
  // leur disparition de la liste.
  await db.exec('BEGIN TRANSACTION');
  try {
    await db.run('UPDATE games SET group_key = NULL WHERE group_key IS NOT NULL');
    await db.run('UPDATE games SET category = dat_category WHERE category IS NOT dat_category');
    for (const [id, groupKey] of groupOf) {
      const category = categoryOf.get(id);
      if (category !== undefined) {
        await db.run('UPDATE games SET group_key = ?, category = ? WHERE id = ?', [groupKey, category, id]);
        result.categoriesOverridden++;
      } else {
        await db.run('UPDATE games SET group_key = ? WHERE id = ?', [groupKey, id]);
      }
    }
    await db.exec('COMMIT');
  } catch (error) {
    // L'échec du ROLLBACK ne doit pas masquer l'erreur d'origine.
    try { await db.exec('ROLLBACK'); } catch { /* pas de transaction active */ }
    throw error;
  }

  result.gamesGrouped = groupOf.size;
  return result;
}

/** Lit et valide un fichier de clone list sur disque. */
export async function readCloneListFile(filePath: string): Promise<CloneListFile> {
  const raw = await fs.readFile(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as CloneListFile;
  if (!parsed || !Array.isArray(parsed.variants)) {
    throw new Error(`Invalid clone list (no "variants" array): ${path.basename(filePath)}`);
  }
  return parsed;
}
