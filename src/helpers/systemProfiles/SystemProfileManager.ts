// src/helpers/systemProfiles/SystemProfileManager.ts
//
// Façade de sélection des profils système, à la manière de l'ArchiveManager pour
// les formats d'archive. Les profils sont des singletons SANS état ; le manager
// choisit lequel s'applique et le moteur lui passe le contexte (systemId, settings,
// roms…) en paramètre.

import { getSystemProfileKind, type SystemProfileKind } from '../../config/systems.js';
import type { SystemProfile } from './types.js';
import { BaseSystemProfile } from './BaseSystemProfile.js';
import { ArcadeSystemProfile } from './ArcadeSystemProfile.js';
import { OpticalDiscSystemProfile } from './OpticalDiscSystemProfile.js';

export class SystemProfileManager {
  private readonly base = new BaseSystemProfile();
  private readonly arcade = new ArcadeSystemProfile();
  private readonly disc = new OpticalDiscSystemProfile();

  private byKind(kind: SystemProfileKind): SystemProfile {
    switch (kind) {
      case 'arcade': return this.arcade;
      case 'disc': return this.disc;
      case 'cartridge':
      default: return this.base;
    }
  }

  /** Profil d'un système, d'après son `profile` (ou inférence). Utilisé au scan. */
  forSystem(systemId: string): SystemProfile {
    return this.byKind(getSystemProfileKind(systemId));
  }

  /**
   * Profil pour la consolidation. L'« arcade-ness » d'un romset est historiquement
   * déterminée par le mode du DAT (dat_set_mode) et non par le systemId : si le DAT
   * porte des concepts arcade (mode ≠ 'n/a'), on force le profil arcade même si le
   * système n'a pas été détecté. Cela reproduit EXACTEMENT l'ancien gate `datIsArcade`.
   */
  forConsolidation(systemId: string, datSetMode: string | null | undefined): SystemProfile {
    const datIsArcade = !!(datSetMode && datSetMode !== 'n/a');
    if (datIsArcade) return this.arcade;
    return this.forSystem(systemId);
  }
}

/** Instance singleton partagée (comme `archiveManager`). */
export const systemProfileManager = new SystemProfileManager();
