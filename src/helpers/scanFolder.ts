// src/helpers/scanFolder.ts
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { crc32 } from 'crc';
import AdmZip from 'adm-zip';
import { Database } from '../database/init';
import { RunResult } from 'sqlite3';
import sevenBin from '7zip-bin';
import Seven from 'node-7z';
import { createExtractorFromFile } from 'node-unrar-js';
import { ChdmanHandler } from './chdmanHandler.js';
import { calculateFileHashes, calculateFileHashesStream, calculateHashesFromBuffer } from './hashCalculator.js';

const pathTo7zip = sevenBin.path7za;

export interface FileHash {
  crc32: string;
  md5: string;
  sha1: string;
}

export interface ScannedFile {
  filePath: string;
  fileName: string;
  size: number;
  hashes: FileHash;
  isArchive: boolean;
  archiveType?: string;
  contents?: ArchiveContent[];
  relativePath?: string; // Chemin relatif par rapport au dossier racine
}

export interface ArchiveContent {
  fileName: string;
  size: number;
  hashes?: FileHash;
}

export interface FolderStructure {
  path: string;
  isRoot: boolean;
  parentPath?: string;
  files: ScannedFile[];
  subFolders: FolderStructure[];
}

// Instance du handler CHD
const chdman = new ChdmanHandler();

// Calculer les hashes d'un buffer
/*function calculateHashes(buffer: Buffer): FileHash {
  return {
    crc32: crc32(buffer).toString(16).padStart(8, '0').toUpperCase(),
    md5: crypto.createHash('md5').update(buffer).digest('hex').toUpperCase(),
    sha1: crypto.createHash('sha1').update(buffer).digest('hex').toUpperCase(),
  };
}*/

// Calculer les hashes d'un fichier (pour les gros fichiers)
/*async function calculateFileHashes(filePath: string): Promise<FileHash> {
  const fileBuffer = await fs.readFile(filePath);
  return calculateHashes(fileBuffer);
}*/

// Scanner un fichier ZIP et hasher son contenu
async function scanZipArchive(filePath: string): Promise<ArchiveContent[]> {
  try {
    console.log(`\n\n=== Analyse de ${path.basename(filePath)} avec AdmZip ===\n`);
    console.log('Path complet:', filePath);
    
    const zip = new AdmZip(filePath);
    const contents: ArchiveContent[] = [];
    
    for (const entry of zip.getEntries()) {
      if (!entry.isDirectory) {
        // Essayer de récupérer le CRC32 depuis l'archive
        const crc32FromZip = entry.header.crc.toString(16).padStart(8, '0').toUpperCase();
        
        contents.push({
          fileName: entry.entryName,
          size: entry.header.size,
          hashes: crc32FromZip ? {
              crc32: crc32FromZip,
              md5: '',
              sha1: ''
            } : undefined
        });

        // Logs pour debug
        //console.log('\nFichier:', entry.entryName);
        //console.log('Taille:', entry.header.size);
        //console.log('CRC:', crc32FromZip || 'Non disponible');
      }
    }

    console.log(`\n✅ Archive zip analysée: ${contents.length} fichiers`);

    return contents;
  } catch (err) {
    console.error(`Error reading ZIP file ${filePath}:`, err);
    return [];
  }
}

// Scanner un fichier 7z
async function scan7zArchive(filePath: string): Promise<ArchiveContent[]> {
  try {
    console.log(`\n\n=== Analyse de ${path.basename(filePath)} avec node-7z ===\n`);
    console.log('Path complet:', filePath);
    
    const contents: ArchiveContent[] = [];
    
    return new Promise((resolve, reject) => {
      const myStream = Seven.list(filePath, {
        $bin: pathTo7zip,
        recursive: false,
        techInfo: true      // Important : garder à true pour avoir le CRC
      });
      
      myStream.on('data', function (data: any) {
        console.log('\nDonnées reçues de node-7z:', data);
        
        if (data.file && !data.file.endsWith('/')) {
          // Gestion robuste de la taille
          let size = 0;
          if (data.techInfo && data.techInfo.has('Size')) {
            const sizeStr = data.techInfo.get('Size');
            size = parseInt(sizeStr) || 0;
          }
          
          // CORRECTION : Utiliser .get() pour accéder au CRC dans la Map
          let formattedCrc = undefined;
          if (data.techInfo && data.techInfo.has('CRC')) {
            const crc = data.techInfo.get('CRC');
            if (crc !== undefined && crc !== null && crc !== '-') {
              try {
                // Le CRC est déjà formaté en hexadécimal par 7z
                formattedCrc = crc.toString().toUpperCase();
              } catch (crcError) {
                console.warn('Erreur lors du formatage du CRC:', crcError);
                formattedCrc = undefined;
              }
            }
          }
          
          contents.push({
            fileName: data.file,
            size: size,
            hashes: formattedCrc ? {
              crc32: formattedCrc,
              md5: '',
              sha1: ''
            } : undefined
          });
          
          // Logs pour debug
          console.log('\nFichier:', data.file);
          console.log('Taille:', size);
          console.log('CRC depuis techInfo:', data.techInfo?.get('CRC'));
          console.log('CRC formaté:', formattedCrc || 'Non disponible');
        }
      });
      
      myStream.on('end', function () {
        console.log(`\n✅ Archive 7z analysée: ${contents.length} fichiers`);
        resolve(contents);
      });
      
      myStream.on('error', function (err: any) {
        console.error('\n❌ Erreur node-7z:', err.message);
        resolve([]);
      });
    });
    
  } catch (err: any) {
    console.error(`❌ Erreur avec node-7z pour ${path.basename(filePath)}:`, err.message);
    return [];
  }
}

// Scanner un fichier RAR - Version corrigée selon l'API réelle
async function scanRarArchive(filePath: string): Promise<ArchiveContent[]> {
  try {
    console.log(`\n=== Analyse RAR: ${path.basename(filePath)} ===`);
    console.log('Path complet:', filePath);
    
    const contents: ArchiveContent[] = [];
    
    // Importer le module correctement pour ES modules
    const { createExtractorFromData } = await import('node-unrar-js');
    
    // Charger le fichier WASM
    let wasmBinary: Uint8Array;
    try {
      const wasmPath = path.join(process.cwd(), 'node_modules', 'node-unrar-js', 'dist', 'js', 'unrar.wasm');
      const wasmBuffer = await fs.readFile(wasmPath);
      wasmBinary = new Uint8Array(wasmBuffer);
    } catch (e) {
      console.error('❌ Impossible de trouver unrar.wasm');
      return [];
    }
    
    // Lire le fichier RAR
    const rarBuffer = await fs.readFile(filePath);
    const rarData = new Uint8Array(rarBuffer);
    
    // Créer l'extracteur avec createExtractorFromData
    // Cette fonction prend un seul paramètre avec la structure suivante
    const extractor = await createExtractorFromData({
      data: rarData,           // Les données du fichier RAR
      wasmBinary: wasmBinary   // Le binaire WASM
    });
    
    // Lister les fichiers
    const list = extractor.getFileList();
    const fileHeaders = [...list.fileHeaders]; // Convertir en array si nécessaire
    
    console.log(`Nombre de fichiers dans l'archive: ${fileHeaders.length}`);
    
    for (const header of fileHeaders) {
      // Ignorer les dossiers
      if (header.flags.directory) continue;
      
      // Le CRC32 est dans le header
      const crcHex = header.crc.toString(16).padStart(8, '0').toUpperCase();
      
      const content = {
        fileName: header.name,
        size: header.unpSize,
        hashes: {
          crc32: crcHex,
          md5: '',
          sha1: ''
        }
      };
      
      contents.push(content);
      console.log(`Fichier ajouté: ${header.name}, CRC: ${crcHex}`);
    }
    
    console.log(`✅ Total fichiers traités: ${contents.length}`);
    return contents;
    
  } catch (err) {
    console.error(`❌ Erreur RAR:`, err);
    return [];
  }
}

// Alternative si les données ne fonctionnent pas : utiliser le chemin directement
async function scanRarArchiveWithPath(filePath: string): Promise<ArchiveContent[]> {
  try {
    console.log(`\n=== Analyse RAR (méthode alternative): ${path.basename(filePath)} ===`);
    
    const contents: ArchiveContent[] = [];
    
    // Utiliser la commande système unrar si disponible
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    
    try {
      // Essayer d'utiliser unrar en ligne de commande
      const { stdout } = await execAsync(`unrar l -v "${filePath}"`);
      
      // Parser la sortie de unrar
      const lines = stdout.split('\n');
      let inFileList = false;
      
      for (const line of lines) {
        if (line.includes('-------')) {
          inFileList = !inFileList;
          continue;
        }
        
        if (inFileList && line.trim()) {
          // Parser les infos du fichier
          // Format typique: filename  size  packed  ratio  date  time  attr  crc
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 8) {
            const fileName = parts[0];
            const size = parseInt(parts[1]) || 0;
            const crc = parts[7];
            
            if (!fileName.endsWith('/')) {
              contents.push({
                fileName: fileName,
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
      
      console.log(`✅ Archive RAR analysée avec unrar CLI: ${contents.length} fichiers`);
      return contents;
      
    } catch (cmdError) {
      console.log('unrar CLI non disponible, retour à node-unrar-js');
      // Fallback sur la méthode précédente
      return scanRarArchive(filePath);
    }
    
  } catch (err) {
    console.error(`❌ Erreur RAR alternative:`, err);
    return [];
  }
}

// Scanner un fichier CHD et extraire les checksums du contenu
async function scanChdArchive(filePath: string): Promise<ArchiveContent[]> {
  try {
    console.log(`\n\n=== Analyse de ${path.basename(filePath)} avec chdman ===\n`);
    console.log('Path complet:', filePath);
    
    // Vérifier si chdman est disponible
    const isAvailable = await chdman.isAvailable();
    if (!isAvailable) {
      console.warn('chdman non disponible, impossible de scanner le CHD');
      return [];
    }
    
    // Récupérer les infos du CHD
    const chdInfo = await chdman.info(filePath);
    
    // Logger les informations détaillées
    console.log('Type de média:', chdInfo.mediaType);
    console.log('Type de disque:', chdInfo.discType);
    console.log('Est un GD-ROM:', chdInfo.isGDI);
    console.log('Nombre de tracks:', chdInfo.tracks?.length || 0);

    //const hasMultipleDataTracks = (chdInfo.tracks?.length || 0) > 1;
    
    if (chdInfo.tracks && chdInfo.tracks.length > 0) {
      console.log('\n=== Détails des tracks ===');
      for (const track of chdInfo.tracks) {
        console.log(`Track ${track.trackNumber}: ${track.type}`);
        if (track.subtype) console.log(`  - Subtype: ${track.subtype}`);
        if (track.pregap) console.log(`  - Pregap: ${track.pregap} frames`);
        if (track.frames) console.log(`  - Frames: ${track.frames}`);
        if (track.pgtype) console.log(`  - PGTYPE: ${track.pgtype}`);
      }
      
      // Estimer le nombre de fichiers BIN qui seront créés
      const expectedBins = chdman.getExpectedBinCount(chdInfo);
      console.log(`\nNombre de fichiers BIN attendus: ${expectedBins}`);
    }
    
    // Déterminer la méthode d'extraction selon le type
    const tempDir = path.join(os.tmpdir(), 'chd_extract_' + Date.now());
    await fs.mkdir(tempDir, { recursive: true });
    
    let extractedFiles: string[] = [];
    
    // Logique d'extraction adaptée au type
    if (chdInfo.isGDI) {
      console.log('\n🎮 Extraction GD-ROM (Dreamcast)');
      
      // Les GD-ROM utilisent extractcd mais produisent souvent plusieurs BIN
      const outputBase = path.join(tempDir, path.basename(filePath).replace('.chd', '.cue'));

      await chdman.extractCD(filePath, outputBase, chdInfo);
      
      // Pour un GDI, on s'attend à :
      // - output.gdi (ou output.cue)
      // - track01.bin, track02.bin, track03.bin...
      
      const files = await fs.readdir(tempDir);
      for (const file of files) {
        const fullPath = path.join(tempDir, file);
        const stats = await fs.stat(fullPath);
        if (stats.isFile()) {
          extractedFiles.push(fullPath);
          
          // Identifier le type de fichier
          if (file.endsWith('.gdi')) {
            console.log(`  ✓ Fichier GDI: ${file}`);
          } else if (file.endsWith('.bin')) {
            console.log(`  ✓ Track BIN: ${file} (${formatFileSize(stats.size)})`);
          } else if (file.endsWith('.raw')) {
            console.log(`  ✓ Track RAW: ${file}`);
          }
        }
      }
      
    } else if (chdInfo.discType === 'CD-DA') {
      console.log('\n🎵 Extraction CD Audio');
      
      // CD Audio produit généralement un .cue + plusieurs .bin (un par track audio)
      const outputBase = path.join(tempDir, path.basename(filePath).replace('.chd', '.cue'));
      await chdman.extractCD(filePath, outputBase, chdInfo);
      
      const files = await fs.readdir(tempDir);
      for (const file of files) {
        const fullPath = path.join(tempDir, file);
        const stats = await fs.stat(fullPath);
        if (stats.isFile()) {
          extractedFiles.push(fullPath);
          console.log(`  ✓ ${file} (${formatFileSize(stats.size)})`);
        }
      }
      
    } else if (chdInfo.mediaType === 'DVD') {
      console.log('\n📀 Extraction DVD');
      
      // DVD utilise extractdvd
      const outputBase = path.join(tempDir, 'output');
      await chdman.extractDVD(filePath, outputBase);
      
      const files = await fs.readdir(tempDir);
      for (const file of files) {
        const fullPath = path.join(tempDir, file);
        const stats = await fs.stat(fullPath);
        if (stats.isFile()) {
          extractedFiles.push(fullPath);
          console.log(`  ✓ ${file} (${formatFileSize(stats.size)})`);
        }
      }
      
    } else if (chdInfo.mediaType === 'CD') {
      console.log('\n💿 Extraction CD-ROM standard');
      
      // CD-ROM standard
      const outputBase = path.join(tempDir, path.basename(filePath).replace('.chd', '.cue'));
      await chdman.extractCD(filePath, outputBase, chdInfo);
      
      const files = await fs.readdir(tempDir);
      let binCount = 0;
      
      for (const file of files) {
        const fullPath = path.join(tempDir, file);
        const stats = await fs.stat(fullPath);
        if (stats.isFile()) {
          extractedFiles.push(fullPath);
          if (file.endsWith('.bin')) binCount++;
          console.log(`  ✓ ${file} (${formatFileSize(stats.size)})`);
        }
      }
      
      // Vérifier si le nombre de BIN correspond aux attentes
      //const expectedBins = chdman.getExpectedBinCount(chdInfo);
      //if (binCount !== expectedBins) {
      //  console.warn(`⚠️ Nombre de BIN différent de l'attendu: ${binCount} vs ${expectedBins}`);
      //}
      
    } else {
      // Autres types (HD, LD, RAW)
      console.log(`\n💾 Extraction ${chdInfo.mediaType}`);
      
      switch (chdInfo.mediaType) {
        case 'HD':
          const imgPath = path.join(tempDir, 'output.img');
          await chdman.extractHD(filePath, imgPath);
          break;
        case 'LD':
          const ldPath = path.join(tempDir, 'output.avi');
          await chdman.extractLD(filePath, ldPath);
          break;
        case 'RAW':
          const rawPath = path.join(tempDir, 'output.raw');
          await chdman.extractRaw(filePath, rawPath);
          break;
      }
      
      // Collecter tous les fichiers créés
      const files = await fs.readdir(tempDir);
      for (const file of files) {
        const fullPath = path.join(tempDir, file);
        const stats = await fs.stat(fullPath);
        if (stats.isFile()) {
          extractedFiles.push(fullPath);
          console.log(`  ✓ ${file} (${formatFileSize(stats.size)})`);
        }
      }
    }
    
    console.log(`\n📊 Total fichiers extraits: ${extractedFiles.length}`);
    
    // Calculer les hashes pour chaque fichier
    const contents: ArchiveContent[] = [];
    
    for (const extractedFile of extractedFiles) {
      const stats = await fs.stat(extractedFile);
      const fileName = path.basename(extractedFile);
      
      // Identifier le type de fichier pour optimiser
      const ext = path.extname(fileName).toLowerCase();
      let hashes: FileHash | undefined;
      
      // Pour les fichiers de métadonnées (petits), calculer tous les hashes
      /*if (ext === '.cue' || ext === '.gdi' || ext === '.toc') {
        const buffer = await fs.readFile(extractedFile);
        hashes = calculateHashesFromBuffer(buffer);
      }
      // Pour les gros fichiers BIN/ISO
      else if (stats.size < 100 * 1024 * 1024) { // < 100MB
        const buffer = await fs.readFile(extractedFile);
        hashes = calculateHashesFromBuffer(buffer);
      }
      else {
        // Gros fichiers : utiliser streams ou limiter les hashes
        console.log(`  ⏳ Calcul des hashes pour ${fileName} (gros fichier)...`);
        hashes = await calculateFileHashesStream(extractedFile);
      }*/

      hashes = await calculateFileHashes(extractedFile);

      contents.push({
        fileName: fileName,
        size: stats.size,
        hashes: hashes
      });
    }
    
    // Nettoyer les fichiers temporaires
    try {
      for (const file of extractedFiles) {
        await fs.unlink(file);
      }
      await fs.rmdir(tempDir);
      console.log('✓ Fichiers temporaires nettoyés');
    } catch (error) {
      console.error('Erreur nettoyage:', error);
    }
    
    return contents;
    
  } catch (error) {
    console.error(`Erreur scan CHD:`, error);
    return [];
  }
}

// Fonction helper pour le formatage
function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

// Scanner récursivement un dossier avec structure hiérarchique
async function scanDirectoryRecursive(
  dir: string, 
  rootDir: string,
  structure: FolderStructure
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Créer une sous-structure pour ce dossier
      const subFolder: FolderStructure = {
        path: fullPath,
        isRoot: false,
        parentPath: dir,
        files: [],
        subFolders: []
      };
      
      structure.subFolders.push(subFolder);
      await scanDirectoryRecursive(fullPath, rootDir, subFolder);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      const buffer = await fs.readFile(fullPath);
      //const hashes = calculateHashesFromBuffer(buffer);
      const hashes = await calculateFileHashes(fullPath);
      
      const scannedFile: ScannedFile = {
        filePath: fullPath,
        fileName: entry.name,
        size: buffer.length,
        hashes,
        isArchive: false,
        relativePath: path.relative(rootDir, fullPath)
      };

      // Gérer les archives
      if (ext === '.zip') {
        scannedFile.isArchive = true;
        scannedFile.archiveType = 'zip';
        scannedFile.contents = await scanZipArchive(fullPath);
      } else if (ext === '.7z') {
        scannedFile.isArchive = true;
        scannedFile.archiveType = '7z';
        scannedFile.contents = await scan7zArchive(fullPath);
      } else if (ext === '.rar') {
        scannedFile.isArchive = true;
        scannedFile.archiveType = 'rar';
        // Essayer d'abord avec le chemin, puis avec le buffer en fallback
        scannedFile.contents = await scanRarArchive(fullPath);
      } else if (ext === '.chd') {
        scannedFile.isArchive = true;
        scannedFile.archiveType = 'chd';
        scannedFile.contents = await scanChdArchive(fullPath);
      }

      structure.files.push(scannedFile);
    }
  }
}

// Fonction principale de scan avec structure
export async function scanFolderWithStructure(folderPath: string): Promise<FolderStructure> {
  const structure: FolderStructure = {
    path: folderPath,
    isRoot: true,
    files: [],
    subFolders: []
  };
  
  await scanDirectoryRecursive(folderPath, folderPath, structure);
  return structure;
}

// Fonction de scan classique (pour compatibilité)
export async function scanFolder(folderPath: string): Promise<ScannedFile[]> {
  const structure = await scanFolderWithStructure(folderPath);
  
  // Aplatir la structure pour obtenir tous les fichiers
  const allFiles: ScannedFile[] = [];
  
  function collectFiles(struct: FolderStructure) {
    allFiles.push(...struct.files);
    for (const subFolder of struct.subFolders) {
      collectFiles(subFolder);
    }
  }
  
  collectFiles(structure);
  return allFiles;
}

// Sauvegarder les résultats du scan avec hiérarchie dans la base de données
export async function saveScanResultsWithStructure(
  db: Database, 
  structure: FolderStructure
): Promise<number> {
  await db.run('BEGIN TRANSACTION');

  try {
    let totalFiles = 0;

    // Fonction récursive pour sauvegarder la structure
    async function saveStructure(
      struct: FolderStructure, 
      parentFolderId: number | null = null
    ): Promise<number> {
      // Insérer le dossier
      const folderResult = await db.run(
        `INSERT OR REPLACE INTO scanned_folders 
         (folder_path, parent_folder_id, is_root, file_count)
         VALUES (?, ?, ?, ?)`,
        [struct.path, parentFolderId, struct.isRoot ? 1 : 0, struct.files.length]
      );
      
      const folderId = folderResult.lastID;

      // Insérer les fichiers de ce dossier
      const insertFile = db.prepare(`
        INSERT OR REPLACE INTO scanned_files 
        (folder_id, file_path, file_name, size, crc32, md5, sha1, is_archive, archive_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertArchiveContent = db.prepare(`
        INSERT INTO archive_contents
        (archive_id, file_name, size, crc32, md5, sha1)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const file of struct.files) {
        await new Promise<void>((resolve, reject) => {
          insertFile.run(
            folderId,
            file.filePath,
            file.fileName,
            file.size,
            file.hashes.crc32,
            file.hashes.md5,
            file.hashes.sha1,
            file.isArchive ? 1 : 0,
            file.archiveType || null,
            function(this: RunResult, err: Error | null) {
              if (err) reject(err);
              else {
                if (file.isArchive && file.contents) {
                  const archiveId = this.lastID;
                  Promise.all(file.contents.map(content => 
                    new Promise<void>((res, rej) => {
                      insertArchiveContent.run(
                        archiveId,
                        content.fileName,
                        content.size,
                        content.hashes?.crc32 || null,
                        content.hashes?.md5 || null,
                        content.hashes?.sha1 || null,
                        (err: Error | null) => err ? rej(err) : res()
                      );
                    })
                  )).then(() => resolve()).catch(reject);
                } else {
                  resolve();
                }
              }
            }
          );
        });
        totalFiles++;
  
        if (file.isArchive && file.contents) {
          console.log(`Sauvegarde archive ${file.archiveType}: ${file.fileName}`);
          console.log(`Nombre de fichiers dans l'archive: ${file.contents.length}`);
          
          if (file.archiveType === 'rar' && file.contents.length > 0) {
            console.log('Premier fichier RAR:', file.contents[0]);
          }
        }
      }

      insertFile.finalize();
      insertArchiveContent.finalize();

      // Sauvegarder les sous-dossiers récursivement
      for (const subFolder of struct.subFolders) {
        totalFiles += await saveStructure(subFolder, folderId);
      }

      return totalFiles;
    }

    const total = await saveStructure(structure);

    await db.run('COMMIT');
    console.log(`Saved ${total} files to database with folder structure`);
    
    return total;

  } catch (error) {
    await db.run('ROLLBACK');
    throw error;
  }
}

// Version compatible pour l'ancienne API
export async function saveScanResults(
  db: Database, 
  results: ScannedFile[], 
  basePath: string
): Promise<void> {
  // Créer une structure à partir des résultats plats
  const structure: FolderStructure = {
    path: basePath,
    isRoot: true,
    files: results,
    subFolders: []
  };
  
  await saveScanResultsWithStructure(db, structure);
}
