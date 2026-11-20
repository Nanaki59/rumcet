// src/helpers/archives/CsoHandler.ts

import path from 'path';
import fs from 'fs/promises';
import {
  IArchiveHandler,
  ArchiveContent,
  ArchiveCreateOptions,
  ArchiveExtractOptions
} from './types.js';
import { hashCso, decompressCso } from './csoFormat.js';

/**
 * Handler pour les images CSO / ZSO (ISO compressée par blocs, PSP et PS2).
 * Support : lecture et extraction, par le décodeur intégré (csoFormat.ts),
 * sans outil externe.
 *
 * Une image CSO est vue comme une archive à UNE entrée : `<nom>.iso`, portant
 * la taille et les hashs de l'ISO décompressée — ceux de la ROM décrite par le
 * DAT Redump. L'extraction produit cette ISO, que la consolidation convertit
 * en CHD ou garde brute selon le profil.
 */
export class CsoHandler implements IArchiveHandler {

  canRead(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.cso');
  }

  /** Nom de l'entrée unique : l'ISO portant le nom de l'image. */
  private entryName(filePath: string): string {
    return path.basename(filePath, path.extname(filePath)) + '.iso';
  }

  async list(filePath: string): Promise<ArchiveContent[]> {
    const { size, ...hashes } = await hashCso(filePath);
    return [{ fileName: this.entryName(filePath), size, hashes }];
  }

  async extract(options: ArchiveExtractOptions): Promise<void> {
    const entry = this.entryName(options.archivePath);
    if (options.files && options.files.length > 0
        && !options.files.some(f => f.replace(/\\/g, '/').toLowerCase() === entry.toLowerCase())) {
      throw new Error(`Entry not found in ${options.archivePath}: ${options.files.join(', ')}`);
    }
    await fs.mkdir(options.outputDir, { recursive: true });
    await decompressCso(options.archivePath, path.join(options.outputDir, entry));
    console.log(`✅ CSO extracted: ${options.archivePath}`);
  }

  canWrite(): boolean {
    return false;
  }

  async create(_options: ArchiveCreateOptions): Promise<void> {
    throw new Error('CSO creation is not supported (CSO is a source format only).');
  }

  getSupportedExtensions(): string[] {
    return ['.cso'];
  }
}
