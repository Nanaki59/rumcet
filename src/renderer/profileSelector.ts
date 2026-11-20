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

// src/renderer/profileSelector.ts
// Liste déroulante du profil de consolidation courant (bandeau de la fenêtre principale).

import { t } from './i18n.js';
import type { ConsolidationProfile } from '../types/global.js';

const SELECT_ID = 'profile-select';

/** Nom affichable : nom saisi, sinon nom traduit d'après l'id (profils intégrés, « Mon profil »). */
export function profileDisplayName(profile: Pick<ConsolidationProfile, 'id' | 'name'>): string {
  return profile.name || t(`profiles.names.${profile.id}`);
}

async function renderProfileSelector(): Promise<void> {
  const select = document.getElementById(SELECT_ID) as HTMLSelectElement | null;
  if (!select) return;
  const { profiles, activeProfileId } = await window.api.profiles.list();
  select.innerHTML = '';
  for (const profile of profiles) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profileDisplayName(profile);
    select.appendChild(option);
  }
  select.value = activeProfileId;
}

/** Remplit la liste et la tient à jour (changements depuis la fenêtre des paramètres). */
export async function initProfileSelector(): Promise<void> {
  const select = document.getElementById(SELECT_ID) as HTMLSelectElement | null;
  if (!select) return;

  select.addEventListener('change', async () => {
    const result = await window.api.profiles.setActive(select.value);
    if (!result.success) {
      if (result.error === 'busy') alert(t('index.profiles.busyAlert'));
      // Revenir à la valeur réellement appliquée
      await renderProfileSelector();
    }
  });
  window.api.profiles.onChanged(() => { void renderProfileSelector(); });

  // 🔧 : paramètres des profils, ouverts sur l'onglet Compression
  document.getElementById('profile-settings-btn')?.addEventListener('click', () => {
    void window.api.openSettingsWindow('archives');
  });

  await renderProfileSelector();
}

/** Grise la liste pendant une consolidation (le main refuse aussi le changement). */
export function setProfileSelectorEnabled(enabled: boolean): void {
  const select = document.getElementById(SELECT_ID) as HTMLSelectElement | null;
  if (select) select.disabled = !enabled;
}
