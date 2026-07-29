// src/helpers/systemProfiles/BaseSystemProfile.ts
//
// Profil générique = comportement "cartouche / par défaut" (No-Intro et la plupart
// des systèmes). Les familles Arcade / OpticalDisc en héritent et ne surchargent
// que ce qui diffère réellement.

import type { Database } from '../../database/init.js';
import type { ArcadeTargetSetMode, ArchiveFormat } from '../settingsManager.js';
import type { DependencyResolution } from '../resolveDependencies.js';
import type {
  SystemProfile, SystemProfileKind, ChdIdentityMode,
  HashTriplet, MatchedRomInfo, AppSettings
} from './types.js';
import {
  getSystemAllowedFormats, determineTargetFormat,
  findChdEntryPoint, canConvertToChd, isChdDisk, hashesMatch
} from './rules.js';

export class BaseSystemProfile implements SystemProfile {
  readonly kind: SystemProfileKind = 'cartridge';

  isArcade(): boolean {
    return false;
  }

  chdIdentity(): ChdIdentityMode {
    // Par défaut (non arcade) : un CHD est identifié par le hash de son contenu
    // extrait (bin/cue/iso) — pertinent pour les romsets Redump.
    return 'contents';
  }

  matchesHashes(datRom: HashTriplet, candidate: HashTriplet): boolean {
    return hashesMatch(datRom, candidate);
  }

  allowedFormats(systemId: string, settings: AppSettings): ArchiveFormat[] {
    return getSystemAllowedFormats(systemId, settings);
  }

  determineTargetFormat(systemId: string, settings: AppSettings, chdPossible: boolean): ArchiveFormat | null {
    return determineTargetFormat(systemId, settings, chdPossible);
  }

  romsSqlCondition(_targetMode: ArcadeTargetSetMode | null, _alias: string = 'dr'): string {
    // Systèmes non arcade : aucun filtre merge_name.
    return '';
  }

  async resolveDependencies(_db: Database, _targetMode: ArcadeTargetSetMode): Promise<DependencyResolution | null> {
    // Pas de cascade parents/BIOS/devices hors arcade.
    return null;
  }

  classifyRoms(roms: MatchedRomInfo[]): { archivable: MatchedRomInfo[]; copyAsIs: MatchedRomInfo[] } {
    // is_disk n'est renseigné que pour les <disk> MAME → hors arcade, copyAsIs est
    // toujours vide. Le split reste néanmoins générique et correct.
    const archivable: MatchedRomInfo[] = [];
    const copyAsIs: MatchedRomInfo[] = [];
    for (const rom of roms) {
      (isChdDisk(rom) ? copyAsIs : archivable).push(rom);
    }
    return { archivable, copyAsIs };
  }

  canProduceChd(roms: MatchedRomInfo[]): boolean {
    return canConvertToChd(roms);
  }

  chdEntryPoint(files: string[]): string | null {
    return findChdEntryPoint(files);
  }
}
