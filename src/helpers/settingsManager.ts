// src/helpers/settingsManager.ts

import { app } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { SYSTEMS } from '../config/systems.js';

export type ArchiveFormat = '7z' | 'zip' | 'chd';
export type CompressionLevel = 'fastest' | 'normal' | 'maximum';
export type CleanupScope = 'used-only' | 'all-matched';
export type RarTool = '7zip' | 'winrar' | 'unrar';

// Manufacturer (ex: 'Sony', 'Nintendo', 'Sega', 'Atari', 'Commodore'...).
// Élargi à string pour suivre Recalbox qui couvre une centaine de constructeurs.
export type SystemCategory = string;

// Type de plateforme tel que défini par Recalbox (console, handheld, arcade, computer).
export type SystemSubcategory = string;

export interface SystemCompatibility {
  systemId: string;
  systemName: string;
  category: SystemCategory;
  subcategory?: SystemSubcategory;
  supportedFormats: ArchiveFormat[];
  warningFormats?: ArchiveFormat[];
  unsupportedFormats?: ArchiveFormat[];
}

export interface AppSettings {
  // Dossiers par défaut
  defaultDatFolder: string;
  defaultDatabaseFolder: string;
  defaultRomsFolder: string;
  unmatchedRomsFolder: string;
  validatedRomsFolder: string;
  tempExtractionFolder: string;

  /**
   * Si activé, le dossier cible des ROMs validées sera un sous-dossier nommé
   * d'après le systemId (ex: "psx", "nes") créé sous validatedRomsFolder.
   * Le settings persisté pointe toujours sur le dossier parent ; le dossier
   * effectif est résolu via getEffectiveValidatedRomsFolder().
   */
  validatedRomsMultiSystem?: boolean;

  // Consolidation — Nettoyage
  cleanSourceAfterConsolidation: boolean;
  cleanupScope: CleanupScope;
  protectFilesForUnselectedGames: boolean;

  // Mise à jour DAT
  autoSelectNewGames: boolean;

  // Autres paramètres
  theme: 'light' | 'dark';
  language: 'fr' | 'en';
  autoScanOnStartup: boolean;
  
  // Paramètres de compression
  compressionLevel: CompressionLevel;
  recreateArchivesIfNeeded: boolean;
  archiveFormatPriority: ArchiveFormat[];
  useBestCompression: boolean;
  solidArchive: boolean;
  multithreading: boolean;

  // Outils externes
  sevenZipPath?: string;
  winrarPath?: string;
  unrarPath?: string;
  chdmanPath?: string;
  useEmbeddedChdman?: boolean;
  rarToolPriority?: RarTool[];

  // Compatibilité archives par système
  systemCompatibility?: SystemCompatibility[];

  // Paramètres par défaut No-Intro (téléchargement DAT)
  noIntroDefaults?: {
    includeBios: boolean;
    includeProto: boolean;
    includeBeta: boolean;
    includeDemo: boolean;
    includeSample: boolean;
  };

  // Téléchargement de ROMs
  downloadSources?: Array<{
    id: string;
    name: string;
    baseUrl: string;
    enabled: boolean;
    extensions?: string[];
    systemExtensions?: Record<string, string[]>;
  }>;
  downloadExtensions?: string[];
  downloadSystemExtensions?: Array<{
    systemId: string;
    extensions: string[];
  }>;
  incompleteRomsFolder?: string;

  settingsVersion?: number;
}

// Mapping des niveaux de compression vers les valeurs 7z
export const compressionLevelTo7z = {
  fastest: '1',  // -mx1 (fastest)
  normal: '5',   // -mx5 (normal)
  maximum: '9'   // -mx9 (ultra)
};

// Mapping des niveaux de compression vers les valeurs ZIP
export const compressionLevelToZip = {
  fastest: 1,    // DEFLATE level 1
  normal: 6,     // DEFLATE level 6 (default)
  maximum: 9     // DEFLATE level 9 (best)
};

const CURRENT_SETTINGS_VERSION = 9;

/**
 * Valeurs par défaut de compatibilité archives par système.
 * Dérivées dynamiquement du registre central src/config/systems.ts.
 * Pour modifier la liste des systèmes ou leurs formats : `npm run sync-systems`.
 */
export const DEFAULT_SYSTEM_COMPATIBILITY: SystemCompatibility[] = SYSTEMS.map(s => ({
  systemId: s.systemId,
  systemName: s.fullname,
  category: s.manufacturer ?? 'Autres',
  subcategory: s.type ?? undefined,
  supportedFormats: s.supportedFormats,
  warningFormats: s.warningFormats,
  unsupportedFormats: s.unsupportedFormats
}));

class SettingsManager {
  private settingsPath: string;
  private settings: AppSettings;
  private defaultSettings: AppSettings;

  constructor() {
    // Chemin du fichier de configuration
    this.settingsPath = path.join(app.getPath('userData'), 'settings.json');
    
    // Paramètres par défaut
    const documentsPath = app.getPath('documents');
    this.defaultSettings = {
      defaultDatFolder: path.join(documentsPath, 'ROMs', 'DAT'),
      defaultDatabaseFolder: path.join(app.getPath('userData'), 'databases'),
      defaultRomsFolder: path.join(documentsPath, 'ROMs'),
      unmatchedRomsFolder: path.join(documentsPath, 'ROMs', 'Unmatched'),
      validatedRomsFolder: path.join(documentsPath, 'ROMs', 'Validated'),
      tempExtractionFolder: path.join(app.getPath('temp'), 'RUMCET'),
      validatedRomsMultiSystem: false,

      cleanSourceAfterConsolidation: true,
      cleanupScope: 'used-only',
      protectFilesForUnselectedGames: true,

      autoSelectNewGames: true,

      theme: 'light',
      language: 'fr',
      autoScanOnStartup: false,

      // Paramètres de compression par défaut
      compressionLevel: 'maximum',
      recreateArchivesIfNeeded: false,
      archiveFormatPriority: ['chd', '7z', 'zip'], // Ordre par défaut
      useBestCompression: false,
      solidArchive: true,
      multithreading: true,
      
      // Paramètres des outils externes par défaut
      sevenZipPath: undefined,
      winrarPath: undefined,
      unrarPath: undefined,
      chdmanPath: undefined,
      useEmbeddedChdman: true,
      rarToolPriority: ['7zip', 'winrar', 'unrar'],

      // Compatibilité archives par système
      systemCompatibility: DEFAULT_SYSTEM_COMPATIBILITY,

      // Paramètres par défaut No-Intro
      noIntroDefaults: {
        includeBios: true,
        includeProto: true,
        includeBeta: true,
        includeDemo: true,
        includeSample: true,
      },

      // Téléchargement de ROMs
      downloadSources: [],
      downloadExtensions: ['7z', 'zip', 'chd', 'rar', 'iso', 'cso', 'pbp'],
      downloadSystemExtensions: [],
      incompleteRomsFolder: path.join(documentsPath, 'ROMs', 'Incomplete'),

      settingsVersion: CURRENT_SETTINGS_VERSION
    };
    
    this.settings = { ...this.defaultSettings };
  }

  /**
   * Migre les anciens paramètres vers la nouvelle version
   */
  private migrateSettings(loadedSettings: any): AppSettings {
    const version = loadedSettings.settingsVersion || 1;
    
    console.log(`Migration des paramètres depuis la version ${version} vers ${CURRENT_SETTINGS_VERSION}`);
    
    let migratedSettings = { ...loadedSettings };
    
    // Migration v1 -> v2 : Ajout des paramètres de compression basiques
    if (version < 2) {
      console.log('Migration v1 -> v2 : Ajout des paramètres de compression');
      migratedSettings = {
        ...migratedSettings,
        compressionLevel: this.defaultSettings.compressionLevel,
        recreateArchivesIfNeeded: this.defaultSettings.recreateArchivesIfNeeded,
        preferredArchiveFormat: '7z', // Ancien format (sera migré en v3)
        solidArchive: this.defaultSettings.solidArchive,
        multithreading: this.defaultSettings.multithreading,
        settingsVersion: 2
      };
    }
    
    // Migration v2 -> v3 : Passage de preferredArchiveFormat à archiveFormatPriority
    if (version < 3) {
      console.log('Migration v2 -> v3 : Passage à l\'ordre de priorité des formats');
      
      // Convertir l'ancien format unique en liste ordonnée
      const oldFormat = migratedSettings.preferredArchiveFormat;
      let priority: ArchiveFormat[] = ['7z', 'zip', 'chd']; // Par défaut
      
      if (oldFormat === 'zip') {
        priority = ['zip', '7z', 'chd'];
      } else if (oldFormat === 'chd') {
        priority = ['chd', '7z', 'zip'];
      } else if (oldFormat === '7z') {
        priority = ['7z', 'chd', 'zip'];
      } else if (oldFormat === 'best') {
        // L'ancien "best" devient le nouveau useBestCompression
        priority = ['chd', '7z', 'zip'];
        migratedSettings.useBestCompression = true;
      }
      
      migratedSettings = {
        ...migratedSettings,
        archiveFormatPriority: priority,
        useBestCompression: migratedSettings.useBestCompression || false,
        settingsVersion: 3
      };
      
      // Supprimer l'ancien champ
      delete migratedSettings.preferredArchiveFormat;
    }

    // Migration v3 -> v4 : Ajout des paramètres de consolidation
    if (version < 4) {
      console.log('Migration v3 -> v4 : Ajout des paramètres de consolidation');
      migratedSettings = {
        ...migratedSettings,
        validatedRomsFolder: this.defaultSettings.validatedRomsFolder,
        tempExtractionFolder: this.defaultSettings.tempExtractionFolder,
        cleanSourceAfterConsolidation: this.defaultSettings.cleanSourceAfterConsolidation,
        settingsVersion: 4
      };
    }

    // Migration v4 -> v5 : Ajout des paramètres de nettoyage avancés
    if (version < 5) {
      console.log('Migration v4 -> v5 : Ajout des paramètres de nettoyage avancés');
      migratedSettings = {
        ...migratedSettings,
        cleanupScope: this.defaultSettings.cleanupScope,
        protectFilesForUnselectedGames: this.defaultSettings.protectFilesForUnselectedGames,
        settingsVersion: 5
      };
    }

    // Migration v5 -> v6 : Ajout du paramètre de sélection des nouveaux jeux
    if (version < 6) {
      console.log('Migration v5 -> v6 : Ajout du paramètre autoSelectNewGames');
      migratedSettings = {
        ...migratedSettings,
        autoSelectNewGames: this.defaultSettings.autoSelectNewGames,
        settingsVersion: 6
      };
    }

    // Migration v6 -> v7 : Ajout des paramètres par défaut No-Intro
    if (version < 7) {
      console.log('Migration v6 -> v7 : Ajout des paramètres noIntroDefaults');
      migratedSettings = {
        ...migratedSettings,
        noIntroDefaults: this.defaultSettings.noIntroDefaults,
        settingsVersion: 7
      };
    }

    // Migration v7 -> v8 : Ajout des paramètres de téléchargement de ROMs
    if (version < 8) {
      console.log('Migration v7 -> v8 : Ajout des paramètres de téléchargement de ROMs');
      migratedSettings = {
        ...migratedSettings,
        downloadSources: this.defaultSettings.downloadSources,
        downloadExtensions: this.defaultSettings.downloadExtensions,
        downloadSystemExtensions: this.defaultSettings.downloadSystemExtensions,
        incompleteRomsFolder: this.defaultSettings.incompleteRomsFolder,
        settingsVersion: 8
      };
    }

    // Migration v8 -> v9 : Ajout du mode multi-système pour le dossier cible
    if (version < 9) {
      console.log('Migration v8 -> v9 : Ajout de validatedRomsMultiSystem');
      migratedSettings = {
        ...migratedSettings,
        validatedRomsMultiSystem: this.defaultSettings.validatedRomsMultiSystem,
        settingsVersion: 9
      };
    }

    return migratedSettings as AppSettings;
  }

  /**
   * Valide les paramètres chargés
   */
  private validateSettings(settings: AppSettings): boolean {
    // Vérifier que archiveFormatPriority est un tableau non vide
    if (!Array.isArray(settings.archiveFormatPriority) || 
        settings.archiveFormatPriority.length === 0) {
      console.warn('archiveFormatPriority invalide, utilisation des valeurs par défaut');
      settings.archiveFormatPriority = this.defaultSettings.archiveFormatPriority;
    }
    
    // Vérifier qu'il n'y a pas de doublons
    const uniqueFormats = [...new Set(settings.archiveFormatPriority)];
    if (uniqueFormats.length !== settings.archiveFormatPriority.length) {
      console.warn('Doublons détectés dans archiveFormatPriority, nettoyage...');
      settings.archiveFormatPriority = uniqueFormats as ArchiveFormat[];
    }
    
    // Vérifier que tous les formats sont valides
    const validFormats: ArchiveFormat[] = ['7z', 'zip', 'chd'];
    settings.archiveFormatPriority = settings.archiveFormatPriority.filter(
      format => validFormats.includes(format)
    ) as ArchiveFormat[];
    
    if (settings.archiveFormatPriority.length === 0) {
      console.warn('Aucun format valide trouvé, utilisation des valeurs par défaut');
      settings.archiveFormatPriority = this.defaultSettings.archiveFormatPriority;
    }
    
    return true;
  }

  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.settingsPath, 'utf8');
      const loadedSettings = JSON.parse(data);
      
      // Migrer si nécessaire
      const migratedSettings = this.migrateSettings(loadedSettings);
      
      // Valider
      this.validateSettings(migratedSettings);
      
      // Fusionner avec les paramètres par défaut pour gérer les nouvelles clés
      this.settings = { ...this.defaultSettings, ...migratedSettings };
      
      // Sauvegarder si des migrations ont été appliquées
      if (!loadedSettings.settingsVersion || 
          loadedSettings.settingsVersion < CURRENT_SETTINGS_VERSION) {
        console.log('Sauvegarde des paramètres migrés');
        await this.save();
      }
      
      // Créer les dossiers s'ils n'existent pas
      await this.ensureFoldersExist();
      
    } catch (error) {
      // Si le fichier n'existe pas, utiliser les paramètres par défaut
      console.log('Paramètres non trouvés, utilisation des valeurs par défaut');
      await this.save(); // Sauvegarder les paramètres par défaut
    }
  }

  async save(): Promise<void> {
    try {
      // S'assurer que le dossier userData existe
      const userDataPath = app.getPath('userData');
      await fs.mkdir(userDataPath, { recursive: true });
      
      // Sauvegarder les paramètres
      await fs.writeFile(
        this.settingsPath,
        JSON.stringify(this.settings, null, 2),
        'utf8'
      );
      
      console.log('Paramètres sauvegardés');
    } catch (error) {
      console.error('Erreur lors de la sauvegarde des paramètres:', error);
    }
  }

  private async ensureFoldersExist(): Promise<void> {
    const folders = [
      this.settings.defaultDatabaseFolder,
      this.settings.unmatchedRomsFolder,
      this.settings.validatedRomsFolder,
      this.settings.tempExtractionFolder
    ];
    
    for (const folder of folders) {
      try {
        await fs.mkdir(folder, { recursive: true });
      } catch (error) {
        console.error(`Erreur lors de la création du dossier ${folder}:`, error);
      }
    }
  }

  get(key: keyof AppSettings): any {
    return this.settings[key];
  }

  set(key: keyof AppSettings, value: any): void {
    (this.settings as any)[key] = value;
  }

  getAll(): AppSettings {
    return { ...this.settings };
  }

  async updateSettings(newSettings: Partial<AppSettings>): Promise<void> {
    this.settings = { ...this.settings, ...newSettings };

    // Valider après mise à jour
    this.validateSettings(this.settings);

    await this.save();
  }

  reset(): void {
    this.settings = { ...this.defaultSettings };
  }

  /**
   * ⭐ NOUVELLE MÉTHODE : Obtenir le premier format compatible
   * @param compatibleFormats Liste des formats compatibles pour le système
   * @returns Le premier format de la priorité qui est compatible
   */
  getPreferredFormat(compatibleFormats: ArchiveFormat[]): ArchiveFormat | null {
    for (const format of this.settings.archiveFormatPriority) {
      if (compatibleFormats.includes(format)) {
        return format;
      }
    }
    return null;
  }

  // ─── Contexte actif (system_id de la base ouverte) ───
  // Utilisé par les opérations (scan, consolidation, download) pour exposer le
  // system_id courant aux composants bas niveau (ex: ChdHandler) qui ont besoin
  // du dossier effectif sans dépendre de la base de données directement.
  private activeSystemId: string | null = null;

  setActiveSystemId(id: string | null): void {
    this.activeSystemId = id;
  }

  getActiveSystemId(): string | null {
    return this.activeSystemId;
  }

  /**
   * Variante synchrone : applique le sous-dossier système si l'option
   * "Dossier multi-système" est active ET qu'un system_id est défini.
   * Ne crée pas le dossier ; l'appelant doit appeler fs.mkdir si besoin.
   */
  getEffectiveFolderSync(key: 'validatedRomsFolder' | 'unmatchedRomsFolder' | 'incompleteRomsFolder' | 'tempExtractionFolder'): string {
    const base = (this.settings[key] as string) || '';
    if (!base || !this.settings.validatedRomsMultiSystem || !this.activeSystemId) return base;
    return path.join(base, this.activeSystemId);
  }
}

// Instance singleton
export const settingsManager = new SettingsManager();

/**
 * Retourne un dossier cible effectif (avec sous-dossier système si l'option
 * "Dossier multi-système" est activée et qu'un system_id est défini en metadata).
 *
 * - Si validatedRomsMultiSystem est activé ET que system_id est défini :
 *   retourne path.join(baseFolder, system_id) et crée le sous-dossier au besoin.
 * - Sinon : retourne baseFolder tel quel.
 *
 * Le dossier paramétré (baseFolder) reste toujours le parent — seul le dossier
 * effectif change selon le mode multi-système.
 */
export async function getEffectiveTargetFolder(
  db: { get<T = any>(sql: string, params?: any[]): Promise<T | undefined> },
  baseFolder: string
): Promise<string> {
  const settings = settingsManager.getAll();
  if (!baseFolder || !settings.validatedRomsMultiSystem) {
    return baseFolder;
  }

  let systemId = '';
  try {
    const row = await db.get<{ value: string }>(
      'SELECT value FROM metadata WHERE key = ?',
      ['system_id']
    );
    systemId = row?.value || '';
  } catch {
    return baseFolder;
  }

  if (!systemId) return baseFolder;

  const subFolder = path.join(baseFolder, systemId);
  await fs.mkdir(subFolder, { recursive: true });
  return subFolder;
}

/** Raccourci pour le dossier cible des ROMs validées (rétrocompatible). */
export async function getEffectiveValidatedRomsFolder(
  db: { get<T = any>(sql: string, params?: any[]): Promise<T | undefined> }
): Promise<string> {
  return getEffectiveTargetFolder(db, settingsManager.getAll().validatedRomsFolder);
}

/** Raccourci pour le dossier cible des ROMs incomplètes. */
export async function getEffectiveIncompleteRomsFolder(
  db: { get<T = any>(sql: string, params?: any[]): Promise<T | undefined> }
): Promise<string> {
  return getEffectiveTargetFolder(db, settingsManager.getAll().incompleteRomsFolder ?? '');
}

/** Raccourci pour le dossier cible des ROMs non référencées. */
export async function getEffectiveUnmatchedRomsFolder(
  db: { get<T = any>(sql: string, params?: any[]): Promise<T | undefined> }
): Promise<string> {
  return getEffectiveTargetFolder(db, settingsManager.getAll().unmatchedRomsFolder);
}

/** Raccourci pour le dossier temporaire d'extraction. */
export async function getEffectiveTempExtractionFolder(
  db: { get<T = any>(sql: string, params?: any[]): Promise<T | undefined> }
): Promise<string> {
  return getEffectiveTargetFolder(db, settingsManager.getAll().tempExtractionFolder);
}
