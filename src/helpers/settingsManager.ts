// src/helpers/settingsManager.ts

import { app } from 'electron';
import path from 'path';
import fs from 'fs/promises';

export type ArchiveFormat = '7z' | 'zip' | 'chd';
export type CompressionLevel = 'fastest' | 'normal' | 'maximum';
export type CleanupScope = 'used-only' | 'all-matched';
export type RarTool = '7zip' | 'winrar' | 'unrar';

export type SystemCategory = 'Nintendo' | 'Sega' | 'Sony' | 'Arcade' | 'Ordinateurs' | 'Autres';

export type SystemSubcategory = 'Consoles de salon' | 'Consoles portables';

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

  // Consolidation — Nettoyage
  cleanSourceAfterConsolidation: boolean;
  cleanupScope: CleanupScope;
  protectFilesForUnselectedGames: boolean;

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

const CURRENT_SETTINGS_VERSION = 5;

/**
 * Valeurs par défaut de compatibilité archives par système
 */
export const DEFAULT_SYSTEM_COMPATIBILITY: SystemCompatibility[] = [
  // ── Nintendo — Consoles de salon ──
  { systemId: 'nes', systemName: 'Nintendo Entertainment System (NES)', category: 'Nintendo', subcategory: 'Consoles de salon', supportedFormats: ['zip', '7z'], unsupportedFormats: ['chd'] },
  { systemId: 'snes', systemName: 'Super Nintendo (SNES)', category: 'Nintendo', subcategory: 'Consoles de salon', supportedFormats: ['zip', '7z'], unsupportedFormats: ['chd'] },
  { systemId: 'n64', systemName: 'Nintendo 64', category: 'Nintendo', subcategory: 'Consoles de salon', supportedFormats: ['7z', 'zip'], unsupportedFormats: ['chd'] },
  { systemId: 'gamecube', systemName: 'Nintendo GameCube', category: 'Nintendo', subcategory: 'Consoles de salon', supportedFormats: ['7z'], warningFormats: ['zip'], unsupportedFormats: ['chd'] },
  { systemId: 'wii', systemName: 'Nintendo Wii', category: 'Nintendo', subcategory: 'Consoles de salon', supportedFormats: ['7z'], warningFormats: ['zip'], unsupportedFormats: ['chd'] },
  // ── Nintendo — Portables ──
  { systemId: 'gb', systemName: 'Game Boy', category: 'Nintendo', subcategory: 'Consoles portables', supportedFormats: ['zip', '7z'], unsupportedFormats: ['chd'] },
  { systemId: 'gbc', systemName: 'Game Boy Color', category: 'Nintendo', subcategory: 'Consoles portables', supportedFormats: ['zip', '7z'], unsupportedFormats: ['chd'] },
  { systemId: 'gba', systemName: 'Game Boy Advance', category: 'Nintendo', subcategory: 'Consoles portables', supportedFormats: ['zip', '7z'], unsupportedFormats: ['chd'] },
  { systemId: 'nds', systemName: 'Nintendo DS', category: 'Nintendo', subcategory: 'Consoles portables', supportedFormats: ['7z', 'zip'], unsupportedFormats: ['chd'] },
  { systemId: '3ds', systemName: 'Nintendo 3DS', category: 'Nintendo', subcategory: 'Consoles portables', supportedFormats: ['7z'], warningFormats: ['zip'], unsupportedFormats: ['chd'] },
  // ── Sega — Consoles de salon ──
  { systemId: 'mastersystem', systemName: 'Sega Master System', category: 'Sega', subcategory: 'Consoles de salon', supportedFormats: ['zip', '7z'], unsupportedFormats: ['chd'] },
  { systemId: 'genesis', systemName: 'Sega Genesis / Mega Drive', category: 'Sega', subcategory: 'Consoles de salon', supportedFormats: ['zip', '7z'], unsupportedFormats: ['chd'] },
  { systemId: 'sega32x', systemName: 'Sega 32X', category: 'Sega', subcategory: 'Consoles de salon', supportedFormats: ['zip', '7z'], unsupportedFormats: ['chd'] },
  { systemId: 'segacd', systemName: 'Sega CD / Mega CD', category: 'Sega', subcategory: 'Consoles de salon', supportedFormats: ['chd'], warningFormats: ['7z', 'zip'], unsupportedFormats: [] },
  { systemId: 'saturn', systemName: 'Sega Saturn', category: 'Sega', subcategory: 'Consoles de salon', supportedFormats: ['chd'], warningFormats: ['7z'], unsupportedFormats: ['zip'] },
  { systemId: 'dreamcast', systemName: 'Sega Dreamcast', category: 'Sega', subcategory: 'Consoles de salon', supportedFormats: ['chd'], warningFormats: ['7z'], unsupportedFormats: ['zip'] },
  // ── Sega — Portables ──
  { systemId: 'gamegear', systemName: 'Sega Game Gear', category: 'Sega', subcategory: 'Consoles portables', supportedFormats: ['zip', '7z'], unsupportedFormats: ['chd'] },
  // ── Sony — Consoles de salon ──
  { systemId: 'psx', systemName: 'PlayStation (PSX)', category: 'Sony', subcategory: 'Consoles de salon', supportedFormats: ['chd'], warningFormats: ['7z', 'zip'], unsupportedFormats: [] },
  { systemId: 'ps2', systemName: 'PlayStation 2 (PS2)', category: 'Sony', subcategory: 'Consoles de salon', supportedFormats: ['chd', '7z'], warningFormats: [], unsupportedFormats: ['zip'] },
  // ── Sony — Portables ──
  { systemId: 'psp', systemName: 'PlayStation Portable (PSP)', category: 'Sony', subcategory: 'Consoles portables', supportedFormats: ['chd', '7z'], warningFormats: ['zip'], unsupportedFormats: [] },
  // ── Arcade ──
  { systemId: 'mame', systemName: 'Arcade (MAME)', category: 'Arcade', supportedFormats: ['zip'], warningFormats: ['7z'], unsupportedFormats: ['chd'] },
  { systemId: 'fba', systemName: 'Arcade (FinalBurn Neo)', category: 'Arcade', supportedFormats: ['zip'], warningFormats: ['7z'], unsupportedFormats: ['chd'] },
  { systemId: 'neogeo', systemName: 'Neo Geo', category: 'Arcade', supportedFormats: ['zip'], warningFormats: ['7z'], unsupportedFormats: ['chd'] },
  // ── Ordinateurs ──
  { systemId: 'pc', systemName: 'PC (DOS / Windows)', category: 'Ordinateurs', supportedFormats: ['7z', 'zip'], warningFormats: ['chd'], unsupportedFormats: [] },
  // ── Autres ──
  { systemId: 'pcengine', systemName: 'PC Engine / TurboGrafx-16', category: 'Autres', supportedFormats: ['chd', '7z', 'zip'], unsupportedFormats: [] },
  { systemId: 'atari2600', systemName: 'Atari 2600', category: 'Autres', supportedFormats: ['zip', '7z'], unsupportedFormats: ['chd'] },
];

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

      cleanSourceAfterConsolidation: true,
      cleanupScope: 'used-only',
      protectFilesForUnselectedGames: true,

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
}

// Instance singleton
export const settingsManager = new SettingsManager();
