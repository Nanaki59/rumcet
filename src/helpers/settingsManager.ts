// src/helpers/settingsManager.ts

import { app } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { SYSTEMS, getDefaultSystemCompatibility, getSystemById } from '../config/systems.js';
import {
  PROFILE_KEYS,
  BUILTIN_PROFILE_IDS,
  CUSTOM_PROFILE_ID,
  isProfileKey,
  splitProfileSettings,
  type ProfileKey,
  type BuiltinProfileId
} from '../shared/profileKeys.js';
import { applyCompatRule, compatEntryForRule, isCompatRule, type CompatRule } from '../shared/compatRules.js';

/**
 * Dossiers propres à une base, stockés dans sa table `metadata`. Une valeur
 * nulle/vide signifie « utiliser le paramètre global ».
 */
export interface DbFolderSettings {
  /** `target_folder_base` : dossier cible choisi pour cette base (avant sous-dossier système) */
  targetFolderBase: string | null;
  /** `target_folder` : dossier cible effectif (seule information des bases antérieures) */
  targetFolderLegacy: string | null;
  /** `target_system_subfolder` : sous-dossier système pour cette base (null = paramètre global) */
  systemSubfolder: boolean | null;
  /** `unmatched_folder` */
  unmatchedFolder: string | null;
  /** `incomplete_folder` */
  incompleteFolder: string | null;
  /** `temp_folder` */
  tempFolder: string | null;
}

export const EMPTY_DB_FOLDER_SETTINGS: DbFolderSettings = {
  targetFolderBase: null,
  targetFolderLegacy: null,
  systemSubfolder: null,
  unmatchedFolder: null,
  incompleteFolder: null,
  tempFolder: null
};

export type ArchiveFormat = '7z' | 'zip' | 'chd';
export type CompressionLevel = 'fastest' | 'normal' | 'maximum';
export type CleanupScope = 'used-only' | 'all-matched';
/** Archive en lecture seule (RAR) ne contenant plus que des fichiers inutiles + des non matchés. */
export type ReadOnlyArchiveUnmatchedMode = 'repack' | 'move';
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

// ─── Sélection 1G1R ────────────────────────────────────────────────
/**
 * Priorités d'arbitrage entre les variantes d'un même jeu.
 *
 * Les listes sont ORDONNÉES : la première valeur gagne. Une valeur absente d'une
 * liste n'est pas exclue, elle reçoit simplement le rang le plus bas — exclure
 * durement reste le rôle d'une règle d'auto-sélection (« région n'est pas Japan »),
 * ce qui évite de dupliquer un second mécanisme d'exclusion.
 */
export interface OneGameOneRomSettings {
  /** Interrupteur maître. FALSE par défaut : sans action de l'utilisateur, rien ne change. */
  enabled: boolean;
  /** Régions canoniques, de la plus souhaitée à la moins souhaitée. */
  regionPriority: string[];
  /** Codes langue No-Intro, de la plus souhaitée à la moins souhaitée. */
  languagePriority: string[];
  /**
   * Si true, la langue prime sur la région dans l'arbitrage. Utile quand on veut
   * « la version française d'où qu'elle vienne » plutôt que « la version Europe ».
   */
  languageOverRegion: boolean;
  /** Modes vidéo, du plus souhaité au moins souhaité. */
  videoPriority: string[];
  /** Préférer la révision la plus récente à qualité régionale égale. */
  preferLatestRevision: boolean;
  /**
   * Retomber sur une version effectivement possédée quand la version préférée est
   * absente de la collection. Évite un trou dans le set là où un fichier existe.
   * C'est ce que RUMCET peut faire et qu'un outil travaillant sur le seul DAT ne
   * peut pas : il ignore ce que contient réellement la collection.
   */
  fallbackToOwned: boolean;
}

// ─── Clone lists ───────────────────────────────────────────────────────────
/**
 * Listes de correspondance entre titres d'un même jeu portant des noms différents
 * selon la région (« Biohazard » / « Resident Evil »). Aucune heuristique ne peut
 * les deviner : c'est une donnée éditoriale curée à la main par la communauté.
 *
 * RUMCET les consomme sans les maintenir. L'URL est un réglage pour que le projet
 * ne dépende du sort d'aucun dépôt en particulier.
 */
export interface CloneListSettings {
  /** Base d'URL des fichiers JSON. Doit se terminer par un séparateur. */
  sourceUrl: string;
  /** Dossier local de dépôt. Vide = <userData>/clonelists. */
  folder?: string;
  /** Horodatage ISO de la dernière synchronisation réussie. */
  lastDownload?: string;
  /**
   * Synchroniser et appliquer automatiquement au chargement d'un DAT.
   *
   * Nécessaire parce qu'un chargement PRIMAIRE vide et réécrit la table des jeux :
   * la colonne `group_key` disparaît avec elle. Un chargement COMPLÉMENTAIRE ajoute
   * des jeux qui n'en ont pas encore.
   *
   * La synchronisation est conditionnelle (requête HTTP avec `If-None-Match`) : si
   * la liste distante n'a pas bougé, le serveur répond 304 et rien n'est
   * retéléchargé. Le coût par chargement de DAT est donc négligeable, ce qui permet
   * d'activer ce comportement par défaut sans peser sur la source.
   */
  autoUpdate: boolean;
  /**
   * ETag HTTP de la dernière version téléchargée, par nom de fichier.
   * C'est ce qui rend la vérification de mise à jour quasi gratuite.
   */
  etags?: Record<string, string>;
}

export const DEFAULT_CLONE_LISTS: CloneListSettings = {
  // Dépôt d'origine (BSD-3-Clause). Son application n'est plus maintenue, mais les
  // données continuent d'être mises à jour ; un fork peut être substitué ici.
  sourceUrl: 'https://raw.githubusercontent.com/unexpectedpanda/retool-clonelists-metadata/main/clonelists/',
  folder: '',
  autoUpdate: true,
  etags: {}
};

/**
 * Priorités par défaut. Volontairement neutres et non vides : une liste vide
 * rendrait l'arbitrage arbitraire dès la première utilisation. L'ordre retenu
 * privilégie les versions les plus largement diffusées et anglophones, que
 * l'utilisateur réordonne ensuite selon sa collection.
 */
export const DEFAULT_ONE_GAME_ONE_ROM: OneGameOneRomSettings = {
  enabled: false,
  regionPriority: ['World', 'Europe', 'USA', 'Japan'],
  languagePriority: ['En', 'Fr', 'Ja'],
  languageOverRegion: false,
  videoPriority: ['PAL', 'PAL 60Hz', 'NTSC'],
  preferLatestRevision: true,
  fallbackToOwned: true
};

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
  /** Déplacer les fichiers non matchés vers le dossier dédié (si le nettoyage est activé) */
  moveUnmatchedFiles: boolean;
  /** RAR : recompresser les non matchés en 7z (`repack`) ou déplacer l'archive entière (`move`) */
  unmatchedInReadOnlyArchives: ReadOnlyArchiveUnmatchedMode;

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
   * Crée un fichier `.m3u` pour chaque jeu multi-disques / multi-supports consolidé
   * (« (Disc N) », « (Disk N of M) »…), à côté des disques, sur les systèmes qui
   * acceptent le `.m3u`. Les disques de ces jeux ne sont alors jamais archivés en
   * 7z/zip/rar (incompatibles avec le .m3u) : CHD/ISO/CSO si autorisés, sinon bruts.
   */
  generateM3u?: boolean;

  /**
   * Modèles de règles d'auto-sélection enregistrés « par défaut », indexés par type
   * de DAT (clé « sys:<systemId> », repli « arcade » / « generic »). Permet de
   * réappliquer rapidement le même jeu de règles à une nouvelle base du même type.
   */
  defaultSelectionRules?: Record<string, {
    base: string;
    rules: any[];
    /** Réglages 1G1R du modèle. Absent sur un modèle enregistré avant leur arrivée. */
    oneGameOneRom?: OneGameOneRomSettings;
  }>;

  /**
   * Presets d'auto-sélection personnalisés (créés par l'utilisateur), globaux et
   * disponibles pour tous les DAT. Chaque preset porte un scope (arcade / no-intro /
   * redump / nointro-redump / other / global) qui pilote sa visibilité selon la famille de DAT.
   * Miroir per-base stocké dans la metadata 'custom_selection_presets'.
   */
  customSelectionPresets?: Array<{ id: string; name: string; scope: string; rules: any[] }>;

  /**
   * Sélection 1G1R (« 1 game, 1 rom ») : ne conserver qu'une version par jeu, en
   * arbitrant les variantes régionales selon des priorités.
   *
   * STRICTEMENT OPT-IN. `enabled` vaut false par défaut et rien dans l'application
   * ne doit l'activer implicitement : ni un preset de règles, ni le chargement d'une
   * clone list, ni la détection d'un système. Tant qu'il est désactivé, le
   * comportement doit être rigoureusement identique à celui d'avant la fonction.
   */
  oneGameOneRom?: OneGameOneRomSettings;

  /**
   * Clone lists : source, dépôt local et réapplication automatique.
   * Sans effet tant qu'aucune liste n'a été téléchargée puis appliquée.
   */
  cloneLists?: CloneListSettings;

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
  /** Version de chdman : 'latest' (la plus récente), 'default' (embarquée), 'manual' (chdmanPath) ou un tag téléchargé (ex. mame0289) */
  chdmanVersion?: string;
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

  /**
   * Profils de consolidation. Les clés de PROFILE_KEYS ne sont PAS stockées au
   * premier niveau : elles vivent dans `profiles[].settings`. getAll() fusionne
   * les paramètres globaux avec ceux du profil courant (`activeProfileId`), de
   * sorte que le reste du code lit `settings.archiveFormatPriority` etc. sans
   * connaître les profils.
   */
  profiles?: ConsolidationProfile[];
  activeProfileId?: string;

  settingsVersion?: number;
}

/** Paramètres portés par un profil de consolidation. */
export type ProfileSettings = Pick<AppSettings, ProfileKey>;

export interface ConsolidationProfile {
  /** 'universal' | 'recalbox' | 'master' (intégrés), 'custom' ou uuid. */
  id: string;
  /** Nom saisi par l'utilisateur. Vide = nom traduit d'après l'id (profils intégrés, « Mon profil »). */
  name: string;
  /** Profil intégré : modifiable et réinitialisable, mais ni supprimable ni renommable. */
  builtin: boolean;
  /**
   * Dernière règle de base appliquée à la compatibilité par système. Sert aux
   * mises à jour Recalbox pour recalculer les systèmes acceptés ; null = universal.
   */
  compatRule: CompatRule | null;
  settings: ProfileSettings;
}

/** Règle et options propres à chaque profil intégré. */
const BUILTIN_PROFILE_DEFS: Record<BuiltinProfileId, { compatRule: CompatRule; useBestCompression: boolean; generateM3u: boolean }> = {
  universal: { compatRule: 'universal', useBestCompression: false, generateM3u: false },
  recalbox: { compatRule: 'recalbox', useBestCompression: false, generateM3u: true },
  master: { compatRule: 'master', useBestCompression: true, generateM3u: false }
};

function isBuiltinProfileId(id: string): id is BuiltinProfileId {
  return (BUILTIN_PROFILE_IDS as readonly string[]).includes(id);
}

/** Retire les clés de profil d'un objet de paramètres (stockage du premier niveau). */
function stripProfileKeys<T extends Record<string, any>>(settings: T): T {
  return splitProfileSettings(settings).global as T;
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

const CURRENT_SETTINGS_VERSION = 23;

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
      moveUnmatchedFiles: true,
      unmatchedInReadOnlyArchives: 'repack',

      autoSelectNewGames: true,
      arcadeTargetSetMode: 'split',
      arcadeSeparateBios: false,
      arcadeChdEmptyZip: false,
      generateM3u: false,

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
      chdmanVersion: 'latest',
      rarToolPriority: ['7zip', 'winrar', 'unrar'],

      // Compatibilité archives par système
      // Recalculé dans load() une fois la surcharge Recalbox appliquée
      systemCompatibility: getDefaultSystemCompatibility(),

      // Sélection 1G1R — désactivée par défaut (voir OneGameOneRomSettings)
      oneGameOneRom: { ...DEFAULT_ONE_GAME_ONE_ROM },

      // Clone lists — aucune liste téléchargée tant que l'utilisateur ne le demande pas
      cloneLists: { ...DEFAULT_CLONE_LISTS },

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

    this.settings = this.buildStoredDefaults();
  }

  // ─── Profils de consolidation : construction ───

  /** Valeurs par défaut des paramètres de profil (copie indépendante). */
  private defaultProfileSettings(): ProfileSettings {
    const values: Record<string, any> = {};
    for (const key of PROFILE_KEYS) values[key] = structuredClone(this.defaultSettings[key]);
    values.systemCompatibility = getDefaultSystemCompatibility();
    return values as ProfileSettings;
  }

  /** Profil intégré construit à partir de paramètres de base, avec sa règle appliquée. */
  private buildBuiltinProfile(id: BuiltinProfileId, base: ProfileSettings): ConsolidationProfile {
    const def = BUILTIN_PROFILE_DEFS[id];
    return {
      id,
      name: '',
      builtin: true,
      compatRule: def.compatRule,
      settings: {
        ...structuredClone(base),
        useBestCompression: def.useBestCompression,
        generateM3u: def.generateM3u,
        systemCompatibility: applyCompatRule(def.compatRule)
      }
    };
  }

  /** « Mon profil » (réglages de base) + les profils intégrés dérivés de ces réglages. */
  private buildProfiles(base: ProfileSettings): ConsolidationProfile[] {
    return [
      { id: CUSTOM_PROFILE_ID, name: '', builtin: false, compatRule: null, settings: structuredClone(base) },
      ...BUILTIN_PROFILE_IDS.map(id => this.buildBuiltinProfile(id, base))
    ];
  }

  /** Paramètres stockés par défaut : globaux + profils, sans clé de profil au premier niveau. */
  private buildStoredDefaults(): AppSettings {
    return {
      ...stripProfileKeys(structuredClone(this.defaultSettings)),
      profiles: this.buildProfiles(this.defaultProfileSettings()),
      activeProfileId: CUSTOM_PROFILE_ID
    };
  }

  /** Profil courant (toujours défini après load/validation). */
  private activeProfile(): ConsolidationProfile {
    const profiles = this.settings.profiles ?? [];
    return profiles.find(p => p.id === this.settings.activeProfileId) ?? profiles[0];
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

    // Migration v16 -> v17 : sélection 1G1R (désactivée par défaut).
    // On ne fusionne PAS partiellement un objet existant : si la clé est absente on
    // pose le défaut complet, sinon on complète uniquement les champs manquants, en
    // préservant systématiquement le `enabled` déjà choisi par l'utilisateur.
    if (version < 17) {
      console.log('Migration v16 -> v17: adding oneGameOneRom (default off)');
      const existing = migratedSettings.oneGameOneRom;
      migratedSettings = {
        ...migratedSettings,
        oneGameOneRom: existing
          ? { ...DEFAULT_ONE_GAME_ONE_ROM, ...existing }
          : { ...DEFAULT_ONE_GAME_ONE_ROM },
        settingsVersion: 17
      };
    }

    // Migration v17 -> v18 : clone lists (aucune liste téléchargée par défaut).
    // Le champ `sourceUrl` d'une installation existante est préservé : c'est
    // précisément le réglage qui permet de basculer vers un autre dépôt.
    if (version < 18) {
      console.log('Migration v17 -> v18: adding cloneLists (nothing downloaded by default)');
      const existing = migratedSettings.cloneLists;
      migratedSettings = {
        ...migratedSettings,
        cloneLists: existing
          ? { ...DEFAULT_CLONE_LISTS, ...existing }
          : { ...DEFAULT_CLONE_LISTS },
        settingsVersion: 18
      };
    }

    // Migration v18 -> v19 : les deux réglages de clone list (« réappliquer » et
    // « télécharger si absent ») sont remplacés par un seul, qui synchronise ET
    // applique. La vérification de mise à jour passant par une requête
    // conditionnelle, elle est assez peu coûteuse pour être active par défaut.
    if (version < 19) {
      console.log('Migration v18 -> v19: cloneLists autoApply/autoDownload -> autoUpdate');
      const previous = migratedSettings.cloneLists as Record<string, unknown> | undefined;
      // Quiconque avait activé l'un des deux anciens réglages voulait de
      // l'automatisme : on le conserve. Les autres reçoivent le nouveau défaut.
      const hadAutomation = previous?.autoApply === true || previous?.autoDownload === true;
      const carried = { ...(previous ?? {}) };
      delete carried.autoApply;
      delete carried.autoDownload;
      migratedSettings = {
        ...migratedSettings,
        cloneLists: {
          ...DEFAULT_CLONE_LISTS,
          ...carried,
          autoUpdate: previous ? hadAutomation || DEFAULT_CLONE_LISTS.autoUpdate : DEFAULT_CLONE_LISTS.autoUpdate
        },
        settingsVersion: 19
      };
    }

    // Migration v19 -> v20 : suppression de la case « utiliser chdman embarqué ».
    // Un chemin vide signifie désormais « version embarquée » (même logique que
    // 7-Zip). Quand la case était cochée, le chemin personnalisé était ignoré :
    // on le vide pour conserver le chdman réellement utilisé jusqu'ici.
    if (version < 20) {
      console.log('Migration v19 -> v20: removing useEmbeddedChdman (empty chdmanPath = embedded)');
      if (migratedSettings.useEmbeddedChdman !== false) {
        migratedSettings.chdmanPath = '';
      }
      delete migratedSettings.useEmbeddedChdman;
      migratedSettings = {
        ...migratedSettings,
        settingsVersion: 20
      };
    }

    // Migration v20 -> v21 : profils de consolidation. Les réglages de consolidation
    // actuels deviennent « Mon profil » (profil courant, comportement inchangé) ; les
    // profils intégrés sont créés à partir de ces mêmes réglages, avec leur règle de
    // compatibilité appliquée. Les clés de profil quittent le premier niveau.
    if (version < 21) {
      console.log('Migration v20 -> v21: moving consolidation settings into profiles');
      const base: Record<string, any> = this.defaultProfileSettings();
      for (const key of PROFILE_KEYS) {
        if (migratedSettings[key] !== undefined) base[key] = structuredClone(migratedSettings[key]);
      }
      migratedSettings = {
        ...stripProfileKeys(migratedSettings),
        profiles: this.buildProfiles(base as ProfileSettings),
        activeProfileId: CUSTOM_PROFILE_ID,
        settingsVersion: 21
      };
    }

    // Migration v21 -> v22 : le chemin de chdman n'est utilisé qu'en « Sélection
    // manuelle » (chdmanVersion = 'manual'). Un chemin déjà renseigné reste utilisé.
    if (version < 22) {
      console.log('Migration v21 -> v22: chdmanPath only used with chdmanVersion = manual');
      if (migratedSettings.chdmanPath) {
        migratedSettings.chdmanVersion = 'manual';
      }
      migratedSettings = {
        ...migratedSettings,
        settingsVersion: 22
      };
    }

    // Migration v22 -> v23 : création des .m3u multi-disques. Activée par défaut
    // dans le profil intégré Recalbox ; les autres profils la reçoivent désactivée
    // (complétion par défaut dans validateProfiles).
    if (version < 23) {
      console.log('Migration v22 -> v23: adding generateM3u (on for the Recalbox profile)');
      for (const profile of Array.isArray(migratedSettings.profiles) ? migratedSettings.profiles : []) {
        if (profile?.id === 'recalbox' && profile.settings && profile.settings.generateM3u === undefined) {
          profile.settings.generateM3u = true;
        }
      }
      migratedSettings = {
        ...migratedSettings,
        settingsVersion: 23
      };
    }

    return migratedSettings as AppSettings;
  }

  /**
   * Valide les paramètres chargés
   */
  private validateSettings(settings: AppSettings): boolean {
    this.validateProfiles(settings);

    // ── Clone lists ──
    // Une URL vide ou non http(s) empêcherait tout téléchargement en silence.
    if (settings.cloneLists) {
      const cl = settings.cloneLists;
      const url = typeof cl.sourceUrl === 'string' ? cl.sourceUrl.trim() : '';
      cl.sourceUrl = /^https?:\/\//i.test(url) ? url : DEFAULT_CLONE_LISTS.sourceUrl;
      // La concaténation avec le nom de fichier suppose un séparateur final.
      if (!cl.sourceUrl.endsWith('/')) cl.sourceUrl += '/';
      cl.autoUpdate = cl.autoUpdate !== false;
      // Un cache d'ETag corrompu ferait échouer chaque requête conditionnelle.
      if (typeof cl.etags !== 'object' || cl.etags === null || Array.isArray(cl.etags)) {
        cl.etags = {};
      }
    } else {
      settings.cloneLists = { ...DEFAULT_CLONE_LISTS };
    }

    return true;
  }

  /**
   * Valide la liste des profils : ids uniques, profils intégrés présents, profil
   * courant existant, paramètres de chaque profil complets et cohérents.
   */
  private validateProfiles(settings: AppSettings): void {
    const seen = new Set<string>();
    const profiles: ConsolidationProfile[] = [];
    for (const raw of Array.isArray(settings.profiles) ? settings.profiles : []) {
      if (!raw || typeof raw.id !== 'string' || !raw.id || seen.has(raw.id)) continue;
      seen.add(raw.id);
      const profile: ConsolidationProfile = {
        id: raw.id,
        name: typeof raw.name === 'string' ? raw.name : '',
        builtin: isBuiltinProfileId(raw.id),
        compatRule: isCompatRule(raw.compatRule) ? raw.compatRule : null,
        settings: { ...this.defaultProfileSettings(), ...(raw.settings ?? {}) }
      };
      if (profile.builtin) profile.name = '';
      this.validateProfileSettings(profile.settings);
      profiles.push(profile);
    }

    // Un profil intégré manquant (fichier édité à la main) est recréé avec ses valeurs par défaut
    for (const id of BUILTIN_PROFILE_IDS) {
      if (!seen.has(id)) profiles.push(this.buildBuiltinProfile(id, this.defaultProfileSettings()));
    }

    settings.profiles = profiles;
    if (!profiles.some(p => p.id === settings.activeProfileId)) {
      settings.activeProfileId = profiles.find(p => p.id === CUSTOM_PROFILE_ID)?.id ?? profiles[0].id;
    }
  }

  /** Valide les paramètres d'un profil (priorité des formats, 1G1R). */
  private validateProfileSettings(settings: ProfileSettings): void {
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

    // ── Sélection 1G1R ──
    // Une liste de priorité corrompue (doublons, valeurs non textuelles) rendrait
    // l'arbitrage non déterministe sans qu'aucune erreur ne remonte : on nettoie
    // plutôt que de faire confiance au fichier.
    if (settings.oneGameOneRom) {
      const ogor = settings.oneGameOneRom;
      const cleanList = (list: unknown, fallback: string[]): string[] => {
        if (!Array.isArray(list)) return [...fallback];
        const cleaned = [...new Set(
          list.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
              .map(v => v.trim())
        )];
        // Une liste vidée par le nettoyage est acceptée telle quelle : l'utilisateur
        // a le droit de ne pas vouloir arbitrer sur ce critère.
        return cleaned;
      };
      ogor.regionPriority = cleanList(ogor.regionPriority, DEFAULT_ONE_GAME_ONE_ROM.regionPriority);
      ogor.languagePriority = cleanList(ogor.languagePriority, DEFAULT_ONE_GAME_ONE_ROM.languagePriority);
      ogor.videoPriority = cleanList(ogor.videoPriority, DEFAULT_ONE_GAME_ONE_ROM.videoPriority);
      ogor.enabled = ogor.enabled === true;
      ogor.languageOverRegion = ogor.languageOverRegion === true;
      ogor.preferLatestRevision = ogor.preferLatestRevision !== false;
      ogor.fallbackToOwned = ogor.fallbackToOwned !== false;
    } else {
      settings.oneGameOneRom = { ...DEFAULT_ONE_GAME_ONE_ROM };
    }
  }

  /**
   * Dédoublonne et complète la compatibilité par système d'un profil.
   *
   * Un ancien bug produisait des doublons (chaque systemId présent 2×) qui
   * persistaient sur disque. Comme le rendu/save mémorisait "la dernière"
   * entrée, une entrée vide dupliquée écrasait les formats réels de MAME
   * (et d'autres), donnant l'impression d'une réinitialisation au restart.
   *
   * Règle de dédup : pour chaque systemId, on conserve l'entrée avec le PLUS
   * de supportedFormats (l'entrée vide dupliquée perd donc face à l'entrée
   * réelle). Puis on complète les systèmes absents selon la règle du profil.
   * Retourne true si la liste a changé.
   */
  private normalizeProfileCompat(profile: ConsolidationProfile): boolean {
    const loadedCompat = profile.settings.systemCompatibility ?? [];
    const bestById = new Map<string, SystemCompatibility>();
    for (const entry of loadedCompat) {
      const key = entry.systemId.toLowerCase();
      const existing = bestById.get(key);
      if (!existing || (entry.supportedFormats?.length ?? 0) > (existing.supportedFormats?.length ?? 0)) {
        bestById.set(key, entry);
      }
    }
    let backfilled = 0;
    for (const sys of SYSTEMS) {
      if (!bestById.has(sys.systemId.toLowerCase())) {
        bestById.set(sys.systemId.toLowerCase(), compatEntryForRule(sys, profile.compatRule ?? 'universal'));
        backfilled++;
      }
    }
    const dedupedCompat = [...bestById.values()];
    const changed = dedupedCompat.length !== loadedCompat.length;
    profile.settings.systemCompatibility = dedupedCompat;
    if (changed) {
      console.log(
        `systemCompatibility nettoyé (profil ${profile.id}) : ${loadedCompat.length} → ${dedupedCompat.length} entrées ` +
        `(${loadedCompat.length - dedupedCompat.length + backfilled} doublon(s) retiré(s), ${backfilled} backfill).`
      );
    }
    return changed;
  }

  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.settingsPath, 'utf8');
      const loadedSettings = JSON.parse(data);
      
      // Migrer si nécessaire
      const migratedSettings = this.migrateSettings(loadedSettings);
      
      // Fusionner avec les paramètres par défaut pour gérer les nouvelles clés.
      // Les clés de profil restent hors du premier niveau (elles vivent dans les profils).
      this.settings = stripProfileKeys({ ...this.buildStoredDefaults(), ...migratedSettings });

      // Valider (profils compris)
      this.validateSettings(this.settings);

      // Dédoublonnage + backfill de la compatibilité de chaque profil
      let compatChanged = false;
      for (const profile of this.settings.profiles!) {
        if (this.normalizeProfileCompat(profile)) compatChanged = true;
      }

      // Sauvegarder si des migrations ont été appliquées OU si le dédoublonnage
      // a modifié une compatibilité (pour nettoyer le disque définitivement).
      if (!loadedSettings.settingsVersion ||
          loadedSettings.settingsVersion < CURRENT_SETTINGS_VERSION ||
          compatChanged) {
        console.log('Saving migrated/cleaned settings');
        await this.save();
      }
      
      // Créer les dossiers s'ils n'existent pas
      await this.ensureFoldersExist();
      
    } catch (error) {
      // Si le fichier n'existe pas, utiliser les paramètres par défaut
      console.log('Settings not found, using default values');
      this.settings = this.buildStoredDefaults();
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

  /** Lit un paramètre : une clé de profil est lue dans le profil courant. */
  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    if (isProfileKey(key)) return (this.activeProfile().settings as AppSettings)[key];
    return this.settings[key];
  }

  /** Écrit un paramètre en mémoire : une clé de profil est écrite dans le profil courant. */
  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    const target = isProfileKey(key) ? this.activeProfile().settings : this.settings;
    (target as AppSettings)[key] = value;
  }

  /** Vue fusionnée : paramètres globaux + paramètres du profil courant. */
  getAll(): AppSettings {
    return { ...this.settings, ...structuredClone(this.activeProfile().settings) };
  }

  /**
   * Met à jour des paramètres. Les clés globales vont au premier niveau, les clés
   * de profil dans le profil courant.
   */
  async updateSettings(newSettings: Partial<AppSettings>): Promise<void> {
    const { global, profile } = splitProfileSettings(newSettings);
    // Les profils se modifient par replaceProfiles / setActiveProfile, pas par cette voie
    delete global.profiles;
    delete global.activeProfileId;

    this.settings = { ...this.settings, ...global };
    const active = this.activeProfile();
    active.settings = { ...active.settings, ...profile };

    // Valider après mise à jour
    this.validateSettings(this.settings);

    await this.save();
  }

  reset(): void {
    this.settings = this.buildStoredDefaults();
  }

  // ─── Profils de consolidation : API ───

  /** Profils (copies) et identifiant du profil courant. */
  listProfiles(): { profiles: ConsolidationProfile[]; activeProfileId: string } {
    return {
      profiles: structuredClone(this.settings.profiles ?? []),
      activeProfileId: this.activeProfile().id
    };
  }

  getActiveProfileId(): string {
    return this.activeProfile().id;
  }

  /** Change le profil courant. Retourne false si l'id est inconnu. */
  async setActiveProfile(id: string): Promise<boolean> {
    if (!(this.settings.profiles ?? []).some(p => p.id === id)) return false;
    this.settings.activeProfileId = id;
    await this.save();
    return true;
  }

  /**
   * Remplace l'ensemble des profils (fenêtre des paramètres : créations, renommages,
   * suppressions et modifications enregistrés en une fois). Les profils intégrés ne
   * peuvent pas disparaître ; si le profil courant a été supprimé, on revient à
   * « Mon profil » ou au premier profil.
   */
  async replaceProfiles(profiles: ConsolidationProfile[]): Promise<void> {
    this.settings.profiles = structuredClone(profiles);
    this.validateSettings(this.settings);
    for (const profile of this.settings.profiles) this.normalizeProfileCompat(profile);
    await this.save();
  }

  /** Valeurs par défaut d'un profil intégré (bouton « Réinitialiser »). */
  getBuiltinProfileDefaults(id: string): ConsolidationProfile | null {
    return isBuiltinProfileId(id) ? this.buildBuiltinProfile(id, this.defaultProfileSettings()) : null;
  }

  /**
   * Mise à jour Recalbox : les systèmes acceptés reprennent, dans chaque profil,
   * les formats donnés par la dernière règle appliquée au profil (universal à défaut).
   */
  async applySystemsUpdateToProfiles(systemIds: string[]): Promise<void> {
    for (const profile of this.settings.profiles ?? []) {
      const compat = [...(profile.settings.systemCompatibility ?? [])];
      for (const id of systemIds) {
        const sys = getSystemById(id);
        if (!sys) continue;
        const entry = compatEntryForRule(sys, profile.compatRule ?? 'universal');
        const index = compat.findIndex(c => c.systemId.toLowerCase() === id.toLowerCase());
        if (index >= 0) compat[index] = entry;
        else compat.push(entry);
      }
      profile.settings.systemCompatibility = compat;
    }
    await this.save();
  }

  /**
   * ⭐ NOUVELLE MÉTHODE : Obtenir le premier format compatible
   * @param compatibleFormats Liste des formats compatibles pour le système
   * @returns Le premier format de la priorité qui est compatible
   */
  getPreferredFormat(compatibleFormats: ArchiveFormat[]): ArchiveFormat | null {
    for (const format of this.get('archiveFormatPriority')) {
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

  // ─── Dossiers propres à la base ouverte (métadonnées) ───
  // Copie en mémoire pour les composants synchrones (getEffectiveFolderSync) ;
  // alimentée à l'ouverture/fermeture de la base et à chaque modification.
  private activeDbFolders: DbFolderSettings = { ...EMPTY_DB_FOLDER_SETTINGS };

  setActiveDbFolders(folders: DbFolderSettings | null): void {
    this.activeDbFolders = folders ? { ...folders } : { ...EMPTY_DB_FOLDER_SETTINGS };
  }

  getActiveDbFolders(): DbFolderSettings {
    return { ...this.activeDbFolders };
  }

  /**
   * Variante synchrone : surcharges de la base ouverte + sous-dossier système
   * (option de la base, sinon paramètre global "Dossier multi-système").
   * Ne crée pas le dossier ; l'appelant doit appeler fs.mkdir si besoin.
   */
  getEffectiveFolderSync(key: EffectiveFolderKey): string {
    return resolveEffectiveFolder(key, this.activeDbFolders, this.activeSystemId);
  }
}

// Instance singleton
export const settingsManager = new SettingsManager();

// ─── Dossiers par base ───

export type EffectiveFolderKey = 'validatedRomsFolder' | 'unmatchedRomsFolder' | 'incompleteRomsFolder' | 'tempExtractionFolder';

/** Métadonnées qui influent sur les dossiers effectifs de la base. */
export const DB_FOLDER_METADATA_KEYS = [
  'target_folder_base',
  'target_folder',
  'target_system_subfolder',
  'unmatched_folder',
  'incomplete_folder',
  'temp_folder',
  'system_id'
];

type MetadataReader = { get<T = any>(sql: string, params?: any[]): Promise<T | undefined> };

async function readMetadata(db: MetadataReader, key: string): Promise<string | null> {
  try {
    const row = await db.get<{ value: string }>('SELECT value FROM metadata WHERE key = ?', [key]);
    return row?.value || null;
  } catch {
    return null;
  }
}

/** Lit les dossiers propres à une base depuis ses métadonnées. */
export async function loadDbFolderSettings(db: MetadataReader): Promise<DbFolderSettings> {
  const subfolder = await readMetadata(db, 'target_system_subfolder');
  return {
    targetFolderBase: await readMetadata(db, 'target_folder_base'),
    targetFolderLegacy: await readMetadata(db, 'target_folder'),
    systemSubfolder: subfolder === null ? null : subfolder === '1',
    unmatchedFolder: await readMetadata(db, 'unmatched_folder'),
    incompleteFolder: await readMetadata(db, 'incomplete_folder'),
    tempFolder: await readMetadata(db, 'temp_folder')
  };
}

/** Recharge la copie en mémoire des dossiers de la base (null = aucune base ouverte). */
export async function refreshActiveDbFolders(db: MetadataReader | null): Promise<void> {
  settingsManager.setActiveDbFolders(db ? await loadDbFolderSettings(db) : null);
}

/**
 * Résout un dossier effectif à partir des dossiers de la base et des paramètres globaux.
 * - Dossier cible : `target_folder_base` (+ sous-dossier système) ; sinon `target_folder`
 *   tel quel (bases antérieures, déjà effectif) ; sinon paramètre global.
 * - Autres dossiers : surcharge de la base, sinon paramètre global, + sous-dossier système.
 * Le sous-dossier système suit l'option de la base si elle est définie, sinon le
 * paramètre global « Dossier multi-système ».
 */
export function resolveEffectiveFolder(
  key: EffectiveFolderKey,
  dbFolders: DbFolderSettings,
  systemId: string | null
): string {
  const settings = settingsManager.getAll();
  const useSystemSubfolder = dbFolders.systemSubfolder ?? !!settings.validatedRomsMultiSystem;
  const withSystem = (base: string) =>
    base && useSystemSubfolder && systemId ? path.join(base, systemId) : base;

  switch (key) {
    case 'validatedRomsFolder':
      if (dbFolders.targetFolderBase) return withSystem(dbFolders.targetFolderBase);
      if (dbFolders.targetFolderLegacy) return dbFolders.targetFolderLegacy;
      return withSystem(settings.validatedRomsFolder || '');
    case 'unmatchedRomsFolder':
      return withSystem(dbFolders.unmatchedFolder || settings.unmatchedRomsFolder || '');
    case 'incompleteRomsFolder':
      return withSystem(dbFolders.incompleteFolder || settings.incompleteRomsFolder || '');
    case 'tempExtractionFolder':
      return withSystem(dbFolders.tempFolder || settings.tempExtractionFolder || '');
  }
}

/**
 * Dossier effectif lu directement dans la base (toujours à jour). Crée le
 * sous-dossier système quand il s'applique.
 */
async function getEffectiveDbFolder(db: MetadataReader, key: EffectiveFolderKey): Promise<string> {
  const dbFolders = await loadDbFolderSettings(db);
  const folder = resolveEffectiveFolder(key, dbFolders, await readMetadata(db, 'system_id'));
  if (folder && folder !== resolveEffectiveFolder(key, dbFolders, null)) {
    await fs.mkdir(folder, { recursive: true });
  }
  return folder;
}

/** Dossier cible des ROMs validées (destination de la consolidation). */
export async function getEffectiveValidatedRomsFolder(db: MetadataReader): Promise<string> {
  return getEffectiveDbFolder(db, 'validatedRomsFolder');
}

/** Dossier des ROMs incomplètes. */
export async function getEffectiveIncompleteRomsFolder(db: MetadataReader): Promise<string> {
  return getEffectiveDbFolder(db, 'incompleteRomsFolder');
}

/** Dossier des ROMs non référencées. */
export async function getEffectiveUnmatchedRomsFolder(db: MetadataReader): Promise<string> {
  return getEffectiveDbFolder(db, 'unmatchedRomsFolder');
}

/** Dossier temporaire d'extraction. */
export async function getEffectiveTempExtractionFolder(db: MetadataReader): Promise<string> {
  return getEffectiveDbFolder(db, 'tempExtractionFolder');
}
