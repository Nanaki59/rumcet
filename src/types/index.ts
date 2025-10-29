// src/types/index.ts
// Types partagés utilisés dans l'application

export interface DatLoadResult {
  success: boolean;
  dbPath: string;
  gamesCount: number;
  romsCount: number;
  datInfo?: {
    name: string;
    description: string;
    version: string;
    date: string;
    author: string;
    homepage: string;
    url: string;
  };
}

export interface DatabaseOpenResult {
  success: boolean;
  dbPath: string;
  datPath: string | null;
  gamesCount: number;
  romsCount: number;
  folders: Array<{
    path: string;
    fileCount: number;
  }>;
  datInfo?: {
    name: string;
    description: string;
    version: string;
    date: string;
    author: string;
    homepage: string;
    url: string;
  };
}

export interface ScanStats {
  length: number;
}

export interface LogMessage {
  severity: string;
  context: string;
  message: string;
}

export interface MatchingResult {
  matches: any[];
  stats: {
    totalDatRoms: number;
    perfectMatches: number;
    goodMatches: number;
    partialMatches: number;
    missingRoms: number;
    extraFiles: number;
  };
}
