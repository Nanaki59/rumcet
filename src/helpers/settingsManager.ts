// src/helpers/settingsManager.ts

import { app } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { SYSTEMS } from '../config/systems.js';

export type ArchiveFormat = '7z' | 'zip' | 'chd';
export type CompressionLevel = 'fastest' | 'normal' | 'maximum';
export type CleanupScope = 'used-only' | 'all-matched';
export type RarTool = '7zip' | 'winrar' | 'unrar';
export type ArcadeTargetSetMode = 'split' | 'non-merged' | 'merged';

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

// ─── Modèle d'extension téléchargement ─────────────────────────────
// Catégorie d'origine de l'extension (utilisée pour le code couleur + lettre dans l'UI).
export type DownloadExtensionSource = 'global' | 'sysCompressed' | 'datRaw' | 'extraRaw' | 'manual';

export interface DownloadExtensionEntry {
  /** L'extension sans le point (ex: '7z', 'bin'). */
  ext: string;
  /** Catégorie d'origine. Détermine la couleur/lettre dans l'UI et le mode par défaut. */
  source: DownloadExtensionSource;
  /**
   * Mode de recherche :
   *  - true (archive)  : on cherche `gameName.ext`
   *  - false (raw)     : on cherche chaque `datRom.name` qui se termine par `.ext`
   */
  isArchive: boolean;
}

export interface ExtensionPickerData {
  /** Liste ordonnée des extensions actives (ordre = priorité de recherche). */
  activeExtensions: DownloadExtensionEntry[];
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

  /**
   * Mode du set arcade cible pour la consolidation (DAT MAME uniquement).
   *  - 'split'      : chaque clone ne contient que ses ROMs propres (parent et BIOS en archives séparées)
   *  - 'non-merged' : chaque clone est autonome (ROMs propres + ROMs partagées du parent inlinées)
   *  - 'merged'     : l'archive du parent contient le parent et tous ses clones
   * Ignoré pour les DAT non arcade (No-Intro / Redump).
   */
  arcadeTargetSetMode?: ArcadeTargetSetMode;

  /**
   * DAT MAME uniquement. Si activé, les sets BIOS (isbios="yes") sont rangés
   * dans un sous-dossier `bios/` du dossier cible au lieu d'être à plat avec les
   * jeux. Convention Recalbox. ⚠️ Le MAME standard attend les BIOS dans le même
   * dossier que les ROMs — n'activer que si votre frontend gère un chemin BIOS séparé.
   */
  arcadeSeparateBios?: boolean;

  /**
   * DAT MAME uniquement. Si activé, un ZIP vide `<jeu>.zip` est créé pour les jeux
   * dont toutes les ROMs sont des CHD (aucune ROM classique). Recalbox liste les
   * jeux via les .zip présents ; le placeholder rend le jeu CHD-only visible.
   * Implique le rangement du CHD en sous-dossier (disposition Recalbox).
   */
  arcadeChdEmptyZip?: boolean;

  /**
   * Modèles de règles d'auto-sélection enregistrés « par défaut », indexés par type
   * de DAT (clé « sys:<systemId> », repli « arcade » / « generic »). Permet de
   * réappliquer rapidement le même jeu de règles à une nouvelle base du même type.
   */
  defaultSelectionRules?: Record<string, { base: string; rules: any[] }>;

  /**
   * Presets d'auto-sélection personnalisés (créés par l'utilisateur), globaux et
   * disponibles pour tous les DAT. Chaque preset porte un scope (arcade /
   * nointro-redump / global) qui pilote sa visibilité selon le type de DAT.
   * Miroir per-base stocké dans la metadata 'custom_selection_presets'.
   */
  customSelectionPresets?: Array<{ id: string; name: string; scope: string; rules: any[] }>;

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
    /**
     * Systèmes disponibles sur cette source. Pour chacun, l'utilisateur peut :
     *  - définir un sous-dossier sur la source qui contient les ROMs
     *  - optionnellement surcharger la liste des extensions actives (sinon résolution globale)
     */
    systems?: Array<{
      systemId: string;
      subfolder?: string;
      /** Si défini, surcharge la résolution globale pour ce couple source × système. */
      override?: ExtensionPickerData;
    }>;
  }>;
  /** Extensions globales par défaut testées sur toutes les sources/systèmes. */
  downloadExtensions?: string[];
  /**
   * Configuration par système pour la résolution globale des extensions de téléchargement.
   * Chaque entrée contient une liste ordonnée d'extensions actives (avec leur catégorie source
   * et leur mode archive/raw) plus une liste d'extensions retirées du pool (pour qu'elles
   * ne réapparaissent pas automatiquement).
   */
  downloadSystemExtensions?: Array<{
    systemId: string;
  } & ExtensionPickerData>;
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

const CURRENT_SETTINGS_VERSION = 16;

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
      arcadeTargetSetMode: 'split',
      arcadeSeparateBios: false,
      arcadeChdEmptyZip: false,

      customSelectionPresets: [],

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
      downloadExtensions: ['7z', 'zip', 'rar'],
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
    
    console.log(`Migrating settings from version ${version} to ${CURRENT_SETTINGS_VERSION}`);
    
    let migratedSettings = { ...loadedSettings };
    
    // Migration v1 -> v2 : Ajout des paramètres de compression basiques
    if (version < 2) {
      console.log('Migration v1 -> v2: Adding compression settings');
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
      console.log('Migration v2 -> v3: Switching to format priority order');
      
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
      console.log('Migration v3 -> v4: Adding consolidation settings');
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
      console.log('Migration v4 -> v5: Adding advanced cleanup settings');
      migratedSettings = {
        ...migratedSettings,
        cleanupScope: this.defaultSettings.cleanupScope,
        protectFilesForUnselectedGames: this.defaultSettings.protectFilesForUnselectedGames,
        settingsVersion: 5
      };
    }

    // Migration v5 -> v6 : Ajout du paramètre de sélection des nouveaux jeux
    if (version < 6) {
      console.log('Migration v5 -> v6: Adding the autoSelectNewGames setting');
      migratedSettings = {
        ...migratedSettings,
        autoSelectNewGames: this.defaultSettings.autoSelectNewGames,
        settingsVersion: 6
      };
    }

    // Migration v6 -> v7 : Ajout des paramètres par défaut No-Intro
    if (version < 7) {
      console.log('Migration v6 -> v7: Adding the noIntroDefaults settings');
      migratedSettings = {
        ...migratedSettings,
        noIntroDefaults: this.defaultSettings.noIntroDefaults,
        settingsVersion: 7
      };
    }

    // Migration v7 -> v8 : Ajout des paramètres de téléchargement de ROMs
    if (version < 8) {
      console.log('Migration v7 -> v8: Adding ROM download settings');
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
      console.log('Migration v8 -> v9: Adding validatedRomsMultiSystem');
      migratedSettings = {
        ...migratedSettings,
        validatedRomsMultiSystem: this.defaultSettings.validatedRomsMultiSystem,
        settingsVersion: 9
      };
    }

    // Migration v9 -> v10 : Refonte du modèle de données téléchargement
    //  - downloadSystemExtensions : passage de { systemId, extensions[] } vers
    //    { systemId, useGlobalDefaults, useDatRawFormats, useExtraRawFormats, additionalExtensions[] }
    //  - downloadSources[].extensions : supprimé (inutile)
    //  - downloadSources[].systemExtensions (Record) : converti en systems[] (Array)
    //  - downloadExtensions : réinitialisé si correspond à l'ancien défaut (chd/iso/cso/pbp)
    if (version < 10) {
      console.log('Migration v9 -> v10: reworking the download data model');

      // Sources : reshape systemExtensions → systems
      const sources = (migratedSettings.downloadSources || []) as any[];
      const newSources = sources.map((s: any) => {
        const systems: Array<{ systemId: string; subfolder?: string; overrideExtensions?: string[] }> = [];
        const sysExt = s.systemExtensions as Record<string, string[]> | undefined;
        if (sysExt) {
          for (const [systemId, exts] of Object.entries(sysExt)) {
            systems.push({
              systemId,
              subfolder: '',
              // Si l'utilisateur avait défini des extensions spécifiques, on les conserve en override
              overrideExtensions: Array.isArray(exts) && exts.length > 0 ? exts : undefined
            });
          }
        }
        return {
          id: s.id,
          name: s.name,
          baseUrl: s.baseUrl,
          enabled: s.enabled,
          systems
          // extensions: supprimé
        };
      });

      // Per-système : passage du tableau d'extensions vers le modèle à cases à cocher
      const oldSysExt = (migratedSettings.downloadSystemExtensions || []) as any[];
      const newSysExt = oldSysExt.map((entry: any) => ({
        systemId: entry.systemId,
        useGlobalDefaults: true,
        useSystemCompressedFormats: true,
        useDatRawFormats: true,
        useExtraRawFormats: true,
        // Si l'utilisateur avait défini des extensions explicites, on les met en complémentaires
        additionalExtensions: Array.isArray(entry.extensions) ? entry.extensions : []
      }));

      // Reset downloadExtensions si l'utilisateur avait l'ancien défaut
      const oldDefault = ['7z', 'zip', 'chd', 'rar', 'iso', 'cso', 'pbp'];
      const current = migratedSettings.downloadExtensions || [];
      const isOldDefault =
        current.length === oldDefault.length &&
        current.every((e: string) => oldDefault.includes(e));
      const newDownloadExts = isOldDefault ? this.defaultSettings.downloadExtensions : current;

      migratedSettings = {
        ...migratedSettings,
        downloadSources: newSources,
        downloadSystemExtensions: newSysExt,
        downloadExtensions: newDownloadExts,
        settingsVersion: 10
      };
    }

    // Migration v10 -> v11 : ajout de useSystemCompressedFormats (par défaut true)
    if (version < 11) {
      console.log('Migration v10 -> v11: adding useSystemCompressedFormats');
      const existing = (migratedSettings.downloadSystemExtensions || []) as any[];
      const backfilled = existing.map((entry: any) => ({
        ...entry,
        useSystemCompressedFormats: entry.useSystemCompressedFormats ?? true
      }));
      migratedSettings = {
        ...migratedSettings,
        downloadSystemExtensions: backfilled,
        settingsVersion: 11
      };
    }

    // Migration v11 -> v12 : refonte vers le modèle "tags actifs + pool" (Phase 7)
    // Convertit les cases à cocher (useGlobalDefaults, useSystemCompressedFormats,
    // useDatRawFormats, useExtraRawFormats) + additionalExtensions vers une liste
    // ordonnée d'extensions actives avec leur source et leur flag isArchive.
    if (version < 12) {
      console.log('Migration v11 -> v12: reworking to the active tags + pool model');
      const oldEntries = (migratedSettings.downloadSystemExtensions || []) as any[];
      const globalDefaults = (migratedSettings.downloadExtensions || []) as string[];

      const newEntries = oldEntries.map((old: any) => {
        const sysDef = SYSTEMS.find(s => s.systemId === old.systemId);
        const active: DownloadExtensionEntry[] = [];

        const addCategory = (
          source: DownloadExtensionSource,
          exts: string[],
          enabled: boolean,
          isArchive: boolean
        ) => {
          if (!enabled) return;
          for (const e of exts) {
            const norm = (e || '').replace(/^\./, '').toLowerCase().trim();
            if (!norm) continue;
            if (!active.some(a => a.ext === norm)) {
              active.push({ ext: norm, source, isArchive });
            }
          }
        };

        addCategory('global', globalDefaults, old.useGlobalDefaults !== false, true);
        if (sysDef) {
          addCategory(
            'sysCompressed',
            [...sysDef.supportedFormats, ...sysDef.warningFormats],
            old.useSystemCompressedFormats !== false,
            true
          );
          addCategory('datRaw', sysDef.datRawFormats, old.useDatRawFormats !== false, false);
          addCategory('extraRaw', sysDef.extraRawFormats, old.useExtraRawFormats !== false, false);
        }
        // additionalExtensions → tags 'manual' archive=true par défaut
        for (const e of (old.additionalExtensions || []) as string[]) {
          const norm = (e || '').replace(/^\./, '').toLowerCase().trim();
          if (norm && !active.some(a => a.ext === norm)) {
            active.push({ ext: norm, source: 'manual', isArchive: true });
          }
        }

        return { systemId: old.systemId, activeExtensions: active };
      });

      // Convertir les override des sources : ancien overrideExtensions: string[] → override avec activeExtensions
      const sources = (migratedSettings.downloadSources || []) as any[];
      const newSources = sources.map((s: any) => ({
        ...s,
        systems: (s.systems || []).map((sysEntry: any) => {
          const override = sysEntry.overrideExtensions;
          if (Array.isArray(override) && override.length > 0) {
            const activeExtensions: DownloadExtensionEntry[] = override.map((e: string) => ({
              ext: (e || '').replace(/^\./, '').toLowerCase().trim(),
              source: 'manual' as DownloadExtensionSource,
              isArchive: true
            })).filter((e: DownloadExtensionEntry) => e.ext);
            return {
              systemId: sysEntry.systemId,
              subfolder: sysEntry.subfolder,
              override: { activeExtensions }
            };
          }
          return {
            systemId: sysEntry.systemId,
            subfolder: sysEntry.subfolder
            // pas d'override → résolution globale utilisée
          };
        })
      }));

      migratedSettings = {
        ...migratedSettings,
        downloadSystemExtensions: newEntries,
        downloadSources: newSources,
        settingsVersion: 12
      };
    }

    // Migration v12 -> v13 : suppression de removedFromPool (le pool ne peut plus
    // être masqué définitivement, on n'a donc plus besoin de cette liste)
    if (version < 13) {
      console.log('Migration v12 -> v13: removing removedFromPool');
      const sysExt = (migratedSettings.downloadSystemExtensions || []) as any[];
      const cleanedSysExt = sysExt.map((e: any) => {
        const { removedFromPool: _, ...rest } = e;
        return rest;
      });
      const sources = (migratedSettings.downloadSources || []) as any[];
      const cleanedSources = sources.map((s: any) => ({
        ...s,
        systems: (s.systems || []).map((sys: any) => {
          if (sys.override) {
            const { removedFromPool: _, ...overrideRest } = sys.override;
            return { ...sys, override: overrideRest };
          }
          return sys;
        })
      }));
      migratedSettings = {
        ...migratedSettings,
        downloadSystemExtensions: cleanedSysExt,
        downloadSources: cleanedSources,
        settingsVersion: 13
      };
    }

    // Migration v13 -> v14 : ajout du mode arcade cible (split par défaut)
    if (version < 14) {
      console.log('Migration v13 -> v14: adding arcadeTargetSetMode (default split)');
      migratedSettings = {
        ...migratedSettings,
        arcadeTargetSetMode: migratedSettings.arcadeTargetSetMode || this.defaultSettings.arcadeTargetSetMode,
        settingsVersion: 14
      };
    }

    // Migration v14 -> v15 : rangement BIOS / CHD en sous-dossiers (désactivé par défaut)
    if (version < 15) {
      console.log('Migration v14 -> v15: adding arcadeSeparateBios (default off)');
      migratedSettings = {
        ...migratedSettings,
        arcadeSeparateBios: migratedSettings.arcadeSeparateBios ?? false,
        settingsVersion: 15
      };
    }

    // Migration v15 -> v16 : zip vide pour les jeux CHD-only (désactivé par défaut)
    if (version < 16) {
      console.log('Migration v15 -> v16: adding arcadeChdEmptyZip (default off)');
      migratedSettings = {
        ...migratedSettings,
        arcadeChdEmptyZip: migratedSettings.arcadeChdEmptyZip ?? false,
        settingsVersion: 16
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
      console.warn('Invalid archiveFormatPriority, using default values');
      settings.archiveFormatPriority = this.defaultSettings.archiveFormatPriority;
    }
    
    // Vérifier qu'il n'y a pas de doublons
    const uniqueFormats = [...new Set(settings.archiveFormatPriority)];
    if (uniqueFormats.length !== settings.archiveFormatPriority.length) {
      console.warn('Duplicates detected in archiveFormatPriority, cleaning up...');
      settings.archiveFormatPriority = uniqueFormats as ArchiveFormat[];
    }
    
    // Vérifier que tous les formats sont valides
    const validFormats: ArchiveFormat[] = ['7z', 'zip', 'chd'];
    settings.archiveFormatPriority = settings.archiveFormatPriority.filter(
      format => validFormats.includes(format)
    ) as ArchiveFormat[];
    
    if (settings.archiveFormatPriority.length === 0) {
      console.warn('No valid format found, using default values');
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

      // ── Dédoublonnage + backfill de systemCompatibility ──
      // Un ancien bug produisait des doublons (chaque systemId présent 2×) qui
      // persistaient sur disque. Comme le rendu/save mémorisait "la dernière"
      // entrée, une entrée vide dupliquée écrasait les formats réels de MAME
      // (et d'autres), donnant l'impression d'une réinitialisation au restart.
      //
      // Règle de dédup : pour chaque systemId, on conserve l'entrée avec le PLUS
      // de supportedFormats (l'entrée vide dupliquée perd donc face à l'entrée
      // réelle). Puis on backfille les systèmes absents depuis le registre.
      const loadedCompat = this.settings.systemCompatibility ?? [];
      const bestById = new Map<string, SystemCompatibility>();
      for (const entry of loadedCompat) {
        const key = entry.systemId.toLowerCase();
        const existing = bestById.get(key);
        if (!existing || (entry.supportedFormats?.length ?? 0) > (existing.supportedFormats?.length ?? 0)) {
          bestById.set(key, entry);
        }
      }
      let backfilled = 0;
      for (const def of DEFAULT_SYSTEM_COMPATIBILITY) {
        if (!bestById.has(def.systemId.toLowerCase())) {
          bestById.set(def.systemId.toLowerCase(), def);
          backfilled++;
        }
      }
      const dedupedCompat = [...bestById.values()];
      const hadDuplicatesOrBackfill = dedupedCompat.length !== loadedCompat.length;
      this.settings.systemCompatibility = dedupedCompat;
      if (hadDuplicatesOrBackfill) {
        console.log(
          `systemCompatibility nettoyé : ${loadedCompat.length} → ${dedupedCompat.length} entrées ` +
          `(${loadedCompat.length - dedupedCompat.length + backfilled} doublon(s) retiré(s), ${backfilled} backfill).`
        );
      }

      // Sauvegarder si des migrations ont été appliquées OU si le dédoublonnage
      // a modifié systemCompatibility (pour nettoyer le disque définitivement).
      if (!loadedSettings.settingsVersion ||
          loadedSettings.settingsVersion < CURRENT_SETTINGS_VERSION ||
          hadDuplicatesOrBackfill) {
        console.log('Saving migrated/cleaned settings');
        await this.save();
      }
      
      // Créer les dossiers s'ils n'existent pas
      await this.ensureFoldersExist();
      
    } catch (error) {
      // Si le fichier n'existe pas, utiliser les paramètres par défaut
      console.log('Settings not found, using default values');
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
      
      console.log('Settings saved');
    } catch (error) {
      console.error('Error while saving settings:', error);
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
        console.error(`Error while creating the folder ${folder}:`, error);
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
