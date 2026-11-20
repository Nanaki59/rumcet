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
// src/renderer/helpTip.ts
// Puces d'aide « ? » : <span class="help-tip" data-help="clé.i18n"></span>.
// Une bulle unique (position: fixed, rattachée au <body>) est affichée au survol,
// au focus clavier ou au clic, et recalée pour rester dans la fenêtre — elle
// n'est donc pas rognée par les conteneurs en overflow hidden/auto.
// Le texte est résolu à l'affichage (t(clé)) : il suit la langue courante sans
// re-initialisation. Il est injecté en HTML (contenu issu de nos locales).

import { t } from './i18n.js';

const MARGIN = 8;
let bubble: HTMLDivElement | null = null;
let current: HTMLElement | null = null;
let pinned = false; // ouverte par clic : reste affichée jusqu'au clic ailleurs / Échap
let globalListeners = false;

function getBubble(): HTMLDivElement {
  if (!bubble) {
    bubble = document.createElement('div');
    bubble.className = 'help-tip-bubble';
    bubble.id = 'help-tip-bubble';
    bubble.setAttribute('role', 'tooltip');
    document.body.appendChild(bubble);
  }
  return bubble;
}

function position(tip: HTMLElement, b: HTMLDivElement): void {
  const r = tip.getBoundingClientRect();
  const bw = b.offsetWidth;
  const bh = b.offsetHeight;
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  // Sous la puce, centrée ; au-dessus si la place manque en bas.
  let top = r.bottom + MARGIN;
  let below = true;
  if (top + bh > vh - MARGIN && r.top - MARGIN - bh >= MARGIN) {
    top = r.top - MARGIN - bh;
    below = false;
  }
  let left = r.left + r.width / 2 - bw / 2;
  left = Math.max(MARGIN, Math.min(left, vw - bw - MARGIN));

  b.style.top = `${Math.max(MARGIN, top)}px`;
  b.style.left = `${left}px`;
  b.classList.toggle('below', below);
  b.classList.toggle('above', !below);
  // Flèche alignée sur la puce même quand la bulle est décalée.
  b.style.setProperty('--arrow-x', `${r.left + r.width / 2 - left}px`);
}

function show(tip: HTMLElement): void {
  const b = getBubble();
  current = tip;
  b.innerHTML = t(tip.dataset.help || '');
  b.classList.add('visible');
  tip.setAttribute('aria-describedby', b.id);
  position(tip, b);
}

function hide(): void {
  if (current) current.removeAttribute('aria-describedby');
  current = null;
  pinned = false;
  bubble?.classList.remove('visible');
}

function installGlobalListeners(): void {
  if (globalListeners) return;
  globalListeners = true;
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && current) hide();
  });
  document.addEventListener('click', e => {
    if (pinned && current && !current.contains(e.target as Node)) hide();
  });
  // La bulle est en position fixe : la masquer si la page défile ou change de taille.
  window.addEventListener('scroll', () => { if (current) hide(); }, true);
  window.addEventListener('resize', () => { if (current) hide(); });
}

/**
 * Active les puces « ? » contenues dans `root`. Idempotent : peut être rappelé
 * après chaque rendu dynamique.
 */
export function initHelpTips(root: ParentNode = document): void {
  installGlobalListeners();
  root.querySelectorAll<HTMLElement>('.help-tip:not([data-help-init])').forEach(tip => {
    tip.dataset.helpInit = '1';
    tip.textContent = '?';
    tip.tabIndex = 0;
    tip.setAttribute('role', 'button');

    tip.addEventListener('mouseenter', () => { if (!pinned) show(tip); });
    tip.addEventListener('mouseleave', () => { if (!pinned && current === tip) hide(); });
    tip.addEventListener('focus', () => { if (!pinned) show(tip); });
    tip.addEventListener('blur', () => { if (!pinned && current === tip) hide(); });
    tip.addEventListener('click', e => {
      // Ne pas déclencher les actions du conteneur (bouton, ligne, en-tête…)
      e.preventDefault();
      e.stopPropagation();
      if (pinned && current === tip) {
        hide();
      } else {
        show(tip);
        pinned = true;
      }
    });
    tip.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        tip.click();
      }
    });
  });
}
