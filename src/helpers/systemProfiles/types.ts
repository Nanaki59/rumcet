// src/helpers/systemProfiles/types.ts
//
// Types partagés du système de "profils système". Un profil porte les règles de
// matching et de consolidation spécifiques à une FAMILLE de systèmes (arcade,
// disque optique, cartouche), à la manière des handlers de l'ArchiveManager.
// Ce fichier ne doit importer QUE des modules neutres (pas consolidateRoms ni
// matchRoms) pour éviter les dépendances circulaires : le moteur importe le
// profil, jamais l'inverse.

import type { ArcadeTargetSetMode, ArchiveFormat } from '../settingsManager.js';
import { settingsManager } from '../settingsManager.js';
import type { Database } from '../../database/init.js';
import type { DependencyResolution } from '../resolveDependencies.js';
import type { SystemProfileKind } from '../../config/systems.js';

/** Famille de règles d'un système (canonique dans src/config/systems.ts). */
export type { SystemProfileKind };

/** Comment un CHD est identifié au scan :
 *  - 'header'   : par le SHA1 de son en-tête (identité MAME <disk>), sans extraction.
 *  - 'contents' : par le hash des fichiers extraits (bin/cue/iso — romsets Redump). */
export type ChdIdentityMode = 'header' | 'contents';

/** Triplet de hash comparé lors du matching. */
export interface HashTriplet {
  crc32: string | null;
  md5: string | null;
  sha1: string | null;
}

/** Alias du type de settings (évite de dupliquer la longue signature). */
export type AppSettings = ReturnType<typeof settingsManager.getAll>;

/**
 * Une ROM du DAT matchée à une source physique, telle que consommée par le moteur
 * de consolidation. Déplacé ici (depuis consolidateRoms.ts) pour être partageable
 * par les profils sans cycle d'import.
 */
export interface MatchedRomInfo {
  datRomId: number;
  datRomName: string;
  datRomSize: number | null;
  datRomCrc32: string | null;
  datRomMd5: string | null;
  datRomSha1: string | null;
  /** Présent (non-null) si cette ROM est partagée avec le parent (merge="X") — vue split. */
  datRomMergeName: string | null;
  /** ID du game qui possède cette dat_rom dans le DAT (= game.id sauf clones foldés merged). */
  datRomOwnerGameId: number;
  datRomOwnerGameName: string;
  scannedFileId: number | null;
  scannedFilePath: string | null;
  scannedFileName: string | null;
  archiveContentId: number | null;
  archiveFileName: string | null;
  archivePath: string | null;
  archiveType: string | null;
  /** 1 si cette entrée est un <disk> MAME (CHD), copié tel quel et jamais ré-archivé. */
  isDisk: number | null;
}

/**
 * Contrat d'un profil système. La base (BaseSystemProfile) implémente tout de
 * façon générique ; chaque famille ne surcharge que ce qui diffère réellement.
 */
export interface SystemProfile {
  readonly kind: SystemProfileKind;

  // ── Identité / gating ──
  /** Le système porte les concepts arcade (set modes, cascade, merge_name, <disk>). */
  isArcade(): boolean;
  /** Mode d'identification des CHD au scan (voir ChdIdentityMode). */
  chdIdentity(): ChdIdentityMode;

  // ── Matching ──
  /** Deux triplets de hash correspondent-ils ? Défaut : égalité CRC/MD5/SHA1. */
  matchesHashes(datRom: HashTriplet, candidate: HashTriplet): boolean;

  // ── Consolidation : formats ──
  allowedFormats(systemId: string, settings: AppSettings): ArchiveFormat[];
  determineTargetFormat(systemId: string, settings: AppSettings, chdPossible: boolean): ArchiveFormat | null;

  // ── Consolidation : composition du set ──
  /** Filtre SQL additionnel sur dat_roms selon le mode cible (arcade split → merge_name IS NULL). */
  romsSqlCondition(targetMode: ArcadeTargetSetMode | null, alias?: string): string;
  /** Cascade de dépendances (parents/BIOS/devices arcade). null si non applicable. */
  resolveDependencies(db: Database, targetMode: ArcadeTargetSetMode): Promise<DependencyResolution | null>;
  /** Sépare les ROMs à archiver de celles copiées telles quelles (disques CHD arcade). */
  classifyRoms(roms: MatchedRomInfo[]): { archivable: MatchedRomInfo[]; copyAsIs: MatchedRomInfo[] };
  /** Le contenu peut-il être (re)construit en CHD ? (point d'entrée .cue/.gdi/.iso présent) */
  canProduceChd(roms: MatchedRomInfo[]): boolean;
  /** Trouve le fichier point d'entrée CHD parmi des fichiers extraits (chemins). */
  chdEntryPoint(files: string[]): string | null;
}
