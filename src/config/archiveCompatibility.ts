// src/config/archiveCompatibility.ts

/**
 * Configuration de compatibilité des formats d'archives par système
 * 
 * Ce fichier définit quels formats d'archives sont compatibles avec chaque système
 * et quels avertissements afficher si nécessaire
 */

export interface ArchiveCompatibility {
  // Formats toujours compatibles
  fullySupported: string[];
  
  // Formats compatibles avec certains émulateurs seulement
  partiallySupported?: {
    format: string;
    warning: string;
    emulators?: string[];
  }[];
  
  // Formats non compatibles
  notSupported: string[];
  
  // Format recommandé pour ce système
  recommended: string;
}

/**
 * Configuration par système
 */
export const ARCHIVE_COMPATIBILITY: Record<string, ArchiveCompatibility> = {
  
  // ============================================
  // NINTENDO - CONSOLES DE SALON
  // ============================================
  
  'nes': {
    fullySupported: ['zip', '7z'],
    notSupported: ['chd', 'iso', 'cso'],
    recommended: 'zip'
  },
  
  'snes': {
    fullySupported: ['zip', '7z'],
    notSupported: ['chd', 'iso', 'cso'],
    recommended: 'zip'
  },
  
  'n64': {
    fullySupported: ['zip', '7z'],
    notSupported: ['chd', 'iso', 'cso'],
    recommended: '7z'
  },
  
  'gamecube': {
    fullySupported: ['7z', 'zip'],
    partiallySupported: [
      {
        format: 'iso',
        warning: 'Format ISO supporté mais plus volumineux que 7z compressé',
        emulators: ['Dolphin']
      }
    ],
    notSupported: ['chd', 'cso'],
    recommended: '7z'
  },
  
  'wii': {
    fullySupported: ['7z', 'zip'],
    partiallySupported: [
      {
        format: 'iso',
        warning: 'Format ISO supporté mais plus volumineux que 7z compressé',
        emulators: ['Dolphin']
      }
    ],
    notSupported: ['chd', 'cso'],
    recommended: '7z'
  },
  
  // ============================================
  // NINTENDO - PORTABLES
  // ============================================
  
  'gameboy': {
    fullySupported: ['zip', '7z'],
    notSupported: ['chd', 'iso', 'cso'],
    recommended: 'zip'
  },
  
  'gbc': {
    fullySupported: ['zip', '7z'],
    notSupported: ['chd', 'iso', 'cso'],
    recommended: 'zip'
  },
  
  'gba': {
    fullySupported: ['zip', '7z'],
    notSupported: ['chd', 'iso', 'cso'],
    recommended: 'zip'
  },
  
  'nds': {
    fullySupported: ['zip', '7z'],
    notSupported: ['chd', 'iso', 'cso'],
    recommended: '7z'
  },
  
  '3ds': {
    fullySupported: ['7z'],
    partiallySupported: [
      {
        format: 'zip',
        warning: '7z est recommandé pour une meilleure compression',
        emulators: ['Citra']
      }
    ],
    notSupported: ['chd', 'iso', 'cso'],
    recommended: '7z'
  },
  
  // ============================================
  // SEGA - CONSOLES DE SALON
  // ============================================
  
  'mastersystem': {
    fullySupported: ['zip', '7z'],
    notSupported: ['chd', 'iso', 'cso'],
    recommended: 'zip'
  },
  
  'megadrive': {
    fullySupported: ['zip', '7z'],
    notSupported: ['chd', 'iso', 'cso'],
    recommended: 'zip'
  },
  
  'genesis': {
    fullySupported: ['zip', '7z'],
    notSupported: ['chd', 'iso', 'cso'],
    recommended: 'zip'
  },
  
  'sega32x': {
    fullySupported: ['zip', '7z'],
    notSupported: ['chd', 'iso', 'cso'],
    recommended: 'zip'
  },
  
  'segacd': {
    fullySupported: ['chd'],
    partiallySupported: [
      {
        format: 'iso',
        warning: 'CHD est fortement recommandé pour économiser de l\'espace',
        emulators: ['RetroArch', 'Kega Fusion']
      },
      {
        format: 'zip',
        warning: 'ZIP de fichiers BIN/CUE supporté mais CHD recommandé',
        emulators: ['RetroArch']
      }
    ],
    notSupported: ['cso'],
    recommended: 'chd'
  },
  
  'saturn': {
    fullySupported: ['chd'],
    partiallySupported: [
      {
        format: 'iso',
        warning: 'CHD est fortement recommandé pour économiser de l\'espace',
        emulators: ['Mednafen', 'SSF']
      }
    ],
    notSupported: ['zip', '7z', 'cso'],
    recommended: 'chd'
  },
  
  'dreamcast': {
    fullySupported: ['chd'],
    partiallySupported: [
      {
        format: 'iso',
        warning: 'CHD est fortement recommandé pour économiser de l\'espace',
        emulators: ['Redream', 'Flycast']
      },
      {
        format: 'cso',
        warning: 'CSO supporté par certains émulateurs mais CHD recommandé',
        emulators: ['PPSSPP (via conversion)']
      }
    ],
    notSupported: ['zip', '7z'],
    recommended: 'chd'
  },
  
  // ============================================
  // SEGA - PORTABLES
  // ============================================
  
  'gamegear': {
    fullySupported: ['zip', '7z'],
    notSupported: ['chd', 'iso', 'cso'],
    recommended: 'zip'
  },
  
  // ============================================
  // SONY
  // ============================================
  
  'psx': {
    fullySupported: ['chd'],
    partiallySupported: [
      {
        format: 'iso',
        warning: 'CHD est fortement recommandé (économise ~50% d\'espace)',
        emulators: ['ePSXe', 'DuckStation', 'RetroArch']
      },
      {
        format: 'zip',
        warning: 'ZIP de fichiers BIN/CUE supporté mais CHD recommandé',
        emulators: ['RetroArch']
      }
    ],
    notSupported: ['cso'],
    recommended: 'chd'
  },
  
  'ps2': {
    fullySupported: ['7z', 'chd'],
    partiallySupported: [
      {
        format: 'iso',
        warning: 'CHD ou 7z recommandés pour économiser de l\'espace',
        emulators: ['PCSX2']
      }
    ],
    notSupported: ['zip', 'cso'],
    recommended: 'chd'
  },
  
  'psp': {
    fullySupported: ['cso', 'chd'],
    partiallySupported: [
      {
        format: 'iso',
        warning: 'CSO ou CHD recommandés pour économiser de l\'espace (~50%)',
        emulators: ['PPSSPP']
      },
      {
        format: 'zip',
        warning: 'ZIP supporté mais CSO/CHD recommandés',
        emulators: ['PPSSPP']
      }
    ],
    notSupported: [],
    recommended: 'cso'
  },
  
  // ============================================
  // ARCADE
  // ============================================
  
  'mame': {
    fullySupported: ['zip'],
    partiallySupported: [
      {
        format: '7z',
        warning: '7z supporté mais ZIP reste le format standard MAME',
        emulators: ['MAME', 'FinalBurn Neo']
      }
    ],
    notSupported: ['chd', 'iso', 'cso'],
    recommended: 'zip'
  },
  
  'fba': {
    fullySupported: ['zip'],
    partiallySupported: [
      {
        format: '7z',
        warning: '7z supporté par certaines versions mais ZIP recommandé',
        emulators: ['FinalBurn Neo']
      }
    ],
    notSupported: ['chd', 'iso', 'cso'],
    recommended: 'zip'
  },
  
  'neogeo': {
    fullySupported: ['zip'],
    partiallySupported: [
      {
        format: '7z',
        warning: '7z supporté mais ZIP reste le format standard',
        emulators: ['FinalBurn Neo', 'MAME']
      }
    ],
    notSupported: ['chd', 'iso', 'cso'],
    recommended: 'zip'
  },
  
  // ============================================
  // AUTRES
  // ============================================
  
  'pc': {
    fullySupported: ['zip', '7z', 'iso'],
    partiallySupported: [
      {
        format: 'chd',
        warning: 'CHD supporté pour les images disque mais moins commun',
        emulators: ['DOSBox']
      }
    ],
    notSupported: ['cso'],
    recommended: '7z'
  },
  
  'atari2600': {
    fullySupported: ['zip', '7z'],
    notSupported: ['chd', 'iso', 'cso'],
    recommended: 'zip'
  },
  
  // ============================================
  // DÉFAUT (système non reconnu)
  // ============================================
  
  'default': {
    fullySupported: ['zip', '7z'],
    partiallySupported: [
      {
        format: 'chd',
        warning: 'CHD supporté pour les systèmes CD/DVD',
        emulators: []
      },
      {
        format: 'iso',
        warning: 'ISO supporté mais la compression est recommandée',
        emulators: []
      },
      {
        format: 'cso',
        warning: 'CSO principalement pour PSP',
        emulators: []
      }
    ],
    notSupported: [],
    recommended: '7z'
  }
};

/**
 * Obtenir la configuration de compatibilité pour un système
 */
export function getArchiveCompatibility(systemId: string): ArchiveCompatibility {
  const normalizedId = systemId.toLowerCase().replace(/[\s-_]/g, '');
  return ARCHIVE_COMPATIBILITY[normalizedId] || ARCHIVE_COMPATIBILITY['default'];
}

/**
 * Vérifier si un format est compatible avec un système
 */
export function isFormatSupported(systemId: string, format: string): {
  supported: boolean;
  level: 'full' | 'partial' | 'not';
  warning?: string;
  emulators?: string[];
} {
  const compat = getArchiveCompatibility(systemId);
  const normalizedFormat = format.toLowerCase().replace('.', '');
  
  // Vérifier support complet
  if (compat.fullySupported.includes(normalizedFormat)) {
    return { supported: true, level: 'full' };
  }
  
  // Vérifier support partiel
  if (compat.partiallySupported) {
    const partial = compat.partiallySupported.find(p => p.format === normalizedFormat);
    if (partial) {
      return {
        supported: true,
        level: 'partial',
        warning: partial.warning,
        emulators: partial.emulators
      };
    }
  }
  
  // Non supporté
  return { supported: false, level: 'not' };
}

/**
 * Obtenir le format recommandé pour un système
 */
export function getRecommendedFormat(systemId: string): string {
  const compat = getArchiveCompatibility(systemId);
  return compat.recommended;
}

/**
 * Obtenir tous les formats compatibles pour un système
 */
export function getAllCompatibleFormats(systemId: string): string[] {
  const compat = getArchiveCompatibility(systemId);
  const formats = [...compat.fullySupported];
  
  if (compat.partiallySupported) {
    formats.push(...compat.partiallySupported.map(p => p.format));
  }
  
  return formats;
}
