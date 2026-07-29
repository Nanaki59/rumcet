// src/database/init.ts
import sqlite3 from 'sqlite3';
import fs from 'fs/promises';
import path from 'path';

const currentSchemaVersion = '2.0';

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
      console.log('Existing database deleted');
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

    -- Phase 9 : sources DAT chargés dans cette DB. Un DAT primaire (role='primary')
    -- + N DAT complémentaires (role='complementary', ex: DAT CHDs qui étend un DAT ROMs).
    -- Les colonnes source_id sur games/dat_roms/game_relationships permettent
    -- de retracer l'origine de chaque entrée pour rechargement ou audit.
    CREATE TABLE IF NOT EXISTS dat_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT,
      role TEXT NOT NULL CHECK(role IN ('primary', 'complementary')),
      dat_name TEXT,
      dat_description TEXT,
      dat_version TEXT,
      dat_set_mode TEXT,
      games_added INTEGER DEFAULT 0,
      roms_added INTEGER DEFAULT 0,
      loaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Table principale des jeux
    -- Colonnes arcade :
    --   is_bios     : 1 si <machine isbios="yes"> (set BIOS partagé, non jouable)
    --   is_device   : 1 si <machine isdevice="yes"> (device matériel partagé)
    --   is_mechanical : 1 si <machine ismechanical="yes"> (flipper, machine à sous… — non jouable au pad)
    --   parent_name_ref : nom textuel du parent référencé via cloneof/romof, conservé
    --                     même si le parent n'est pas présent dans le DAT (cas DAT pré-filtré)
    --   cloneof_ref : valeur brute de l'attribut cloneof (parent « jeu » : variante/hack). NULL si absent.
    --   romof_ref   : valeur brute de l'attribut romof (parent technique de partage de ROMs / BIOS). NULL si absent.
    --   driver_status   : valeur de <driver status="good|imperfect|preliminary"/>.
    --                     NULL pour les DAT qui ne portent pas cette info (Pleasuredome, Logiqx).
    --   source_id       : ID de la source DAT qui a introduit ce jeu.
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      category TEXT,
      is_selected INTEGER DEFAULT 1,
      change_status TEXT,
      system_id INTEGER,
      is_bios INTEGER DEFAULT 0,
      is_device INTEGER DEFAULT 0,
      is_mechanical INTEGER DEFAULT 0,
      parent_name_ref TEXT,
      cloneof_ref TEXT,
      romof_ref TEXT,
      driver_status TEXT,
      source_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (source_id) REFERENCES dat_sources(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_games_name ON games(name);
    -- Note : les CREATE INDEX pour les colonnes ajoutées en v1.6+ (is_bios,
    -- is_device, parent_name_ref, driver_status) sont différés après les
    -- migrations. Sinon, sur une ancienne DB où la colonne n'existe pas encore,
    -- le CREATE INDEX échoue avant que la migration ait pu ajouter la colonne.

    -- Relations parent/enfant pour les jeux arcade (cloneof + romof + device_ref).
    -- Seules les relations dont le parent existe dans la table games sont insérées ici.
    -- Pour la traçabilité en cas de DAT pré-filtré, le nom textuel du parent
    -- est aussi conservé dans games.parent_name_ref.
    CREATE TABLE IF NOT EXISTS game_relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      child_game_id INTEGER NOT NULL,
      parent_game_id INTEGER NOT NULL,
      relationship_type TEXT NOT NULL CHECK(relationship_type IN ('cloneof', 'romof', 'device_ref')),
      source_id INTEGER,
      FOREIGN KEY (child_game_id) REFERENCES games(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_game_id) REFERENCES games(id) ON DELETE CASCADE,
      FOREIGN KEY (source_id) REFERENCES dat_sources(id) ON DELETE SET NULL,
      UNIQUE(child_game_id, relationship_type, parent_game_id)
    );

    CREATE INDEX IF NOT EXISTS idx_game_rel_child ON game_relationships(child_game_id);
    CREATE INDEX IF NOT EXISTS idx_game_rel_parent ON game_relationships(parent_game_id);
    CREATE INDEX IF NOT EXISTS idx_game_rel_type ON game_relationships(relationship_type);

    -- Table des ROMs définies dans le DAT
    -- Colonnes arcade :
    --   merge_name : si la ROM a l'attribut merge="X" dans le DAT, indique qu'elle est
    --                identique à une ROM nommée X dans le parent (mode split)
    --   is_disk    : 1 si l'entrée vient d'une balise <disk> au lieu de <rom> (CHD MAME)
    CREATE TABLE IF NOT EXISTS dat_roms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      size INTEGER,
      crc32 TEXT,
      md5 TEXT,
      sha1 TEXT,
      merge_name TEXT,
      is_disk INTEGER DEFAULT 0,
      source_id INTEGER,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
      FOREIGN KEY (source_id) REFERENCES dat_sources(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_dat_roms_game_id ON dat_roms(game_id);
    CREATE INDEX IF NOT EXISTS idx_dat_roms_crc32 ON dat_roms(crc32);
    CREATE INDEX IF NOT EXISTS idx_dat_roms_md5 ON dat_roms(md5);
    CREATE INDEX IF NOT EXISTS idx_dat_roms_sha1 ON dat_roms(sha1);
    -- idx_dat_roms_merge et idx_dat_roms_is_disk : idem, créés après les migrations.

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

    -- Snapshot de la version précédente du DAT (pour comparaison après mise à jour)
    CREATE TABLE IF NOT EXISTS games_previous (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      is_selected INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS dat_roms_previous (
      id INTEGER PRIMARY KEY,
      game_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      size INTEGER,
      crc32 TEXT,
      md5 TEXT,
      sha1 TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_dat_roms_previous_game ON dat_roms_previous(game_id);
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

  // Post-migration : créer les index pour les colonnes ajoutées en v1.6+.
  // Doit tourner APRÈS les migrations pour que les colonnes existent, mais aussi
  // pour les DB fraîches (schéma courant créé d'un coup, pas de migration à jouer).
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_games_is_bios ON games(is_bios);
    CREATE INDEX IF NOT EXISTS idx_games_is_device ON games(is_device);
    CREATE INDEX IF NOT EXISTS idx_games_is_mechanical ON games(is_mechanical);
    CREATE INDEX IF NOT EXISTS idx_games_parent_name_ref ON games(parent_name_ref);
    CREATE INDEX IF NOT EXISTS idx_games_driver_status ON games(driver_status);
    CREATE INDEX IF NOT EXISTS idx_games_source ON games(source_id);
    CREATE INDEX IF NOT EXISTS idx_dat_roms_merge ON dat_roms(merge_name);
    CREATE INDEX IF NOT EXISTS idx_dat_roms_is_disk ON dat_roms(is_disk);
    CREATE INDEX IF NOT EXISTS idx_dat_roms_source ON dat_roms(source_id);
    CREATE INDEX IF NOT EXISTS idx_game_rel_source ON game_relationships(source_id);
  `);

  console.log(`✅ Database initialized (schema v${currentSchemaVersion})`);
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
  console.log('Database cleared');
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
  if (currentVersion < '1.5') {
    await migrateToV1_5(db);
  }
  if (currentVersion < '1.6') {
    await migrateToV1_6(db);
  }
  if (currentVersion < '1.7') {
    await migrateToV1_7(db);
  }
  if (currentVersion < '1.8') {
    await migrateToV1_8(db);
  }
  if (currentVersion < '1.9') {
    await migrateToV1_9(db);
  }
  if (currentVersion < '2.0') {
    await migrateToV2_0(db);
  }
}

async function migrateToV1_1(db: Database): Promise<void> {
  console.log('Migrating to schema v1.1...');

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

  console.log('✅ Migration to schema v1.1 complete');
}

async function migrateToV1_2(db: Database): Promise<void> {
  console.log('Migrating to schema v1.2...');

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

  console.log('✅ Migration to schema v1.2 complete');
}

async function migrateToV1_3(db: Database): Promise<void> {
  console.log('Migrating to schema v1.3...');

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

  console.log('✅ Migration to schema v1.3 complete (rom_matches recreated — re-run matching)');
}

async function migrateToV1_4(db: Database): Promise<void> {
  console.log('Migrating to schema v1.4...');

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

  console.log('✅ Migration to schema v1.4 complete (rom_matches recreated with CASCADE — re-run matching)');
}

async function migrateToV1_5(db: Database): Promise<void> {
  console.log('Migrating to schema v1.5...');

  // Ajouter change_status à games
  const columns = await db.all<{ name: string }>('PRAGMA table_info(games)');
  if (!columns.some(col => col.name === 'change_status')) {
    await db.run('ALTER TABLE games ADD COLUMN change_status TEXT');
  }

  // Créer les tables de snapshot pour comparaison DAT
  await db.exec(`
    CREATE TABLE IF NOT EXISTS games_previous (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      is_selected INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS dat_roms_previous (
      id INTEGER PRIMARY KEY,
      game_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      size INTEGER,
      crc32 TEXT,
      md5 TEXT,
      sha1 TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_dat_roms_previous_game ON dat_roms_previous(game_id);
  `);

  await db.run(
    'UPDATE metadata SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?',
    [currentSchemaVersion, 'schema_version']
  );

  console.log('✅ Migration to schema v1.5 complete');
}

async function migrateToV1_7(db: Database): Promise<void> {
  console.log('Migrating to schema v1.7 (driver_status for filtering by MAME emulation quality)...');

  const gamesCols = await db.all<{ name: string }>('PRAGMA table_info(games)');
  if (!gamesCols.some(c => c.name === 'driver_status')) {
    await db.run('ALTER TABLE games ADD COLUMN driver_status TEXT');
  }

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_games_driver_status ON games(driver_status);
  `);

  await db.run(
    'UPDATE metadata SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?',
    [currentSchemaVersion, 'schema_version']
  );

  console.log('✅ Migration to schema v1.7 complete');
}

async function migrateToV1_8(db: Database): Promise<void> {
  console.log('Migrating to schema v1.8 (dat_sources — multi-DAT loading: primary + complementary)...');

  // Table dat_sources : registre des DAT chargés dans la DB (primaire + N complémentaires).
  await db.exec(`
    CREATE TABLE IF NOT EXISTS dat_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT,
      role TEXT NOT NULL CHECK(role IN ('primary', 'complementary')),
      dat_name TEXT,
      dat_description TEXT,
      dat_version TEXT,
      dat_set_mode TEXT,
      games_added INTEGER DEFAULT 0,
      roms_added INTEGER DEFAULT 0,
      loaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Colonnes source_id sur games / dat_roms / game_relationships pour tracer
  // l'origine de chaque entrée. NULL pour les entrées existantes avant migration
  // (elles seront rattachées à la source primaire de rétro-compatibilité).
  const gamesCols = await db.all<{ name: string }>('PRAGMA table_info(games)');
  if (!gamesCols.some(c => c.name === 'source_id')) {
    await db.run('ALTER TABLE games ADD COLUMN source_id INTEGER');
  }

  const romsCols = await db.all<{ name: string }>('PRAGMA table_info(dat_roms)');
  if (!romsCols.some(c => c.name === 'source_id')) {
    await db.run('ALTER TABLE dat_roms ADD COLUMN source_id INTEGER');
  }

  const relCols = await db.all<{ name: string }>('PRAGMA table_info(game_relationships)');
  if (!relCols.some(c => c.name === 'source_id')) {
    await db.run('ALTER TABLE game_relationships ADD COLUMN source_id INTEGER');
  }

  // Rétro-compatibilité : si la DB contenait déjà des jeux avant cette migration,
  // ils viennent du DAT primaire. On crée une entrée dat_sources rétrospective
  // à partir des metadata existantes (dat_path, dat_name, etc.) pour préserver
  // la traçabilité et rattacher les entrées orphelines.
  const existingGamesCount = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM games');
  if ((existingGamesCount?.n ?? 0) > 0) {
    const existingSourcesCount = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM dat_sources');
    if ((existingSourcesCount?.n ?? 0) === 0) {
      // Récupérer les metadata déjà stockées (peuvent être NULL, on fait au mieux)
      const meta = async (k: string) => (await db.get<{ value: string }>('SELECT value FROM metadata WHERE key = ?', [k]))?.value ?? null;
      const datPath = await meta('dat_path');
      const datName = await meta('dat_name');
      const datDescription = await meta('dat_description');
      const datVersion = await meta('dat_version');
      const datSetMode = await meta('dat_set_mode');

      const result = await db.run(
        `INSERT INTO dat_sources (file_path, role, dat_name, dat_description, dat_version, dat_set_mode, games_added, roms_added)
         VALUES (?, 'primary', ?, ?, ?, ?, 0, 0)`,
        [datPath, datName, datDescription, datVersion, datSetMode]
      );
      const primarySourceId = result.lastID;

      // Rattacher toutes les entrées orphelines à la source primaire rétrospective
      await db.run('UPDATE games SET source_id = ? WHERE source_id IS NULL', [primarySourceId]);
      await db.run('UPDATE dat_roms SET source_id = ? WHERE source_id IS NULL', [primarySourceId]);
      await db.run('UPDATE game_relationships SET source_id = ? WHERE source_id IS NULL', [primarySourceId]);

      // Mettre à jour les compteurs de la source
      const gAdded = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM games WHERE source_id = ?', [primarySourceId]);
      const rAdded = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM dat_roms WHERE source_id = ?', [primarySourceId]);
      await db.run(
        'UPDATE dat_sources SET games_added = ?, roms_added = ? WHERE id = ?',
        [gAdded?.n ?? 0, rAdded?.n ?? 0, primarySourceId]
      );
    }
  }

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_games_source ON games(source_id);
    CREATE INDEX IF NOT EXISTS idx_dat_roms_source ON dat_roms(source_id);
    CREATE INDEX IF NOT EXISTS idx_game_rel_source ON game_relationships(source_id);
  `);

  await db.run(
    'UPDATE metadata SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?',
    [currentSchemaVersion, 'schema_version']
  );

  console.log('✅ Migration to schema v1.8 complete');
}

async function migrateToV1_9(db: Database): Promise<void> {
  console.log('Migrating to schema v1.9 (games.is_mechanical — MAME electromechanical machines)...');

  // Nouvelle colonne is_mechanical (<machine ismechanical="yes">). Vaut 0 pour les
  // jeux existants : la valeur réelle n'est renseignée qu'au (re)chargement d'un DAT.
  const gamesCols = await db.all<{ name: string }>('PRAGMA table_info(games)');
  if (!gamesCols.some(c => c.name === 'is_mechanical')) {
    await db.run('ALTER TABLE games ADD COLUMN is_mechanical INTEGER DEFAULT 0');
  }

  await db.run(
    'UPDATE metadata SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?',
    [currentSchemaVersion, 'schema_version']
  );

  console.log('✅ Migration to schema v1.9 complete');
}

async function migrateToV2_0(db: Database): Promise<void> {
  console.log('Migrating to schema v2.0 (games.cloneof_ref / romof_ref — separate MAME parent references)...');

  // Nouvelles colonnes cloneof_ref / romof_ref (valeurs brutes des attributs MAME
  // cloneof / romof). Valent NULL pour les jeux existants : renseignées au
  // (re)chargement d'un DAT. parent_name_ref (cloneof||romof) est conservé tel quel.
  const gamesCols = await db.all<{ name: string }>('PRAGMA table_info(games)');
  if (!gamesCols.some(c => c.name === 'cloneof_ref')) {
    await db.run('ALTER TABLE games ADD COLUMN cloneof_ref TEXT');
  }
  if (!gamesCols.some(c => c.name === 'romof_ref')) {
    await db.run('ALTER TABLE games ADD COLUMN romof_ref TEXT');
  }

  await db.run(
    'UPDATE metadata SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?',
    [currentSchemaVersion, 'schema_version']
  );

  console.log('✅ Migration to schema v2.0 complete');
}

async function migrateToV1_6(db: Database): Promise<void> {
  console.log('Migrating to schema v1.6 (arcade support: cloneof / romof / device_ref / disk / merge)...');

  // Colonnes additionnelles sur `games`
  const gamesCols = await db.all<{ name: string }>('PRAGMA table_info(games)');
  if (!gamesCols.some(c => c.name === 'is_bios')) {
    await db.run('ALTER TABLE games ADD COLUMN is_bios INTEGER DEFAULT 0');
  }
  if (!gamesCols.some(c => c.name === 'is_device')) {
    await db.run('ALTER TABLE games ADD COLUMN is_device INTEGER DEFAULT 0');
  }
  if (!gamesCols.some(c => c.name === 'parent_name_ref')) {
    await db.run('ALTER TABLE games ADD COLUMN parent_name_ref TEXT');
  }

  // Colonnes additionnelles sur `dat_roms`
  const romCols = await db.all<{ name: string }>('PRAGMA table_info(dat_roms)');
  if (!romCols.some(c => c.name === 'merge_name')) {
    await db.run('ALTER TABLE dat_roms ADD COLUMN merge_name TEXT');
  }
  if (!romCols.some(c => c.name === 'is_disk')) {
    await db.run('ALTER TABLE dat_roms ADD COLUMN is_disk INTEGER DEFAULT 0');
  }

  // Nouvelle table game_relationships + index
  await db.exec(`
    CREATE TABLE IF NOT EXISTS game_relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      child_game_id INTEGER NOT NULL,
      parent_game_id INTEGER NOT NULL,
      relationship_type TEXT NOT NULL CHECK(relationship_type IN ('cloneof', 'romof', 'device_ref')),
      FOREIGN KEY (child_game_id) REFERENCES games(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_game_id) REFERENCES games(id) ON DELETE CASCADE,
      UNIQUE(child_game_id, relationship_type, parent_game_id)
    );

    CREATE INDEX IF NOT EXISTS idx_game_rel_child ON game_relationships(child_game_id);
    CREATE INDEX IF NOT EXISTS idx_game_rel_parent ON game_relationships(parent_game_id);
    CREATE INDEX IF NOT EXISTS idx_game_rel_type ON game_relationships(relationship_type);

    CREATE INDEX IF NOT EXISTS idx_games_is_bios ON games(is_bios);
    CREATE INDEX IF NOT EXISTS idx_games_is_device ON games(is_device);
    CREATE INDEX IF NOT EXISTS idx_games_parent_name_ref ON games(parent_name_ref);
    CREATE INDEX IF NOT EXISTS idx_dat_roms_merge ON dat_roms(merge_name);
    CREATE INDEX IF NOT EXISTS idx_dat_roms_is_disk ON dat_roms(is_disk);
  `);

  await db.run(
    'UPDATE metadata SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?',
    [currentSchemaVersion, 'schema_version']
  );

  console.log('✅ Migration to schema v1.6 complete');
}
