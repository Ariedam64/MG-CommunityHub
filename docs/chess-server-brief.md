# Échecs : 4 modifs serveur

Suite de `chess-multiplayer-api.md`. Le client est écrit et déployé.
Objectif : qu'une partie d'échecs soit visible par les joueurs présents dans la
même room, en temps réel.

**Prérequis à vérifier en premier.** Ces modifs supposent que le serveur connaît
la room courante d'un joueur, celle qui alimente déjà `room_changed`. Remplace
`players.current_room_id` par le vrai nom de colonne partout ci-dessous. Si
cette information n'existe pas, dis-le moi, tout le reste tombe.

---

## 1. `GET /chess/matches?scope=room`

Un troisième `scope`, à côté de `me` et `friends` : les parties `active` dont au
moins un joueur est dans la room de l'appelant. Sans `moves`, comme les autres.

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

**Recette :** deux comptes non amis dans la même room, l'un joue, l'autre voit la
partie dans la liste. Un troisième compte dans une autre room ne la voit pas.

---

## 2. Même condition sur la lecture d'une partie

`GET /chess/matches/:id` et `GET /chess/matches/:id/moves?since=` répondent
`403` à qui n'est ni joueur ni ami. Ajouter : **ou bien un des deux joueurs
partage la room de l'appelant**.

Rien d'autre ne bouge. Une partie reste non énumérable par un inconnu, elle
devient lisible par les gens qui sont à côté.

**Recette :** le compte non ami de la modif 1 peut faire un `GET` sur l'id du
match et récupère `moves`. Depuis une autre room, `403`.

---

## 3. Diffuser `chess_move` à la room

Aujourd'hui `chess_move`, `chess_match_ended` et `chess_draw_offer` partent aux
deux joueurs via `pushUnifiedEvent`. Ajouter les autres joueurs présents dans la
room de chacun des deux.

Pas de registre, pas d'endpoint, pas d'état à garder : la room est déjà connue et
un `chess_move` pèse une centaine d'octets.

C'est cette modif qui rend l'affichage instantané au lieu d'avoir jusqu'à 5
secondes de retard, y compris sous Discord Activity.

**Recette :** le spectateur voit le coup arriver en même temps que l'adversaire,
sans rafraîchir.

---

## 4. Diffuser aussi `chess_match_started` et `chess_match_ended` à la room

Même chose pour ces deux là. Sans ça le client doit appeler la modif 1 toutes les
quelques secondes pour savoir qu'une partie a commencé, ce qui fait N requêtes
identiques par room.

**Recette :** un plateau apparaît chez le voisin au moment où sa partie démarre,
sans délai et sans sondage.

---

## Ce qui ne change pas

- Le contrôle d'amitié sur la **création** d'un défi. On défie toujours ses amis.
- Les contraintes du §3.1 (un défi en attente par paire, une partie à la fois).
- Le moteur, la pendule, les codes d'erreur.

## Hors périmètre pour l'instant

- Registre de spectateurs (`POST /watch`) et compteur `watchers`. Nécessaire
  seulement pour regarder à distance une partie qui se joue dans une autre room.
  Les 4 modifs ci-dessus couvrent le cas « dans ma room ».
- Ouvrir les défis aux inconnus.

---

Une fois les 4 en place, côté client il y a un mot à changer et deux timers à
supprimer, rien de plus.
