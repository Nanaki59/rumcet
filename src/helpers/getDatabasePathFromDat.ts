// src/helpers/getDatabasePathFromDat.ts
import path from 'path';
import { settingsManager } from './settingsManager.js';

/**
 * Génère un chemin de base de données SQLite à partir d'un chemin de fichier .dat ou .xml.
 * @param datFilePath - Chemin absolu du fichier .dat ou .xml.
 * @returns Chemin absolu du fichier .sqlite correspondant.
 */
export function getDatabasePathFromDat(datFilePath: string): string {
  if (!datFilePath) {
    throw new Error('Le chemin du fichier DAT/XML est requis.');
  }

  // Obtient le nom de base du fichier sans son extension
  const baseName = path.basename(datFilePath, path.extname(datFilePath));
  
  // Utilise le dossier des bases de données défini dans les paramètres
  const dbFolder = settingsManager.get('defaultDatabaseFolder');
  
  return path.join(dbFolder, `${baseName}.sqlite`);
}

/**
 * Obtient le chemin du dossier des bases de données
 */
export function getDatabasesFolder(): string {
  return settingsManager.get('defaultDatabaseFolder');
}
