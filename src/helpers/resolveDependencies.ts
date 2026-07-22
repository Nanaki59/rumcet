// src/helpers/resolveDependencies.ts
import { Database } from '../database/init.js';
import type { ArcadeTargetSetMode } from './settingsManager.js';

/** État de sélection d'un jeu selon le moteur de dépendances. */
export type SelectionState = 'user' | 'auto' | 'none';

/** Raison d'une auto-sélection (utilisée pour les tooltips). */
export interface AutoReason {
  /** Type de la relation qui a forcé l'auto-sélection. */
  type: 'cloneof' | 'romof' | 'device_ref';
  /** ID du jeu qui a entraîné l'auto-sélection (le "demandeur"). */
  requiredBy: number;
  /** Nom du jeu demandeur (pour affichage). */
  requiredByName: string;
}

export interface DependencyResolution {
  /** Map gameId → état de sélection final. */
  states: Map<number, SelectionState>;
  /** Map gameId → liste des raisons d'auto-sélection (pour tooltips). */
  autoReasons: Map<number, AutoReason[]>;
}

/**
 * Calcule l'ensemble des jeux à inclure dans un romset selon :
 *  - les jeux sélectionnés par l'utilisateur (games.is_selected = 1)
 *  - le mode du set cible (split / non-merged / merged)
 *
 * Règles de cascade :
 *  - **Tous modes** : BIOS (romof, jeu cible is_bios=1) et devices (device_ref) sont
 *    transitivement requis pour tout jeu user-sélectionné jouable.
 *  - **split**     : les parents (cloneof) sont requis (le clone ne contient que ses
 *                     ROMs propres et a besoin du parent pour les ROMs partagées).
 *  - **non-merged**: les parents (cloneof) ne sont PAS requis (le clone est autonome).
 *  - **merged**    : les parents (cloneof) sont requis (c'est l'archive qui contient
 *                     les ROMs du clone).
 *
 * Retourne aussi, pour chaque jeu auto-sélectionné, la liste des jeux qui l'ont
 * "tiré" et le type de relation correspondant (pour affichage de tooltip).
 */
export async function resolveDependencies(
  db: Database,
  targetMode: ArcadeTargetSetMode
): Promise<DependencyResolution> {
  // 1. Récupérer tous les jeux user-sélectionnés (excluant les BIOS/devices :
  //    ils ne sont jamais user-sélectionnés, ils n'apparaissent que par cascade).
  const userSelected = await db.all<{ id: number; name: string }>(
    `SELECT id, name FROM games WHERE is_selected = 1 AND is_bios = 0 AND is_device = 0`
  );

  // 2. Charger toutes les relations en mémoire (1 seul SELECT, plus rapide qu'une
  //    requête par jeu pour les gros DAT MAME).
  const allRels = await db.all<{
    child_game_id: number;
    parent_game_id: number;
    relationship_type: 'cloneof' | 'romof' | 'device_ref';
    parent_name: string;
  }>(`
    SELECT gr.child_game_id, gr.parent_game_id, gr.relationship_type, g.name AS parent_name
    FROM game_relationships gr
    JOIN games g ON gr.parent_game_id = g.id
  `);

  // Indexer par enfant pour BFS rapide.
  const relsByChild = new Map<number, typeof allRels>();
  for (const rel of allRels) {
    if (!relsByChild.has(rel.child_game_id)) relsByChild.set(rel.child_game_id, []);
    relsByChild.get(rel.child_game_id)!.push(rel);
  }

  // Types de relation à suivre selon le mode cible.
  // BIOS (romof) et devices (device_ref) sont toujours suivis ; le parent
  // (cloneof) ne l'est qu'en split / merged.
  const followCloneof = targetMode === 'split' || targetMode === 'merged';
  const followedTypes = new Set<string>(['romof', 'device_ref']);
  if (followCloneof) followedTypes.add('cloneof');

  // 3. BFS depuis chaque jeu user-sélectionné pour trouver les ancêtres requis.
  const autoReasons = new Map<number, AutoReason[]>();
  const visited = new Set<number>();
  const queue: Array<{ gameId: number; demandedBy: number; demandedByName: string }> = [];

  for (const us of userSelected) {
    visited.add(us.id);
    // Empiler les ancêtres directs de chaque jeu user-sélectionné.
    const rels = relsByChild.get(us.id) || [];
    for (const rel of rels) {
      if (!followedTypes.has(rel.relationship_type)) continue;
      queue.push({ gameId: rel.parent_game_id, demandedBy: us.id, demandedByName: us.name });
      // Enregistrer la raison
      if (!autoReasons.has(rel.parent_game_id)) autoReasons.set(rel.parent_game_id, []);
      autoReasons.get(rel.parent_game_id)!.push({
        type: rel.relationship_type,
        requiredBy: us.id,
        requiredByName: us.name
      });
    }
  }

  // Propagation transitive : un ancêtre peut lui-même avoir des ancêtres
  // (ex: clone d'un clone, device qui dépend d'un autre device).
  while (queue.length > 0) {
    const { gameId } = queue.shift()!;
    if (visited.has(gameId)) continue;
    visited.add(gameId);

    const rels = relsByChild.get(gameId) || [];
    for (const rel of rels) {
      if (!followedTypes.has(rel.relationship_type)) continue;
      // Pour les ancêtres d'ancêtres, on garde l'information de la chaîne :
      // on hérite du demandeur initial (pas du parent intermédiaire) pour les
      // tooltips, afin d'expliquer pourquoi le BIOS d'un device est requis.
      queue.push({ gameId: rel.parent_game_id, demandedBy: gameId, demandedByName: '' });
      if (!autoReasons.has(rel.parent_game_id)) autoReasons.set(rel.parent_game_id, []);
      autoReasons.get(rel.parent_game_id)!.push({
        type: rel.relationship_type,
        requiredBy: gameId,
        requiredByName: ''  // résolu côté UI si besoin
      });
    }
  }

  // 4. Construire la map d'états.
  const states = new Map<number, SelectionState>();
  for (const us of userSelected) states.set(us.id, 'user');
  for (const autoId of autoReasons.keys()) {
    // Si déjà user, on garde 'user' (priorité user > auto).
    if (!states.has(autoId)) states.set(autoId, 'auto');
  }

  return { states, autoReasons };
}

/**
 * Statistiques globales sur la résolution de dépendances, pour affichage UI.
 */
export interface DependencyStats {
  userCount: number;
  autoCount: number;
  totalRequired: number;
}

export function computeDependencyStats(resolution: DependencyResolution): DependencyStats {
  let userCount = 0;
  let autoCount = 0;
  for (const state of resolution.states.values()) {
    if (state === 'user') userCount++;
    else if (state === 'auto') autoCount++;
  }
  return { userCount, autoCount, totalRequired: userCount + autoCount };
}
