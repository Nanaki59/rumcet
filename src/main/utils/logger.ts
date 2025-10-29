// src/main/utils/logger.ts
import { BrowserWindow } from 'electron';
import { logManager } from '../../helpers/logManager.js';

/**
 * Envoie un message de log au renderer ET l'écrit dans le fichier de log
 * Utilisé UNIQUEMENT par les handlers internes du main process
 */
export async function sendLogToRenderer(
  mainWindow: BrowserWindow | null,
  severity: 'info' | 'warning' | 'error',
  context: string,
  message: string
): Promise<void> {
  // Écrire dans le fichier de log
  await logManager.writeFormatted(severity, context, message);
  
  // Envoyer au renderer si la fenêtre existe
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log-message', {
      severity,
      context,
      message
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
