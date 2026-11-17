// src/main/services/database.service.ts
import { Database } from '../../database/init.js';
import { refreshActiveDbFolders } from '../../helpers/settingsManager.js';

/**
 * Service singleton pour gérer la base de données courante
 */
export class DatabaseService {
  private static instance: DatabaseService;
  
  private currentDatabase: Database | null = null;
  private currentDbPath: string | null = null;
  private currentDatPath: string | null = null;
  private isDatLoadedInDb: boolean = false;

  private constructor() {}

  static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  // Getters
  getDatabase(): Database | null {
    return this.currentDatabase;
  }

  getDbPath(): string | null {
    return this.currentDbPath;
  }

  getDatPath(): string | null {
    return this.currentDatPath;
  }

  isDatLoaded(): boolean {
    return this.isDatLoadedInDb;
  }

  // Setters
  setDatabase(db: Database | null): void {
    this.currentDatabase = db;
    // Dossiers propres à la base (cible, non-référencées…) pour les composants synchrones
    refreshActiveDbFolders(db).catch(err => console.error('Unable to load the database folders:', err));
  }

  /** À appeler après une modification des métadonnées de dossiers de la base active. */
  async refreshFolders(): Promise<void> {
    await refreshActiveDbFolders(this.currentDatabase);
  }

  setDbPath(path: string | null): void {
    this.currentDbPath = path;
  }

  setDatPath(path: string | null): void {
    this.currentDatPath = path;
  }

  setDatLoaded(loaded: boolean): void {
    this.isDatLoadedInDb = loaded;
  }

  // Méthodes utilitaires
  async closeDatabase(): Promise<void> {
    if (this.currentDatabase) {
      await this.currentDatabase.close();
      this.currentDatabase = null;
      this.currentDbPath = null;
      this.currentDatPath = null;
      this.isDatLoadedInDb = false;
      refreshActiveDbFolders(null).catch(() => { /* sans base : rien à lire */ });
    }
  }

  reset(): void {
    refreshActiveDbFolders(null).catch(() => { /* sans base : rien à lire */ });
    this.currentDatabase = null;
    this.currentDbPath = null;
    this.currentDatPath = null;
    this.isDatLoadedInDb = false;
  }
}

export const databaseService = DatabaseService.getInstance();
