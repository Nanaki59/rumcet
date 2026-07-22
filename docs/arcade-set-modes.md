# Modes de set MAME (Split / Non-merged / Merged)

Document de référence pour la gestion des ROMs arcade dans RUMCET.

---

## 1. Pourquoi trois modes ?

Les jeux arcade ont une particularité absente des consoles : ils existent souvent en
**plusieurs versions** (régionales, révisions, hacks officiels). MAME modélise cette
réalité avec une **relation parent / clones** :

- Le **parent** est la version désignée comme référence (souvent la version mondiale ou
  la première sortie).
- Les **clones** sont les autres versions. Ils partagent une partie de leurs ROMs avec
  le parent (typiquement les graphismes, les samples, parfois des programmes communs).

Selon comment on **stocke** ces relations sur disque, on parle de trois modes :

| Mode             | Contenu de chaque ZIP                              | Taille | Dépendances |
|------------------|----------------------------------------------------|--------|-------------|
| **Non-merged**   | Toutes les ROMs nécessaires (jeu + parent + BIOS)  | ↑↑     | Aucune      |
| **Split**        | Uniquement les ROMs propres au jeu                 | ↓      | Parent + BIOS doivent exister à côté |
| **Merged**       | Le parent contient ses ROMs + celles de ses clones | ↓↓     | Aucun ZIP clone individuel |

Les émulateurs MAME modernes savent lire les trois modes. La règle d'or :
**tous les ZIPs d'un même set doivent être dans le même mode**.

---

## 2. Balises XML d'un DAT MAME

### 2.1. `<machine>`

L'équivalent de `<game>` dans les DAT No-Intro/Redump. RUMCET accepte les deux.

```xml
<machine name="sf2" sourcefile="capcom/cps1.cpp">
  <description>Street Fighter II - The World Warrior (World)</description>
  <year>1991</year>
  <manufacturer>Capcom</manufacturer>
  <rom name="sf2_30.bin" size="131072" crc="abcd1234" sha1="..."/>
  ...
</machine>
```

Attributs notables :
- `name` : identifiant court du jeu (= nom du ZIP attendu)
- `sourcefile` : fichier source MAME (info technique, inutile pour le matching)
- `isbios="yes"` : ce n'est pas un jeu mais un set BIOS (ex: `neogeo`, `cpzn1`, `naomi`)
- `isdevice="yes"` : c'est un device partagé (carte mère, sous-système), pas jouable
- `runnable="no"` : combiné avec `isbios` ou `isdevice`, indique que le set n'est pas démarrable seul

### 2.2. `cloneof="parent_name"` — parenté logique

Désigne le parent "logique" du jeu (l'original dont c'est une variante).

```xml
<machine name="sf2u" cloneof="sf2" romof="sf2">
  <description>Street Fighter II - US</description>
  ...
</machine>
```

Le clone `sf2u` est une **variante régionale** de `sf2`.

### 2.3. `romof="parent_name"` — parenté technique des ROMs

Désigne le ZIP qui contient les ROMs partagées. Dans 99% des cas `romof === cloneof`,
sauf pour les **BIOS partagés** :

```xml
<!-- Le BIOS Neo Geo : ensemble de ROMs partagées, pas un jeu jouable -->
<machine name="neogeo" isbios="yes">
  <description>Neo-Geo (BIOS)</description>
  <rom name="sp-s2.sp1" crc="9036d879" sha1="..."/>
  ...
</machine>

<!-- Un jeu Neo Geo : pas de cloneof (pas de variante), mais romof pointe sur le BIOS -->
<machine name="kof98" romof="neogeo">
  <description>King of Fighters '98</description>
  <rom name="242-p1.p1" crc="..." sha1="..."/>
  <rom name="sp-s2.sp1" merge="sp-s2.sp1" crc="9036d879" sha1="..."/>
  ...
</machine>

<!-- Un clone régional de kof98 : cloneof=kof98, romof=kof98 (pas neogeo directement) -->
<machine name="kof98k" cloneof="kof98" romof="kof98">
  ...
</machine>
```

Quand `cloneof` et `romof` diffèrent, RUMCET stocke les deux relations dans
`game_relationships` avec `relationship_type IN ('cloneof', 'romof')`.

### 2.4. `<rom merge="filename">` — ROM partagée avec le parent

Indique que cette ROM est **identique** à une ROM du parent (mêmes hashs). En mode
split, le clone ne stocke PAS cette ROM (elle est lue depuis le ZIP parent à l'exécution).

```xml
<rom name="sf2_31.bin" merge="sf2_31.bin" crc="ef567890" sha1="..."/>
```

- L'attribut `merge` indique le nom du fichier **dans le ZIP parent**.
- Souvent `merge="X"` avec `name="X"`, mais peuvent différer si renommage.
- L'absence de `merge` signifie : c'est une ROM **propre** au jeu (à stocker dans son ZIP).

### 2.5. `<device_ref name="...">` — référence à un device

Certains jeux dépendent de "devices" (composants matériels partagés). C'est le cas
de Naomi, Triforce, ou de modules audio génériques.

```xml
<machine name="ferrari" romof="naomi">
  <description>Ferrari F355 Challenge</description>
  <device_ref name="naomi"/>
  <device_ref name="rom_board"/>
  <rom name="..."/>
</machine>
```

Pour la logique de set RUMCET, `device_ref` se comporte **comme `romof`** : c'est
une dépendance vers un autre ZIP contenant des ROMs nécessaires. On peut l'imaginer
comme un BIOS supplémentaire.

### 2.6. `<disk>` — supports optiques (CHD)

Pour les jeux arcade modernes (Naomi GD-ROM, Chihiro, Triforce, certains kit
Sega Lindbergh…), une partie ou la totalité du jeu est stockée sous forme de
disque, listé via `<disk>` et non `<rom>`.

```xml
<machine name="ironclad" romof="naomi">
  <description>Ironclad (Naomi GD-ROM)</description>
  <device_ref name="naomi"/>
  <disk name="gdl-0036" sha1="abc123..." region="cdrom"/>
</machine>
```

Spécificités :
- Pas de `crc32` ni `md5` — uniquement `sha1` (les CHD sont volumineux, le CRC32
  n'est pas pertinent).
- Pas de `size` non plus (taille variable selon la version du CHD).
- Le fichier attendu sur disque est `name.chd` à la racine du ZIP du jeu (en
  pratique, généralement **un dossier** au lieu d'un ZIP : `ironclad/gdl-0036.chd`).
- Une `<machine>` peut combiner `<rom>` et `<disk>` (firmware + GD-ROM).

RUMCET stocke les disques dans la table `dat_roms` avec une colonne `is_disk = 1`.
Le matching CHD se fait **uniquement sur SHA1**.

---

## 3. Modes de DAT vs modes de set

C'est une distinction importante.

### 3.1. Mode du DAT

Le **DAT** lui-même peut être au format split, non-merged ou merged. Cela change
la façon dont les ROMs sont listées dans chaque `<machine>` :

- **DAT split** (le plus courant en distribution) : chaque clone liste UNIQUEMENT
  ses ROMs propres + des entrées `<rom merge="..."/>` pour les ROMs partagées avec
  le parent.
- **DAT non-merged** : chaque clone liste TOUTES ses ROMs requises (propres + parent
  + BIOS). Pas de `merge=`. Le DAT est plus gros.
- **DAT merged** : le parent contient l'intégralité des ROMs de la famille (parent +
  tous les clones). Les `<machine>` clones n'ont aucune `<rom>` ou pointent vers
  le parent.

### 3.2. Mode du set sur disque

Le **set** est ce que l'utilisateur a réellement sur son disque dur. Il peut être
dans un mode différent du DAT chargé. Exemple courant :
- DAT en mode split (chargé depuis progettosnaps)
- Set en mode non-merged sur disque (téléchargé d'une autre source)

RUMCET doit gérer la combinaison des deux pour matcher correctement.

### 3.3. Heuristique de détection

**Pour le DAT** (au chargement) :
- Si une ROM avec `merge=` existe → DAT **split**
- Sinon, si plusieurs clones listent les mêmes CRC pour des ROMs aussi présentes
  sur le parent → DAT **non-merged**
- Sinon, si les `<machine>` clones n'ont aucune `<rom>` mais ont un `cloneof` →
  DAT **merged**

**Pour le set** (après scan) :
- Analyser un échantillon de ZIPs clones :
  - Si leur contenu ⊃ contenu du ZIP parent → **non-merged**
  - Si leur contenu ∩ ZIP parent est vide ou très limité → **split**
- Si beaucoup de ZIPs clones manquent et les parents contiennent beaucoup de
  fichiers nommés en `cloneName/` → **merged**

Les deux infos sont stockées en metadata : `dat_set_mode` et `scanned_set_mode`.

---

## 4. Cas edge à anticiper

### 4.1. DAT non-MAME

Si le DAT chargé n'est pas un DAT arcade (No-Intro, Redump, MAME hbmame, etc.) :
- Pas de `cloneof`/`romof`/`merge` → table `game_relationships` reste vide
- Le détecteur de mode DAT renvoie `'n/a'` ou `null`
- L'onglet "Arcade" des paramètres reste affiché et configurable, mais ses
  réglages sont **sans effet** sur la consolidation
- Aucune logique de set mode n'est activée pendant la consolidation

### 4.2. DAT pré-filtré

L'utilisateur peut charger un DAT qu'il a généré lui-même (sous-ensemble de jeux).
Conséquence : certains parents ou BIOS référencés peuvent **manquer** dans le DAT.

- Au parsing, on lit `cloneof="X"` mais aucune `<machine name="X">` n'existe.
- Dans `game_relationships`, on n'insère la relation que si le parent existe
  dans la table `games`. Sinon, on stocke quand même le **nom textuel** du parent
  dans une colonne supplémentaire (ex: `parent_name_ref`) pour debug.
- À la consolidation, si on a besoin des ROMs du parent et qu'il n'est pas dans
  le DAT, on émet un avertissement et on traite le jeu comme s'il était autonome
  (mode non-merged sera incomplet, mais split / merged restent cohérents).

### 4.3. Set incomplet

Cas où l'utilisateur a des ZIPs clones mais pas le parent (ou inversement).

- En mode split : le clone est inutilisable sans le parent → marquer comme
  "incomplet" dans le matching.
- En mode non-merged : chaque ZIP est autonome, pas de problème.
- En mode merged : si le parent manque, tous ses clones sont perdus.

Affichage : badge ⚠️ sur le jeu, info-bulle expliquant la dépendance manquante.

### 4.4. BIOS / Device-only

Les sets `isbios="yes"` ou `isdevice="yes"` ne sont pas des jeux jouables. Ils
doivent :
- Apparaître dans la base mais flaggués (colonne `is_bios INTEGER`, `is_device
  INTEGER`)
- Ne pas être proposés à la sélection pour le téléchargement de ROMs (download
  rom UI)
- Toujours être consolidés s'ils sont référencés par un jeu sélectionné (sinon
  le jeu ne marche pas)

### 4.5. Chaînes de `device_ref`

Un device peut référencer un autre device. La résolution doit être récursive
pour collecter toutes les ROMs nécessaires à un jeu :
```
ferrari → naomi (device_ref) → naomi (device a aussi un device_ref interne sur
  rom_board ou un BIOS variant)
```

RUMCET utilisera une CTE récursive en SQL ou un traversal en mémoire pour
collecter tous les ancêtres.

### 4.6. Sets `mixed`

Un dossier de ROMs peut mélanger des ZIPs en mode split et d'autres en mode
non-merged (typiquement quand l'utilisateur a fusionné plusieurs sources).
Le détecteur de mode renvoie `'mixed'` et la consolidation traite chaque ZIP
selon son mode individuel.

---

## 5. CHDs dans MAME

Les CHDs MAME diffèrent des CHDs disc-based RUMCET classiques (PSX, Saturn) :

| Aspect           | CHD MAME                              | CHD disque (PSX, Saturn…)  |
|------------------|---------------------------------------|----------------------------|
| Listé dans DAT   | `<disk>` au lieu de `<rom>`           | `<rom>` standard           |
| Identifiant      | `sha1` uniquement                     | `crc32 + md5 + sha1`       |
| Taille listée    | Non                                   | Oui                        |
| Stockage         | Souvent dans un **sous-dossier** au nom du jeu : `gameName/diskName.chd` | Fichier `.chd` à plat dans le dossier validé |
| Matching         | Comparaison SHA1                      | CRC32 prioritaire          |

Exemple concret :
```
validated/ironclad/
  ironclad.zip       <- ROMs firmware (de <rom> dans le DAT)
  gdl-0036.chd       <- disque (de <disk> dans le DAT)
```

Pour cette raison, le mode "Dossier multi-système" de RUMCET reste pertinent
pour MAME (le sous-dossier `mame/` regroupe tout), et la consolidation des
CHDs MAME crée un **sous-dossier par jeu** plutôt que de mettre les CHDs à plat.

---

## 6. Affichage du DAT en mode cible (vue, sans modifier le DAT)

RUMCET ne **convertit pas** physiquement le DAT (pas d'export d'un nouveau DAT).
En revanche, il peut **afficher** la liste des jeux comme si elle était dans
le mode cible choisi :

- **Affichage Split** : chaque jeu n'affiche que les ROMs où `merge_name IS NULL`.
- **Affichage Non-merged** : chaque jeu affiche ses ROMs + les ROMs du parent +
  les ROMs du BIOS (avec un badge "[parent]" ou "[bios]").
- **Affichage Merged** : un seul jeu par famille (le parent), affichant toutes
  les ROMs de tous les clones (avec un badge "[clone:nom]").

Cette vue est purement calculée à l'affichage, à partir de la base.
Aucun changement persistant en DB.

L'utilisateur sélectionne le mode cible dans l'onglet Arcade des paramètres ; la
vue centrale s'adapte automatiquement.

---

## 7. Compatibilité émulateurs

| Émulateur                | Mode recommandé    | Notes |
|--------------------------|--------------------|-------|
| MAME (récent)            | Non-merged ou Split| Lit les 3 modes |
| FB Neo                   | Split              | Préfère split |
| Retroarch + libretro     | Split              | Idem MAME |
| Recalbox                 | Split              | Mode par défaut Recalbox |
| Batocera                 | Split              | Idem |

C'est pourquoi RUMCET utilise **Split** comme mode par défaut : compatible
partout, économe en espace, et c'est le mode produit par les outils communautaires
de consolidation (ClrMamePro, Romulus, Romcenter).

---

## 8. Glossaire rapide

- **Set** : ensemble cohérent de ZIPs pour un système MAME donné, dans un mode unique.
- **Famille** : un parent + tous ses clones (et le BIOS s'il y en a un).
- **Roms propres** : ROMs spécifiques à un jeu (sans attribut `merge=`).
- **Roms héritées** : ROMs partagées avec le parent (avec `merge=`).
- **BIOS set** : ensemble de ROMs partagées par une famille de jeux (Neo Geo, CPS,
  Naomi…). N'est pas un jeu jouable.
- **Device set** : équivalent BIOS pour des composants matériels (carte mère,
  sous-système). Référencé via `<device_ref>`.
