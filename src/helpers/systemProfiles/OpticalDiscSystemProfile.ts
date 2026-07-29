// src/helpers/systemProfiles/OpticalDiscSystemProfile.ts
//
// Profil disque optique (PS1, Saturn, Dreamcast, Sega CD, PC-Engine CD, …). Romsets
// Redump : les pistes bin/cue/iso sont décrites par leur hash et le contenu peut
// être (re)construit en CHD. Le comportement générique de Base convient déjà :
//  - chdIdentity() = 'contents' (identité par les fichiers extraits) ;
//  - canProduceChd()/chdEntryPoint() détectent le point d'entrée .cue/.gdi/.iso.
// Cette classe matérialise la famille pour le mapping `profile: 'disc'` et sert de
// point d'accroche à de futures règles spécifiques (ex : extraction unique du CHD
// source, gestion .m3u multi-disques).

import type { SystemProfileKind } from './types.js';
import { BaseSystemProfile } from './BaseSystemProfile.js';

export class OpticalDiscSystemProfile extends BaseSystemProfile {
  readonly kind: SystemProfileKind = 'disc';
}
