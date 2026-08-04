# Échecs : registre de spectateurs

Complément au brief précédent, dont c'était le « hors périmètre ».

Deux choses qu'il débloque :

- **regarder une partie qui se joue dans une autre room**, depuis le hub. La
  diffusion à la room ne couvre que les gens présents sur place ;
- **le compteur de spectateurs**, que le client affiche déjà et qui reste masqué
  faute de donnée.

---

## 1. Deux routes

```
POST   /chess/matches/:id/watch    → 204
DELETE /chess/matches/:id/watch    → 204
```

Mêmes conditions d'accès que `GET /chess/matches/:id` : joueur, ami, ou même
room. `403` sinon, `404` si le match n'existe pas.

`POST` est aussi le ping de renouvellement, pas seulement l'inscription. Le
client le rappelle toutes les 30 secondes tant qu'il regarde.

## 2. Le registre

```ts
Map<matchId, Map<playerId, expiresAt>>
```

En mémoire, dans le process. C'est légitime pour la même raison que le hub
d'événements (§1.4 de la spec) : il n'y a qu'un conteneur `api`.

**TTL de 60 secondes, renouvelé par le `POST`.** Une entrée expirée est ignorée
puis nettoyée au passage.

> **Ne pas se baser sur la fermeture de la connexion.** Sous Discord Activity le
> transport est du long-polling : la connexion se ferme et se rouvre en
> permanence, en fonctionnement normal. « Le spectateur s'est déconnecté » n'y
> veut rien dire, alors que le TTL marche pareil des deux côtés.

Les entrées d'un match sont jetées quand il passe `finished`.

## 3. Diffusion

`chess_move`, `chess_match_ended`, `chess_draw_offer` et `chess_draw_declined`
partent en plus aux spectateurs non expirés.

**Déduplique avec la diffusion à la room** : quelqu'un qui est à la fois dans la
room et inscrit ne doit recevoir l'événement qu'une fois. Une union des deux
ensembles de `playerId` avant d'émettre suffit.

Une diffusion qui échoue est journalisée et n'annule rien, comme pour la room.

## 4. `watchers` dans le payload

`GET /chess/matches` et `GET /chess/matches/:id` renvoient le nombre d'entrées
non expirées :

```json
"watchers": 3
```

Le client masque le compteur quand le champ est absent, donc rien ne casse tant
que ce n'est pas livré. Compter les entrées expirées ferait afficher des
spectateurs partis depuis dix minutes.

---

## Recette

- Un compte dans une **autre room** appelle `POST /watch`, puis reçoit
  `chess_move` en direct sur son flux. Sans le `POST`, il ne reçoit rien.
- Il arrête de pinguer : au bout de 60 s il cesse de recevoir, et `watchers`
  redescend.
- Un compte **dans la room** des joueurs, inscrit en plus, reçoit chaque
  événement **une seule fois**.
- `watchers` reflète le nombre réel, et retombe à 0 quand tout le monde part.
- La partie se termine : le registre du match est vidé.

## Ce qui ne change pas

- La diffusion à la room, qui reste le chemin des spectateurs sur place.
- Les conditions d'accès en lecture.
- Le moteur, la pendule, les codes d'erreur.
