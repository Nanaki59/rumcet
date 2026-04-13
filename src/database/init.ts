// src/database/init.ts
import sqlite3 from 'sqlite3';
import fs from 'fs/promises';
import path from 'path';

const currentSchemaVersion = '1.4';

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
      is_selected INTEGER DEFAULT 1,
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
      compression_level INTEGER,
      has_comment BOOLEAN DEFAULT 0,
      has_global_comment BOOLEAN DEFAULT 0,
      scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (folder_id) REFERENCES scanned_folders(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_scanned_files_folder ON scanned_files(folder_id);
    CREATE INDEX IF NOT EXISTS idx_scanned_files_path ON scanned_files(file_path);
    CREATE INDEX IF NOT EXISTS idx_scanned_files_compression ON scanned_files(compression_level);
    CREATE INDEX IF NOT EXISTS idx_scanned_files_comment ON scanned_files(has_comment);
    CREATE INDEX IF NOT EXISTS idx_scanned_files_global_comment ON scanned_files(has_global_comment);

    -- Table des contenus d'archives
    CREATE TABLE IF NOT EXISTS archive_contents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      archive_id INTEGER NOT NULL,
      file_name TEXT NOT NULL,
      size INTEGER,
      crc32 TEXT,
      md5 TEXT,
      sha1 TEXT,
      compression_level INTEGER,
      has_comment BOOLEAN DEFAULT 0,
      FOREIGN KEY (archive_id) REFERENCES scanned_files(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_archive_contents_archive ON archive_contents(archive_id);
    CREATE INDEX IF NOT EXISTS idx_archive_contents_compression ON archive_contents(compression_level);
    CREATE INDEX IF NOT EXISTS idx_archive_contents_comment ON archive_contents(has_comment);

    -- Table des correspondances entre DAT et fichiers scannés
    -- Contient TOUS les matches (un fichier peut matcher plusieurs ROMs du DAT)
    -- scanned_file_id pointe toujours vers le fichier physique sur disque
    --   (fichier loose OU fichier archive contenant le fichier matché)
    -- archive_content_id est renseigné uniquement si le match vient d'un contenu d'archive
    CREATE TABLE IF NOT EXISTS rom_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dat_rom_id INTEGER NOT NULL,
      scanned_file_id INTEGER NOT NULL,
      archive_content_id INTEGER,
      archive_is_perfect BOOLEAN DEFAULT 0,
      FOREIGN KEY (dat_rom_id) REFERENCES dat_roms(id) ON DELETE CASCADE,
      FOREIGN KEY (scanned_file_id) REFERENCES scanned_files(id) ON DELETE CASCADE,
      FOREIGN KEY (archive_content_id) REFERENCES archive_contents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_rom_matches_dat ON rom_matches(dat_rom_id);
    CREATE INDEX IF NOT EXISTS idx_rom_matches_file ON rom_matches(scanned_file_id);
    CREATE INDEX IF NOT EXISTS idx_rom_matches_archive_content ON rom_matches(archive_content_id);

    -- Table de suivi de consolidation
    CREATE TABLE IF NOT EXISTS consolidation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL,
      game_name TEXT NOT NULL,
      output_path TEXT,
      output_format TEXT,
      status TEXT DEFAULT 'pending',
      roms_consolidated INTEGER DEFAULT 0,
      roms_total INTEGER DEFAULT 0,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_consolidation_log_game ON consolidation_log(game_id);
    CREATE INDEX IF NOT EXISTS idx_consolidation_log_status ON consolidation_log(status);

    -- Table de suivi des fichiers non matchés déplacés
    CREATE TABLE IF NOT EXISTS unmatched_moves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_path TEXT NOT NULL,
      destination_path TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  // Initialiser la version du schéma si elle n'existe pas
  const schemaVersion = await db.get<{ value: string }>(
    'SELECT value FROM metadata WHERE key = ?',
    ['schema_version']
  );

  if (!schemaVersion) {
    await db.run(
      'INSERT INTO metadata (key, value) VALUES (?, ?)',
      ['schema_version', currentSchemaVersion]
    );
  } else {
    // Appliquer les migrations si nécessaire
    await migrateSchemaIfNeeded(db, schemaVersion.value);
  }

  console.log(`✅ Base de données initialisée (schéma v${currentSchemaVersion})`);
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

async function migrateSchemaIfNeeded(db: Database, currentVersion: string): Promise<void> {
  if (currentVersion < '1.1') {
    await migrateToV1_1(db);
  }
  if (currentVersion < '1.2') {
    await migrateToV1_2(db);
  }
  if (currentVersion < '1.3') {
    await migrateToV1_3(db);
  }
  if (currentVersion < '1.4') {
    await migrateToV1_4(db);
  }
}

async function migrateToV1_1(db: Database): Promise<void> {
  console.log('Migration vers schéma v1.1...');

  // Vérifier si la colonne existe déjà
  const columns = await db.all<{ name: string }>('PRAGMA table_info(games)');
  const hasIsSelected = columns.some(col => col.name === 'is_selected');

  if (!hasIsSelected) {
    await db.run('ALTER TABLE games ADD COLUMN is_selected INTEGER DEFAULT 1');
  }

  await db.run(
    'UPDATE metadata SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?',
    [currentSchemaVersion, 'schema_version']
  );

  console.log('✅ Migration vers schéma v1.1 terminée');
}

async function migrateToV1_2(db: Database): Promise<void> {
  console.log('Migration vers schéma v1.2...');

  await db.exec(`
    CREATE TABLE IF NOT EXISTS consolidation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL,
      game_name TEXT NOT NULL,
      output_path TEXT,
      output_format TEXT,
      status TEXT DEFAULT 'pending',
      roms_consolidated INTEGER DEFAULT 0,
      roms_total INTEGER DEFAULT 0,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_consolidation_log_game ON consolidation_log(game_id);
    CREATE INDEX IF NOT EXISTS idx_consolidation_log_status ON consolidation_log(status);

    CREATE TABLE IF NOT EXISTS unmatched_moves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_path TEXT NOT NULL,
      destination_path TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.run(
    'UPDATE metadata SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?',
    [currentSchemaVersion, 'schema_version']
  );

  console.log('✅ Migration vers schéma v1.2 terminée');
}

async function migrateToV1_3(db: Database): Promise<void> {
  console.log('Migration vers schéma v1.3...');

  // Recréer la table rom_matches avec le nouveau schéma
  // (suppression match_type/match_score, ajout archive_is_perfect,
  //  scanned_file_id pointe désormais vers le fichier physique y compris pour les archives)
  await db.exec(`
    DROP TABLE IF EXISTS rom_matches;

    CREATE TABLE rom_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dat_rom_id INTEGER NOT NULL,
      scanned_file_id INTEGER NOT NULL,
      archive_content_id INTEGER,
      archive_is_perfect BOOLEAN DEFAULT 0,
      FOREIGN KEY (dat_rom_id) REFERENCES dat_roms(id) ON DELETE CASCADE,
      FOREIGN KEY (scanned_file_id) REFERENCES scanned_files(id) ON DELETE CASCADE,
      FOREIGN KEY (archive_content_id) REFERENCES archive_contents(id) ON DELETE CASCADE
    );

    CREATE INDEX idx_rom_matches_dat ON rom_matches(dat_rom_id);
    CREATE INDEX idx_rom_matches_file ON rom_matches(scanned_file_id);
    CREATE INDEX idx_rom_matches_archive_content ON rom_matches(archive_content_id);
  `);

  await db.run(
    'UPDATE metadata SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?',
    [currentSchemaVersion, 'schema_version']
  );

  console.log('✅ Migration vers schéma v1.3 terminée (rom_matches recréée — relancer le matching)');
}

async function migrateToV1_4(db: Database): Promise<void> {
  console.log('Migration vers schéma v1.4...');

  // Recréer rom_matches avec ON DELETE CASCADE sur toutes les FK
  // (v1.3 manquait les CASCADE, ce qui bloquait la suppression de dossiers)
  await db.exec(`
    DROP TABLE IF EXISTS rom_matches;

    CREATE TABLE rom_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dat_rom_id INTEGER NOT NULL,
      scanned_file_id INTEGER NOT NULL,
      archive_content_id INTEGER,
      archive_is_perfect BOOLEAN DEFAULT 0,
      FOREIGN KEY (dat_rom_id) REFERENCES dat_roms(id) ON DELETE CASCADE,
      FOREIGN KEY (scanned_file_id) REFERENCES scanned_files(id) ON DELETE CASCADE,
      FOREIGN KEY (archive_content_id) REFERENCES archive_contents(id) ON DELETE CASCADE
    );

    CREATE INDEX idx_rom_matches_dat ON rom_matches(dat_rom_id);
    CREATE INDEX idx_rom_matches_file ON rom_matches(scanned_file_id);
    CREATE INDEX idx_rom_matches_archive_content ON rom_matches(archive_content_id);
  `);

  await db.run(
    'UPDATE metadata SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?',
    [currentSchemaVersion, 'schema_version']
  );

  console.log('✅ Migration vers schéma v1.4 terminée (rom_matches recréée avec CASCADE — relancer le matching)');
}
