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
 */

// src/renderer/systemListRenderer.ts
//
// Module partagé pour afficher une liste de systèmes triable, recherchable,
// regroupable et repliable. Utilisé par les paramètres "Compatibilité par
// système" et "Extensions par système (téléchargement)".

import type { SystemDefinition } from '../config/systems.js';

export type SortMode = 'type-then-manufacturer' | 'manufacturer-then-type' | 'alphabetical';

export interface RenderGroupedSystemsOptions {
  container: HTMLElement;
  systems: SystemDefinition[];
  sortMode: SortMode;
  search: string;
  /** État persistant des groupes pliés. Sera muté par le helper. */
  collapsed: Set<string>;
  /** Callback de rendu pour chaque élément système. */
  renderItem: (sys: SystemDefinition) => HTMLElement;
}

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * Filtre par recherche (id, fullname, manufacturer, type).
 */
function filterBySearch(systems: SystemDefinition[], search: string): SystemDefinition[] {
  const q = (search || '').trim().toLowerCase();
  if (!q) return systems;
  return systems.filter(s =>
    s.systemId.toLowerCase().includes(q) ||
    s.fullname.toLowerCase().includes(q) ||
    (s.manufacturer || '').toLowerCase().includes(q) ||
    (s.type || '').toLowerCase().includes(q)
  );
}

/**
 * Construit la structure groupée Map<primary, Map<secondary, systems[]>>
 * selon le mode de tri. Pour le mode 'alphabetical', un seul groupe sans clé.
 */
function buildGrouped(
  systems: SystemDefinition[],
  sortMode: SortMode
): Map<string, Map<string, SystemDefinition[]>> {
  if (sortMode === 'alphabetical') {
    const grouped = new Map<string, Map<string, SystemDefinition[]>>();
    grouped.set('', new Map([['', [...systems].sort((a, b) => a.fullname.localeCompare(b.fullname))]]));
    return grouped;
  }

  const primaryKey = (s: SystemDefinition) =>
    sortMode === 'type-then-manufacturer' ? (s.type || 'autres') : (s.manufacturer || 'Autres');
  const secondaryKey = (s: SystemDefinition) =>
    sortMode === 'type-then-manufacturer' ? (s.manufacturer || 'Autres') : (s.type || 'autres');

  const grouped = new Map<string, Map<string, SystemDefinition[]>>();
  for (const sys of systems) {
    const p = primaryKey(sys);
    const s = secondaryKey(sys);
    if (!grouped.has(p)) grouped.set(p, new Map());
    const sec = grouped.get(p)!;
    if (!sec.has(s)) sec.set(s, []);
    sec.get(s)!.push(sys);
  }

  // Tri des clés primaires (Autres/autres en dernier)
  const sortedPrimaryKeys = [...grouped.keys()].sort((a, b) => {
    const aOther = a.toLowerCase() === 'autres';
    const bOther = b.toLowerCase() === 'autres';
    if (aOther && !bOther) return 1;
    if (!aOther && bOther) return -1;
    return a.localeCompare(b);
  });

  return new Map(sortedPrimaryKeys.map(k => [k, grouped.get(k)!]));
}

/**
 * Rendu de la liste groupée. Vide d'abord le container puis ajoute la structure.
 *
 * Pour chaque groupe primaire : un <div.system-category-section> contenant un
 * <h4.system-category-title> cliquable (chevron + label capitalisé) et un
 * <div.system-category-content> qui peut être plié.
 */
export function renderGroupedSystems(opts: RenderGroupedSystemsOptions): void {
  const { container, systems, sortMode, search, collapsed, renderItem } = opts;
  container.innerHTML = '';

  const filtered = filterBySearch(systems, search);
  const grouped = buildGrouped(filtered, sortMode);

  for (const [primary, secondaryMap] of grouped) {
    const section = document.createElement('div');
    section.className = 'system-category-section';

    const content = document.createElement('div');
    content.className = 'system-category-content';

    if (primary) {
      const catTitle = document.createElement('h4');
      catTitle.className = 'system-category-title';
      const isCollapsed = collapsed.has(primary);
      catTitle.dataset.collapsed = isCollapsed ? '1' : '0';
      const chevron = document.createElement('span');
      chevron.className = 'system-category-chevron';
      chevron.textContent = isCollapsed ? '▶' : '▼';
      const label = document.createElement('span');
      label.textContent = capitalize(primary);
      catTitle.appendChild(chevron);
      catTitle.appendChild(label);
      catTitle.style.cursor = 'pointer';
      catTitle.style.userSelect = 'none';
      content.style.display = isCollapsed ? 'none' : '';
      catTitle.addEventListener('click', () => {
        const nowCollapsed = catTitle.dataset.collapsed !== '1';
        catTitle.dataset.collapsed = nowCollapsed ? '1' : '0';
        chevron.textContent = nowCollapsed ? '▶' : '▼';
        content.style.display = nowCollapsed ? 'none' : '';
        if (nowCollapsed) collapsed.add(primary);
        else collapsed.delete(primary);
      });
      section.appendChild(catTitle);
    }

    const sortedSecondary = [...secondaryMap.keys()].sort((a, b) => a.localeCompare(b));
    for (const secondary of sortedSecondary) {
      const subcatSystems = secondaryMap.get(secondary)!;
      if (secondary) {
        const subcatTitle = document.createElement('h6');
        subcatTitle.className = 'system-subcategory-title';
        subcatTitle.textContent = capitalize(secondary);
        content.appendChild(subcatTitle);
      }
      for (const sys of [...subcatSystems].sort((a, b) => a.fullname.localeCompare(b.fullname))) {
        content.appendChild(renderItem(sys));
      }
    }

    section.appendChild(content);
    container.appendChild(section);
  }
}
