// ============================================
// src/helpers/hashCalculator.ts
// ============================================

import crypto from 'crypto';
import fs from 'fs';
import { crc32 } from 'crc';

export interface FileHash {
  crc32: string;
  md5: string;
  sha1: string;
}

/**
 * Calcule les hashes d'un buffer (pour petits fichiers)
 */
export function calculateHashesFromBuffer(buffer: Buffer): FileHash {
  return {
    crc32: crc32(buffer).toString(16).padStart(8, '0').toUpperCase(),
    md5: crypto.createHash('md5').update(buffer).digest('hex').toUpperCase(),
    sha1: crypto.createHash('sha1').update(buffer).digest('hex').toUpperCase(),
  };
}

/**
 * Calcule les hashes d'un fichier en utilisant des streams (pour gros fichiers)
 * Optimisé pour ne pas charger tout le fichier en mémoire : le CRC32 est calculé
 * incrémentalement. Attention : le premier chunk doit être hashé SANS valeur
 * précédente (`crc32(chunk, 0)` ne donne pas le même résultat que `crc32(chunk)`).
 *
 * @param signal Permet d'interrompre la lecture (arrêt forcé d'un scan)
 */
export function calculateFileHashesStream(filePath: string, signal?: AbortSignal): Promise<FileHash> {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { signal });

    const md5Hash = crypto.createHash('md5');
    const sha1Hash = crypto.createHash('sha1');
    let crcValue: number | undefined;

    stream.on('data', (chunk: string | Buffer) => {
      const bufferChunk = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      md5Hash.update(bufferChunk);
      sha1Hash.update(bufferChunk);
      crcValue = (crcValue === undefined ? crc32(bufferChunk) : crc32(bufferChunk, crcValue)) >>> 0;
    });

    stream.on('end', () => {
      const finalCrc = crcValue === undefined ? crc32(Buffer.alloc(0)) >>> 0 : crcValue;
      resolve({
        crc32: finalCrc.toString(16).padStart(8, '0').toUpperCase(),
        md5: md5Hash.digest('hex').toUpperCase(),
        sha1: sha1Hash.digest('hex').toUpperCase()
      });
    });

    stream.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Calcule les hashes d'un fichier en choisissant automatiquement la méthode
 * selon la taille du fichier
 *
 * @param signal Permet d'interrompre la lecture (arrêt forcé d'un scan)
 */
export async function calculateFileHashes(filePath: string, sizeThreshold: number = 100 * 1024 * 1024, signal?: AbortSignal): Promise<FileHash> {
  const stats = await fs.promises.stat(filePath);
  
  if (stats.size < sizeThreshold) {
    // Pour les petits fichiers, on peut les charger en mémoire
    const buffer = await fs.promises.readFile(filePath, { signal });
    return calculateHashesFromBuffer(buffer);
  } else {
    // Pour les gros fichiers, utiliser des streams
    return calculateFileHashesStream(filePath, signal);
  }
}

/**
 * Calcule seulement le CRC32 d'un fichier (plus rapide)
 */
export function calculateCRC32Only(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    let crcValue = 0;
    
    stream.on('data', (chunk: string | Buffer) => {
      const bufferChunk = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      crcValue = crc32(chunk, crcValue);
    });
    
    stream.on('end', () => {
      resolve(crcValue.toString(16).padStart(8, '0').toUpperCase());
    });
    
    stream.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Calcule les hashes avec progression (utile pour l'UI)
 */
export function calculateFileHashesWithProgress(
  filePath: string,
  onProgress?: (percent: number) => void
): Promise<FileHash> {
  return new Promise(async (resolve, reject) => {
    try {
      const stats = await fs.promises.stat(filePath);
      const totalSize = stats.size;
      let processedSize = 0;
      
      const stream = fs.createReadStream(filePath);
      const md5Hash = crypto.createHash('md5');
      const sha1Hash = crypto.createHash('sha1');
      let crcValue = 0;
      
      stream.on('data', (chunk: string | Buffer) => {
        const bufferChunk = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;

        md5Hash.update(bufferChunk);
        sha1Hash.update(bufferChunk);
        crcValue = crc32(bufferChunk, crcValue);
        
        processedSize += bufferChunk.length;
        if (onProgress && totalSize > 0) {
          const percent = Math.round((processedSize / totalSize) * 100);
          onProgress(percent);
        }
      });
      
      stream.on('end', () => {
        resolve({
          crc32: crcValue.toString(16).padStart(8, '0').toUpperCase(),
          md5: md5Hash.digest('hex').toUpperCase(),
          sha1: sha1Hash.digest('hex').toUpperCase()
        });
      });
      
      stream.on('error', (error) => {
        reject(error);
      });
    } catch (error) {
      reject(error);
    }
  });
}
