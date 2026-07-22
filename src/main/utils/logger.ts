// src/main/utils/logger.ts
import { BrowserWindow } from 'electron';
import { logManager } from '../../helpers/logManager.js';
import { tEn } from '../i18n.js';
import type { MessageParams } from '../../shared/i18nCore.js';

/**
 * Journalise un message identifié par une clé i18n (+ paramètres d'interpolation) :
 *  - fichier de log : résolu en ANGLAIS (tEn), quelle que soit la langue de l'UI ;
 *  - panneau du renderer : la clé + params sont transmis, le renderer résout
 *    dans la langue courante de l'interface.
 * Si `key` n'existe pas dans les dictionnaires, elle est journalisée telle
 * quelle (permet de logger du contenu brut : messages d'erreur, chemins).
 * Utilisé UNIQUEMENT par les handlers internes du main process.
 */
export async function sendLogToRenderer(
  mainWindow: BrowserWindow | null,
  severity: 'info' | 'warning' | 'error',
  context: string,
  key: string,
  params?: MessageParams
): Promise<void> {
  // Écrire dans le fichier de log (toujours en anglais)
  await logManager.writeFormatted(severity, context, tEn(key, params));

  // Envoyer au renderer si la fenêtre existe (résolution dans la langue de l'UI)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log-message', {
      severity,
      context,
      key,
      params
    });
  }
}

/**
 * Log une erreur avec stack trace
 */
export async function logError(
  mainWindow: BrowserWindow | null,
  context: string,
  error: unknown
): Promise<void> {
  const errorMessage = error instanceof Error
    ? `${error.message}\n${error.stack}`
    : String(error);

  await sendLogToRenderer(mainWindow, 'error', context, errorMessage);
}

/**
 * Log avec timestamp formaté
 */
export function formatLogMessage(message: string): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] ${message}`;
}
