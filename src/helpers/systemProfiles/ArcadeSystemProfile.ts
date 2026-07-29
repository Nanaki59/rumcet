// src/helpers/systemProfiles/ArcadeSystemProfile.ts
//
// Profil arcade (MAME, FBNeo, Naomi, Atomiswave, …). Porte les règles propres aux
// romsets arcade : set modes (split/merged/non-merged), cascade de dépendances,
// filtrage merge_name, et identité CHD par SHA1 d'en-tête (<disk> MAME).

import type { Database } from '../../database/init.js';
import type { ArcadeTargetSetMode } from '../settingsManager.js';
import { resolveDependencies } from '../resolveDependencies.js';
import type { DependencyResolution } from '../resolveDependencies.js';
import type { SystemProfileKind, ChdIdentityMode } from './types.js';
import { BaseSystemProfile } from './BaseSystemProfile.js';

export class ArcadeSystemProfile extends BaseSystemProfile {
  readonly kind: SystemProfileKind = 'arcade';

  isArcade(): boolean {
    return true;
  }

  chdIdentity(): ChdIdentityMode {
    // Un <disk> MAME est identifié par le SHA1 de l'en-tête du CHD : pas d'extraction.
    return 'header';
  }

  romsSqlCondition(targetMode: ArcadeTargetSetMode | null, alias: string = 'dr'): string {
    // Mode split : exclure les ROMs partagées avec le parent (merge_name renseigné).
    if (targetMode === 'split') {
      const prefix = alias ? `${alias}.` : '';
      return `AND ${prefix}merge_name IS NULL`;
    }
    return '';
  }

  async resolveDependencies(db: Database, targetMode: ArcadeTargetSetMode): Promise<DependencyResolution | null> {
    return resolveDependencies(db, targetMode);
  }
}
