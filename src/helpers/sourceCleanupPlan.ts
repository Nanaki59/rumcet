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

// src/helpers/sourceCleanupPlan.ts
// Logique pure du nettoyage des sources (aucun accès disque ni base) :
// utilité d'un fichier, action à mener sur un conteneur, libellés des dossiers
// sources dans le dossier des non matchés. Vérifiée par scripts/checkSourceCleanup.mjs.

import path from 'path';

const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';

/** Clé de comparaison d'un chemin (absolu, insensible à la casse sous Windows/macOS). */
export function normalizeForCompare(p: string): string {
  const resolved = path.resolve(p);
  return CASE_INSENSITIVE ? resolved.toLowerCase() : resolved;
}

/** Vrai si `filePath` est `folder` lui-même ou se trouve dessous. */
export function isInsideFolder(filePath: string, folder: string): boolean {
  if (!folder) return false;
  const rel = path.relative(normalizeForCompare(folder), normalizeForCompare(filePath));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// ─── Utilité d'un fichier source ───

/** État d'un jeu de la consolidation en cours. */
export type RunGameStatus = 'pending' | 'failed' | 'succeeded';

export interface NeedContext {
  /** État dans le run (undefined : jeu hors du run). */
  statusOf(gameId: number): RunGameStatus | undefined;
  /** is_selected != 0 en base. */
  isSelected(gameId: number): boolean;
  protectUnselected: boolean;
}

/**
 * Un fichier (ou une entrée d'archive) est-il encore utile ?
 * On examine les jeux auxquels il est lié, hors ceux qui l'ont déclaré comme
 * source (les jeux qui viennent d'être consolidés à partir de lui) :
 * - dans le dossier cible, tout autre jeu le rend utile (c'est sa sortie) ;
 * - jeu en attente, en erreur ou ignoré dans ce run → utile ;
 * - jeu consolidé plus tôt dans ce run → copie excédentaire ;
 * - jeu sélectionné absent du run (incomplet) → utile ;
 * - jeu non sélectionné → utile si la protection est activée.
 */
export function isItemNeeded(
  linkedGameIds: Iterable<number>,
  registrants: ReadonlySet<number>,
  insideTarget: boolean,
  ctx: NeedContext
): boolean {
  for (const gameId of linkedGameIds) {
    if (registrants.has(gameId)) continue;
    if (insideTarget) return true;
    const status = ctx.statusOf(gameId);
    if (status === 'pending' || status === 'failed') return true;
    if (status === 'succeeded') continue;
    if (ctx.isSelected(gameId)) return true;
    if (ctx.protectUnselected) return true;
  }
  return false;
}

// ─── Action sur un conteneur ───

/** ZIP/7z : entrées retirables ; non modifiables (traitées en bloc) : RAR, CHD, CSO. */
export type ContainerKind = 'modifiable' | 'readonly';

export type ReadOnlyArchiveMode = 'repack' | 'move';

export interface ContainerPlanInput {
  kind: ContainerKind;
  /** Entrées devenues inutiles (R). */
  removable: string[];
  /** Nombre d'entrées liées au DAT encore utiles (K). */
  keptCount: number;
  /** Entrées sans aucun lien avec le DAT (U). */
  unmatched: string[];
  moveUnmatched: boolean;
  readOnlyMode: ReadOnlyArchiveMode;
}

export type ContainerAction =
  | { type: 'none' }
  /** Rien n'est plus utile : supprimer l'archive. */
  | { type: 'delete' }
  /** Retirer des entrées, l'archive reste en place. */
  | { type: 'strip'; remove: string[] }
  /** Retirer des entrées, puis déplacer l'archive (qui ne contient plus que des non matchés). */
  | { type: 'strip-and-move'; remove: string[] }
  /** Copier `split` dans une nouvelle archive (dossier des non matchés), puis retirer `remove` + `split` de la source. */
  | { type: 'strip-and-split'; remove: string[]; split: string[] }
  /** Non modifiable : tout extraire, recompresser `unmatched` en 7z dans les non matchés, supprimer l'archive. */
  | { type: 'repack-unmatched'; unmatched: string[] }
  /** Déplacer l'archive entière dans les non matchés. */
  | { type: 'move' }
  /** Non modifiable et encore partiellement utile (ou déplacement désactivé) : impossible à alléger. */
  | { type: 'keep-readonly' };

export function planContainer(input: ContainerPlanInput): ContainerAction {
  const { kind, removable, keptCount, unmatched, moveUnmatched } = input;
  if (removable.length === 0) return { type: 'none' };

  if (keptCount === 0 && unmatched.length === 0) return { type: 'delete' };

  if (kind === 'readonly') {
    if (keptCount > 0 || !moveUnmatched) return { type: 'keep-readonly' };
    return input.readOnlyMode === 'move'
      ? { type: 'move' }
      : { type: 'repack-unmatched', unmatched };
  }

  // ZIP / 7z
  if (keptCount === 0) {
    return moveUnmatched ? { type: 'strip-and-move', remove: removable } : { type: 'strip', remove: removable };
  }
  if (moveUnmatched && unmatched.length > 0) {
    return { type: 'strip-and-split', remove: removable, split: unmatched };
  }
  return { type: 'strip', remove: removable };
}

// ─── Libellés des dossiers sources (dossier des non matchés) ───

function pathSegments(folder: string): string[] {
  return path.resolve(folder)
    .split(/[\\/]+/)
    .filter(Boolean)
    .map(seg => seg.replace(/:$/, ''));
}

/**
 * Pour chaque racine scannée, le plus court suffixe de dossiers parents qui la
 * distingue des autres racines (ex. `parentfolder1/sourcefolder1` face à
 * `parentfolder3/sourcefolder1`, mais `sourcefolder2` seul s'il est unique).
 * Retourne des segments, à joindre avec path.join.
 */
export function minimalRootLabels(roots: string[]): Map<string, string[]> {
  const unique = new Map<string, string>(); // clé normalisée → chemin d'origine
  for (const root of roots) {
    const key = normalizeForCompare(root);
    if (!unique.has(key)) unique.set(key, root);
  }
  const items = [...unique.values()].map(root => ({ root, segs: pathSegments(root), depth: 1 }));
  const keyOf = (it: { segs: string[]; depth: number }) => {
    const label = it.segs.slice(-it.depth).join('/');
    return CASE_INSENSITIVE ? label.toLowerCase() : label;
  };

  let changed = true;
  while (changed) {
    changed = false;
    const groups = new Map<string, typeof items>();
    for (const it of items) {
      const k = keyOf(it);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(it);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      for (const it of group) {
        if (it.depth < it.segs.length) {
          it.depth++;
          changed = true;
        }
      }
    }
  }

  const labels = new Map<string, string[]>();
  for (const it of items) {
    labels.set(it.root, it.segs.length > 0 ? it.segs.slice(-it.depth) : ['root']);
  }
  return labels;
}

/** Racine scannée la plus profonde contenant `filePath` (null si aucune). */
export function findRoot(filePath: string, roots: string[]): string | null {
  let best: string | null = null;
  for (const root of roots) {
    if (isInsideFolder(filePath, root) && (!best || root.length > best.length)) best = root;
  }
  return best;
}
