/*
 * RUMCET - ROM's Ultimate Manager, Conversion and Editor Tool
 * Copyright (C) 2025 Nanaki59
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

// scripts/checkRomNaming.mjs
//
// Harnais de vérification du parseur de noms (src/shared/romNaming/).
// Tourne hors Electron pour permettre une itération rapide : parse un DAT réel,
// affiche la distribution des métadonnées extraites, constitue les groupes 1G1R
// et signale les anomalies (groupes hétérogènes, disques qui s'éliminent).
//
// Usage :
//   npm run build            (le script consomme dist/, pas les sources TS)
//   npm run check-naming -- "Nintendo - Game Boy Color (20260525-135930).dat"
//   npm run check-naming -- "ARCADE 0.287.dat" --samples 40

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseString } from 'xml2js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// Le script consomme la sortie compilée : pathToFileURL est indispensable sous Windows
// (une URL « file:// » construite à la main perd la lettre de lecteur).
const romNamingUrl = pathToFileURL(
  path.join(ROOT, 'dist', 'src', 'shared', 'romNaming', 'index.js')
).href;

const { parseTitle } = await import(romNamingUrl).catch(() => {
  console.error('❌ dist/ introuvable. Lance « npm run build » avant ce script.');
  process.exit(1);
});

// ── Arguments ───────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const datArg = argv.find(a => !a.startsWith('--'));
const sampleCount = parseInt(argv[argv.indexOf('--samples') + 1], 10) || 20;

if (!datArg) {
  console.error('Usage : npm run check-naming -- <fichier.dat> [--samples N]');
  process.exit(1);
}

const datPath = path.isAbsolute(datArg) ? datArg : path.join(ROOT, datArg);

// ── Lecture du DAT ──────────────────────────────────────────────────────────────

const xml = await fs.readFile(datPath, 'utf-8');
const datObject = await new Promise((resolve, reject) => {
  parseString(xml, { explicitArray: true, mergeAttrs: false }, (err, result) => {
    if (err) reject(err);
    else resolve(result);
  });
});

// Mêmes racines que src/database/insertGamesFromDat.ts
const games = [
  ...(datObject?.datafile?.game || []),
  ...(datObject?.datafile?.machine || []),
  ...(datObject?.mame?.machine || [])
];

if (games.length === 0) {
  console.error('❌ Aucun jeu trouvé dans ce DAT.');
  process.exit(1);
}

// Détection arcade : mêmes marqueurs que detectDatSetMode()
const isArcade = games.some(g =>
  g.$?.cloneof || g.$?.romof || g.$?.isbios || g.$?.isdevice || g.device_ref
);
const mode = isArcade ? 'mame' : 'nointro';

const header = datObject?.datafile?.header?.[0];
console.log('═'.repeat(78));
console.log(`DAT      : ${path.basename(datPath)}`);
console.log(`Header   : ${header?.name?.[0] ?? datObject?.mame?.$?.build ?? '(aucun)'}`);
console.log(`Jeux     : ${games.length}`);
console.log(`Mode     : ${mode}`);
console.log('═'.repeat(78));

// ── Parsing ─────────────────────────────────────────────────────────────────────

const parsed = games
  .filter(g => g.$?.name)
  .map(g => ({
    name: g.$.name,
    description: g.description?.[0] ?? null,
    cloneof: g.$?.cloneof ?? g.$?.romof ?? null,
    parsed: parseTitle(g.$.name, { mode, description: g.description?.[0] ?? null })
  }));

// ── Distributions ───────────────────────────────────────────────────────────────

function histogram(items, label, { limit = 15 } = {}) {
  const counts = new Map();
  for (const value of items) counts.set(value, (counts.get(value) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\n── ${label} (${counts.size} valeurs distinctes)`);
  for (const [value, count] of sorted.slice(0, limit)) {
    const pct = ((count / parsed.length) * 100).toFixed(1).padStart(5);
    console.log(`   ${pct}%  ${String(count).padStart(6)}  ${value}`);
  }
  if (sorted.length > limit) console.log(`   … ${sorted.length - limit} autres`);
}

histogram(parsed.flatMap(p => p.parsed.regions.length ? p.parsed.regions : ['(aucune)']), 'Régions');
histogram(parsed.flatMap(p => p.parsed.languages.length ? p.parsed.languages : ['(aucune)']), 'Langues');
histogram(parsed.map(p => p.parsed.videoMode ?? '(aucun)'), 'Modes vidéo');
histogram(parsed.map(p => p.parsed.devStatus ?? '(production)'), 'Statut de développement');
histogram(parsed.flatMap(p => p.parsed.releaseFlags.length ? p.parsed.releaseFlags : ['(aucun)']), 'Marqueurs de diffusion');
histogram(parsed.map(p => p.parsed.revision ?? '(aucune)'), 'Révisions', { limit: 10 });

// Tags non classés : ce qui reste après extraction. C'est le signal principal pour
// repérer une catégorie de tag que le parseur ignore encore.
//
// Le test se fait en soumettant le tag SEUL au parseur plutôt qu'en comparant au
// résultat global : comparer des libellés produirait des faux positifs à la pelle
// (le tag « Proto » donne le statut « proto », le tag « US » donne la région « USA »).
const claimedCache = new Map();

function isTagClaimed(tag) {
  if (claimedCache.has(tag)) return claimedCache.get(tag);
  const probe = mode === 'mame'
    ? parseTitle('Probe', { mode, description: `Probe (${tag})` })
    : parseTitle(`Probe (${tag})`, { mode });
  const claimed =
    probe.regions.length > 0 ||
    (probe.languages.length > 0 && !probe.languagesAreImplied) ||
    probe.videoMode !== null ||
    probe.revision !== null ||
    probe.devStatus !== null ||
    probe.releaseFlags.length > 0 ||
    probe.discNumber !== null ||
    probe.isBiosTag;
  claimedCache.set(tag, claimed);
  return claimed;
}

const unclassified = [];
for (const p of parsed) {
  for (const tag of p.parsed.tags) {
    const normalized = tag.replace(/\s+/g, ' ').trim();
    if (!isTagClaimed(normalized)) unclassified.push(normalized);
  }
}
histogram(unclassified, 'Tags NON classés (candidats à ajouter au parseur)', { limit: 25 });

// ── Groupes 1G1R ────────────────────────────────────────────────────────────────

// Même clé que celle prévue en phase B : famille de clones en MAME, titre normalisé
// sinon, le numéro de disque entrant TOUJOURS dans la clé.
function groupKeyOf(entry) {
  const disc = entry.parsed.discNumber != null ? `#disc${entry.parsed.discNumber}` : '';
  if (mode === 'mame') return `${entry.cloneof ?? entry.name}${disc}`;
  return `${entry.parsed.baseTitle}${disc}`;
}

const groups = new Map();
for (const entry of parsed) {
  const key = groupKeyOf(entry);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(entry);
}

const multi = [...groups.entries()].filter(([, members]) => members.length > 1);
const totalInMulti = multi.reduce((sum, [, m]) => sum + m.length, 0);

console.log('\n' + '═'.repeat(78));
console.log('GROUPES 1G1R');
console.log('═'.repeat(78));
console.log(`   Titres            : ${parsed.length}`);
console.log(`   Groupes           : ${groups.size}`);
console.log(`   Groupes > 1 membre: ${multi.length}`);
console.log(`   Titres regroupés  : ${totalInMulti}`);
console.log(`   Réduction 1G1R    : ${parsed.length} → ${groups.size} ` +
  `(-${(((parsed.length - groups.size) / parsed.length) * 100).toFixed(1)} %)`);

// ── Anomalies ───────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(78));
console.log('ANOMALIES');
console.log('═'.repeat(78));

// 1. Deux disques différents dans un même groupe : interdit par construction.
let discCollisions = 0;
for (const [key, members] of groups) {
  const discs = new Set(members.map(m => m.parsed.discNumber));
  if (discs.size > 1) {
    discCollisions++;
    if (discCollisions <= 5) console.log(`   ⚠ disques mélangés : ${key}`);
  }
}
console.log(discCollisions === 0
  ? '   ✓ aucun groupe ne mélange deux numéros de disque'
  : `   ✗ ${discCollisions} groupes mélangent des disques`);

// 2. Groupes hétérogènes : plusieurs titres affichés distincts sous une même clé.
//    En mode No-Intro c'est le signe d'une sur-normalisation du titre.
if (mode === 'nointro') {
  let heterogeneous = 0;
  for (const [key, members] of groups) {
    const titles = new Set(members.map(m => m.parsed.displayTitle.toLowerCase()));
    if (titles.size > 1) {
      heterogeneous++;
      if (heterogeneous <= 5) {
        console.log(`   ⚠ titres distincts sous « ${key} » : ${[...titles].join(' | ')}`);
      }
    }
  }
  console.log(heterogeneous === 0
    ? '   ✓ aucun groupe ne mélange deux titres distincts'
    : `   ${heterogeneous} groupes agrègent des libellés différents (vérifier au cas par cas)`);
}

// 3. Titres sans aucune région : ils ne pourront pas être arbitrés par région.
const noRegion = parsed.filter(p => p.parsed.regions.length === 0);
console.log(`   ${noRegion.length === 0 ? '✓' : 'ℹ'} ${noRegion.length} titres sans région détectée` +
  (noRegion.length > 0 ? ` (ex. « ${noRegion[0].name} »)` : ''));

// ── Échantillons ────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(78));
console.log(`ÉCHANTILLON — ${sampleCount} groupes multi-membres`);
console.log('═'.repeat(78));

for (const [key, members] of multi.slice(0, sampleCount)) {
  console.log(`\n▸ ${key}  (${members.length} versions)`);
  for (const m of members) {
    const p = m.parsed;
    const bits = [
      p.regions.join('+') || '—',
      p.languages.join(',') + (p.languagesAreImplied ? '*' : '') || '—',
      p.videoMode ?? '',
      p.revision ?? '',
      p.devStatus ?? '',
      p.releaseFlags.join(',')
    ].filter(Boolean);
    console.log(`    ${m.name}`);
    console.log(`        ${bits.join('  |  ')}`);
  }
}

console.log('\n(* = langues déduites de la région, non déclarées dans le nom)');
