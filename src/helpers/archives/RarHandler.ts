// src/helpers/archives/RarHandler.ts

import path from 'path';
import fs from 'fs/promises';
import { trackedExecFileAsync } from './processRegistry.js';
import { detectSevenZip, detectRar, detectUnrar, rarCliPath } from '../toolPaths.js';
import { 
  IArchiveHandler, 
  ArchiveContent, 
  ArchiveCreateOptions, 
  ArchiveExtractOptions 
} from './types.js';

const execFileAsync = trackedExecFileAsync;

/**
 * Handler pour les archives RAR
 * Support: Lecture et Extraction uniquement (RAR est propriétaire)
 * 
 * Utilise des binaires externes pour éviter les problèmes de licence:
 * - 7-Zip complet (7z.exe) - Recommandé
 * - WinRAR (Rar.exe en ligne de commande) - Support complet avec CRC
 * - UnRAR (UnRAR.exe) - Même syntaxe que WinRAR, extraction uniquement
 * 
 * NOTE IMPORTANTE : 
 * - 7za.exe (de 7zip-bin) ne supporte PAS les RAR !
 * - WinRAR.exe = GUI, Rar.exe = CLI
 * - UnRAR utilise actuellement la MÊME syntaxe que WinRAR (même développeur)
 *   Les fonctions de parsing sont séparées pour gérer d'éventuelles divergences futures
 * 
 * OPTIONS DE LISTAGE (WinRAR/UnRAR) :
 * - Option 'l'  : Liste simple (colonnes, sans CRC)
 * - Option 'lt' : Liste technique (lignes, avec CRC) ← UTILISÉ
 * - Option 'lta': Liste technique complète (inclut services)
 */
export class RarHandler implements IArchiveHandler {
  private unrarPath?: string;
  private sevenZipPath?: string;
  private winrarPath?: string;
  private toolPriority: Array<'7zip' | 'winrar' | 'unrar'> = ['7zip', 'winrar', 'unrar'];
  
  // Cache des outils disponibles (détecté une seule fois)
  private toolsDetected: boolean = false;
  private availableTools: Set<'7zip' | 'winrar' | 'unrar'> = new Set();
  
  constructor() {
    // Les chemins seront initialisés via setToolPaths() depuis archive_handlers.ts
    // ou détectés automatiquement lors du premier appel
  }

  /**
   * Définit l'ordre de priorité des outils RAR
   */
  setToolPriority(priority: Array<'7zip' | 'winrar' | 'unrar'>): void {
    this.toolPriority = priority;
    console.log('🔧 RAR tool order updated:', this.toolPriority);
  }
  
  /**
   * Configure les chemins vers les outils RAR
   */
  setToolPaths(paths: { unrar?: string; sevenZip?: string; winrar?: string }): void {
    if (paths.unrar) this.unrarPath = paths.unrar;
    if (paths.sevenZip) this.sevenZipPath = paths.sevenZip;
    if (paths.winrar) this.winrarPath = paths.winrar;
    
    // Réinitialiser la détection pour revalider les nouveaux chemins
    this.toolsDetected = false;
    this.availableTools.clear();
  }
  
  canRead(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.rar');
  }
  
  /**
   * Détecte les outils disponibles UNE SEULE FOIS
   */
  private async detectAvailableTools(): Promise<void> {
    if (this.toolsDetected) {
      return;
    }
    
    console.log('🔍 Detecting available RAR tools...');
    
    // Test 7-Zip : chemin configuré, sinon détection (Program Files, PATH, Homebrew…)
    if (this.sevenZipPath && await this.isToolAvailable(this.sevenZipPath)) {
      this.availableTools.add('7zip');
      console.log(`✅ 7-Zip available: ${this.sevenZipPath}`);
    } else {
      const detected = await detectSevenZip();
      if (detected) {
        this.sevenZipPath = detected;
        this.availableTools.add('7zip');
        console.log(`✅ 7-Zip found: ${detected}`);
      } else {
        console.log('❌ 7-Zip not available');
      }
    }
    
    // Test WinRAR (version ligne de commande : Rar.exe sous Windows, rar ailleurs)
    this.winrarPath = this.winrarPath ? rarCliPath(this.winrarPath) : (await detectRar()) || undefined;
    if (this.winrarPath && await this.isToolAvailable(this.winrarPath)) {
      this.availableTools.add('winrar');
      console.log(`✅ WinRAR (Rar) disponible: ${this.winrarPath}`);
    } else {
      console.log('❌ WinRAR not available');
    }
    
    // Test UnRAR
    if (!this.unrarPath) {
      this.unrarPath = (await detectUnrar()) || undefined;
    }
    if (this.unrarPath && await this.isToolAvailable(this.unrarPath)) {
      this.availableTools.add('unrar');
      console.log(`✅ UnRAR available: ${this.unrarPath}`);
    } else {
      console.log('❌ UnRAR not available');
    }
    
    this.toolsDetected = true;
    console.log(`🔧 Outils RAR disponibles: [${Array.from(this.availableTools).join(', ')}]`);
  }
  
  /**
   * Vérifie si un outil est disponible : fichier existant, ou nom de commande
   * (ex. « unrar ») que le système sait lancer.
   */
  private async isToolAvailable(toolPath: string): Promise<boolean> {
    if (!toolPath) return false;
    
    try {
      await fs.access(toolPath);
      return true;
    } catch {
      try {
        await execFileAsync(toolPath, [], { timeout: 3000 });
        return true;
      } catch (error: any) {
        // Un code de sortie numérique signifie que l'outil s'est lancé (sans
        // argument, il affiche son aide et sort en erreur) ; ENOENT = introuvable
        return typeof error?.code === 'number';
      }
    }
  }
  
  /**
   * Liste le contenu d'une archive RAR
   */
  async list(filePath: string): Promise<ArchiveContent[]> {
    await this.detectAvailableTools();
  
    const allCommands = {
      '7zip': { 
        tool: '7zip' as const,
        path: this.sevenZipPath,
        args: ['l', '-slt', filePath],
        parser: this.parse7zipOutput.bind(this)
      },
      'winrar': { 
        tool: 'winrar' as const,
        path: this.winrarPath,
        args: ['lt', filePath],
        parser: this.parseWinRarOutput.bind(this)
      },
      'unrar': { 
        tool: 'unrar' as const,
        path: this.unrarPath,
        args: ['lt', filePath],
        parser: this.parseUnrarOutput.bind(this)
      }
    };
    
    const commands = this.toolPriority
      .filter(toolName => this.availableTools.has(toolName))
      .map(toolName => allCommands[toolName])
      .filter(cmd => cmd && cmd.path);

    if (commands.length === 0) {
      throw new Error(
        'Aucun outil RAR disponible.\n' +
        'Veuillez installer l\'un de ces outils :\n' +
        '- 7-Zip (recommandé) : https://www.7-zip.org/\n' +
        '- WinRAR : https://www.win-rar.com/\n' +
        '- UnRAR : https://www.rarlab.com/rar_add.htm'
      );
    }

    console.log('🔧 RAR tool try order:', commands.map(c => c.tool).join(', '));

    let lastError: Error | null = null;
    
    for (const { tool, path: toolPath, args, parser } of commands) {
      console.log(`\n📄 Trying with ${tool}...`);
      console.log(`   Chemin: ${toolPath}`);
      
      try {
        console.log(`🔍 Commande: ${toolPath} ${args.join(' ')}`);
        console.log(`⏳ Running the command...`);
        
        const { stdout } = await execFileAsync(toolPath!, args, { maxBuffer: 10 * 1024 * 1024 });
        
        console.log(`✅ Command executed, parsing the output...`);
        console.log(`📄 Raw output (${stdout.length} characters):`);
        console.log(stdout.substring(0, 500));
        
        const contents = parser(stdout);
        
        if (contents.length > 0) {
          console.log(`✅ RAR listed with ${tool}: ${path.basename(filePath)} - ${contents.length} fichiers`);
          return contents;
        } else {
          console.log(`⚠️  ${tool}: no file found while parsing`);
        }
      } catch (error: any) {
        lastError = error;
        console.error(`❌ RAR listing failed with ${tool}:`);
        console.error(`   Message: ${error.message}`);
        if (error.code) console.error(`   Code: ${error.code}`);
        if (error.stderr) console.error(`   stderr: ${error.stderr}`);
        continue;
      }
    }
    
    throw new Error(
      'Impossible de lire l\'archive RAR avec les outils disponibles.\n' +
      `Dernière erreur : ${lastError?.message || 'Aucun outil n\'a réussi'}`
    );
  }
  
  /**
   * Parse la sortie technique de 7-Zip (-slt)
   */
  private parse7zipOutput(output: string): ArchiveContent[] {
    const contents: ArchiveContent[] = [];
    const lines = output.split('\n');
    let currentFile: Partial<ArchiveContent> = {};
    let pastSeparator = false;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed.startsWith('----------')) {
        pastSeparator = true;
        continue;
      }
      
      if (!pastSeparator) continue;
      
      if (trimmed.startsWith('Path = ')) {
        if (currentFile.fileName && currentFile.size !== undefined) {
          contents.push(currentFile as ArchiveContent);
        }
        currentFile = { fileName: trimmed.substring(7), size: 0 };
      }
      else if (trimmed.startsWith('Size = ')) {
        currentFile.size = parseInt(trimmed.substring(7)) || 0;
      }
      else if (trimmed.startsWith('Attributes = ')) {
        const attrs = trimmed.substring(13);
        if (attrs.includes('D')) {
          currentFile = {};
        }
      }
      else if (trimmed.startsWith('CRC = ')) {
        const crc = trimmed.substring(6);
        if (crc && crc !== '-' && crc !== '00000000') {
          if (!currentFile.hashes) {
            currentFile.hashes = { crc32: '', md5: '', sha1: '' };
          }
          currentFile.hashes.crc32 = crc.toUpperCase().padStart(8, '0');
        }
      }
    }
    
    if (currentFile.fileName && currentFile.size !== undefined) {
      contents.push(currentFile as ArchiveContent);
    }
    
    return contents;
  }
  
  /**
   * Parse la sortie technique de WinRAR avec option 'lt'
   * 
   * Format de sortie 'lt' (lignes clé: valeur) :
   *         Name: fichier.cue
   *         Type: File
   *         Size: 112
   *  Packed size: 112
   *        Ratio: 100%
   *     Modified: 2025-05-21 18:14:55,892458400
   *   Attributes: ..A....
   *        CRC32: E54FC39F
   *      Host OS: Windows
   *  Compression: RAR 5.0(v50) -m0 -md=128k
   * 
   * IMPORTANT : Ignorer les entrées de Type: Service (métadonnées internes)
   */
  private parseWinRarOutput(output: string): ArchiveContent[] {
    const contents: ArchiveContent[] = [];
    const lines = output.split('\n');
    let currentFile: Partial<ArchiveContent> & { type?: string } = {};
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Nouvelle entrée commence par "Name:"
      if (trimmed.startsWith('Name:')) {
        // Sauvegarder l'entrée précédente si c'est un fichier valide
        if (currentFile.fileName && 
            currentFile.size !== undefined && 
            currentFile.type === 'File') {
          contents.push({
            fileName: currentFile.fileName,
            size: currentFile.size,
            hashes: currentFile.hashes
          });
        }
        
        // Nouvelle entrée
        currentFile = {
          fileName: trimmed.substring(5).trim(),
          size: 0
        };
      }
      // Type d'entrée (File, Directory, Service)
      else if (trimmed.startsWith('Type:')) {
        currentFile.type = trimmed.substring(5).trim();
      }
      // Taille du fichier
      else if (trimmed.startsWith('Size:')) {
        const sizeStr = trimmed.substring(5).trim();
        currentFile.size = parseInt(sizeStr) || 0;
      }
      // CRC32
      else if (trimmed.startsWith('CRC32:')) {
        const crc = trimmed.substring(6).trim();
        if (crc && crc !== '00000000') {
          if (!currentFile.hashes) {
            currentFile.hashes = { crc32: '', md5: '', sha1: '' };
          }
          currentFile.hashes.crc32 = crc.toUpperCase();
        }
      }
    }
    
    // Ajouter le dernier fichier si valide
    if (currentFile.fileName && 
        currentFile.size !== undefined && 
        currentFile.type === 'File') {
      contents.push({
        fileName: currentFile.fileName,
        size: currentFile.size,
        hashes: currentFile.hashes
      });
    }
    
    return contents;
  }
  
  /**
   * Parse la sortie technique de UnRAR avec option 'lt'
   * 
   * Actuellement, UnRAR utilise le MÊME format que WinRAR (même développeur).
   * Cette fonction est séparée pour permettre de gérer facilement d'éventuelles
   * divergences futures entre les deux outils.
   * 
   * Format de sortie identique à WinRAR :
   *         Name: fichier.cue
   *         Type: File
   *         Size: 112
   *        CRC32: E54FC39F
   */
  private parseUnrarOutput(output: string): ArchiveContent[] {
    // Actuellement délègue à parseWinRarOutput car le format est identique
    // Garde cette fonction séparée pour faciliter les changements futurs
    return this.parseWinRarOutput(output);
  }
  
  /**
   * Extrait une archive RAR
   */
  async extract(options: ArchiveExtractOptions): Promise<void> {
    await fs.mkdir(options.outputDir, { recursive: true });
    await this.detectAvailableTools();

    // RAR/UnRAR exigent un séparateur final pour traiter la destination comme un dossier
    const outputDirArg = options.outputDir.endsWith(path.sep) ? options.outputDir : options.outputDir + path.sep;
    const allCommands = {
      '7zip': { 
        tool: '7zip' as const,
        path: this.sevenZipPath,
        args: ['x', '-y', options.archivePath, `-o${options.outputDir}`]
      },
      'winrar': { 
        tool: 'winrar' as const,
        path: this.winrarPath,
        args: ['x', '-y', '-o+', options.archivePath, outputDirArg]
      },
      'unrar': { 
        tool: 'unrar' as const,
        path: this.unrarPath,
        args: ['x', '-y', '-o+', options.archivePath, outputDirArg]
      }
    };
    
    const commands = this.toolPriority
      .filter(toolName => this.availableTools.has(toolName))
      .map(toolName => allCommands[toolName])
      .filter(cmd => cmd && cmd.path);

    if (commands.length === 0) {
      throw new Error('Aucun outil RAR disponible pour l\'extraction');
    }

    let lastError: Error | null = null;
    
    for (const { tool, path: toolPath, args } of commands) {
      try {
        console.log(`Extraction with ${tool}: ${toolPath} ${args.join(' ')}`);
        await execFileAsync(toolPath!, args, { maxBuffer: 50 * 1024 * 1024 });
        
        console.log(`✅ RAR extracted with ${tool}`);
        return;
      } catch (error: any) {
        lastError = error;
        console.error(`❌ Extraction failed with ${tool}:`, error.message);
        continue;
      }
    }
    
    throw new Error(
      `Impossible d'extraire l'archive RAR.\n` +
      `Dernière erreur : ${lastError?.message || 'Aucun outil n\'a réussi'}`
    );
  }
  
  canWrite(): boolean {
    return false;
  }
  
  async create(options: ArchiveCreateOptions): Promise<void> {
    throw new Error('La création d\'archives RAR n\'est pas supportée (format propriétaire)');
  }
  
  getSupportedExtensions(): string[] {
    return ['.rar'];
  }
}
