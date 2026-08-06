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

// src/renderer/reorderable.ts
//
// Plomberie du glisser-déposer HTML5 pour listes réordonnables, partagée par les
// deux fenêtres du renderer. Ne rend RIEN : les appelants gardent la main sur leur
// balisage, leur disposition et leurs classes CSS. Ce module ne fait que câbler les
// cinq événements de drag et rappeler avec les index source et cible.
//
// Auparavant recopié à l'identique dans les listes de priorité des paramètres, les
// chips de presets d'auto-sélection et le sélecteur d'extensions de téléchargement.

/**
 * Élément en cours de déplacement, à l'échelle du module.
 * Une seule opération de glisser peut être active à la fois dans une fenêtre ; le
 * champ `instance` identifie le groupe d'origine et suffit à rejeter un dépôt d'une
 * liste vers une autre, sans qu'aucun appelant ait à marquer ses éléments.
 */
let active: { instance: object; index: number } | null = null;

export interface ReorderableOptions {
  /** Éléments réordonnables, dans leur ordre d'affichage. */
  items: HTMLElement[];
  /** Appelé après un dépôt valide. À l'appelant de muter ses données et de re-rendre. */
  onReorder: (fromIndex: number, toIndex: number) => void;
  /** Classe posée sur l'élément déplacé. Défaut : `dragging`. */
  draggingClass?: string;
  /** Classe posée sur la cible survolée. Défaut : `drag-over`. */
  overClass?: string;
  /**
   * Poignée de préhension. Quand elle est fournie, l'élément n'est rendu déplaçable
   * que pendant l'appui sur la poignée.
   *
   * Indispensable dès qu'une ligne contient des champs de saisie : un ancêtre
   * `draggable` capte le geste de sélection de texte, et l'utilisateur ne peut plus
   * sélectionner le contenu d'un `<input>` à la souris.
   */
  handle?: (item: HTMLElement) => HTMLElement | null | undefined;
}

/**
 * Rend une liste d'éléments réordonnable au glisser-déposer.
 * À rappeler après chaque re-rendu : les écouteurs vivent sur les éléments, qui sont
 * typiquement recréés à chaque fois.
 */
export function makeReorderable(options: ReorderableOptions): void {
  const {
    items,
    onReorder,
    draggingClass = 'dragging',
    overClass = 'drag-over',
    handle
  } = options;

  // Identité du groupe : deux appels distincts ne peuvent pas s'échanger d'éléments.
  const instance = {};
  const clearOver = () => items.forEach(item => item.classList.remove(overClass));

  items.forEach((item, index) => {
    const grip = handle?.(item);
    // Sans poignée, l'élément entier est déplaçable en permanence.
    item.draggable = !grip;
    if (grip) {
      grip.addEventListener('mousedown', () => { item.draggable = true; });
      // Appui sans déplacement : on referme, sinon la ligne resterait déplaçable.
      grip.addEventListener('mouseup', () => { item.draggable = false; });
    }

    item.addEventListener('dragstart', (e) => {
      active = { instance, index };
      item.classList.add(draggingClass);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });

    item.addEventListener('dragover', (e) => {
      // Ne pas appeler preventDefault() pour un glisser venu d'ailleurs : sans ça,
      // le dépôt serait accepté visuellement puis ignoré.
      if (!active || active.instance !== instance) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      if (active.index === index) return;
      clearOver();
      item.classList.add(overClass);
    });

    item.addEventListener('dragleave', () => item.classList.remove(overClass));

    item.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      item.classList.remove(overClass);
      if (!active || active.instance !== instance || active.index === index) return;
      const from = active.index;
      active = null;
      onReorder(from, index);
    });

    item.addEventListener('dragend', () => {
      item.classList.remove(draggingClass);
      item.draggable = !grip;
      clearOver();
      active = null;
    });
  });
}
