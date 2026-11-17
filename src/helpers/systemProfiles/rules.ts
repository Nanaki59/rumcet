// src/helpers/systemProfiles/rules.ts
//
// Helpers purs partagés par les profils système ET le moteur de consolidation.
// Déplacés depuis consolidateRoms.ts / matchRoms.ts (logique inchangée — parité)
// pour vivre dans un module neutre (pas de cycle d'import avec le moteur).

import path from 'path';
import type { ArchiveFormat } from '../settingsManager.js';
import { getSystemById } from '../../config/systems.js';
import type { AppSettings, HashTriplet, MatchedRomInfo } from './types.js';

/**
 * Formats d'archive autorisés pour un système :
 * 1. Surcharge utilisateur (systemCompatibility) — prioritaire, même si vide.
 * 2. Registre central src/config/systems.ts (supportedFormats).
 * 3. zip + 7z si système totalement inconnu.
 * Un tableau vide = aucun format supporté → conserver les fichiers bruts.
 */
export function getSystemAllowedFormats(
  systemId: string,
  settings: AppSettings
): ArchiveFormat[] {
  const userOverride = settings.systemCompatibility?.find(
    (sc: { systemId: string; supportedFormats: ArchiveFormat[] }) =>
      sc.systemId.toLowerCase() === systemId.toLowerCase()
  );
  if (userOverride) {
    return userOverride.supportedFormats;
  }

  const sys = getSystemById(systemId);
  if (sys) {
    return sys.supportedFormats;
  }

  return ['7z', 'zip'];
}

/**
 * Meilleur format d'archive pour un système en croisant les formats autorisés
 * avec la priorité utilisateur. `null` = aucun format autorisé → mode brut.
 */
export function determineTargetFormat(
  systemId: string,
  settings: AppSettings,
  chdPossible: boolean
): ArchiveFormat | null {
  const allowedFormats = getSystemAllowedFormats(systemId, settings);

  if (allowedFormats.length === 0) return null;

  for (const format of settings.archiveFormatPriority) {
    if (format === 'chd' && !chdPossible) continue;
    if (allowedFormats.includes(format)) {
      return format;
    }
  }

  for (const format of allowedFormats) {
    if (format === 'chd' && !chdPossible) continue;
    return format;
  }

  return null;
}

/** Formats cibles qu'un .m3u peut référencer (une archive 7z/zip n'est pas lisible par les cores). */
export const M3U_COMPATIBLE_FORMATS: readonly ArchiveFormat[] = ['chd'];

/** Le système accepte-t-il les .m3u (extensions du registre) ? */
export function systemAcceptsM3u(systemId: string): boolean {
  const sys = getSystemById(systemId);
  if (!sys) return false;
  return [...sys.datRawFormats, ...sys.extraRawFormats].some(ext => ext.toLowerCase() === 'm3u');
}

/**
 * Copie superficielle des paramètres où les formats autorisés du système sont
 * restreints aux formats compatibles .m3u. Liste vide → mode brut (fichiers à plat).
 * Le reste du moteur (format cible, copie directe, meilleure compression) suit sans
 * logique spécifique.
 */
export function withM3uCompatibleFormats<T extends AppSettings>(settings: T, systemId: string): T {
  const supportedFormats = getSystemAllowedFormats(systemId, settings)
    .filter(f => M3U_COMPATIBLE_FORMATS.includes(f));
  const sameSystem = (sc: { systemId: string }) => sc.systemId.toLowerCase() === systemId.toLowerCase();
  const current = settings.systemCompatibility ?? [];
  const existing = current.find(sameSystem);
  const sys = getSystemById(systemId);
  const restricted = existing
    ? { ...existing, supportedFormats }
    : { systemId, systemName: sys?.fullname ?? systemId, category: 'console' as const, supportedFormats };
  return {
    ...settings,
    systemCompatibility: [...current.filter(sc => !sameSystem(sc)), restricted]
  };
}

/**
 * Extensions acceptées comme point d'entrée pour chdman
 * (.bin seul n'est PAS suffisant — il faut un .cue, .gdi, .iso, etc.)
 */
export const CHD_ENTRY_EXTENSIONS = ['.cue', '.gdi', '.iso', '.toc', '.nrg', '.cdi', '.ccd'];

/** Trouve le fichier point d'entrée CHD parmi des chemins de fichiers. */
export function findChdEntryPoint(filePaths: string[]): string | null {
  return filePaths.find(f =>
    CHD_ENTRY_EXTENSIONS.includes(path.extname(f).toLowerCase())
  ) || null;
}

/** Les ROMs contiennent-elles un point d'entrée CHD valide (avant extraction) ? */
export function canConvertToChd(roms: MatchedRomInfo[]): boolean {
  return roms.some(rom => {
    const ext = path.extname(rom.datRomName).toLowerCase();
    return CHD_ENTRY_EXTENSIONS.includes(ext);
  });
}

/** Un disque CHD (<disk> MAME, is_disk=1) : copié tel quel, jamais extrait/ré-archivé. */
export function isChdDisk(rom: MatchedRomInfo): boolean {
  return !!rom.isDisk;
}

/**
 * Égalité de hash : au moins un des CRC32 / MD5 / SHA1 correspond (insensible à la
 * casse). Logique identique à l'ancien compareHashes de matchRoms.ts.
 */
export function hashesMatch(datRom: HashTriplet, file: HashTriplet): boolean {
  if (datRom.crc32 && file.crc32 && datRom.crc32.toUpperCase() === file.crc32.toUpperCase()) {
    return true;
  }
  if (datRom.md5 && file.md5 && datRom.md5.toUpperCase() === file.md5.toUpperCase()) {
    return true;
  }
  if (datRom.sha1 && file.sha1 && datRom.sha1.toUpperCase() === file.sha1.toUpperCase()) {
    return true;
  }
  return false;
}
