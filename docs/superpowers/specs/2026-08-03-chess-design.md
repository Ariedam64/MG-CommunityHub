# Échecs dans MG Community Hub — design

Portage du système d'échecs d'Aries Mod vers le hub, avec la couche réseau
branchée sur le backend déjà déployé.

Références : [`chess-client-port.md`](../../../chess-client-port.md) (guide de
portage) et `chess-multiplayer-api.md` (spec serveur, dans `magicGarden - Copie/docs/`).

---

## 1. Périmètre

**Dans la v1 :** défi entre amis depuis la vue joueur, partie complète au clic et
au glisser, pendule, abandon, proposition de nulle, sélecteur de sous-promotion,
mode spectateur, HUD flottant portant tout ça.

**Hors périmètre :** défis à des inconnus, nulles automatiques (répétition, 50
coups, matériel insuffisant), incrément Fischer, historique des parties
terminées, compteur de spectateurs côté serveur — le HUD réserve la place, mais
la valeur ne sera réelle que quand les endpoints dédiés existeront.

Le backend est en ligne et conforme à la spec : `chess/matches`,
`chess/challenges` et `chess/matches/:id` répondent `401` sans jeton, comme les
routes existantes du hub.

---

## 2. Ce que le hub fournit déjà

Quatre des cinq prérequis du §2 du guide de portage sont couverts.

| Prérequis | Où |
|---|---|
| `tos` — tile object system | `src/game/tileObjectSystem.ts` (même capture `bind`, mêmes globaux `__QUINOA_ENGINE__` / `__TILE_OBJECT_SYSTEM__`) |
| Store jotai + `getAtomByLabel` | `src/store/jotai.ts:279`, `src/store/atoms.ts:106` (`map`) |
| `decorCatalog` | `src/data/index.ts:64` — `warnAboutUnknownDecor` est donc conservé |
| Stream unifié SSE / long-poll | `src/api/client/events.ts:118` `openUnifiedEvents` |
| Vue joueur | `src/ui/hub/tabs/playerDetailView.ts:805` `createActionsSection` |
| Audio sous CSP Discord | `src/platform/discordCsp.ts:110` `getAudioUrlSafe` |
| Widget flottant draggable | `src/ui/communityHubButtonFloating.ts` — motif à reprendre pour le HUD |

Manquent trois briques, toutes petites et cernées :

- **`pointerToFarmTile`** — le hub n'a que `pointerToTile`, qui calcule
  `clientX / tileSize` en supposant la caméra à l'origine du monde. Dès que le
  jardin est panné, il renvoie une case fausse. La version d'Aries
  (`tileObjectSystemApi.ts:314`) projette par `worldContainer.toLocal()`. Le
  clic-pour-jouer en dépend entièrement.
- **`findGraphicsCtor` + `findAcrossBranches`** — le hub attrape PIXI par
  `engine.app.renderer.PIXI` (`tileObjectSystem.ts:337`), un chemin non public
  que la minification peut renommer. La recherche par `roundRect` + `clear`
  d'Aries ne dépend que de méthodes publiques.
- **Le volume SFX** — aucun `audioPlayer` dans le hub. Calcul du §2.4 du guide,
  une vingtaine de lignes.

---

## 3. Carte des modules

```
src/game/chess/
  chessRules.ts          verbatim (660 l.)  moteur pur, tourne sous Node
  chessBoardLayout.ts    verbatim (46 l.)
  chessBoardTiles.ts     imports → @/store/atoms, @/store/jotai, @/game/tileObjectSystem
  chessBoardRender.ts    imports → @/game/pixiGraphics
  chessBoardTint.ts      inchangé
  chessBoardInput.ts     inchangé
  chessBoardSounds.ts    volume §2.4 + préchargement getAudioUrlSafe
  chessBoard.ts          + myColor dans canPickUp, tryMove devient optimiste

  chessSession.ts    NOUVEAU  propriétaire du jardin — machine à états
  chessNet.ts        NOUVEAU  appels REST + résolution des 409 / 422
  chessClock.ts      NOUVEAU  offset serveur, décompte des deux pendules
  chessHud.ts        NOUVEAU  HUD flottant
  chessChallengeUi.ts NOUVEAU toast + modal de défi, compte à rebours 2 min

src/game/pixiGraphics.ts             NOUVEAU  findGraphicsCtor + findAcrossBranches
src/game/tileObjectSystem.ts         + getCanvas et pointerToFarmTile sur la façade tos
src/api/endpoints/chess.ts           NOUVEAU  httpGet / httpPost typés
src/api/streams/chess.ts             NOUVEAU  openChessStream — le switch des chess_*
src/api/types/index.ts               + ChessMatch, ChessChallenge, ChessClock, welcome.chess
src/api/cache/chess.ts               NOUVEAU  cache défis + parties d'amis
src/ui/hub/tabs/playerDetailView.ts  + createGamesSection
meta.userscript.js                   + @connect images.chesscomfiles.com
scripts/checkChessRules.ts           verbatim + script npm check:chess
```

`src/api/streams/chess.ts` est **un abonné de plus, pas une connexion de plus** :
il appelle `openUnifiedEvents` comme `streams/messages.ts:31`, et `events.ts`
déduplique déjà par `playerId`. Le §1.1 de la spec serveur est respecté sans
effort.

### 3.1 Deux entorses assumées aux règles du repo

**`chessRules.ts` fait 660 lignes**, au-delà de la cible de 500. Le découper
casserait la promesse qui fait tenir tout l'édifice : le fichier existe en deux
exemplaires identiques, client et serveur, et toute correction se recopie telle
quelle. On garde le fichier entier et on s'appuie sur `check:chess` pour la
sécurité.

**Les identifiants de décor des pièces sont en dur** — `pawn: "StoneGnome"`,
`knight: "StoneCaribou"`, etc. Ce n'est pas de la donnée de jeu dupliquée mais un
choix artistique de représentation, et il est déjà validé à l'exécution contre
MGData par `warnAboutUnknownDecor` : si un identifiant disparaît du jeu, la
console le dit et propose des voisins. Ils restent surchargeables par
`options.pieceDecorIds`.

---

## 4. `chessSession` — le propriétaire du jardin

Le jardin est une ressource **exclusive** : un seul plateau à la fois, qu'on
joue ou qu'on regarde, et les tuiles doivent être restaurées quoi qu'il arrive.
Un module unique le possède ; tout le reste passe par lui.

```
idle ──challenge accepté / welcome──▶ arming ──tos prêt──▶ playing
idle ──watch(matchId)──────────────▶ arming ──tos prêt──▶ spectating
playing | spectating ──fin / quitter──▶ idle
```

**API publique :**

```ts
chessSession.challenge(opponentId, color)  // POST, puis attend chess_match_started
chessSession.watch(matchId)                // spectateur
chessSession.leave()                        // démonte, restaure les tuiles
chessSession.getState()                     // pour la section Games de la vue joueur
chessSession.onChange(cb): () => void       // abonnement UI
```

**Invariants :**

- `leave()` appelle `restoreAllTiles()` **toujours**, y compris sur chemin
  d'erreur, et est sûr à appeler plusieurs fois.
- Un `mount` refuse si l'état n'est pas `idle`. La section Games grise donc
  « Défier » et « Regarder » pendant une partie.
- `beforeunload` et le changement de salon déclenchent un `leave()`.

**L'état `arming` n'est pas décoratif.** Un `chess_match_started` peut arriver
avant que `tos.isReady()` soit vrai, ou avant que le jardin soit chargé. La
pendule, elle, tourne déjà côté serveur. On affiche donc le HUD avec les deux
pendules dès la réception, et on retente le montage toutes les 500 ms. Sans ça,
on perd du temps au drapeau parce qu'on n'a pas pu dessiner.

**Garde de coexistence.** Aries Mod peut monter son propre plateau dans le même
jardin (`qwsChessBoard()` en console). `chessSession` pose
`window.__MG_CHESS_BOARD_OWNER__` au montage et refuse de monter si le drapeau
est déjà pris par un autre mod, avec un toast explicite. Cinq lignes d'assurance.

---

## 5. Flux

### 5.1 Défi sortant

`POST /chess/challenges { opponentId, color }` → `201`. La section Games passe en
« Défi envoyé — 1:47 » avec un bouton Annuler (`DELETE /chess/challenges/:id`).
Le compte à rebours vient de `expiresAt`.

`403` (plus amis), `404`, `409` (défi déjà en attente ou l'un des deux en partie)
donnent un toast et un rafraîchissement de la section.

`chess_challenge_declined` et `chess_challenge_cancelled` (avec
`reason: "cancelled" | "expired"`) ramènent la section à l'état « Défier » et
émettent un toast. L'expiration arrive par événement, pas par le compte à
rebours local : celui-ci n'est qu'un affichage.

### 5.2 Défi entrant

`chess_challenge` → son de notification + toast + modal Accepter / Refuser avec
compte à rebours 2 min. Le modal réutilise le motif de
`playerViewActions.ts:55`. Accepter appelle
`POST /chess/challenges/:id/accept`, qui répond avec le `match` et déclenche
`chess_match_started` aux deux joueurs.

Le montage du plateau est piloté par `chess_match_started`, **pas** par la
réponse HTTP : c'est le seul chemin que les deux joueurs partagent.

Au montage, le panneau du hub se ferme s'il est ouvert — il masque le jardin, et
donc le plateau. Le bouton flottant du hub reste disponible ; rouvrir le panneau
pendant une partie est permis, le HUD flottant continue de tourner par-dessus.

### 5.3 Coup local — optimiste

1. `attemptMove` en local. `move === null` → son `illegal`, flash de la case,
   rien n'est envoyé. Aucun aller-retour pour un coup illégal.
2. Si c'est une promotion, ouvrir le sélecteur (§7) et geler jusqu'au choix.
3. Animer (`animatePieceSlide`), puis `commitMove` dans le `onDone` — l'ordre du
   §4.6 du guide, pas l'inverse.
4. `POST /chess/matches/:id/moves { ply: localPly + 1, from, to, promotion }`.
5. `200` → recaler la pendule sur le `clock` de la réponse.
6. `409 ply_mismatch` → le corps porte `match` : rejouer `moves` depuis
   `createGame()`, re-rendre. Aucune requête supplémentaire.
7. `422 illegal_move` → même resynchronisation : si le serveur refuse un coup que
   le moteur local a validé, c'est que les deux positions divergeaient.
8. Erreur réseau → resynchronisation par `GET /chess/matches/:id`.

### 5.4 Coup distant — et la déduplication

Chaque `chess_move` porte un `ply`, y compris celui de notre propre coup. La
règle est uniforme :

| Condition | Action |
|---|---|
| `ply <= localPly` | ignorer — c'est l'écho de notre coup optimiste |
| `ply === localPly + 1` | `attemptMove` puis `commitMove` : rendu, teinte, dernier coup, son |
| `ply > localPly + 1` | on a manqué un événement → `GET /chess/matches/:id/moves?since=localPly` |

Le troisième cas n'est pas théorique : sous Discord Activity, le long-polling est
mis en pause pendant chaque requête HTTP (`withDiscordPollPause`), donc un
événement peut passer à travers.

### 5.5 Fin de partie

`chess_match_ended` → son `gameEnd`, bandeau de résultat dans le HUD
(« Échec et mat — vous gagnez », « Au temps », « Abandon », « Nulle par
accord »), le plateau reste affiché avec les entrées désactivées. Un bouton
Fermer appelle `leave()`.

Abandon : `POST /chess/matches/:id/resign`, derrière une confirmation.

### 5.6 Nulle

Bouton dans le HUD → `POST /chess/matches/:id/draw { action: "offer" }`.
À la réception de `chess_draw_offer`, le HUD montre « X propose nulle » avec
Accepter / Refuser. L'acceptation renvoie le `ply` affiché par la proposition ;
un `409` signifie que la position a changé depuis, on se recale et on efface
l'offre.

### 5.7 Sous-promotion

Quand un coup local amène un pion sur la dernière rangée, le HUD ouvre un
sélecteur quatre pièces (dame, tour, fou, cavalier) **avant** l'animation. Le
choix alimente `promotion`. Annuler repose la pièce sur sa case de départ.

Les indices de coups se dédoublonnent déjà par case (§4.8 du guide) — sans quoi
la case de promotion sortirait plus foncée que les autres.

### 5.8 Spectateur

Entrée unique : la section Games de la vue d'un ami affiche « En partie contre
Bob — Regarder » quand l'ami est occupé.

`watch(matchId)` → `GET /chess/matches/:id` (coups inclus) → rejouer depuis
`createGame()` → rendre, blancs en bas. Les entrées de jeu sont désactivées,
mais **les clics sur le plateau restent avalés** (§4.5 du guide) : sinon
l'avatar marche sur les cases et le jeu reconstruit les tile views.

Les spectateurs ne reçoivent pas d'événements. Polling
`GET /chess/matches/:id/moves?since=<ply>` toutes les **3 s** sur le web et
**5 s** sous Discord, où chaque requête met le long-poll en pause. Le polling
s'arrête dès que le match passe `finished`.

### 5.9 Reconnexion

`welcome` porte `chess: { challenges: { incoming, outgoing }, matches }`, les
parties actives coups inclus. `chessSession` s'abonne via `onWelcome`
(`cache/welcome.ts:17`) :

- une partie active et rien de monté → monter ;
- un plateau monté pour une partie absente de la liste → démonter.

C'est le seul chemin de resynchronisation nécessaire au (re)démarrage : aucune
requête supplémentaire.

---

## 6. Pendule client

Chaque payload portant un `clock` recalcule `offset = serverTime - Date.now()`.
Le décompte affiché est
`restant = sideMs - (Date.now() + offset - turnStartedAt)` pour le joueur au
trait ; l'autre pendule est gelée.

Rafraîchissement par `setInterval` à 200 ms — suffisant pour du `mm:ss`, et bien
moins coûteux qu'un `requestAnimationFrame`. Sous 20 secondes, l'affichage passe
au dixième et la pendule vire au rouge.

Quand la pendule adverse atteint zéro localement, attendre **2 secondes de
grâce** (marge réseau) puis `POST /chess/matches/:id/claim-timeout`. Un `409`
signifie que notre pendule était en avance : le corps porte le match, on se
recale sans second aller-retour.

---

## 7. HUD flottant

Un panneau draggable dont la position est persistée, sur le modèle de
`communityHubButtonFloating.ts` (seuil de glisser à 8 px, position clampée au
viewport, `readHubPath` / `writeHubPath`). Il apparaît au montage d'une partie
et disparaît avec elle.

```
┌──────────────────────────────┐
│  ● Alice           09:58     │   ← adversaire, pendule gelée
│  ○ Toi        ▸    09:43     │   ← trait actif, décompte
├──────────────────────────────┤
│  [Nulle]  [Abandonner]   👁 3│
└──────────────────────────────┘
```

- Le sélecteur de sous-promotion s'ouvre dans ce panneau (§5.7).
- La bannière de proposition de nulle et le bandeau de résultat s'y insèrent.
- `👁 3` est le compteur de spectateurs. **Les endpoints n'existent pas encore** :
  la place est réservée et l'élément reste masqué tant que le champ est absent
  du payload. Aucune valeur inventée.
- En mode spectateur : les deux pendules, la mention « Spectateur », un bouton
  Quitter, ni nulle ni abandon.

---

## 8. Section Games de la vue joueur

Un bloc ajouté à `playerDetailView.ts`, à côté de `createActionsSection`, avec
cinq états :

| Condition | Affichage |
|---|---|
| Ami libre | « Défier » + sélecteur de couleur (blanc / noir / aléatoire) |
| Défi sortant en cours | « Défi envoyé — 1:47 » + Annuler |
| Défi entrant de lui | « Vous a défié » + Accepter / Refuser |
| Ami en partie | « En partie contre X » + Regarder |
| Moi en partie | « Défier » désactivé, mention « partie en cours » |

Les défis viennent du `welcome` (donc du cache, aucune requête à l'ouverture de
la vue). Les parties **des amis** n'y sont pas : elles demandent
`GET /chess/matches?scope=friends`, chargé à l'ouverture du hub et mis en cache
30 s dans `api/cache/chess.ts`. Les événements `chess_*` invalident ce cache.

Savoir si l'ami est déjà pris évite d'envoyer un défi qui se prendra un `409`.

---

## 9. Cas limites

- **Restauration des tuiles** — `restoreAllTiles()` au démontage, sur
  `beforeunload`, et au changement de salon. Le registre de restauration de
  `chessBoardTiles.ts` fait le travail ; il faut juste qu'aucun chemin ne le
  contourne.
- **Sons sous CSP Discord** — les échantillons viennent de
  `images.chesscomfiles.com`. Il faut `@connect images.chesscomfiles.com` dans
  `meta.userscript.js` et un préchargement par `getAudioUrlSafe`, qui les
  transforme en blobs via `GM_xmlhttpRequest`. Sans ça, aucun son sous Discord.
- **Normalisation du volume** — l'échelle SFX du jeu plafonne à `0.2` et vise
  Howler ; `HTMLAudioElement.volume` attend `0..1`. Diviser par
  `GAME_SFX_SCALE_MAX` avant application, sinon slider à fond les sons jouent au
  cinquième du volume. C'est un bug déjà payé.
- **Clics avalés** — tout clic tombant sur une case du plateau appelle
  `preventDefault()` + `stopPropagation()`, même s'il ne déclenche aucune action,
  et même en spectateur. Hors plateau on laisse passer, le joueur doit pouvoir se
  déplacer.
- **`ply` local jamais dérivé du compteur d'animation** — il vient toujours du
  dernier `match` ou `chess_move` connu, sinon la déduplication du §5.4 dérive.

---

## 10. Vérification

**Le moteur, automatiquement :**

```json
"check:chess": "esbuild scripts/checkChessRules.ts --bundle --platform=node --format=cjs --outfile=node_modules/.cache/checkChessRules.cjs --log-level=error && node node_modules/.cache/checkChessRules.cjs"
```

Doit sortir `perft depth 5 : 4865609` et `All chess rule checks passed.`
33 vérifications. Ce nombre ne tombe juste que si déplacements, captures, sorties
d'échec, clouages et prise en passant sont tous exacts.

**L'affichage, à la main** — c'est la check-list de recette :

- une pièce noire reste noire quand l'avatar passe derrière ;
- le damier ne recouvre jamais les pièces ;
- marcher sur le plateau est impossible, marcher autour fonctionne ;
- au roque, la tour glisse en même temps que le roi ;
- un clic sélectionne, un glisser de 10 px déplace ;
- une case de promotion n'est pas plus foncée que les autres.

**Le réseau, à deux navigateurs** — défi, partie complète, abandon, nulle,
rechargement en cours de partie (la position doit revenir seule via `welcome`),
et coupure réseau d'un côté (le coup doit se recaler, pas se perdre).

---

## 11. Ordre d'implémentation

Le guide de portage est formel sur le premier point : ne pas avancer tant que le
perft ne sort pas.

1. `chessRules.ts` + `scripts/checkChessRules.ts` + `npm run check:chess`.
2. `pixiGraphics.ts`, et `getCanvas` / `pointerToFarmTile` sur la façade `tos`.
3. `chessBoardLayout.ts`, `chessBoardTiles.ts` — vérifier par un appel manuel :
   poser un décor sur une tuile, le retirer.
4. `chessBoardRender.ts` — `paintBoard()` dessine le damier,
   `renderPosition(createGame())` pose les 32 pièces.
5. `chessBoardTint.ts` — le camp noir s'assombrit.
6. `chessBoardInput.ts` + `chessBoard.ts` — partie locale jouable.
7. `chessBoardSounds.ts` + `@connect`.
8. Types, `endpoints/chess.ts`, `streams/chess.ts`, `cache/chess.ts`.
9. `chessClock.ts`, `chessHud.ts`.
10. `chessSession.ts` — la machine à états et le montage.
11. `chessChallengeUi.ts` + la section Games.
12. Spectateur.

Aux étapes 1 à 6 on a exactement ce qui tourne aujourd'hui dans Aries Mod, ce
qui donne un point de comparaison en cas de doute.
