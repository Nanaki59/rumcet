// src/types/node-unrar-js.d.ts
declare module 'node-unrar-js' {
  export interface FileHeader {
    name: string;
    flags: {
      encrypted: boolean;
      solid: boolean;
      directory: boolean;
    };
    unpSize: number;
    packSize: number;
    crc: number;
    time: string;
    method: string;
    unpVer: string;
    comment?: string;
  }

  export interface ExtractedFile {
    fileHeader: FileHeader;
    extraction?: Uint8Array;
  }

  export interface ExtractResult {
    files: ExtractedFile[];
  }

  export interface FileList {
    fileHeaders: FileHeader[];
    arcHeader?: any;
  }

  export interface Extractor {
    getFileList(): FileList;
    extract(options?: { file?: string; files?: string[] }): ExtractResult;
  }

  export interface ExtractorOptions {
    data: Buffer | Uint8Array;
    wasmBinary: Buffer | Uint8Array;
    password?: string;
  }

  export function createExtractorFromFile(options: ExtractorOptions): Promise<Extractor>;
  export function createExtractorFromData(options: ExtractorOptions): Promise<Extractor>;
}
