/*
 * RUMCET - ROM's Ultimate Manager, Conversion and Editor Tool
 * Copyright (C) 2025 Nanaki59
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// src/helpers/archives/csoFormat.ts
// Décodeur natif des images CSO (CISO v1/v2) et ZSO (ZISO), sans outil externe.
// Une image CSO est une ISO découpée en blocs compressés individuellement :
//
//   en-tête (24 o) : magic "CISO"/"ZISO", header_size u32, total_bytes u64,
//                    block_size u32, version u8, align u8, réservé u16
//   index          : (nbBlocs + 1) × u32 LE ; position = (valeur & 0x7FFFFFFF) << align
//
//   Bit fort de l'index | CISO v0/v1      | CISO v2                          | ZISO
//   1                   | non compressé    | LZ4                              | non compressé
//   0                   | deflate brut     | non compressé si taille ≥ bloc,  | LZ4
//                       |                  | sinon deflate brut               |
//
// Vérifié par scripts/checkCso.mjs.

import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import zlib from 'zlib';
import { crc32 } from 'crc';
import type { FileHash } from './types.js';

const HEADER_SIZE = 24;
const INDEX_FLAG = 0x80000000;
const INDEX_MASK = 0x7FFFFFFF;
/** Fenêtre de lecture : on lit le fichier par gros morceaux, pas bloc par bloc. */
const READ_WINDOW = 4 * 1024 * 1024;
/** Volume décompressé rendu à chaque itération (limite les allers-retours). */
const OUTPUT_CHUNK = 1024 * 1024;

export interface CsoInfo {
  magic: 'CISO' | 'ZISO';
  version: number;
  /** Taille de l'ISO décompressée. */
  totalBytes: number;
  blockSize: number;
  align: number;
  blockCount: number;
}

function parseHeader(header: Buffer, filePath: string): CsoInfo {
  if (header.length < HEADER_SIZE) throw new Error(`Not a CSO file (truncated header): ${filePath}`);
  const magic = header.toString('latin1', 0, 4);
  if (magic !== 'CISO' && magic !== 'ZISO') throw new Error(`Not a CSO/ZSO file (magic "${magic}"): ${filePath}`);
  const totalBytes = Number(header.readBigUInt64LE(8));
  const blockSize = header.readUInt32LE(16);
  const version = header.readUInt8(20);
  const align = header.readUInt8(21);
  if (blockSize === 0 || blockSize > 16 * 1024 * 1024 || (blockSize & (blockSize - 1)) !== 0) {
    throw new Error(`Invalid CSO block size (${blockSize}): ${filePath}`);
  }
  if (align > 31) throw new Error(`Invalid CSO alignment (${align}): ${filePath}`);
  return { magic, version, totalBytes, blockSize, align, blockCount: Math.ceil(totalBytes / blockSize) };
}

/** En-tête d'une image CSO/ZSO. */
export async function csoInfo(filePath: string): Promise<CsoInfo> {
  const handle = await fsp.open(filePath, 'r');
  try {
    const header = Buffer.alloc(HEADER_SIZE);
    const { bytesRead } = await handle.read(header, 0, HEADER_SIZE, 0);
    return parseHeader(header.subarray(0, bytesRead), filePath);
  } finally {
    await handle.close();
  }
}

/**
 * Décodeur de bloc LZ4 (format « block », sans en-tête de trame). S'arrête dès
 * que `outLen` octets sont produits : l'éventuel bourrage d'alignement qui suit
 * les données compressées est ignoré.
 */
export function lz4DecodeBlock(src: Buffer, outLen: number): Buffer {
  const out = Buffer.alloc(outLen);
  let ip = 0;
  let op = 0;
  while (op < outLen) {
    if (ip >= src.length) throw new Error('LZ4: unexpected end of input');
    const token = src[ip++];

    let litLen = token >>> 4;
    if (litLen === 15) {
      let b: number;
      do {
        if (ip >= src.length) throw new Error('LZ4: unexpected end of input');
        b = src[ip++];
        litLen += b;
      } while (b === 255);
    }
    if (ip + litLen > src.length || op + litLen > outLen) throw new Error('LZ4: literal run out of bounds');
    src.copy(out, op, ip, ip + litLen);
    ip += litLen;
    op += litLen;
    if (op >= outLen) break; // dernière séquence : littéraux seuls

    if (ip + 2 > src.length) throw new Error('LZ4: unexpected end of input');
    const offset = src[ip] | (src[ip + 1] << 8);
    ip += 2;
    if (offset === 0 || offset > op) throw new Error('LZ4: invalid match offset');

    let matchLen = token & 15;
    if (matchLen === 15) {
      let b: number;
      do {
        if (ip >= src.length) throw new Error('LZ4: unexpected end of input');
        b = src[ip++];
        matchLen += b;
      } while (b === 255);
    }
    matchLen += 4;
    if (op + matchLen > outLen) throw new Error('LZ4: match out of bounds');
    // Copie octet par octet : la source peut chevaucher la destination
    for (let i = 0; i < matchLen; i++, op++) out[op] = out[op - offset];
  }
  return out;
}

type BlockEncoding = 'raw' | 'deflate' | 'lz4';

function blockEncoding(info: CsoInfo, flagged: boolean, storedSize: number): BlockEncoding {
  if (info.magic === 'ZISO') return flagged ? 'raw' : 'lz4';
  if (info.version >= 2) {
    if (flagged) return 'lz4';
    return storedSize >= info.blockSize ? 'raw' : 'deflate';
  }
  return flagged ? 'raw' : 'deflate';
}

function decodeBlock(encoding: BlockEncoding, data: Buffer, outLen: number): Buffer {
  switch (encoding) {
    case 'raw':
      if (data.length < outLen) throw new Error('CSO: truncated uncompressed block');
      return data.subarray(0, outLen);
    case 'lz4':
      return lz4DecodeBlock(data, outLen);
    case 'deflate': {
      // Le bourrage d'alignement après la fin du flux deflate est ignoré par zlib
      const out = zlib.inflateRawSync(data);
      if (out.length < outLen) throw new Error('CSO: deflate block shorter than expected');
      return out.length === outLen ? out : out.subarray(0, outLen);
    }
  }
}

/**
 * Parcourt l'ISO contenue dans une image CSO/ZSO, par morceaux décompressés
 * (environ 1 Mio). Interrompable via `signal`.
 */
export async function* readCsoData(filePath: string, signal?: AbortSignal): AsyncGenerator<Buffer> {
  const handle = await fsp.open(filePath, 'r');
  try {
    const fileSize = (await handle.stat()).size;
    const header = Buffer.alloc(HEADER_SIZE);
    const { bytesRead } = await handle.read(header, 0, HEADER_SIZE, 0);
    const info = parseHeader(header.subarray(0, bytesRead), filePath);

    const indexBytes = (info.blockCount + 1) * 4;
    const index = Buffer.alloc(indexBytes);
    const indexRead = (await handle.read(index, 0, indexBytes, HEADER_SIZE)).bytesRead;
    if (indexRead < indexBytes) throw new Error(`CSO index truncated: ${filePath}`);

    let window = Buffer.alloc(0);
    let windowStart = 0;
    const readRange = async (pos: number, size: number): Promise<Buffer> => {
      if (pos < windowStart || pos + size > windowStart + window.length) {
        const length = Math.min(Math.max(READ_WINDOW, size), fileSize - pos);
        if (length < size) throw new Error(`CSO data truncated: ${filePath}`);
        window = Buffer.alloc(length);
        const got = (await handle.read(window, 0, length, pos)).bytesRead;
        if (got < size) throw new Error(`CSO data truncated: ${filePath}`);
        window = window.subarray(0, got);
        windowStart = pos;
        signal?.throwIfAborted();
      }
      return window.subarray(pos - windowStart, pos - windowStart + size);
    };

    let pending: Buffer[] = [];
    let pendingSize = 0;
    let remaining = info.totalBytes;
    for (let i = 0; i < info.blockCount; i++) {
      const raw = index.readUInt32LE(i * 4);
      const pos = (raw & INDEX_MASK) * 2 ** info.align;
      const next = (index.readUInt32LE((i + 1) * 4) & INDEX_MASK) * 2 ** info.align;
      const storedSize = next - pos;
      if (storedSize <= 0 || next > fileSize) throw new Error(`CSO index corrupted at block ${i}: ${filePath}`);

      const outLen = Math.min(info.blockSize, remaining);
      const encoding = blockEncoding(info, (raw & INDEX_FLAG) !== 0, storedSize);
      // Bloc non compressé : seuls `outLen` octets sont utiles (le reste est du bourrage)
      const data = await readRange(pos, encoding === 'raw' ? Math.min(storedSize, outLen) : storedSize);
      let block: Buffer;
      try {
        block = decodeBlock(encoding, data, outLen);
      } catch (error: any) {
        throw new Error(`CSO block ${i} unreadable (${error?.message || error}): ${filePath}`);
      }
      // Le bloc peut pointer dans la fenêtre réutilisée : on le copie avant de le garder
      pending.push(encoding === 'raw' ? Buffer.from(block) : block);
      pendingSize += outLen;
      remaining -= outLen;

      if (pendingSize >= OUTPUT_CHUNK) {
        yield Buffer.concat(pending, pendingSize);
        pending = [];
        pendingSize = 0;
        signal?.throwIfAborted();
      }
    }
    if (pendingSize > 0) yield Buffer.concat(pending, pendingSize);
  } finally {
    await handle.close();
  }
}

/** Hashs (CRC32, MD5, SHA1) de l'ISO contenue, calculés à la volée sans fichier temporaire. */
export async function hashCso(filePath: string, signal?: AbortSignal): Promise<FileHash & { size: number }> {
  const md5 = crypto.createHash('md5');
  const sha1 = crypto.createHash('sha1');
  let crcValue: number | undefined;
  let size = 0;
  for await (const chunk of readCsoData(filePath, signal)) {
    md5.update(chunk);
    sha1.update(chunk);
    // Premier morceau sans valeur précédente (crc32(x, 0) ≠ crc32(x))
    crcValue = (crcValue === undefined ? crc32(chunk) : crc32(chunk, crcValue)) >>> 0;
    size += chunk.length;
  }
  const finalCrc = crcValue === undefined ? crc32(Buffer.alloc(0)) >>> 0 : crcValue;
  return {
    crc32: finalCrc.toString(16).padStart(8, '0').toUpperCase(),
    md5: md5.digest('hex').toUpperCase(),
    sha1: sha1.digest('hex').toUpperCase(),
    size
  };
}

/** Décompresse l'image CSO/ZSO vers `outputPath` (ISO). Supprime le fichier partiel en cas d'échec. */
export async function decompressCso(filePath: string, outputPath: string, signal?: AbortSignal): Promise<void> {
  const out = fs.createWriteStream(outputPath);
  const finished = new Promise<void>((resolve, reject) => {
    out.on('finish', resolve);
    out.on('error', reject);
  });
  try {
    for await (const chunk of readCsoData(filePath, signal)) {
      if (!out.write(chunk)) {
        await new Promise<void>((resolve, reject) => {
          out.once('drain', resolve);
          out.once('error', reject);
        });
      }
    }
    out.end();
    await finished;
  } catch (error) {
    out.destroy();
    await fsp.rm(outputPath, { force: true }).catch(() => { /* ignore */ });
    throw error;
  }
}
