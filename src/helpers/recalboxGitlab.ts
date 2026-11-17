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

// src/helpers/recalboxGitlab.ts
// Accès au dépôt GitLab de Recalbox pour la mise à jour des systèmes à la demande.
//
// Volume volontairement minimal (≈ 4 requêtes par mise à jour) :
//   - REST  : liste des tags, puis arborescence du dossier systems/ (paginée par 100)
//   - GraphQL : contenu des system.ini par lots (blobs(paths:…)), au lieu d'une
//     requête par fichier. L'archive zip du dossier n'est pas utilisable : elle
//     embarque les médias/jeux (~250 Mo).

import {
  RECALBOX_GITLAB_API,
  RECALBOX_PROJECT_ID,
  RECALBOX_SYSTEMS_PATH,
  EXCLUDED_RECALBOX_SYSTEMS,
  buildRecalboxSystemData,
  type RecalboxSystemData
} from '../shared/recalboxSystems.js';

const GRAPHQL_URL = 'https://gitlab.com/api/graphql';
const PROJECT_FULL_PATH = 'recalbox/recalbox';
const REQUEST_TIMEOUT_MS = 60000;
/** La complexité GraphQL est plafonnée à 200 côté gitlab.com (≈ 90 chemins max). */
const GRAPHQL_BATCH_SIZE = 80;

/**
 * Canaux de publication Recalbox, d'après le nom du tag :
 *  - stable      : numéro de version seul (10.1.1)
 *  - patron      : contient « patron » sans « alpha » (10.1.1-patron-3)
 *  - patronAlpha : contient « patron » et « alpha » (11.0-patron-1-alpha-6)
 *  - alpha       : contient « alpha » sans « patron » (10.0.3-alpha-1)
 */
export type RecalboxChannel = 'stable' | 'patron' | 'patronAlpha' | 'alpha';

export interface RecalboxTag {
  name: string;
  channel: RecalboxChannel;
  /** Date ISO du commit taggé. */
  date: string | null;
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${url})`);
  return res.json();
}

/** Canal d'un tag Recalbox, ou null pour les tags techniques (test-…, special, rpi…). */
export function classifyRecalboxTag(name: string): RecalboxChannel | null {
  if (/^\d+(\.\d+)*$/.test(name)) return 'stable';
  if (!/^\d/.test(name) || name.includes('special') || name.includes('rpi')) return null;
  const patron = name.includes('patron');
  const alpha = name.includes('alpha');
  if (patron && alpha) return 'patronAlpha';
  if (patron) return 'patron';
  if (alpha) return 'alpha';
  return null;
}

/** Tags Recalbox récents (100 derniers), du plus récent au plus ancien. */
export async function fetchRecalboxTags(): Promise<RecalboxTag[]> {
  const url = `${RECALBOX_GITLAB_API}/projects/${RECALBOX_PROJECT_ID}/repository/tags?per_page=100&order_by=updated&sort=desc`;
  const tags: Array<{ name: string; commit?: { committed_date?: string } }> = await fetchJson(url);
  const result: RecalboxTag[] = [];
  for (const tag of tags) {
    const channel = classifyRecalboxTag(tag.name);
    if (channel) result.push({ name: tag.name, channel, date: tag.commit?.committed_date ?? null });
  }
  return result;
}

/** Noms des dossiers systèmes pour un tag/branche donné. */
async function fetchSystemDirectories(ref: string): Promise<string[]> {
  const names: string[] = [];
  for (let page = 1; page <= 10; page++) {
    const url = `${RECALBOX_GITLAB_API}/projects/${RECALBOX_PROJECT_ID}/repository/tree` +
      `?path=${encodeURIComponent(RECALBOX_SYSTEMS_PATH)}&ref=${encodeURIComponent(ref)}&per_page=100&page=${page}`;
    const entries: Array<{ name: string; type: string }> = await fetchJson(url);
    if (!Array.isArray(entries) || entries.length === 0) break;
    for (const e of entries) {
      if (e.type === 'tree' && !EXCLUDED_RECALBOX_SYSTEMS.has(e.name)) names.push(e.name);
    }
    if (entries.length < 100) break;
  }
  return names;
}

/** Contenu des system.ini par lots GraphQL. Clé = systemId. Les fichiers absents sont ignorés. */
async function fetchSystemInis(ref: string, systemIds: string[], onProgress?: (done: number, total: number) => void): Promise<Map<string, string>> {
  const query = `query($paths: [String!]!, $ref: String!) {
    project(fullPath: "${PROJECT_FULL_PATH}") {
      repository { blobs(paths: $paths, ref: $ref) { nodes { path rawTextBlob } } }
    }
  }`;
  const result = new Map<string, string>();
  for (let i = 0; i < systemIds.length; i += GRAPHQL_BATCH_SIZE) {
    const batch = systemIds.slice(i, i + GRAPHQL_BATCH_SIZE);
    const paths = batch.map(id => `${RECALBOX_SYSTEMS_PATH}/${id}/system.ini`);
    const json = await fetchJson(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { paths, ref } })
    });
    if (json.errors?.length) throw new Error(json.errors.map((e: any) => e.message).join('; '));
    const nodes: Array<{ path: string; rawTextBlob: string | null }> = json.data?.project?.repository?.blobs?.nodes ?? [];
    for (const node of nodes) {
      const m = node.path.match(/\/([^/]+)\/system\.ini$/);
      if (m && node.rawTextBlob) result.set(m[1], node.rawTextBlob);
    }
    onProgress?.(Math.min(i + batch.length, systemIds.length), systemIds.length);
  }
  return result;
}

/**
 * Données Recalbox de tous les systèmes ROM-based d'un tag/branche.
 * Lève une erreur si le dossier systems/ n'existe pas pour cette version.
 */
export async function fetchRecalboxSystems(ref: string, onProgress?: (done: number, total: number) => void): Promise<RecalboxSystemData[]> {
  const directories = await fetchSystemDirectories(ref);
  if (directories.length === 0) {
    throw new Error(`${RECALBOX_SYSTEMS_PATH} not found for ${ref}`);
  }
  const inis = await fetchSystemInis(ref, directories, onProgress);
  const systems: RecalboxSystemData[] = [];
  for (const [systemId, content] of inis) {
    const data = buildRecalboxSystemData(systemId, content);
    if (data) systems.push(data);
  }
  return systems.sort((a, b) => (a.systemId < b.systemId ? -1 : a.systemId > b.systemId ? 1 : 0));
}
