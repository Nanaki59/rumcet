/*
 * RUMCET - ROM's Ultimate Manager, Conversion and Editor Tool
 * Copyright (C) 2025 Nanaki59
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

// scripts/checkCso.mjs
//
// Harnais de vérification du décodeur CSO/ZSO (src/helpers/archives/csoFormat.ts) :
// fabrique des images CISO v1, CISO v2 et ZISO à partir d'une ISO synthétique
// (blocs aléatoires, blocs de zéros, texte répété, dernier bloc partiel), puis
// vérifie que les hashs et la décompression redonnent l'ISO d'origine.
//
// Usage :
//   npm run build            (le script consomme dist/, pas les sources TS)
//   npm run check-cso

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32 } from 'crc';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const csoUrl = pathToFileURL(path.join(ROOT, 'dist', 'src', 'helpers', 'archives', 'csoFormat.js')).href;

const { hashCso, decompressCso, csoInfo, lz4DecodeBlock } = await import(csoUrl).catch(() => {
  console.error('❌ dist/ introuvable. Lance « npm run build » avant ce script.');
  process.exit(1);
});

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}\n      attendu : ${e}\n      obtenu  : ${a}`);
  }
}

// ─── Encodeur LZ4 (bloc) minimal, pour fabriquer les jeux de test ───
function lz4Encode(src) {
  const out = [];
  const pushLen = (n) => { while (n >= 255) { out.push(255); n -= 255; } out.push(n); };
  const emit = (litStart, litEnd, offset, matchLen) => {
    const litLen = litEnd - litStart;
    const m = matchLen ? matchLen - 4 : 0;
    out.push((Math.min(litLen, 15) << 4) | Math.min(m, 15));
    if (litLen >= 15) pushLen(litLen - 15);
    for (let k = litStart; k < litEnd; k++) out.push(src[k]);
    if (matchLen) {
      out.push(offset & 0xff, offset >> 8);
      if (m >= 15) pushLen(m - 15);
    }
  };
  const seen = new Map();
  let anchor = 0;
  let i = 0;
  while (i + 4 <= src.length) {
    const key = src.readUInt32LE(i);
    const cand = seen.get(key);
    seen.set(key, i);
    if (cand !== undefined && i - cand <= 65535) {
      let len = 4;
      while (i + len < src.length && src[cand + len] === src[i + len]) len++;
      emit(anchor, i, i - cand, len);
      i += len;
      anchor = i;
    } else {
      i++;
    }
  }
  emit(anchor, src.length, 0, 0);
  return Buffer.from(out);
}

// ─── Fabrication d'une image CSO ───
function buildCso(iso, { magic, version, blockSize, align, encode }) {
  const blockCount = Math.ceil(iso.length / blockSize);
  const header = Buffer.alloc(24);
  header.write(magic, 0, 'latin1');
  header.writeUInt32LE(24, 4);
  header.writeBigUInt64LE(BigInt(iso.length), 8);
  header.writeUInt32LE(blockSize, 16);
  header.writeUInt8(version, 20);
  header.writeUInt8(align, 21);
  const index = Buffer.alloc((blockCount + 1) * 4);
  const parts = [header, index];
  const unit = 2 ** align;
  let pos = header.length + index.length;
  const padTo = () => {
    const pad = (unit - (pos % unit)) % unit;
    if (pad) { parts.push(Buffer.alloc(pad, 0xAA)); pos += pad; }
  };
  padTo();
  for (let i = 0; i < blockCount; i++) {
    const block = iso.subarray(i * blockSize, Math.min((i + 1) * blockSize, iso.length));
    const { data, flag } = encode(block, i, blockCount);
    index.writeUInt32LE(((pos / unit) | (flag ? 0x80000000 : 0)) >>> 0, i * 4);
    parts.push(data);
    pos += data.length;
    padTo();
  }
  index.writeUInt32LE(pos / unit, blockCount * 4);
  return Buffer.concat(parts);
}

// ISO synthétique : 37 blocs de 2048 + un bloc partiel de 1000 octets
const BLOCK = 2048;
const blocks = [];
for (let i = 0; i < 37; i++) {
  if (i % 3 === 0) blocks.push(crypto.randomBytes(BLOCK));
  else if (i % 3 === 1) blocks.push(Buffer.alloc(BLOCK));
  else blocks.push(Buffer.from('RUMCET-'.repeat(Math.ceil(BLOCK / 7)).slice(0, BLOCK)));
}
blocks.push(Buffer.from('LAST-'.repeat(200)));
const iso = Buffer.concat(blocks);
const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex').toUpperCase();
const isoSha1 = sha1(iso);

const deflate = (b) => zlib.deflateRawSync(b, { level: 9 });
const isRandom = (i, n) => i % 3 === 0 && i !== n - 1;

const variants = {
  'CISO v1 (deflate + non compressé)': {
    magic: 'CISO', version: 1, blockSize: BLOCK, align: 0,
    encode: (b, i, n) => isRandom(i, n) ? { data: b, flag: true } : { data: deflate(b), flag: false }
  },
  'CISO v1 aligné (bourrage après deflate)': {
    magic: 'CISO', version: 1, blockSize: BLOCK, align: 3,
    encode: (b, i, n) => isRandom(i, n) ? { data: b, flag: true } : { data: deflate(b), flag: false }
  },
  'CISO v2 (LZ4 + deflate + non compressé)': {
    magic: 'CISO', version: 2, blockSize: BLOCK, align: 0,
    encode: (b, i, n) => isRandom(i, n) ? { data: b, flag: false }
      : i % 2 === 0 ? { data: lz4Encode(b), flag: true } : { data: deflate(b), flag: false }
  },
  'ZISO aligné (LZ4 + non compressé)': {
    magic: 'ZISO', version: 1, blockSize: BLOCK, align: 1,
    encode: (b, i, n) => isRandom(i, n) ? { data: b, flag: true } : { data: lz4Encode(b), flag: false }
  }
};

const work = await fs.mkdtemp(path.join(os.tmpdir(), 'rumcet-cso-'));
try {
  console.log('lz4DecodeBlock');
  const sample = Buffer.from('abcabcabcabcabcabc-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-end');
  check('aller-retour (correspondances chevauchantes)', lz4DecodeBlock(lz4Encode(sample), sample.length).equals(sample), true);

  for (const [label, opts] of Object.entries(variants)) {
    console.log(label);
    const file = path.join(work, `${opts.magic}-${opts.version}-${opts.align}.cso`);
    await fs.writeFile(file, buildCso(iso, opts));

    const info = await csoInfo(file);
    check('en-tête', [info.magic, info.totalBytes, info.blockCount], [opts.magic, iso.length, 38]);

    const h = await hashCso(file);
    check('taille', h.size, iso.length);
    check('SHA1 de l\'ISO', h.sha1, isoSha1);
    check('CRC32 de l\'ISO', h.crc32, (crc32(iso) >>> 0).toString(16).padStart(8, '0').toUpperCase());

    const out = path.join(work, 'out.iso');
    await decompressCso(file, out);
    check('décompression à l\'octet près', sha1(await fs.readFile(out)), isoSha1);
  }

  console.log('Erreurs');
  const bad = path.join(work, 'bad.cso');
  await fs.writeFile(bad, Buffer.alloc(64));
  const err = await hashCso(bad).then(() => null, (e) => e.message);
  check('magic invalide rejeté', !!err && err.includes('Not a CSO'), true);
} finally {
  await fs.rm(work, { recursive: true, force: true });
}

console.log(failures === 0 ? '\n✅ Tous les cas passent.' : `\n❌ ${failures} cas en échec.`);
process.exit(failures === 0 ? 0 : 1);
