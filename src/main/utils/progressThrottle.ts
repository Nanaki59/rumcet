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
// src/main/utils/progressThrottle.ts
// Limite les envois de progression vers le renderer (~10/s) tout en garantissant
// que le DERNIER état est toujours transmis : un élément bloqué (fichier, jeu)
// reste ainsi affiché dans la modale.

export interface ProgressThrottle<T> {
  /** Met à jour l'état ; il sera envoyé immédiatement ou au plus tard après l'intervalle */
  push(progress: T): void;
  /** Envoie l'état en attente et arrête le minuteur */
  flush(): void;
}

export function createProgressThrottle<T>(send: (progress: T) => void, intervalMs = 100): ProgressThrottle<T> {
  let pending: T | null = null;
  let lastSent = 0;
  let timer: NodeJS.Timeout | null = null;

  const sendNow = () => {
    timer = null;
    if (pending === null) return;
    const progress = pending;
    pending = null;
    lastSent = Date.now();
    send(progress);
  };

  return {
    push(progress: T) {
      pending = progress;
      const wait = intervalMs - (Date.now() - lastSent);
      if (wait <= 0) sendNow();
      else if (!timer) timer = setTimeout(sendNow, wait);
    },
    flush() {
      if (timer) clearTimeout(timer);
      sendNow();
    }
  };
}
