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

// src/renderer/priorityList.ts
//
// Widget générique de liste ordonnable, partagé par les DEUX fenêtres du renderer :
// les paramètres (formats d'archive, outils RAR) et la modale de sélection
// automatique de la fenêtre principale (priorités 1G1R).
//
// Ne rend que la liste : le balisage du conteneur, du sélecteur d'ajout et du bouton
// associé appartient à l'appelant. Styles dans priorityList.css.
//
// Le drag & drop est doublé de boutons ↑/↓ : le glisser-déposer seul serait
// inaccessible au clavier.

import { t } from './i18n.js';
import { makeReorderable } from './reorderable.js';

export interface PriorityListSpec {
  /** id du conteneur DOM qui reçoit les items. */
  containerId: string;
  /**
   * Lecture de l'état courant. Appelée à CHAQUE usage, jamais mémorisée : la liste
   * peut être remplacée entre deux rendus (rechargement de la configuration d'une
   * base à l'ouverture de la modale), et un tableau capturé deviendrait obsolète.
   */
  getItems: () => string[];
  /** Libellé affiché pour une valeur. Par défaut, la valeur brute. */
  displayName?: (value: string) => string;
  /** Suffixe de classe CSS pour la pastille colorée (`format-<suffixe>`). */
  cssSuffix?: (value: string) => string;
  /** Si true, chaque item porte un bouton de retrait. */
  removable?: boolean;
  /**
   * Valeurs proposables à l'ajout. Celles déjà présentes sont filtrées.
   * Fournir cette fonction fait apparaître le sélecteur d'ajout sous la liste.
   */
  addableValues?: () => Array<{ value: string; label: string }>;
  /** id du `<select>` d'ajout et du bouton associé (requis si addableValues). */
  addSelectId?: string;
  addButtonId?: string;
  /**
   * Appelé après toute modification de l'ordre ou du contenu (déplacement, ajout,
   * retrait). Indispensable là où la liste pilote un calcul affiché ailleurs, comme
   * l'aperçu de la sélection automatique.
   */
  onChange?: () => void;
}

const priorityLists = new Map<string, PriorityListSpec>();
/** Boutons d'ajout déjà câblés, pour ne pas empiler les écouteurs. */
const wiredAddButtons = new Set<string>();

/**
 * Enregistre (ou ré-enregistre) une liste et effectue son rendu.
 * Ré-appelable sans risque : le bouton d'ajout n'est câblé qu'une fois.
 */
export function registerPriorityList(spec: PriorityListSpec): void {
  priorityLists.set(spec.containerId, spec);

  if (spec.addButtonId && spec.addSelectId && !wiredAddButtons.has(spec.addButtonId)) {
    wiredAddButtons.add(spec.addButtonId);
    document.getElementById(spec.addButtonId)?.addEventListener('click', () => {
      // La spec est relue dans la Map, pas capturée : elle a pu être remplacée.
      const current = priorityLists.get(spec.containerId);
      const select = document.getElementById(spec.addSelectId!) as HTMLSelectElement | null;
      if (!current || !select?.value) return;
      const items = current.getItems();
      if (!items.includes(select.value)) items.push(select.value);
      renderPriorityList(current.containerId);
      current.onChange?.();
    });
  }

  renderPriorityList(spec.containerId);
}

export function renderPriorityList(containerId: string): void {
  const spec = priorityLists.get(containerId);
  const container = document.getElementById(containerId);
  if (!spec || !container) return;

  const items = spec.getItems();
  container.innerHTML = '';
  const elements = items.map((value, index) =>
    container.appendChild(createPriorityItem(spec, value, index, items.length)));

  makeReorderable({
    items: elements,
    onReorder: (from, to) => movePriorityItem(containerId, from, to)
  });

  renderPriorityAddControl(spec, items);
}

function createPriorityItem(
  spec: PriorityListSpec, value: string, index: number, total: number
): HTMLElement {
  // `draggable` et l'identification de la liste sont posés par makeReorderable() :
  // l'index vit dans la fermeture du helper, plus besoin de le refléter en dataset.
  const item = document.createElement('div');
  item.className = 'format-priority-item';

  const order = document.createElement('span');
  order.className = 'format-order';
  order.textContent = `${index + 1}.`;

  const name = document.createElement('span');
  name.className = `format-name format-${spec.cssSuffix ? spec.cssSuffix(value) : value}`;
  name.textContent = spec.displayName ? spec.displayName(value) : value;
  // Le libellé est tronqué en colonne étroite : l'infobulle garde le texte entier.
  name.title = name.textContent;

  const actions = document.createElement('div');
  actions.className = 'format-actions';

  if (index > 0) {
    const upBtn = document.createElement('button');
    upBtn.className = 'btn-icon';
    upBtn.textContent = '↑';
    upBtn.onclick = () => movePriorityItem(spec.containerId, index, index - 1);
    actions.appendChild(upBtn);
  }
  if (index < total - 1) {
    const downBtn = document.createElement('button');
    downBtn.className = 'btn-icon';
    downBtn.textContent = '↓';
    downBtn.onclick = () => movePriorityItem(spec.containerId, index, index + 1);
    actions.appendChild(downBtn);
  }
  if (spec.removable) {
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-icon';
    delBtn.textContent = '✕';
    delBtn.title = t('settings.oneGameOneRom.removeEntry');
    delBtn.onclick = () => {
      spec.getItems().splice(index, 1);
      renderPriorityList(spec.containerId);
      spec.onChange?.();
    };
    actions.appendChild(delBtn);
  }

  item.appendChild(order);
  item.appendChild(name);
  item.appendChild(actions);

  // Le glisser-déposer est câblé par makeReorderable() dans renderPriorityList(),
  // une fois tous les éléments créés.
  return item;
}

/** Repeuple le `<select>` d'ajout avec les valeurs non encore présentes. */
function renderPriorityAddControl(spec: PriorityListSpec, items: string[]): void {
  if (!spec.addableValues || !spec.addSelectId) return;
  const select = document.getElementById(spec.addSelectId) as HTMLSelectElement | null;
  if (!select) return;

  const remaining = spec.addableValues().filter(v => !items.includes(v.value));
  select.innerHTML = '';
  for (const { value, label } of remaining) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  }
  select.disabled = remaining.length === 0;

  const button = spec.addButtonId
    ? document.getElementById(spec.addButtonId) as HTMLButtonElement | null
    : null;
  if (button) button.disabled = remaining.length === 0;
}

function movePriorityItem(containerId: string, fromIndex: number, toIndex: number): void {
  const spec = priorityLists.get(containerId);
  if (!spec) return;
  const items = spec.getItems();
  const [moved] = items.splice(fromIndex, 1);
  items.splice(toIndex, 0, moved);
  renderPriorityList(containerId);
  spec.onChange?.();
}

/**
 * Notifie le widget qu'une liste a changé en dehors de lui (chargement d'un modèle,
 * restauration des défauts…). Équivalent à un rendu, nommé pour l'intention.
 */
export function refreshPriorityList(containerId: string): void {
  renderPriorityList(containerId);
}
