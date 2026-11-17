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

// src/renderer/systemsInit.ts
// Applique au registre des systèmes de la page (src/config/systems.ts) la
// surcharge Recalbox tenue par le main process. À appeler (await) juste après
// initI18n() dans chaque page qui importe config/systems.

import { applySystemsOverlay } from '../config/systems.js';

export interface InitSystemsOptions {
  /** Appelé après ré-application de la surcharge quand le registre change. */
  onUpdated?: () => void | Promise<void>;
}

export async function initSystems(options: InitSystemsOptions = {}): Promise<void> {
  await refreshSystems();
  window.api.systems.onUpdated(async () => {
    await refreshSystems();
    await options.onUpdated?.();
  });
}

export async function refreshSystems(): Promise<void> {
  try {
    applySystemsOverlay(await window.api.systems.getOverlay());
  } catch (error) {
    // Registre embarqué conservé : la page reste utilisable
    console.warn('Unable to load the systems overlay:', error);
  }
}
