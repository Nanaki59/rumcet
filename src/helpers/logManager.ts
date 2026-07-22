// src/helpers/logManager.ts

import { app } from 'electron';
import path from 'path';
import fs from 'fs/promises';

// Référence capturée AVANT l'installation du crochet console→fichier (main.ts).
// Les erreurs internes du LogManager doivent aller à la console SANS repasser
// par le crochet, sinon un échec d'écriture provoquerait une boucle infinie.
const rawConsoleError = console.error.bind(console);

export class LogManager {
  private logDir: string;
  private currentLogPath: string;
  private logStream: fs.FileHandle | null = null;
  private maxRotations = 5; // Garder 5 fichiers au total (current + 5 anciens)

  constructor() {
    this.logDir = path.join(app.getPath('userData'), 'logs');
    this.currentLogPath = path.join(this.logDir, 'rumcet.log');
  }

  async initialize(): Promise<void> {
    try {
      // Créer le dossier logs s'il n'existe pas
      await fs.mkdir(this.logDir, { recursive: true });
      
      // Faire la rotation des logs existants
      await this.rotateLogs();
      
      // Ouvrir le nouveau fichier de log
      this.logStream = await fs.open(this.currentLogPath, 'w');
      
      // Écrire l'en-tête
      await this.write(`=== RUMCET Log - ${new Date().toISOString()} ===\n\n`);
      
    } catch (error) {
      rawConsoleError('Erreur lors de l\'initialisation des logs:', error);
    }
  }

  private async rotateLogs(): Promise<void> {
    try {
      // Vérifier si le fichier log actuel existe
      const exists = await fs.access(this.currentLogPath).then(() => true).catch(() => false);
      if (!exists) return;

      // Supprimer le plus ancien fichier de rotation s'il existe
      const oldestLog = path.join(this.logDir, `rumcet.log.${this.maxRotations}`);
      await fs.unlink(oldestLog).catch(() => {}); // Ignorer si n'existe pas

      // Faire la rotation des fichiers existants
      for (let i = this.maxRotations - 1; i >= 1; i--) {
        const oldPath = path.join(this.logDir, `rumcet.log.${i}`);
        const newPath = path.join(this.logDir, `rumcet.log.${i + 1}`);
        
        await fs.rename(oldPath, newPath).catch(() => {});
      }

      // Renommer le fichier actuel en .1
      await fs.rename(this.currentLogPath, path.join(this.logDir, 'rumcet.log.1'));
      
    } catch (error) {
      rawConsoleError('Erreur lors de la rotation des logs:', error);
    }
  }

  async write(message: string): Promise<void> {
    if (!this.logStream) return;
    
    try {
      await this.logStream.writeFile(message + '\n');
    } catch (error) {
      rawConsoleError('Erreur lors de l\'écriture dans le log:', error);
    }
  }

  async writeFormatted(level: string, context: string, message: string): Promise<void> {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${level.toUpperCase()}] [${context}] ${message}`;
    await this.write(formattedMessage);
  }

  async close(): Promise<void> {
    if (this.logStream) {
      await this.logStream.close();
      this.logStream = null;
    }
  }

  getLogPath(): string {
    return this.currentLogPath;
  }

  async getLogHistory(): Promise<string[]> {
    const files: string[] = [];
    try {
      const entries = await fs.readdir(this.logDir);
      const logFiles = entries
        .filter(f => f.startsWith('rumcet.log'))
        .sort((a, b) => {
          // Trier pour avoir le plus récent en premier
          if (a === 'rumcet.log') return -1;
          if (b === 'rumcet.log') return 1;
          const numA = parseInt(a.split('.').pop() || '0');
          const numB = parseInt(b.split('.').pop() || '0');
          return numA - numB;
        });
      
      for (const file of logFiles) {
        files.push(path.join(this.logDir, file));
      }
    } catch (error) {
      rawConsoleError('Erreur lors de la lecture de l\'historique des logs:', error);
    }
    return files;
  }
}

// Instance singleton
export const logManager = new LogManager();
