/*
 * RUMCET - ROM's Ultimate Manager, Conversion and Editor Tool
 * Copyright (C) 2025 Nanaki59
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

// scripts/checkSourceCleanup.mjs
//
// Harnais de vérification des décisions du nettoyage des sources
// (src/helpers/sourceCleanupPlan.ts) : utilité d'un fichier, action sur un
// conteneur, libellés des dossiers sources dans le dossier des non matchés.
//
// Usage :
//   npm run build            (le script consomme dist/, pas les sources TS)
//   npm run check-cleanup

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const planUrl = pathToFileURL(path.join(ROOT, 'dist', 'src', 'helpers', 'sourceCleanupPlan.js')).href;

const { isInsideFolder, isItemNeeded, planContainer, minimalRootLabels, findRoot } = await import(planUrl).catch(() => {
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

// ─── isInsideFolder ───
console.log('isInsideFolder');
const base = path.resolve('/roms');
check('même dossier', isInsideFolder(base, base), true);
check('sous-dossier', isInsideFolder(path.join(base, 'psx', 'a.zip'), base), true);
check('préfixe homonyme', isInsideFolder(path.resolve('/roms2/a.zip'), base), false);
check('dossier vide', isInsideFolder(base, ''), false);

// ─── isItemNeeded ───
// Jeux : 1 = jeu consolidé (déclarant), 2 = en attente, 3 = consolidé plus tôt,
// 4 = en erreur, 5 = sélectionné hors run (incomplet), 6 = non sélectionné.
console.log('isItemNeeded');
const statuses = new Map([[1, 'succeeded'], [2, 'pending'], [3, 'succeeded'], [4, 'failed']]);
const ctx = (protectUnselected) => ({
  statusOf: id => statuses.get(id),
  isSelected: id => id === 5,
  protectUnselected
});
const reg = new Set([1]);
check('seul le déclarant', isItemNeeded([1], reg, false, ctx(true)), false);
check('jeu en attente', isItemNeeded([1, 2], reg, false, ctx(true)), true);
check('copie d\'un jeu déjà consolidé', isItemNeeded([1, 3], reg, false, ctx(true)), false);
check('jeu en erreur', isItemNeeded([1, 4], reg, false, ctx(true)), true);
check('sélectionné incomplet', isItemNeeded([1, 5], reg, false, ctx(false)), true);
check('non sélectionné, protection active', isItemNeeded([1, 6], reg, false, ctx(true)), true);
check('non sélectionné, protection inactive', isItemNeeded([1, 6], reg, false, ctx(false)), false);
check('dossier cible : sortie d\'un autre jeu', isItemNeeded([1, 3], reg, true, ctx(false)), true);
check('dossier cible : ancienne version du jeu', isItemNeeded([1], reg, true, ctx(false)), false);

// ─── planContainer ───
console.log('planContainer');
const plan = (over) => planContainer({
  kind: 'modifiable', removable: ['game.bin'], keptCount: 0, unmatched: [],
  moveUnmatched: true, readOnlyMode: 'repack', ...over
});
check('rien de retirable', plan({ removable: [] }).type, 'none');
check('tout inutile → suppression', plan({}).type, 'delete');
check('hybride bin + cue non matché → retrait puis déplacement',
  plan({ unmatched: ['bad.cue'] }), { type: 'strip-and-move', remove: ['game.bin'] });
check('hybride, déplacement désactivé → retrait seul',
  plan({ unmatched: ['bad.cue'], moveUnmatched: false }), { type: 'strip', remove: ['game.bin'] });
check('jeu non sélectionné protégé + inconnu → scission',
  plan({ keptCount: 2, unmatched: ['readme.txt'] }),
  { type: 'strip-and-split', remove: ['game.bin'], split: ['readme.txt'] });
check('jeu protégé, sans inconnu → retrait', plan({ keptCount: 2 }), { type: 'strip', remove: ['game.bin'] });
check('CHD/CSO sans non matché → suppression', plan({ kind: 'readonly' }).type, 'delete');
check('CHD avec cue non matché → recompression', plan({ kind: 'readonly', unmatched: ['game.cue'] }),
  { type: 'repack-unmatched', unmatched: ['game.cue'] });
check('CHD encore utile → conservé', plan({ kind: 'readonly', keptCount: 1 }).type, 'keep-readonly');
check('RAR hybride → recompression', plan({ kind: 'readonly', unmatched: ['a.nfo'] }),
  { type: 'repack-unmatched', unmatched: ['a.nfo'] });
check('RAR hybride, mode déplacement', plan({ kind: 'readonly', unmatched: ['a.nfo'], readOnlyMode: 'move' }).type, 'move');
check('RAR hybride, déplacement désactivé', plan({ kind: 'readonly', unmatched: ['a.nfo'], moveUnmatched: false }).type, 'keep-readonly');
check('RAR encore utile', plan({ kind: 'readonly', keptCount: 1 }).type, 'keep-readonly');

// ─── minimalRootLabels ───
console.log('minimalRootLabels');
const r1 = path.resolve('/data/parentfolder1/sourcefolder1');
const r2 = path.resolve('/data/parentfolder2/sourcefolder2');
const r3 = path.resolve('/other/parentfolder3/sourcefolder1');
const labels = minimalRootLabels([r1, r2, r3]);
check('homonyme 1', labels.get(r1), ['parentfolder1', 'sourcefolder1']);
check('unique', labels.get(r2), ['sourcefolder2']);
check('homonyme 2', labels.get(r3), ['parentfolder3', 'sourcefolder1']);
const nested = path.join(r1, 'sub');
check('racine la plus profonde', findRoot(path.join(nested, 'x.zip'), [r1, nested]), nested);
check('hors racines', findRoot(path.resolve('/elsewhere/x.zip'), [r1]), null);

console.log(failures === 0 ? '\n✅ Tous les cas passent.' : `\n❌ ${failures} cas en échec.`);
process.exit(failures === 0 ? 0 : 1);
