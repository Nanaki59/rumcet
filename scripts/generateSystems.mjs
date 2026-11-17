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
 */

// scripts/generateSystems.mjs
//
// Génère src/config/systemsData.ts (données embarquées du registre des systèmes)
// en agrégant 3 sources :
//   1. Recalbox (system.ini) — fullname, manufacturer, type, releaseDate, formats
//      https://gitlab.com/recalbox/recalbox/.../package/recalbox-romfs2/systems/
//   2. no-intro DAT-o-MATIC — IDs des DAT par système (UNE requête, User-Agent navigateur)
//      https://datomatic.no-intro.org/index.php?page=download
//   3. redump.org — slugs des DAT par système
//      https://redump.org/downloads/
//
// Le parsing Recalbox et l'accès GitLab sont partagés avec la mise à jour des
// systèmes à la demande dans l'application (src/shared/recalboxSystems.ts,
// src/helpers/recalboxGitlab.ts) : le script consomme leur sortie compilée.
// DAT-o-MATIC n'est interrogé QUE par ce script de build, jamais par l'application.
//
// Les patterns de détection (systemId à partir du nom du DAT), les formats bruts
// des DATs, les profils et les mappings nom-source → systemId sont maintenus à la
// main dans ce fichier.
//
// Usage : npm run sync-systems [-- --ref <tag Recalbox>]   (défaut : master)

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT, 'src', 'config', 'systemsData.ts');
// En-tête de licence lu depuis le fichier (et non recopié ici) : un outil d'insertion
// d'en-têtes avait corrompu ce script en matchant le commentaire de licence du template.
const LICENSE_HEADER_PATH = path.join(ROOT, 'LICENSE_HEADER');

// Le script consomme la sortie compilée : pathToFileURL est indispensable sous Windows
// (une URL « file:// » construite à la main perd la lettre de lecteur).
const distUrl = (...segments) => pathToFileURL(path.join(ROOT, 'dist', 'src', ...segments)).href;

// ============================================================
// MAPPINGS MANUELS (à compléter au besoin)
// ============================================================

// Patterns regex (sans flags) testés contre le nom du <header><name> du DAT
// pour identifier le système. Premier match dans DAT_DETECTION_ORDER l'emporte.
const SYSTEM_DAT_PATTERNS = {
  // Sony
  psx: ['playstation(?!\\s*[2-9])|psx|ps1'],
  ps2: ['playstation\\s*2|ps2'],
  psp: ['playstation\\s*portable|psp'],
  // Sega
  dreamcast: ['dreamcast'],
  saturn: ['saturn'],
  segacd: ['sega\\s*cd|mega\\s*cd'],
  sega32x: ['32x'],
  megadrive: ['mega\\s*drive|genesis'],
  mastersystem: ['master\\s*system|mark\\s*iii'],
  gamegear: ['game\\s*gear'],
  sg1000: ['sg[\\s-]*1000'],
  pico: ['sega\\s*pico'],
  // Nintendo
  '3ds': ['3ds|nintendo\\s*3ds'],
  nds: ['nintendo\\s*ds(?!i)|nds'],
  gba: ['game\\s*boy\\s*advance|gba'],
  gbc: ['game\\s*boy\\s*color|gbc'],
  gb: ['game\\s*boy(?!\\s*(advance|color))|gb(?![ac])'],
  gamecube: ['gamecube|nintendo\\s*gc'],
  wii: ['^(?!.*wii\\s*u).*\\bwii\\b'],
  snes: ['super\\s*nintendo|snes|super\\s*famicom'],
  n64: ['nintendo\\s*64(?!dd)|n64(?!dd)'],
  '64dd': ['64\\s*dd|n64dd'],
  nes: ['nintendo\\s*entertainment|\\bnes\\b|famicom(?!\\s*disk)'],
  fds: ['famicom\\s*disk|fds'],
  satellaview: ['satellaview'],
  virtualboy: ['virtual\\s*boy'],
  pokemini: ['pokemon\\s*mini|pokémon\\s*mini'],
  sufami: ['sufami\\s*turbo'],
  // Microsoft
  xbox: ['^(?!.*360).*\\bxbox\\b'],
  // NEC
  pcengine: ['pc\\s*engine(?!\\s*cd)|turbografx(?!\\s*cd|-16\\s*cd)'],
  pcenginecd: ['pc\\s*engine\\s*cd|turbografx[\\s-]*cd'],
  supergrafx: ['supergrafx'],
  pcfx: ['pc[\\s-]*fx'],
  pc88: ['pc[\\s-]*88'],
  pc98: ['pc[\\s-]*98'],
  // SNK
  neogeo: ['neo[\\s-]*geo(?!\\s*(cd|pocket))'],
  neogeocd: ['neo[\\s-]*geo\\s*cd'],
  ngp: ['neo[\\s-]*geo\\s*pocket(?!\\s*color)'],
  ngpc: ['neo[\\s-]*geo\\s*pocket\\s*color'],
  // Atari
  atari2600: ['atari[\\s-]*2600'],
  atari5200: ['atari[\\s-]*5200'],
  atari7800: ['atari[\\s-]*7800'],
  atari800: ['atari[\\s-]*8[\\s-]*bits?|atari[\\s-]*800'],
  atarist: ['atari\\s*st\\b'],
  jaguar: ['atari\\s*jaguar(?!\\s*cd)|^jaguar(?!\\s*cd)'],
  lynx: ['atari\\s*lynx|^lynx\\b'],
  // Bandai
  wswan: ['wonderswan(?!\\s*color)'],
  wswanc: ['wonderswan\\s*color'],
  // Commodore
  amiga600: ['amiga\\s*(ecs|ocs|600|500)'],
  amiga1200: ['amiga\\s*(aga|1200|4000)'],
  amigacd32: ['amiga\\s*cd\\s*32|cd32'],
  amigacdtv: ['amiga\\s*cdtv|cdtv'],
  c64: ['commodore\\s*64|c64'],
  vic20: ['vic[\\s-]*20'],
  // Magnavox / Mattel / Fairchild
  intellivision: ['intellivision'],
  o2em: ['odyssey\\s*2|videopac(?!\\s*\\+)'],
  videopacplus: ['videopac\\s*\\+'],
  channelf: ['channel\\s*f'],
  // Computers
  msx1: ['^msx\\b(?!\\s*2|\\s*turbo)|msx1'],
  msx2: ['msx[\\s-]*2(?!\\s*plus|\\s*\\+)'],
  msxturbor: ['msx\\s*turbo'],
  x68000: ['x68000'],
  x1: ['sharp\\s*x1\\b'],
  zxspectrum: ['zx\\s*spectrum'],
  zx81: ['zx[\\s-]*81'],
  amstradcpc: ['amstrad\\s*cpc'],
  gx4000: ['gx4000|amstrad\\s*gx'],
  // Apple
  apple2: ['apple\\s*ii(?!gs)|apple\\s*2(?!gs)'],
  apple2gs: ['apple\\s*ii\\s*gs|apple\\s*iigs'],
  macintosh: ['macintosh|^mac\\b'],
  // PC
  dos: ['\\bdos\\b|ibm\\s*pc|pc\\s*compatible'],
  // Arcade
  mame: ['^mame|m\\.a\\.m\\.e\\.|^arcade(?!\\s*pc)'],
  fba: ['finalburn\\s*alpha\\s*2x|fba(?!\\s*neo)'],
  fbneo: ['finalburn\\s*neo|fbneo'],
  atomiswave: ['atomiswave'],
  naomi: ['^naomi(?!\\s*2|\\s*gd)'],
  naomi2: ['naomi\\s*2'],
  naomigd: ['naomi\\s*gd'],
  model3: ['model\\s*3'],
  // 3DO / autres optiques
  '3do': ['3do|panasonic\\s*3do'],
  cdi: ['cd[\\s-]*i(?!\\s*ii)|philips\\s*cd'],
  // Autres
  vectrex: ['vectrex'],
  colecovision: ['colecovision|coleco'],
  multivision: ['othello|multivision'],
  scv: ['super\\s*cassette\\s*vision'],
  supervision: ['watara|supervision'],
  megaduck: ['mega\\s*duck'],
  pcv2: ['pocket\\s*challenge'],
  gw: ['game\\s*and\\s*watch|game\\s*&\\s*watch'],
  thomson: ['thomson'],
  oricatmos: ['oric|atmos'],
  bbcmicro: ['bbc\\s*micro|acorn'],
  samcoupe: ['sam\\s*coup'],
  trs80coco: ['trs[\\s-]*80|coco'],
  ti994a: ['ti[\\s-]*99'],
  spectravideo: ['spectravideo'],
  bk: ['elektronika\\s*bk'],
  vg5000: ['vg[\\s-]*5000'],
  dragon: ['dragon\\s*(32|64)'],
  uzebox: ['uzebox'],
  palm: ['^palm\\b|palmos'],
  tamagotchi: ['tamagotchi'],
  daphne: ['daphne|laserdisc'],
  dice: ['^dice\\b']
};

// Ordre dans lequel les patterns sont testés (du plus spécifique au plus général)
const DAT_DETECTION_ORDER = [
  'ps2', 'psp', 'psx',
  'dreamcast', 'saturn', 'segacd', 'sega32x', 'megadrive', 'mastersystem', 'gamegear', 'sg1000', 'pico',
  '3ds', 'nds',
  'gba', 'gbc', 'gb',
  '64dd', 'n64',
  'gamecube', 'wii',
  'snes', 'satellaview', 'sufami',
  'fds', 'nes',
  'virtualboy', 'pokemini',
  'xbox',
  'pcenginecd', 'pcengine', 'supergrafx', 'pcfx', 'pc88', 'pc98',
  'neogeocd', 'neogeo', 'ngpc', 'ngp',
  'atari2600', 'atari5200', 'atari7800', 'atari800', 'atarist', 'jaguar', 'lynx',
  'wswanc', 'wswan',
  'amigacd32', 'amigacdtv', 'amiga1200', 'amiga600', 'c64', 'vic20',
  'intellivision', 'videopacplus', 'o2em', 'channelf',
  'msxturbor', 'msx2', 'msx1', 'x68000', 'x1', 'zxspectrum', 'zx81', 'amstradcpc', 'gx4000',
  'apple2gs', 'apple2', 'macintosh',
  'dos',
  'fbneo', 'fba', 'mame', 'atomiswave', 'naomigd', 'naomi2', 'naomi', 'model3',
  '3do', 'cdi',
  'vectrex', 'colecovision', 'multivision', 'scv', 'supervision', 'megaduck', 'pcv2', 'gw',
  'thomson', 'oricatmos', 'bbcmicro', 'samcoupe', 'trs80coco', 'ti994a', 'spectravideo', 'bk',
  'vg5000', 'dragon', 'uzebox', 'palm', 'tamagotchi', 'daphne', 'dice'
];

// Formats canoniques listés dans les DATs no-intro/redump pour chaque système.
// À compléter manuellement au fil du temps.
// Si un système n'a pas d'entrée ici, le script émet un warning et laisse
// datRawFormats vide.
const DAT_RAW_FORMATS = {
  // Sony — disques optiques
  psx:           ['bin', 'cue'],
  ps2:           ['iso'],
  psp:           ['iso'],
  // Sega
  dreamcast:     ['gdi', 'bin', 'raw'],
  saturn:        ['bin', 'cue'],
  segacd:        ['bin', 'cue'],
  sega32x:       ['32x', 'bin'],
  megadrive:     ['md', 'gen', 'bin', 'smd'],
  mastersystem:  ['sms'],
  gamegear:      ['gg'],
  sg1000:        ['sg', 'sc'],
  pico:          ['bin', 'md'],
  naomi:         ['bin', 'cue'],
  naomi2:        ['bin', 'cue'],
  // Nintendo
  '3ds':         ['3ds', 'cci'],
  nds:           ['nds'],
  gba:           ['gba'],
  gbc:           ['gbc'],
  gb:            ['gb'],
  gamecube:      ['iso'],
  wii:           ['iso'],
  snes:          ['smc', 'sfc'],
  n64:           ['n64', 'z64', 'v64'],
  '64dd':        ['ndd'],
  nes:           ['nes', 'unf', 'unif'],
  fds:           ['fds'],
  satellaview:   ['bs'],
  sufami:        ['st'],
  virtualboy:    ['vb'],
  pokemini:      ['min'],
  // Microsoft
  xbox:          ['iso'],
  // NEC
  pcengine:      ['pce'],
  pcenginecd:    ['bin', 'cue'],
  supergrafx:    ['sgx'],
  pcfx:          ['bin', 'cue'],
  // SNK
  ngp:           ['ngp'],
  ngpc:          ['ngc'],
  neogeocd:      ['bin', 'cue'],
  // Atari
  atari2600:     ['a26', 'bin'],
  atari5200:     ['a52'],
  atari7800:     ['a78'],
  atarist:       ['st', 'msa'],
  jaguar:        ['j64', 'jag'],
  lynx:          ['lnx', 'lyx'],
  // Bandai
  wswan:         ['ws'],
  wswanc:        ['wsc'],
  // Commodore
  amiga600:      ['adf', 'adz', 'dms'],
  amiga1200:     ['adf', 'adz', 'dms'],
  amigacd32:     ['bin', 'cue'],
  amigacdtv:     ['bin', 'cue'],
  c64:           ['d64', 't64', 'tap'],
  vic20:         ['prg', 'crt'],
  // Apple / Macintosh / PC
  apple2:        ['dsk', 'po'],
  apple2gs:      ['dsk', '2mg'],
  macintosh:     ['iso'],
  dos:           ['iso', 'bin', 'cue'],
  // 3DO / autres optiques
  '3do':         ['bin', 'cue'],
  cdi:           ['bin', 'cue'],
  // Autres consoles
  vectrex:       ['vec', 'bin'],
  colecovision:  ['col', 'cv'],
  intellivision: ['int', 'bin'],
  o2em:          ['bin'],
  channelf:      ['bin'],
  megaduck:      ['bin'],
  supervision:   ['sv', 'bin'],
  pcv2:          ['bin']
  // mame, fba, fbneo : pas de raw — toujours en zip (archive container)
  // computers obscurs (msx, zxspectrum, etc.) : à compléter au besoin
};

// Mapping systemId Recalbox → nom d'affichage utilisé sur les pages no-intro / redump
// Si null/absent : pas de source pour ce système.
// Pour no-intro, on cherche un match exact sur le <b>...</b> de la page download
// Pour redump, on cherche un match exact sur le <td>...</td> de la table downloads
const DAT_SOURCE_NAMES = {
  // Sony — disques optiques : redump est canonique, no-intro liste les variantes Non-Redump
  psx:           { nointro: null,                                  redump: 'Sony PlayStation' },
  ps2:           { nointro: null,                                  redump: 'Sony PlayStation 2' },
  psp:           { nointro: null,                                  redump: 'Sony PlayStation Portable' },
  // Sega
  dreamcast:     { nointro: null,                                  redump: 'Sega Dreamcast' },
  saturn:        { nointro: null,                                  redump: 'Sega Saturn' },
  segacd:        { nointro: null,                                  redump: 'Sega Mega CD & Sega CD' },
  sega32x:       { nointro: 'Sega - 32X',                          redump: null },
  megadrive:     { nointro: 'Sega - Mega Drive - Genesis',         redump: null },
  mastersystem:  { nointro: 'Sega - Master System - Mark III',     redump: null },
  gamegear:      { nointro: 'Sega - Game Gear',                    redump: null },
  sg1000:        { nointro: 'Sega - SG-1000 - SC-3000',            redump: null },
  pico:          { nointro: 'Sega - PICO',                         redump: null },
  naomi:         { nointro: null,                                  redump: 'Sega Naomi' },
  naomi2:        { nointro: null,                                  redump: 'Sega Naomi 2' },
  // Nintendo
  '3ds':         { nointro: 'Nintendo - Nintendo 3DS',             redump: null },
  nds:           { nointro: 'Nintendo - Nintendo DS',              redump: null },
  gba:           { nointro: 'Nintendo - Game Boy Advance',         redump: null },
  gbc:           { nointro: 'Nintendo - Game Boy Color',           redump: null },
  gb:            { nointro: 'Nintendo - Game Boy',                 redump: null },
  gamecube:      { nointro: null,                                  redump: 'Nintendo GameCube' },
  wii:           { nointro: null,                                  redump: 'Nintendo Wii' },
  snes:          { nointro: 'Nintendo - Super Nintendo Entertainment System', redump: null },
  n64:           { nointro: 'Nintendo - Nintendo 64',              redump: null },
  '64dd':        { nointro: 'Nintendo - Nintendo 64DD',            redump: null },
  nes:           { nointro: 'Nintendo - Nintendo Entertainment System', redump: null },
  fds:           { nointro: 'Nintendo - Family Computer Disk System', redump: null },
  satellaview:   { nointro: 'Nintendo - Satellaview',              redump: null },
  virtualboy:    { nointro: 'Nintendo - Virtual Boy',              redump: null },
  pokemini:      { nointro: 'Nintendo - Pokemon Mini',             redump: null },
  sufami:        { nointro: 'Nintendo - Sufami Turbo',             redump: null },
  gw:            { nointro: 'Nintendo - Game & Watch',             redump: null },
  // Microsoft
  xbox:          { nointro: null,                                  redump: 'Microsoft Xbox' },
  // NEC
  pcengine:      { nointro: 'NEC - PC Engine - TurboGrafx-16',     redump: null },
  pcenginecd:    { nointro: null,                                  redump: 'NEC PC Engine CD & TurboGrafx CD' },
  supergrafx:    { nointro: 'NEC - PC Engine SuperGrafx',          redump: null },
  pcfx:          { nointro: null,                                  redump: 'NEC PC-FX & PC-FXGA' },
  pc88:          { nointro: 'NEC - PC-88',                         redump: 'NEC PC-88 series' },
  pc98:          { nointro: 'NEC - PC-98',                         redump: 'NEC PC-98 series' },
  // SNK
  ngp:           { nointro: 'SNK - NeoGeo Pocket',                 redump: null },
  ngpc:          { nointro: 'SNK - NeoGeo Pocket Color',           redump: null },
  neogeocd:      { nointro: null,                                  redump: 'Neo Geo CD' },
  // Atari
  atari2600:     { nointro: 'Atari - Atari 2600',                  redump: null },
  atari5200:     { nointro: 'Atari - Atari 5200',                  redump: null },
  atari7800:     { nointro: 'Atari - Atari 7800',                  redump: null },
  atari800:      { nointro: 'Atari - 8-bit Family',                redump: null },
  atarist:       { nointro: 'Atari - Atari ST',                    redump: null },
  jaguar:        { nointro: 'Atari - Atari Jaguar',                redump: null },
  lynx:          { nointro: 'Atari - Atari Lynx',                  redump: null },
  // Bandai
  wswan:         { nointro: 'Bandai - WonderSwan',                 redump: null },
  wswanc:        { nointro: 'Bandai - WonderSwan Color',           redump: null },
  // Commodore
  amiga600:      { nointro: 'Commodore - Amiga',                   redump: null },
  amiga1200:     { nointro: 'Commodore - Amiga',                   redump: null },
  amigacd32:     { nointro: null,                                  redump: 'Commodore Amiga CD32' },
  amigacdtv:     { nointro: null,                                  redump: 'Commodore Amiga CDTV' },
  c64:           { nointro: 'Commodore - Commodore 64',            redump: null },
  vic20:         { nointro: 'Commodore - VIC-20',                  redump: null },
  // Magnavox / Mattel / Fairchild
  intellivision: { nointro: 'Mattel - Intellivision',              redump: null },
  o2em:          { nointro: 'Magnavox - Odyssey 2',                redump: null },
  videopacplus:  { nointro: 'Philips - Videopac+',                 redump: null },
  channelf:      { nointro: 'Fairchild - Channel F',               redump: null },
  // Microsoft / Sharp / Computers
  msx1:          { nointro: 'Microsoft - MSX',                     redump: null },
  msx2:          { nointro: 'Microsoft - MSX2',                    redump: null },
  x1:            { nointro: 'Sharp - X1',                          redump: null },
  x68000:        { nointro: 'Sharp - X68000',                      redump: 'Sharp X68000' },
  zxspectrum:    { nointro: 'Sinclair - ZX Spectrum +3',           redump: null },
  amstradcpc:    { nointro: 'Amstrad - CPC',                       redump: null },
  // Apple
  apple2:        { nointro: 'Apple - II',                          redump: null },
  apple2gs:      { nointro: 'Apple - IIGS',                        redump: null },
  macintosh:     { nointro: 'Apple - Macintosh',                   redump: 'Apple Macintosh' },
  // PC
  dos:           { nointro: 'IBM - PC and Compatibles',            redump: 'IBM PC compatible' },
  // 3DO / autres optiques
  '3do':         { nointro: null,                                  redump: 'Panasonic 3DO Interactive Multiplayer' },
  cdi:           { nointro: null,                                  redump: 'Philips CD-i' },
  // Autres
  vectrex:       { nointro: 'GCE - Vectrex',                       redump: null },
  colecovision:  { nointro: 'Coleco - ColecoVision',               redump: null },
  scv:           { nointro: 'Epoch - Super Cassette Vision',       redump: null },
  supervision:   { nointro: 'Watara - Supervision',                redump: null },
  megaduck:      { nointro: 'Welback - Mega Duck',                 redump: null },
  pcv2:          { nointro: 'Benesse - Pocket Challenge V2',       redump: null },
  ti994a:        { nointro: 'Texas Instruments - TI-99-4A',        redump: null },
  palm:          { nointro: 'Mobile - Palm OS',                    redump: 'Palm OS' }
};

// Profils de règles de matching/consolidation explicites (voir src/helpers/systemProfiles).
// Absent : inféré (arcade si type='arcade', sinon 'cartridge').
const SYSTEM_PROFILES = {
  dreamcast: 'disc',
  pcenginecd: 'disc',
  psx: 'disc',
  saturn: 'disc',
  segacd: 'disc'
};

// ============================================================
// HTTP
// ============================================================

async function httpGet(url) {
  // Node 18+ : fetch global, gère redirects et UA
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    redirect: 'follow'
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} pour ${url}`);
  }
  return res.text();
}

// ============================================================
// PARSING — no-intro DAT-o-MATIC
// ============================================================

function parseNoIntroPage(html) {
  // Pour chaque ligne <tr>...</tr> de la table principale :
  //   - DAT id : <a href="...op=dat&s=NNN" ...>
  //   - System name : <b>...</b> dans la cellule "edited"
  const result = new Map();
  const trRe = /<tr\s+class="(?:alternate1|alternate2|grey)">([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = trRe.exec(html)) !== null) {
    const block = m[1];
    const idM = block.match(/op=dat&s=(\d+)/);
    const nameM = block.match(/<b>([^<]+)<\/b>/);
    if (idM && nameM) {
      const name = nameM[1].trim();
      const id = idM[1];
      // Premier hit gagne (doublon improbable mais possible)
      if (!result.has(name)) result.set(name, id);
    }
  }
  return result;
}

// ============================================================
// PARSING — redump.org
// ============================================================

function parseRedumpPage(html) {
  // Extraire la table des systèmes : <tr><td>SystemName</td><td>...</td><td><a href="/datfile/SLUG/">...
  // On cherche le bloc <table class="statistics">...</table>
  const tableM = html.match(/<table\s+class="statistics"[^>]*>([\s\S]*?)<\/table>/);
  if (!tableM) return new Map();

  const result = new Map();
  const trRe = /<tr>\s*<td>([^<]+)<\/td>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = trRe.exec(tableM[1])) !== null) {
    const name = m[1].trim();
    if (name === 'Systems') continue; // ligne d'en-tête
    const block = m[2];
    const slugM = block.match(/<a\s+href="\/datfile\/([a-z0-9-]+)\/">/);
    if (slugM) result.set(name, slugM[1]);
  }
  return result;
}

// ============================================================
// GÉNÉRATION DU FICHIER TS
// ============================================================

function jsonStringNullable(s) {
  return s === null || s === undefined ? 'null' : JSON.stringify(s);
}

function formatStringArray(arr) {
  if (arr.length === 0) return '[]';
  return '[' + arr.map(s => `'${s}'`).join(', ') + ']';
}

function formatRegexArray(patterns) {
  if (!patterns || patterns.length === 0) return '[]';
  return '[' + patterns.map(p => `/${p}/i`).join(', ') + ']';
}

function formatDatSources(noIntroId, redumpSlug) {
  const parts = [];
  if (noIntroId) parts.push(`'no-intro': { id: '${noIntroId}' }`);
  if (redumpSlug) parts.push(`'redump': { slug: '${redumpSlug}' }`);
  if (parts.length === 0) return 'undefined';
  // Recommended : redump prioritaire pour les supports optiques (tout slug redump implique optique)
  const recommended = redumpSlug ? "'redump'" : "'no-intro'";
  return `{ ${parts.join(', ')}, recommended: ${recommended} }`;
}

/**
 * Contenu de src/config/systemsData.ts.
 * @param systems entrées { systemId, fullname, manufacturer, type, releaseDate,
 *   supportedFormats, warningFormats, unsupportedFormats, datRawFormats, extraRawFormats }
 * @param datSourcesById systemId → { nointroId, redumpSlug }
 */
export function generateDataFile(licenseHeader, systems, datSourcesById, datDetectionOrder) {
  const header = `${licenseHeader.trimEnd()}

// ============================================================
// FICHIER GÉNÉRÉ AUTOMATIQUEMENT — NE PAS ÉDITER MANUELLEMENT
// Régénération : npm run sync-systems
// Sources :
//   - Recalbox : https://gitlab.com/recalbox/recalbox/
//   - no-intro : https://datomatic.no-intro.org/index.php?page=download
//   - redump  : https://redump.org/downloads/
// Le registre (types, surcharge Recalbox, détection) vit dans systems.ts.
// ============================================================

import type { SystemDefinition } from './systems.js';

export const BUNDLED_SYSTEMS: SystemDefinition[] = [
`;

  const entries = systems.map(s => {
    const patterns = SYSTEM_DAT_PATTERNS[s.systemId] ?? [];
    const info = datSourcesById[s.systemId];
    const profile = SYSTEM_PROFILES[s.systemId];
    return `  {
    systemId: '${s.systemId}',${profile ? `\n    profile: '${profile}',` : ''}
    fullname: ${jsonStringNullable(s.fullname)},
    manufacturer: ${jsonStringNullable(s.manufacturer)},
    type: ${jsonStringNullable(s.type)},
    releaseDate: ${jsonStringNullable(s.releaseDate)},
    supportedFormats: ${formatStringArray(s.supportedFormats)},
    warningFormats: ${formatStringArray(s.warningFormats)},
    unsupportedFormats: ${formatStringArray(s.unsupportedFormats)},
    datRawFormats: ${formatStringArray(s.datRawFormats)},
    extraRawFormats: ${formatStringArray(s.extraRawFormats)},
    datNamePatterns: ${formatRegexArray(patterns)},
    datSources: ${formatDatSources(info?.nointroId ?? null, info?.redumpSlug ?? null)}
  }`;
  }).join(',\n');

  const footer = `
];

// Ordre de détection (du plus spécifique au plus général)
export const DAT_DETECTION_ORDER: string[] = ${JSON.stringify(datDetectionOrder, null, 2).split('\n').map((l, i) => i === 0 ? l : '  ' + l).join('\n')};
`;

  return header + entries + footer;
}

// ============================================================
// MAIN
// ============================================================

function parseArgs(argv) {
  const refIndex = argv.indexOf('--ref');
  return { ref: refIndex >= 0 && argv[refIndex + 1] ? argv[refIndex + 1] : 'master' };
}

async function main() {
  const { ref } = parseArgs(process.argv.slice(2));

  const [{ computeExtraRawFormats }, { fetchRecalboxSystems }] = await Promise.all([
    import(distUrl('shared', 'recalboxSystems.js')),
    import(distUrl('helpers', 'recalboxGitlab.js'))
  ]).catch(() => {
    console.error('❌ dist/ introuvable. Lance « npm run build » avant ce script (npm run sync-systems le fait).');
    process.exit(1);
  });

  // 1. Recalbox
  console.log(`Recalbox (${ref}) : récupération des system.ini...`);
  const recalbox = await fetchRecalboxSystems(ref, (done, total) => console.log(`  ${done}/${total}`));
  const systems = recalbox.map(data => {
    const datRawFormats = DAT_RAW_FORMATS[data.systemId] ?? [];
    return {
      ...data,
      datRawFormats,
      extraRawFormats: computeExtraRawFormats(data.emulatorRawFormats, datRawFormats)
    };
  });
  console.log(`  ${systems.length} systèmes conservés`);
  const knownIds = new Set(systems.map(s => s.systemId));
  for (const s of systems) {
    if (!DAT_RAW_FORMATS[s.systemId] && s.type !== 'arcade') console.warn(`  ⚠️ ${s.systemId} : pas d'entrée DAT_RAW_FORMATS`);
    if (!SYSTEM_DAT_PATTERNS[s.systemId]) console.warn(`  ⚠️ ${s.systemId} : pas de pattern de détection DAT`);
  }

  // 2 & 3. Sources DAT (une requête chacune — erreur fatale plutôt que de perdre les sources)
  console.log('no-intro : récupération de la page de téléchargement...');
  const noIntroByName = parseNoIntroPage(await httpGet('https://datomatic.no-intro.org/index.php?page=download'));
  console.log(`  ${noIntroByName.size} DATs`);
  console.log('redump : récupération de la page de téléchargement...');
  const redumpByName = parseRedumpPage(await httpGet('https://redump.org/downloads/'));
  console.log(`  ${redumpByName.size} systèmes`);
  if (noIntroByName.size === 0 || redumpByName.size === 0) {
    throw new Error('Page no-intro ou redump vide (format changé ou accès refusé) : génération annulée.');
  }

  const datSourcesById = {};
  for (const [systemId, names] of Object.entries(DAT_SOURCE_NAMES)) {
    if (!knownIds.has(systemId)) continue;
    const nointroId = names.nointro ? noIntroByName.get(names.nointro) ?? null : null;
    const redumpSlug = names.redump ? redumpByName.get(names.redump) ?? null : null;
    if (names.nointro && !nointroId) console.warn(`  ⚠️ no-intro : « ${names.nointro} » introuvable (${systemId})`);
    if (names.redump && !redumpSlug) console.warn(`  ⚠️ redump : « ${names.redump} » introuvable (${systemId})`);
    datSourcesById[systemId] = { nointroId, redumpSlug };
  }

  const licenseHeader = await fs.readFile(LICENSE_HEADER_PATH, 'utf8');
  const content = generateDataFile(licenseHeader.replace(/\r\n/g, '\n'), systems, datSourcesById, DAT_DETECTION_ORDER);
  await fs.writeFile(OUTPUT_PATH, content, 'utf8');
  console.log(`✅ ${path.relative(ROOT, OUTPUT_PATH)} généré (${systems.length} systèmes, Recalbox ${ref})`);
}

// Exécuté seulement en ligne de commande (importable pour vérifier le format)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error('Erreur :', err);
    process.exit(1);
  });
}
