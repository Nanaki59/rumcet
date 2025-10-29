// src/database/init.ts
import sqlite3 from 'sqlite3';
import fs from 'fs/promises';
import path from 'path';

export class Database {
  private db: sqlite3.Database;

  constructor(db: sqlite3.Database) {
    this.db = db;
  }

  // Méthodes helper pour promisifier sqlite3
  run(sql: string, params: any[] = []): Promise<sqlite3.RunResult> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve(this);
      });
    });
  }

  get<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row as T);
      });
    });
  }

  all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows as T[]);
      });
    });
  }

  exec(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  prepare(sql: string): sqlite3.Statement {
    return this.db.prepare(sql);
  }
}

export async function initDatabase(dbPath: string, clearExisting: boolean = false): Promise<Database> {
  // Créer le dossier si nécessaire
  const dir = path.dirname(dbPath);
  await fs.mkdir(dir, { recursive: true });

  // Si on doit effacer la DB existante
  if (clearExisting) {
    try {
      await fs.unlink(dbPath);
      console.log('Base de données existante supprimée');
    } catch (error) {
      // Ignorer l'erreur si le fichier n'existe pas
    }
  }

  // Ouvrir la base de données
  const sqliteDb = await new Promise<sqlite3.Database>((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) reject(err);
      else resolve(db);
    });
  });

  const db = new Database(sqliteDb);

  // Activer les foreign keys
  await db.exec('PRAGMA foreign_keys = ON');

  // Initialiser le schéma
  await initSchema(db);

  console.log('Database initialized successfully');
  return db;
}

async function initSchema(db: Database): Promise<void> {
  await db.exec(`
    -- Table des métadonnées
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Table principale des jeux
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      category TEXT,
      system_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_games_name ON games(name);

    -- Table des ROMs définies dans le DAT
    CREATE TABLE IF NOT EXISTS dat_roms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      size INTEGER,
      crc32 TEXT,
      md5 TEXT,
      sha1 TEXT,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_dat_roms_game_id ON dat_roms(game_id);
    CREATE INDEX IF NOT EXISTS idx_dat_roms_crc32 ON dat_roms(crc32);
    CREATE INDEX IF NOT EXISTS idx_dat_roms_md5 ON dat_roms(md5);
    CREATE INDEX IF NOT EXISTS idx_dat_roms_sha1 ON dat_roms(sha1);

    -- Table des dossiers scannés
    CREATE TABLE IF NOT EXISTS scanned_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_path TEXT NOT NULL UNIQUE,
      parent_folder_id INTEGER,
      is_root BOOLEAN DEFAULT 0,
      file_count INTEGER DEFAULT 0,
      scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_folder_id) REFERENCES scanned_folders(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_scanned_folders_path ON scanned_folders(folder_path);
    CREATE INDEX IF NOT EXISTS idx_scanned_folders_parent ON scanned_folders(parent_folder_id);

    -- Table des fichiers scannés
    CREATE TABLE IF NOT EXISTS scanned_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id INTEGER NOT NULL,
      file_path TEXT NOT NULL UNIQUE,
      file_name TEXT NOT NULL,
      size INTEGER,
      crc32 TEXT,
      md5 TEXT,
      sha1 TEXT,
      is_archive BOOLEAN DEFAULT 0,
      archive_type TEXT,
      scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (folder_id) REFERENCES scanned_folders(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_scanned_files_folder ON scanned_files(folder_id);
    CREATE INDEX IF NOT EXISTS idx_scanned_files_path ON scanned_files(file_path);

    -- Table des contenus d'archives
    CREATE TABLE IF NOT EXISTS archive_contents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      archive_id INTEGER NOT NULL,
      file_name TEXT NOT NULL,
      size INTEGER,
      crc32 TEXT,
      md5 TEXT,
      sha1 TEXT,
      FOREIGN KEY (archive_id) REFERENCES scanned_files(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_archive_contents_archive ON archive_contents(archive_id);

    -- Table des correspondances entre DAT et fichiers scannés
    CREATE TABLE IF NOT EXISTS rom_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dat_rom_id INTEGER,
      scanned_file_id INTEGER,
      archive_content_id INTEGER,
      match_type TEXT,
      match_score INTEGER DEFAULT 0,
      FOREIGN KEY (dat_rom_id) REFERENCES dat_roms(id),
      FOREIGN KEY (scanned_file_id) REFERENCES scanned_files(id),
      FOREIGN KEY (archive_content_id) REFERENCES archive_contents(id)
    );

    CREATE INDEX IF NOT EXISTS idx_rom_matches_dat ON rom_matches(dat_rom_id);
    CREATE INDEX IF NOT EXISTS idx_rom_matches_file ON rom_matches(scanned_file_id);
  `);
}

// Fonctions helper pour les métadonnées
export async function setMetadata(db: Database, key: string, value: string): Promise<void> {
  await db.run(
    `INSERT OR REPLACE INTO metadata (key, value, updated_at) 
     VALUES (?, ?, CURRENT_TIMESTAMP)`,
    [key, value]
  );
}

export async function getMetadata(db: Database, key: string): Promise<string | null> {
  const result = await db.get<{ value: string }>(
    'SELECT value FROM metadata WHERE key = ?',
    [key]
  );
  return result?.value || null;
}

export async function clearDatabase(db: Database): Promise<void> {
  // Supprimer toutes les données mais garder la structure
  await db.exec(`
    DELETE FROM archive_contents;
    DELETE FROM scanned_files;
    DELETE FROM scanned_folders;
    DELETE FROM dat_roms;
    DELETE FROM games;
    DELETE FROM rom_matches;
    DELETE FROM metadata;
  `);
  console.log('Base de données vidée');
}
