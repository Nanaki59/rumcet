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

// src/main/handlers/romDownload.handlers.ts

import { IpcMain, BrowserWindow } from 'electron';
import { downloadRoms } from '../../helpers/downloadRoms.js';
import { databaseService } from '../services/database.service.js';

let cancelDownload = false;

export function registerRomDownloadHandlers(ipcMain: IpcMain, mainWindow: BrowserWindow) {
  // Télécharger des jeux spécifiques par IDs
  ipcMain.handle('rom-download:start', async (_event, gameIds: number[]) => {
    const db = databaseService.getDatabase();
    if (!db) throw new Error('Aucune base de données ouverte');

    cancelDownload = false;

    const result = await downloadRoms(
      db,
      gameIds,
      (progress) => {
        mainWindow.webContents.send('rom-download-progress', progress);
      },
      () => cancelDownload
    );

    return result;
  });

  // Télécharger toutes les ROMs manquantes
  ipcMain.handle('rom-download:start-all-missing', async () => {
    const db = databaseService.getDatabase();
    if (!db) throw new Error('Aucune base de données ouverte');

    cancelDownload = false;

    // Récupérer les IDs de jeux manquants ou partiellement matchés (et sélectionnés)
    const missingGames = await db.all<{ id: number }>(`
      SELECT g.id
      FROM games g
      WHERE g.is_selected != 0
      AND (
        -- Jeux sans aucun match
        NOT EXISTS (
          SELECT 1 FROM dat_roms dr
          JOIN rom_matches rm ON rm.dat_rom_id = dr.id
          WHERE dr.game_id = g.id
        )
        OR
        -- Jeux partiellement matchés
        (SELECT COUNT(*) FROM dat_roms dr WHERE dr.game_id = g.id) >
        (SELECT COUNT(DISTINCT dr2.id) FROM dat_roms dr2
         JOIN rom_matches rm2 ON rm2.dat_rom_id = dr2.id
         WHERE dr2.game_id = g.id)
      )
      AND (SELECT COUNT(*) FROM dat_roms dr WHERE dr.game_id = g.id) > 0
      ORDER BY g.name
    `);

    const gameIds = missingGames.map(g => g.id);

    if (gameIds.length === 0) {
      return {
        stats: { totalGames: 0, downloaded: 0, matched: 0, consolidated: 0, failed: 0 },
        results: []
      };
    }

    const result = await downloadRoms(
      db,
      gameIds,
      (progress) => {
        mainWindow.webContents.send('rom-download-progress', progress);
      },
      () => cancelDownload
    );

    return result;
  });

  // Annuler le téléchargement en cours
  ipcMain.handle('rom-download:cancel', async () => {
    cancelDownload = true;
  });
}
