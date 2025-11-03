// src/helpers/archives/CsoHandler.ts

import path from 'path';
import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import { 
  IArchiveHandler, 
  ArchiveContent, 
  ArchiveCreateOptions, 
  ArchiveExtractOptions 
} from './types.js';
import { calculateFileHashes } from '../hashCalculator.js';
import { IsoHandler } from './IsoHandler.js';

const execAsync = promisify(exec);

/**
 * Handler pour les images CSO (Compressed ISO)
 * Format utilisé principalement pour les jeux PSP
 * 
 * Support: Lecture et Extraction
 * Nécessite: maxcso, ciso, ou autre outil de décompression CSO
 * 
 * Stratégie:
 * 1. Décompresser CSO → ISO temporaire
 * 2. Utiliser IsoHandler pour lister/extraire
 */
export class CsoHandler implements IArchiveHandler {
  private isoHandler: IsoHandler;
  
  constructor() {
    this.isoHandler = new IsoHandler();
  }
  
  canRead(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.cso');
  }
  
  /**
   * Décompresse un CSO en ISO temporaire
   */
  private async decompressCsoToIso(csoPath: string): Promise<string> {
    const tempDir = path.join(os.tmpdir(), 'cso_decompress_' + Date.now());
    await fs.mkdir(tempDir, { recursive: true });
    
    const isoPath = path.join(tempDir, path.basename(csoPath, '.cso') + '.iso');
    
    // Essayer différents outils de décompression CSO
    const tools = [
      // maxcso (recommandé, multi-plateforme)
      `maxcso --decompress "${csoPath}" -o "${isoPath}"`,
      // ciso (PSP homebrew tool)
      `ciso 0 "${csoPath}" "${isoPath}"`,
      // UMDGen (Windows)
      `umdgen.exe -d "${csoPath}" -o "${isoPath}"`
    ];
    
    let lastError: Error | null = null;
    
    for (const cmd of tools) {
      try {
        await execAsync(cmd);
        console.log(`✅ CSO decompressed to: ${isoPath}`);
        return isoPath;
      } catch (error: any) {
        lastError = error;
        continue;
      }
    }
    
    // Nettoyer si échec
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (e) {
      // Ignorer
    }
    
    throw new Error(
      'No CSO decompression tool available. Please install maxcso, ciso, or UMDGen. ' +
      `Last error: ${lastError?.message}`
    );
  }
  
  /**
   * Liste le contenu d'un CSO
   * 1. Décompresse en ISO temporaire
   * 2. Liste l'ISO
   * 3. Nettoie
   */
  async list(filePath: string): Promise<ArchiveContent[]> {
    let tempIsoPath: string | null = null;
    
    try {
      // Décompresser
      tempIsoPath = await this.decompressCsoToIso(filePath);
      
      // Lister l'ISO
      const contents = await this.isoHandler.list(tempIsoPath);
      
      return contents;
      
    } finally {
      // Nettoyer le fichier ISO temporaire
      if (tempIsoPath) {
        try {
          const tempDir = path.dirname(tempIsoPath);
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch (error) {
          console.warn('Failed to clean up temp ISO:', error);
        }
      }
    }
  }
  
  /**
   * Extrait un CSO
   * 1. Décompresse en ISO temporaire
   * 2. Extrait l'ISO
   * 3. Nettoie
   */
  async extract(options: ArchiveExtractOptions): Promise<void> {
    let tempIsoPath: string | null = null;
    
    try {
      // Décompresser
      tempIsoPath = await this.decompressCsoToIso(options.archivePath);
      
      // Extraire l'ISO
      await this.isoHandler.extract({
        archivePath: tempIsoPath,
        outputDir: options.outputDir,
        files: options.files
      });
      
      console.log(`✅ CSO extracted: ${options.archivePath}`);
      
    } finally {
      // Nettoyer le fichier ISO temporaire
      if (tempIsoPath) {
        try {
          const tempDir = path.dirname(tempIsoPath);
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch (error) {
          console.warn('Failed to clean up temp ISO:', error);
        }
      }
    }
  }
  
  canWrite(): boolean {
    // On pourrait supporter la compression ISO → CSO avec maxcso
    return false;
  }
  
  async create(options: ArchiveCreateOptions): Promise<void> {
    throw new Error('CSO creation not yet supported. Consider using maxcso CLI directly.');
  }
  
  getSupportedExtensions(): string[] {
    return ['.cso'];
  }
  
  /**
   * Méthode utilitaire: Vérifier si un outil CSO est disponible
   */
  async isCsoToolAvailable(): Promise<boolean> {
    const tools = ['maxcso', 'ciso', 'umdgen'];
    
    for (const tool of tools) {
      try {
        await execAsync(`${tool} --version`);
        return true;
      } catch (error) {
        continue;
      }
    }
    
    return false;
  }
}
