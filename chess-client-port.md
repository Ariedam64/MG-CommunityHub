# Échecs — guide de portage vers MG Community Hub

Comment réimplémenter le système d'échecs dans le Hub en réutilisant les fichiers
déjà écrits et éprouvés dans Aries Mod, plutôt que de repartir de zéro.

Le pendant serveur est spécifié dans [`chess-multiplayer-api.md`](./chess-multiplayer-api.md).

---

## 1. Ce que tu récupères

Huit modules dans `src/services/editor/`, plus un script de vérification.

| Fichier | Lignes | Rôle | Portabilité |
|---|---|---|---|
| `chessRules.ts` | 660 | Moteur : position, coups légaux, roque, en passant, promotion, échec, mat, pat | **Verbatim.** Module pur, zéro dépendance |
| `chessBoardLayout.ts` | 46 | Config + conversion case ↔ tuile | **Verbatim** |
| `chessBoardTiles.ts` | 196 | Lecture/écriture des tile views, registre de restauration | Dépend de `tos`, du map atom, du store jotai |
| `chessBoardRender.ts` | 448 | Damier, pièces, indices de coup, animations | Dépend de `tos` + `findGraphicsCtor` |
| `chessBoardTint.ts` | 196 | Teinte du camp noir | Dépend de `tos` |
| `chessBoardInput.ts` | 329 | Clic-pour-sélectionner et glisser-déposer | Dépend de `tos` |
| `chessBoardSounds.ts` | 111 | Effets sonores | Dépend du volume SFX du jeu |
| `chessBoard.ts` | 397 | Orchestration : options, mise en place, boucle de coup | Dépend de `decorCatalog` (avertissement seulement) |
| `scripts/checkChessRules.ts` | 251 | **Perft** + cas dédiés — 33 vérifications | **Verbatim** (Node) |

Le découpage n'est pas décoratif : `chessRules.ts` ne connaît ni Pixi ni le jeu,
ce qui est exactement ce qui permet de le faire tourner sous Node pour le valider,
et de le réutiliser côté serveur.

### 1.1 Commence par le moteur et son test

Copie `chessRules.ts` et `scripts/checkChessRules.ts`, ajoute le script npm :

```json
"check:chess": "esbuild scripts/checkChessRules.ts --bundle --platform=node --format=cjs --outfile=node_modules/.cache/checkChessRules.cjs --log-level=error && node node_modules/.cache/checkChessRules.cjs"
```

Puis lance-le. Tu dois obtenir :

```
perft depth 5 : 4865609
All chess rule checks passed.
```

C'est la valeur de référence publiée. Elle ne tombe juste que si déplacements,
captures, sorties d'échec, clouages et prise en passant sont **tous** exacts —
un seul coup faux quelque part et le total diverge. Tant que ce nombre sort, le
moteur est bon ; inutile de relire une ligne de règles.

---

## 2. Ce que le Hub doit fournir

La surface externe totale des sept modules d'affichage est **courte**. La voici
en entier, avec ce que chaque élément fait et par quoi le remplacer.

### 2.1 `tos` — l'accès au tile object system

Sept méthodes, depuis `src/utils/tileObjectSystemApi.ts` :

```ts
tos.isReady()
tos.getStatus()                              // { engine, tos }
tos.getCanvas()
tos.getTileObject(tx, ty, { ensureView })    // { tileView, tileObject, gidx }
tos.setTileEmpty(tx, ty, opts)
tos.setTileDecor(tx, ty, { rotation }, opts)
tos.pointerToFarmTile(ev)                    // événement pointeur → { tx, ty }
```

Le fichier capture le moteur du jeu en patchant temporairement
`Function.prototype.bind`, puis **publie sa prise** sur
`window.__QUINOA_ENGINE__` et `window.__TILE_OBJECT_SYSTEM__` — précisément pour
que les autres mods n'aient pas à refaire la capture.

Deux options :

- **Si le Hub tourne seul**, porte `tileObjectSystemApi.ts` : il lit d'abord ces
  globaux et ne patche `bind` que si personne ne l'a fait. Les deux mods peuvent
  coexister sans se gêner, c'est prévu.
- **Si le Hub a déjà son propre accès au moteur**, écris une façade de sept
  méthodes au-dessus.

### 2.2 `findGraphicsCtor` — le constructeur PIXI.Graphics

Le jeu ne publie pas `PIXI` en global. `src/utils/gardenInfoCardPixi.ts` retrouve
la classe en cherchant dans l'arbre d'affichage un nœud qui a `roundRect` et
`clear` — des méthodes publiques, donc préservées par la minification — et prend
son `.constructor`. Le résultat est mis en cache pour la session.

Copie `findGraphicsCtor` et `findAcrossBranches`, c'est une quarantaine de lignes
sans autre dépendance.

### 2.3 Localisation du jardin

`chessBoardTiles.ts` a besoin de deux choses pour trouver le coin du jardin du
joueur :

```ts
Atoms.root.map.get()                  // l'atom jotai "mapAtom"
getAtomByLabel("myUserSlotIdxAtom")   // le slot du joueur
```

Il lit `globalTileIdxToDirtTile`, filtre sur `userSlotIdx`, et prend le min x/y
des tuiles — aucune coordonnée n'est codée en dur, le plateau se cale tout seul.

Si le Hub n'a pas de pont vers le store jotai du jeu, il lui faut un
`getAtomByLabel` : le store est retrouvé via l'arbre React et les atoms sont
identifiés par leur `debugLabel`. C'est `src/store/jotai.ts` dans Aries Mod.

### 2.4 Volume des sons

Une seule chose est lue : `audioPlayer.getGameSfxVolume().vol`. Inutile de
porter toute la classe `AudioPlayer`, il suffit de reproduire son calcul :

```ts
// localStorage "soundEffectsVolumeAtom", clampé dans [0.001, 0.2],
// 0.001 valant un vrai mute, multiplié par Howler.volume() si présent.
```

**Attention à la normalisation** : cette échelle plafonne à `0.2` et est destinée
à Howler, pas à `HTMLAudioElement.volume` qui attend `0..1`. Le module divise par
`GAME_SFX_SCALE_MAX` avant de l'appliquer — sans ça, slider à fond, les sons
jouent à un cinquième du volume. C'est un bug qu'on a eu.

### 2.5 `decorCatalog` — optionnel

Sert uniquement à avertir en console quand un id de décor est inconnu de MGData.
Si le Hub n'a pas MGData, supprime `warnAboutUnknownDecor` : rien d'autre n'en
dépend.

---

## 3. Ordre d'intégration

1. **Moteur + perft.** Ne va pas plus loin tant que le nombre ne sort pas.
2. **`chessBoardLayout.ts`**, tel quel.
3. **`chessBoardTiles.ts`** + le `tos` du §2.1. Vérifie avec un appel manuel :
   poser un décor sur une tuile et le retirer.
4. **`chessBoardRender.ts`** + `findGraphicsCtor`. À ce stade `paintBoard()` doit
   dessiner le damier, et `renderPosition(createGame())` poser les 32 pièces.
5. **`chessBoardTint.ts`** — le camp noir s'assombrit.
6. **`chessBoardInput.ts`** + **`chessBoard.ts`** — la partie locale est jouable
   au clic et au glisser.
7. **`chessBoardSounds.ts`**.
8. **La couche réseau** (§5), qui n'existe pas encore.

À l'étape 6 tu as exactement ce qui tourne aujourd'hui dans Aries Mod :
`qwsChessBoard()` / `qwsChessBoardClear()` en console.

---

## 4. Les pièges — à lire avant de « simplifier »

Ces sept points ont tous été des bugs. Le code porte les cicatrices, et il a
l'air inutilement compliqué à plusieurs endroits **pour de bonnes raisons**.

### 4.1 La teinte va sur les sprites, jamais sur le conteneur

Le réflexe est de teinter le conteneur de la tuile et de laisser Pixi propager
aux enfants. **Ça se casse** : le jeu sort le sprite du décor de ce conteneur
quand l'avatar passe derrière, pour le dessiner au-dessus du joueur. La teinte
héritée cesse alors de s'appliquer — tout en continuant de se lire correctement
sur le conteneur, ce qui rend le diagnostic déroutant.

`collectTintTargets` cible les nœuds qui portent une `texture`, pas les
conteneurs.

### 4.2 …et s'arrête au premier nœud teintable de chaque branche

Pixi v8 hérite le tint **en le multipliant à chaque niveau**, et `Container` a sa
propre propriété `tint`. Teinter un sprite *et* son parent élève la couleur au
carré : les pièces virent au noir opaque. D'où le « on prend, on ne descend
plus » de `collectTintTargets`.

### 4.3 La teinte est réaffirmée à chaque frame, depuis le ticker du jeu

Le jeu réécrit ces sprites lui-même. Un intervalle, même court, perd la course.
Un `requestAnimationFrame` la perd aussi : notre callback est enregistré après
celui du jeu, qui peut donc écrire en dernier avant le rendu.

`chessBoardTint.ts` s'accroche à `engine.app.ticker`. Pixi planifie son propre
rendu à `UPDATE_PRIORITY.LOW`, donc un callback ajouté à la priorité par défaut
passe forcément après la mise à jour du jeu et avant le dessin.

### 4.4 Les calques vont en `zIndex` négatif

`worldContainer` est construit par le jeu avec `sortableChildren: true`, donc le
`zIndex` fait foi. Le damier est à `-999999` : au-dessus du sol — qui vit dans un
`groundContainer` **séparé**, jamais affecté — et sous toutes les pièces.

En `zIndex` positif, le damier recouvre les pièces.

### 4.5 Tout clic sur le plateau doit être avalé

Un clic qui ne déclenche aucune action d'échecs doit quand même appeler
`preventDefault()` + `stopPropagation()` dès qu'il tombe sur une case du plateau.
Sinon le jeu le traite comme un ordre de déplacement, l'avatar marche jusqu'à la
case, **et le jeu reconstruit la tile view au passage.**

Hors plateau, on laisse passer : le joueur doit pouvoir se déplacer normalement.

### 4.6 Le coup n'est commité qu'à l'arrivée de l'animation

`animatePieceSlide(steps, onDone)` déplace les tile views puis appelle `onDone`,
qui applique le coup. Dans l'autre ordre, la case de départ est vidée
instantanément et la pièce disparaît avant même de bouger.

`steps` est une **liste** : le roque en fournit deux, roi et tour partent
ensemble sur la même horloge.

### 4.7 Clic et glisser partagent une seule machine à états

Discriminés par la distance parcourue : au-delà de 8 px, la pression devient un
glisser. Deux logiques séparées se marchent dessus — un clic déclenche toujours
un micro-mouvement.

### 4.8 Bonus : les indices de promotion se dédoublonnent

Une promotion génère quatre coups légaux vers la **même** case. Sans filtre,
quatre marques sont dessinées au même endroit et l'alpha s'accumule : la case
sort visiblement plus foncée que les autres.

---

## 5. La couche réseau — à écrire

C'est la seule partie qui n'existe pas. Elle se glisse dans des coutures déjà en
place.

### 5.1 Ce qui change dans le code existant

**Alternance stricte → ma couleur uniquement.** `chessBoard.ts` teste
aujourd'hui `pieceAt(game, square)?.side === game.turn` dans `canPickUp`. Il faut
y ajouter `=== myColor`. Une seule ligne, mais c'est ce qui distingue une partie
locale d'une partie en ligne.

**Coup local → coup optimiste.** `tryMove` valide localement puis appelle
`commitMove`. En ligne il faut : valider localement (pour refuser tout de suite
un coup illégal sans aller-retour), commiter localement, **puis** envoyer au
serveur — et se recaler si le serveur répond `409`.

Le serveur renvoie le match courant dans le corps des `409` de désynchronisation,
justement pour que le recalage ne coûte pas une requête de plus.

**Coup distant → `commitMove`.** Un événement `chess_move` reçu se résout en
`attemptMove(game, from, to, promotion)` puis `commitMove(move)`. Tout le reste
suit : rendu, teinte, dernier coup surligné, son.

### 5.2 Ce qu'il faut ajouter

| Module | Rôle |
|---|---|
| `chessBoardNet.ts` | Appels REST (§5 de la spec serveur) + branchement des événements `chess_*` |
| `chessBoardClock.ts` | Décompte des deux pendules |
| UI de défi | Branchée sur la liste d'amis du Hub |

**Les événements passent par le stream existant.** Le Hub maintient déjà une
connexion unique par joueur (SSE sur le web, long-polling sous Discord). Ajouter
les échecs, c'est un `case` de plus dans le `switch` de dispatch — surtout pas une
seconde connexion.

**La pendule a besoin de `serverTime`.** Chaque payload de match le porte. Le
client calcule `offset = serverTime - Date.now()` à la réception et affiche
`restant = sideMs - (Date.now() + offset - turnStartedAt)`. Sans ça, une horloge
locale mal réglée affiche un temps faux.

**La resynchronisation a deux entrées.** Le payload `welcome`, reçu à chaque
(re)connexion, contient les parties en cours avec leurs coups — de quoi
reconstruire la position sans rien demander. Et
`GET /chess/matches/:id/moves?since=<ply>` pour rattraper un événement manqué :
sous Discord, le long-polling est mis en pause pendant chaque requête HTTP, donc
ça arrive.

---

## 6. Vérification

**Le moteur** : `npm run check:chess`. 33 vérifications, dont le perft complet.
À faire tourner en CI — c'est aussi ce qui détecte une divergence si la copie
serveur dérive.

**L'affichage** : rien d'automatisable. La liste du §4 est la check-list de
recette :

- une pièce noire reste noire quand l'avatar passe derrière
- le damier ne recouvre jamais les pièces
- marcher sur le plateau est impossible, marcher autour fonctionne
- au roque, la tour glisse en même temps que le roi
- un clic sélectionne, un glisser de 10 px déplace
- une case de promotion n'est pas plus foncée que les autres

---

## 7. Ce qui reste ouvert

- **Sous-promotion** — le moteur génère les quatre pièces et les teste, mais
  l'interface n'a pas de sélecteur et envoie toujours la dame. C'est un petit
  menu à afficher quand un pion atteint la dernière rangée.
- **Nulles automatiques** — répétition, règle des 50 coups, matériel insuffisant
  ne sont détectés nulle part. Deux rois seuls jouent jusqu'au drapeau.
- **Spectateurs** — ils ne reçoivent pas d'événements et lisent
  `?since=<ply>` en boucle (choix assumé côté serveur).
