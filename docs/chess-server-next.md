# Échecs — ce qu'il reste à faire côté serveur

Suite de [`chess-multiplayer-api.md`](../../magicGarden%20-%20Copie/docs/chess-multiplayer-api.md).
Le client est écrit et déployable ; ce document ne décrit que ce qui lui manque
en face.

Trois chantiers indépendants. **A** est le seul dont dépend le mode spectateur ;
**C** est celui qui le rend instantané ; **B** n'a rien à voir avec les deux
autres et peut se faire ou non.

> **Une hypothèse à vérifier avant de commencer.** Tout **A** repose sur le fait
> que le serveur connaît la room courante de chaque joueur — celle qui alimente
> déjà `room_changed` et la ligne « In room » d'une fiche joueur. Le nom réel de
> la colonne est à substituer partout où j'écris `players.current_room_id`.

---

## A — Rendre une partie visible depuis sa room

**Sans ça, rien ne s'affiche pour personne d'autre que les amis des joueurs.**
Le client sait déjà dessiner une partie sur le jardin de son joueur ; il ne peut
simplement pas la lire.

### A.1 `GET /chess/matches?scope=room`

Un troisième `scope`, à côté de `me` et `friends` : les parties `active` dont au
moins un joueur est dans la même room que l'appelant.

```sql
select m.*
from public.chess_matches m
where m.status = 'active'
  and exists (
    select 1
    from public.players p
    join public.players me on me.id = $1
    where p.id in (m.white_player_id, m.black_player_id)
      and p.current_room_id is not null
      and p.current_room_id = me.current_room_id
  );
```

Sans `moves`, comme les autres scopes.

### A.2 Le même assouplissement sur la lecture d'une partie

`GET /chess/matches/:id` et `GET /chess/matches/:id/moves?since=` répondent
aujourd'hui `403` à qui n'est ni joueur ni ami. Il faut y ajouter la condition
du A.1 : **ou bien l'un des deux joueurs partage la room de l'appelant**.

Le reste ne bouge pas. Une partie reste non énumérable par un inconnu ; elle
devient lisible par les gens qui sont physiquement à côté, ce qui est
exactement le sens de la fonctionnalité.

> **L'appartenance à une room change en cours de route.** Un spectateur qui
> quitte la room perd l'accès, et son prochain appel se prend un `403` au milieu
> d'une partie. Ce n'est pas un bug à corriger côté serveur — c'est au client de
> retirer le plateau, ce qu'il fait déjà quand une lecture échoue.

### A.3 Émettre `chess_match_started` et `chess_match_ended` à la room

Aujourd'hui ces deux événements ne partent qu'aux deux joueurs. En les émettant
aussi aux autres joueurs de la room, **le client n'a plus rien à interroger pour
la découverte** : il apprend qu'une partie commence chez son voisin au moment où
elle commence.

Sans A.3, la découverte reste un `scope=room` appelé toutes les quelques
secondes par chaque client de la room — donc N requêtes identiques pour une
information qui change deux fois par partie.

### Ce que A change

| Avant | Après |
|---|---|
| Tu ne vois que les parties de tes **amis** | Tu vois toutes les parties de ta room |
| Le client interroge `scope=friends` toutes les 4 s | Avec A.3, plus aucune requête de découverte |

Côté client c'est **un mot à changer** : `scope: "friends"` devient
`scope: "room"` dans `chessRoomBoards.refreshBoards`, plus le branchement de
A.3 sur `chess_match_started`.

---

## C — Rendre les coups instantanés pour ceux qui regardent

Aujourd'hui les spectateurs ne reçoivent aucun événement (§6 de la spec) et
interrogent `?since=<ply>` en boucle. Ça marche, mais c'est le mauvais transport :
**sous Discord chaque requête HTTP met le long-poll en pause**, donc regarder une
partie retarde ses propres messages, une fois par plateau affiché.

Deux formes, de coût très différent. La première couvre le cas visible.

### C.1 Diffuser à la room — recommandé, et presque gratuit

`chess_move`, `chess_match_ended` et `chess_draw_offer` partent déjà aux deux
joueurs via `pushUnifiedEvent`. Il suffit d'ajouter les autres joueurs de la
room de chacun des deux.

**Aucun registre, aucun endpoint, aucun état.** La room est une information que
le hub a déjà, et un `chess_move` pèse une centaine d'octets. Le seul coût est
d'envoyer un événement à quelqu'un qui n'a pas le mod — ce que le hub fait déjà
pour la présence.

Ça couvre **tout le mode ambiant** : les plateaux dessinés sur les jardins des
joueurs de ta room deviennent instantanés, Discord compris, par le même chemin
qui rend ta messagerie instantanée.

### C.2 Registre de spectateurs — pour regarder à distance

Le cas restant : regarder depuis le hub une partie qui se joue **ailleurs**.
Là il faut savoir qui regarde quoi.

```
POST   /chess/matches/:id/watch    → 204
DELETE /chess/matches/:id/watch    → 204
```

- `Map<matchId, Map<playerId, expiresAt>>` en mémoire, légitime puisque le
  process est unique (§1.4 de la spec).
- **TTL plutôt que fermeture de connexion.** Sous Discord le long-poll se
  reconnecte en permanence ; « la connexion s'est fermée » ne veut rien dire.
  60 s d'expiration, le client repingue toutes les 30 s.
- Sur `chess_move` et `chess_match_ended`, la boucle d'émission ajoute les
  spectateurs non expirés.
- `GET /chess/matches` et `/:id` renvoient `watchers: <n>` dans le payload du
  match.

### Ce que C change

| | Avant | Après |
|---|---|---|
| Latence d'un coup regardé | 4 à 6 s | Instantanée |
| Requêtes par plateau ambiant | 1 toutes les 4 à 6 s | 0 |
| Long-poll Discord | mis en pause à chaque sondage | intact |
| Compteur de spectateurs | impossible | `watchers` (C.2) |

Côté client, C **supprime du code** : les deux timers de `chessRoomBoards`, et
`startSpectatorPolling` / `pollSpectatedMatch` dans `chessSession`.
`applyRoomBoardMove` est déjà branché sur le stream et n'attend que d'être
alimenté. Le compteur `👁 n` du HUD existe déjà et reste masqué tant que
`watchers` est absent du payload — il s'allumera tout seul.

---

## B — Défier des inconnus

Indépendant des deux autres : ça ne rend **aucune** partie visible.

Il s'agit de retirer le contrôle d'amitié de `POST /chess/challenges` (le
`select` sur `player_relationships`, §5.1). Le `409` du §3.1 reste, donc on ne
peut toujours pas être dans deux parties ni avoir deux défis en attente.

La spec justifiait ce contrôle par le harcèlement par défi, et l'argument tient :
sans amitié requise, n'importe qui peut relancer n'importe qui toutes les deux
minutes. Si tu ouvres, prévois en même temps :

- un réglage « refuser les défis d'inconnus », dans `privacy` où il y a déjà la
  place ;
- ou, à défaut, un rate limit par **paire** émetteur/destinataire plutôt que par
  émetteur, pour qu'un refus calme le jeu.

---

## Ordre conseillé

1. **A.1 + A.2** — le mode ambiant sort de la restriction aux amis. C'est le
   changement qui se voit.
2. **C.1** — les mêmes plateaux deviennent instantanés et cessent de poller.
   Petit, et c'est le meilleur rapport effort/effet des trois.
3. **A.3** — supprime la dernière boucle d'interrogation.
4. **C.2** — le spectateur à distance et le compteur. Plus gros, moins visible.
5. **B** — quand tu auras tranché la question du harcèlement.

Après 1 et 2, le client n'a qu'un mot à changer et deux `setInterval` à
supprimer.
