// src/helpers/archives/IsoHandler.ts

import path from 'path';
import fs from 'fs/promises';
import { trackedExecAsync } from './processRegistry.js';
import { 
  IArchiveHandler, 
  ArchiveContent, 
  ArchiveCreateOptions, 
  ArchiveExtractOptions 
} from './types.js';
import { calculateFileHashes } from '../hashCalculator.js';

const execAsync = trackedExecAsync;

/**
 * Handler pour les images ISO
 * Support: Lecture et Extraction (via 7zip)
 * Note: La création d'ISO nécessiterait des outils spécialisés (mkisofs, genisoimage)
 * 
 * 7zip peut lire et extraire les ISO comme des archives
 */
export class IsoHandler implements IArchiveHandler {
  
  canRead(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.iso');
  }
  
  /**
   * Liste le contenu d'une ISO via 7zip
   */
  async list(filePath: string): Promise<ArchiveContent[]> {
    try {
      // Utiliser 7zip pour lister le contenu
      const { stdout } = await execAsync(`7z l -slt "${filePath}"`);
      
      return this.parse7zipDetailedOutput(stdout);
    } catch (error) {
      console.error('Error listing ISO file:', error);
      throw new Error('7zip is required to read ISO files. Please install 7zip.');
    }
  }
  
  /**
   * Parse la sortie détaillée de 7zip (-slt)
   */
  private parse7zipDetailedOutput(output: string): ArchiveContent[] {
    const contents: ArchiveContent[] = [];
    const blocks = output.split('\n\n');
    
    for (const block of blocks) {
      const lines = block.split('\n');
      let fileName: string | null = null;
      let size: number = 0;
      let isFolder = false;
      let crc32: string | undefined = undefined;
      
      for (const line of lines) {
        const [key, ...valueParts] = line.split(' = ');
        const value = valueParts.join(' = ');
        
        if (key === 'Path') {
          fileName = value;
        } else if (key === 'Size') {
          size = parseInt(value) || 0;
        } else if (key === 'Folder') {
          isFolder = value === '+';
        } else if (key === 'CRC') {
          crc32 = value.toUpperCase();
        }
      }
      
      // Ajouter si c'est un fichier (pas un dossier)
      if (fileName && !isFolder) {
        contents.push({
          fileName: fileName,
          size: size,
          hashes: crc32 ? {
            crc32: crc32,
            md5: '',
            sha1: ''
          } : undefined
        });
      }
    }
    
    return contents;
  }
  
  /**
   * Extrait une ISO via 7zip
   */
  async extract(options: ArchiveExtractOptions): Promise<void> {
    // Créer le dossier de destination
    await fs.mkdir(options.outputDir, { recursive: true });
    
    try {
      let cmd: string;
      
      if (options.files && options.files.length > 0) {
        // Extraire des fichiers spécifiques
        const fileArgs = options.files.map(f => `"${f}"`).join(' ');
        cmd = `7z x -y "${options.archivePath}" -o"${options.outputDir}" ${fileArgs}`;
      } else {
        // Extraire tout
        cmd = `7z x -y "${options.archivePath}" -o"${options.outputDir}"`;
      }
      
      await execAsync(cmd);
      console.log(`✅ ISO extracted: ${options.archivePath}`);
    } catch (error) {
      console.error('Error extracting ISO file:', error);
      throw new Error('Failed to extract ISO file. Make sure 7zip is installed.');
    }
  }
  
  canWrite(): boolean {
    // On pourrait supporter la création via mkisofs/genisoimage mais c'est complexe
    return false;
  }
  
  async create(options: ArchiveCreateOptions): Promise<void> {
    throw new Error('ISO creation not yet supported. Consider using mkisofs or genisoimage.');
  }
  
  getSupportedExtensions(): string[] {
    return ['.iso'];
  }
}
