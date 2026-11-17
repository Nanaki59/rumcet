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
// src/renderer/htmlEscape.ts
// Échappement HTML unique du renderer. Sûr en contenu texte comme dans un
// attribut (title="…", value="…") : les guillemets sont aussi échappés — sans
// cela, un texte contenant " fermait l'attribut et tronquait l'infobulle.

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

export function escapeHtml(text: string | null | undefined): string {
  if (text === null || text === undefined) return '';
  return String(text).replace(/[&<>"']/g, char => HTML_ENTITIES[char]);
}
