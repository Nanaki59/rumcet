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

// src/renderer/consoleCapture.ts
// Capture les console.log/warn/error du renderer vers le fichier de logs
// (via IPC log:write), en plus de la console DevTools. Ces lignes techniques
// n'apparaissent PAS dans le panneau de logs de l'interface.

export function setupConsoleCapture(): void {
  const levels: Array<{ method: 'log' | 'warn' | 'error'; level: string }> = [
    { method: 'log', level: 'debug' },
    { method: 'warn', level: 'warning' },
    { method: 'error', level: 'error' }
  ];

  let capturing = false;
  for (const { method, level } of levels) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);
      // Garde synchrone contre la ré-entrance (ex : échec IPC loggué en console)
      if (capturing) return;
      capturing = true;
      try {
        const line = args
          .map(a => {
            if (typeof a === 'string') return a;
            if (a instanceof Error) return `${a.message}\n${a.stack}`;
            try { return JSON.stringify(a); } catch { return String(a); }
          })
          .join(' ');
        void window.api.writeLog(level, 'console', line).catch(() => {});
      } finally {
        capturing = false;
      }
    };
  }
}
