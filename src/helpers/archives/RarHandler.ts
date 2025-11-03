// src/helpers/archives/RarHandler.ts

import path from 'path';
import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { 
  IArchiveHandler, 
  ArchiveContent, 
  ArchiveCreateOptions, 
  ArchiveExtractOptions 
} from './types.js';

const execAsync = promisify(exec);

/**
 * Handler pour les archives RAR
 * Support: Lecture et Extraction uniquement (RAR est propriétaire)
 * 
 * Utilise des binaires externes pour éviter les problèmes de licence:
 * - 7-Zip complet (7z.exe) - Recommandé
 * - WinRAR (si installé)
 * - unrar (si installé)
 * 
 * NOTE IMPORTANTE : 7za.exe (de 7zip-bin) ne supporte PAS les RAR !
 * Il faut utiliser 7z.exe complet installé sur le système.
 */
export class RarHandler implements IArchiveHandler {
  private unrarPath?: string;
  private sevenZipPath: string;
  private winrarPath?: string;
  private toolPriority: Array<'7zip' | 'winrar' | 'unrar'> = ['7zip', 'winrar', 'unrar'];
  
  constructor() {
    // Chemin vers 7-Zip COMPLET (pas 7za.exe de 7zip-bin qui ne supporte pas RAR)
    this.sevenZipPath = this.getDefault7ZipPath();
    
    // Chemins optionnels
    this.winrarPath = this.getDefaultWinRarPath();
  }

  /**
   * Définit l'ordre de priorité des outils RAR
   */
  setToolPriority(priority: Array<'7zip' | 'winrar' | 'unrar'>): void {
    this.toolPriority = priority;
    console.log('🔧 Ordre des outils RAR mis à jour:', this.toolPriority);
  }
  
  /**
   * Configure les chemins vers les outils RAR
   */
  setToolPaths(paths: { unrar?: string; sevenZip?: string; winrar?: string }): void {
    if (paths.unrar) this.unrarPath = paths.unrar;
    if (paths.sevenZip) this.sevenZipPath = paths.sevenZip;
    if (paths.winrar) this.winrarPath = paths.winrar;
  }
  
  /**
   * Obtenir le chemin par défaut de 7-Zip selon la plateforme
   * IMPORTANT : Utilise 7z.exe (complet), PAS 7za.exe (ne supporte pas RAR)
   */
  private getDefault7ZipPath(): string {
    if (process.platform === 'win32') {
      // Liste des emplacements possibles de 7z.exe
      const possiblePaths = [
        'C:\\Program Files\\7-Zip\\7z.exe',
        'C:\\Program Files (x86)\\7-Zip\\7z.exe',
        process.env.ProgramFiles + '\\7-Zip\\7z.exe',
        process.env['ProgramFiles(x86)'] + '\\7-Zip\\7z.exe'
      ];
      
      // Retourner le premier chemin par défaut (sera vérifié plus tard)
      return possiblePaths[0];
    }
    return '7z'; // Supposé dans le PATH sur Linux/Mac
  }
  
  /**
   * Obtenir le chemin par défaut de WinRAR (Windows uniquement)
   */
  private getDefaultWinRarPath(): string {
    if (process.platform === 'win32') {
      return 'C:\\Program Files\\WinRAR\\WinRAR.exe';
    }
    return '';
  }
  
  canRead(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.rar');
  }
  
  /**
   * Cherche 7z.exe à plusieurs emplacements possibles
   */
  private async find7ZipPath(): Promise<string | null> {
    if (process.platform === 'win32') {
      const possiblePaths = [
        'C:\\Program Files\\7-Zip\\7z.exe',
        'C:\\Program Files (x86)\\7-Zip\\7z.exe',
        process.env.ProgramFiles + '\\7-Zip\\7z.exe',
        process.env['ProgramFiles(x86)'] + '\\7-Zip\\7z.exe'
      ].filter(p => p && !p.includes('undefined'));
      
      console.log('🔍 Recherche de 7z.exe aux emplacements:', possiblePaths);
      
      for (const path of possiblePaths) {
        try {
          await fs.access(path);
          console.log(`✅ 7z.exe trouvé : ${path}`);
          return path;
        } catch {
          console.log(`❌ 7z.exe non trouvé : ${path}`);
          continue;
        }
      }
      
      console.log('⚠️  7z.exe non trouvé dans les emplacements standards');
    } else {
      // Linux/Mac : essayer dans PATH
      try {
        await execAsync('which 7z', { timeout: 1000 });
        return '7z';
      } catch {
        return null;
      }
    }
    
    return null;
  }
  
  /**
   * Vérifie si un outil est disponible
   */
  private async isToolAvailable(toolPath: string, testCommand?: string): Promise<boolean> {
    if (!toolPath) return false;
    
    try {
      // Vérifier si le fichier existe
      await fs.access(toolPath);
      console.log(`✅ Outil trouvé : ${toolPath}`);
      return true;
    } catch {
      console.log(`❌ Outil non trouvé : ${toolPath}`);
      // Si le fichier n'existe pas directement, essayer une commande de test
      if (testCommand) {
        try {
          await execAsync(testCommand, { timeout: 3000 });
          console.log(`✅ Outil disponible via commande : ${toolPath}`);
          return true;
        } catch (err: any) {
          console.log(`❌ Test commande échoué pour ${toolPath}:`, err.message);
          return false;
        }
      }
      return false;
    }
  }
  
  /**
   * Liste le contenu d'une archive RAR
   * Essaie plusieurs outils dans l'ordre de préférence
   */
  async list(filePath: string): Promise<ArchiveContent[]> {
    // Chercher 7z.exe automatiquement si le chemin par défaut ne marche pas
    const found7Zip = await this.find7ZipPath();
    if (found7Zip) {
      this.sevenZipPath = found7Zip;
    }
  
    // Définir TOUTES les commandes disponibles
    const allCommands = {
      // 7-Zip (7z.exe complet, supporte RAR)
      // IMPORTANT : Utiliser l'option -slt pour forcer la sortie technique complète
      '7zip': { 
        tool: '7zip',
        path: this.sevenZipPath,
        cmd: () => `"${this.sevenZipPath}" l -slt "${filePath}"`,
        testCmd: `"${this.sevenZipPath}" --help`,
        parser: this.parse7zipOutput.bind(this)
      },
      // WinRAR (si installé sur Windows)
      // IMPORTANT : Utiliser Rar.exe (console) pas WinRAR.exe (GUI)
      'winrar': { 
        tool: 'winrar',
        path: this.winrarPath ? this.winrarPath.replace('WinRAR.exe', 'Rar.exe') : '',
        cmd: () => {
          const rarExe = this.winrarPath ? this.winrarPath.replace('WinRAR.exe', 'Rar.exe') : '';
          return rarExe ? `"${rarExe}" l -v "${filePath}"` : '';
        },
        testCmd: this.winrarPath ? `"${this.winrarPath.replace('WinRAR.exe', 'Rar.exe')}" -?"` : '',
        parser: this.parseWinRarOutput.bind(this)
      },
      // unrar (si installé manuellement)
      'unrar': { 
        tool: 'unrar',
        path: this.unrarPath,
        cmd: () => this.unrarPath ? `"${this.unrarPath}" l -v "${filePath}"` : `unrar l -v "${filePath}"`,
        testCmd: this.unrarPath ? `"${this.unrarPath}" --help` : 'unrar --help',
        parser: this.parseUnrarOutput.bind(this)
      }
    };
    
    // Réorganiser les commandes selon la priorité définie
    const commands = this.toolPriority.map(toolName => allCommands[toolName]).filter(Boolean);

    console.log('🔧 Ordre d\'essai des outils RAR:', this.toolPriority);

    let lastError: Error | null = null;
    
    for (const { tool, path: toolPath, cmd, testCmd, parser } of commands) {
      if (!toolPath && tool !== 'unrar') continue; // Skip si pas de chemin (sauf unrar qui peut être dans PATH)
      
      console.log(`\n🔄 Tentative avec ${tool}...`);
      console.log(`   Chemin: ${toolPath || 'PATH'}`);
      
      // Vérifier si l'outil est disponible
      const available = await this.isToolAvailable(toolPath || '', testCmd);
      if (!available) {
        console.log(`⏭️  ${tool} non disponible, passage au suivant`);
        continue;
      }
      
      try {
        const command = cmd();
        if (!command) {
          console.log(`⚠️  ${tool} : pas de commande générée`);
          continue;
        }
        
        console.log(`📝 Commande: ${command}`);
        console.log(`⏳ Exécution de la commande...`);
        
        const { stdout } = await execAsync(command, { maxBuffer: 10 * 1024 * 1024 });
        
        console.log(`✅ Commande exécutée, parsing de la sortie...`);
        console.log(`📄 Sortie brute (${stdout.length} caractères):`);
        console.log(stdout.substring(0, 500)); // Premiers 500 caractères
        
        const contents = parser(stdout);
        
        if (contents.length > 0) {
          console.log(`✅ RAR listed with ${tool}: ${path.basename(filePath)} - ${contents.length} fichiers`);
          return contents;
        } else {
          console.log(`⚠️  ${tool} : aucun fichier trouvé dans le parsing`);
        }
      } catch (error: any) {
        lastError = error;
        console.error(`❌ Échec listage RAR avec ${tool}:`);
        console.error(`   Message: ${error.message}`);
        console.error(`   Code: ${error.code}`);
        console.error(`   stderr: ${error.stderr}`);
        continue;
      }
    }
    
    // Si aucun outil n'a fonctionné
    throw new Error(
      'Aucun outil disponible pour lire l\'archive RAR.\n' +
      'Veuillez installer l\'un de ces outils :\n' +
      '- 7-Zip (recommandé) : https://www.7-zip.org/\n' +
      '- WinRAR : https://www.win-rar.com/\n' +
      '- unrar : https://www.rarlab.com/rar_add.htm\n' +
      `Dernière erreur : ${lastError?.message || 'Aucun outil trouvé'}`
    );
  }
  
  /**
   * Parse la sortie technique de 7-Zip (-slt)
   * Format: Chaque fichier a plusieurs lignes de propriétés
   * CORRIGÉ : Ignore l'en-tête de l'archive (avant le séparateur "----------")
   */
  private parse7zipOutput(output: string): ArchiveContent[] {
    const contents: ArchiveContent[] = [];
    const lines = output.split('\n');
    let currentFile: Partial<ArchiveContent> = {};
    let inFileSection = false;
    let pastSeparator = false;  // Flag pour ignorer l'en-tête de l'archive
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Détecter le séparateur "----------" qui marque la fin de l'en-tête
      // Tout ce qui est avant ce séparateur concerne l'archive elle-même, pas son contenu
      if (trimmed.startsWith('----------')) {
        pastSeparator = true;
        continue;
      }
      
      // Ignorer tout ce qui est avant le séparateur (= en-tête de l'archive)
      if (!pastSeparator) {
        continue;
      }
      
      // Début d'un fichier
      if (trimmed.startsWith('Path = ')) {
        // Sauvegarder le fichier précédent s'il existe
        if (currentFile.fileName && currentFile.size !== undefined) {
          contents.push(currentFile as ArchiveContent);
        }
        
        // Nouveau fichier
        const filePath = trimmed.substring(7);
        currentFile = { fileName: filePath, size: 0 };
        inFileSection = true;
      }
      // Taille du fichier
      else if (trimmed.startsWith('Size = ')) {
        const size = parseInt(trimmed.substring(7)) || 0;
        currentFile.size = size;
      }
      // Attributs (pour détecter les dossiers)
      else if (trimmed.startsWith('Attributes = ')) {
        const attrs = trimmed.substring(13);
        // Ignorer les dossiers (attribut D)
        if (attrs.includes('D')) {
          currentFile = {}; // Réinitialiser
          inFileSection = false;
        }
      }
      // CRC32
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
    
    // Ajouter le dernier fichier
    if (currentFile.fileName && currentFile.size !== undefined) {
      contents.push(currentFile as ArchiveContent);
    }
    
    return contents;
  }
  
  /**
   * Parse la sortie de WinRAR
   */
  private parseWinRarOutput(output: string): ArchiveContent[] {
    const contents: ArchiveContent[] = [];
    const lines = output.split('\n');
    let inFileList = false;
    
    for (const line of lines) {
      // WinRAR utilise des lignes de séparation
      if (line.includes('-------')) {
        inFileList = !inFileList;
        continue;
      }
      
      if (inFileList && line.trim()) {
        // Format WinRAR : nom taille packed ratio date time attr crc
        const match = line.match(/^\s*(.+?)\s+(\d+)\s+\d+\s+[\d%]+\s+[\d-]+\s+[\d:]+\s+\S+\s+([0-9A-F]{8})/i);
        if (match) {
          const [, fileName, sizeStr, crc] = match;
          const size = parseInt(sizeStr) || 0;
          
          // Ignorer les dossiers
          if (!fileName.endsWith('/') && !fileName.endsWith('\\')) {
            contents.push({
              fileName: fileName.trim(),
              size: size,
              hashes: crc && crc !== '00000000' ? {
                crc32: crc.toUpperCase(),
                md5: '',
                sha1: ''
              } : undefined
            });
          }
        }
      }
    }
    
    return contents;
  }
  
  /**
   * Parse la sortie de unrar
   */
  private parseUnrarOutput(output: string): ArchiveContent[] {
    const contents: ArchiveContent[] = [];
    const lines = output.split('\n');
    let inFileList = false;
    
    for (const line of lines) {
      if (line.includes('-------')) {
        inFileList = !inFileList;
        continue;
      }
      
      if (inFileList && line.trim()) {
        // Format unrar : nom taille packed ratio date time attr crc
        const match = line.match(/^\s*(.+?)\s+(\d+)\s+\d+\s+[\d%]+\s+[\d-]+\s+[\d:]+\s+\S+\s+([0-9A-F]{8})/i);
        if (match) {
          const [, fileName, sizeStr, crc] = match;
          const size = parseInt(sizeStr) || 0;
          
          // Ignorer les dossiers
          if (!fileName.endsWith('/') && !fileName.endsWith('\\')) {
            contents.push({
              fileName: fileName.trim(),
              size: size,
              hashes: crc && crc !== '00000000' ? {
                crc32: crc.toUpperCase(),
                md5: '',
                sha1: ''
              } : undefined
            });
          }
        }
      }
    }
    
    return contents;
  }
  
  /**
   * Extrait une archive RAR
   */
  async extract(options: ArchiveExtractOptions): Promise<void> {
    // Créer le dossier de destination
    await fs.mkdir(options.outputDir, { recursive: true });
    
    // Chercher 7z.exe automatiquement si le chemin par défaut ne marche pas
    const found7Zip = await this.find7ZipPath();
    if (found7Zip) {
      this.sevenZipPath = found7Zip;
    }

    // Définir TOUTES les commandes disponibles
    const allCommands = {
      '7zip': { 
        tool: '7zip',
        path: this.sevenZipPath,
        cmd: () => `"${this.sevenZipPath}" x -y "${options.archivePath}" -o"${options.outputDir}"`,
        testCmd: `"${this.sevenZipPath}" --help`
      },
      'winrar': { 
        tool: 'winrar',
        path: this.winrarPath,
        cmd: () => this.winrarPath ? `"${this.winrarPath}" x -o+ "${options.archivePath}" "${options.outputDir}\\"` : '',
        testCmd: this.winrarPath ? `"${this.winrarPath}" -?` : ''
      },
      'unrar': { 
        tool: 'unrar',
        path: this.unrarPath,
        cmd: () => this.unrarPath ? `"${this.unrarPath}" x -o+ "${options.archivePath}" "${options.outputDir}/"` : `unrar x -o+ "${options.archivePath}" "${options.outputDir}/"`,
        testCmd: this.unrarPath ? `"${this.unrarPath}" --help` : 'unrar --help'
      }
    };
    
    // Réorganiser les commandes selon la priorité définie
    const commands = this.toolPriority.map(toolName => allCommands[toolName]).filter(Boolean);
  
    console.log('🔧 Ordre d\'essai des outils RAR:', this.toolPriority);
    
    let lastError: Error | null = null;
    
    for (const { tool, path: toolPath, cmd, testCmd } of commands) {
      if (!toolPath && tool !== 'unrar') continue;
      
      // Vérifier si l'outil est disponible
      const available = await this.isToolAvailable(toolPath || '', testCmd);
      if (!available) {
        console.log(`⏭️  ${tool} non disponible pour extraction, passage au suivant`);
        continue;
      }
      
      try {
        const command = cmd();
        if (!command) continue;
        
        await execAsync(command, { maxBuffer: 50 * 1024 * 1024 });
        console.log(`✅ RAR extracted with ${tool}: ${path.basename(options.archivePath)}`);
        return;
      } catch (error: any) {
        lastError = error;
        console.warn(`❌ Échec extraction RAR avec ${tool}:`, error.message);
        continue;
      }
    }
    
    throw new Error(
      'Aucun outil disponible pour extraire l\'archive RAR.\n' +
      'Veuillez installer l\'un de ces outils :\n' +
      '- 7-Zip (recommandé) : https://www.7-zip.org/\n' +
      '- WinRAR : https://www.win-rar.com/\n' +
      '- unrar : https://www.rarlab.com/rar_add.htm\n' +
      `Dernière erreur : ${lastError?.message || 'Aucun outil trouvé'}`
    );
  }
  
  canWrite(): boolean {
    // RAR est propriétaire, pas de support d'écriture
    return false;
  }
  
  async create(options: ArchiveCreateOptions): Promise<void> {
    throw new Error('RAR creation not supported (proprietary format)');
  }
  
  getSupportedExtensions(): string[] {
    return ['.rar'];
  }
  
  /**
   * Vérifie si au moins un outil RAR est disponible
   */
  async isAvailable(): Promise<boolean> {
    // Vérifier 7-Zip en priorité (normalement toujours disponible via 7zip-bin)
    const sevenZipAvailable = await this.isToolAvailable(this.sevenZipPath, `"${this.sevenZipPath}" --help`);
    if (sevenZipAvailable) return true;
    
    // Vérifier WinRAR
    if (this.winrarPath) {
      const winrarAvailable = await this.isToolAvailable(this.winrarPath, `"${this.winrarPath}" -?`);
      if (winrarAvailable) return true;
    }
    
    // Vérifier unrar
    if (this.unrarPath) {
      const unrarAvailable = await this.isToolAvailable(this.unrarPath, `"${this.unrarPath}" --help`);
      if (unrarAvailable) return true;
    }
    
    return false;
  }
}
