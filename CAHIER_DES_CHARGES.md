# Art Collectif — Cahier des charges V1

**Version :** 1.1  
**Date :** 1er novembre 2026  
**Statut :** spécification de développement consolidée  
**Nature :** application web de création plastique collaborative  
**Durée de l'expérience :** 1 à 2 mois  
**Principe de développement :** privilégier la simplicité, la fiabilité et la réutilisation de composants éprouvés.

Ce document remplace la version 1.0. Il intègre la revue de cohérence et les arbitrages du porteur du projet. Les critères de performance constituent des exigences à vérifier, et non des résultats de tests déjà exécutés.

## 1. Objectif

Développer une application web permettant à des personnes anonymes, recrutées notamment via Reddit, d'intervenir collectivement sur une image initiale en noir et blanc. Chaque participant peut dessiner librement, soit pixel par pixel, soit au pinceau.

Les contributions sont synchronisées entre les utilisateurs connectés et conservées dans un historique permettant de reconstruire un état antérieur et de générer une vidéo timelapse.

À la clôture de l'expérience, l'artiste doit pouvoir récupérer l'image, son historique et les vidéos afin de poursuivre son travail sous une forme matérielle, notamment par impression et intervention manuelle.

L'application est un dispositif de création, pas un réseau social.

### 1.1 Principes non négociables

1. Le fond original reste techniquement intact, mais peut être entièrement recouvert.
2. Les utilisateurs peuvent recouvrir sans restriction les dessins précédents.
3. Les participants utilisent exclusivement les couleurs autorisées, jamais du noir, du blanc ou du gris.
4. Aucun quota global de pixels ou d'interventions n'est appliqué.
5. Toutes les opérations acceptées sont enregistrées durablement et peuvent être rejouées.
6. L'historique n'est jamais exposé par l'interface ou les API publiques.
7. Aucun compte n'est nécessaire pour participer.
8. Le projet peut être arrêté puis exporté intégralement par l'administrateur.
9. Tous les exports sont privés et réservés à l'administrateur.

### 1.2 Arbitrages retenus

| Sujet | Décision |
|---|---|
| Export public | Aucun, y compris anonymisé |
| Relecture et timelapse | Deux politiques : brut et modéré selon les décisions retenues au début de la relecture |
| Reconstitution de la modération telle qu'affichée à l'époque | Hors périmètre |
| Redémarrage avec stockage intact | Aucune perte d'opération acquittée |
| Perte complète du disque ou du VPS | Objectif de perte maximale d'une heure de contributions |
| Capacité cible | 50 personnes dessinant simultanément |
| Commandes locales non confirmées | Conservées pendant la vie de l'onglet ; persistance après fermeture ou rechargement hors périmètre |
| Fond, dimensions et palette | Figés dès la première ouverture |
| Clôture | Définitive pour la V1 |

La capacité cible constitue une marge de fonctionnement ; elle ne suppose pas que cette fréquentation sera atteinte.

### 1.3 Vocabulaire

- **Intervention ou trait :** un clic, un glissement continu de l'outil Pixel ou un trait complet de pinceau.
- **Commande ou partie :** un message technique appartenant à une intervention. Une intervention longue contient plusieurs commandes.
- **Séquence (seq) :** ordre définitif des commandes acceptées, attribué par le serveur.
- **Révision de modération :** version des décisions de masquage et de restauration.
- **État brut :** dessin obtenu sans appliquer de masquage.
- **État modéré :** dessin obtenu en excluant les traits masqués à la révision retenue.

## 2. Périmètre fonctionnel

### 2.1 Interface publique

Une unique page responsive comprenant :

- Un titre et une courte présentation du projet.
- Un canevas partagé de 720 × 480 pixels.
- Deux outils : **Pixel** et **Pinceau**.
- Une palette de 24 couleurs prédéfinies.
- Un sélecteur d'épaisseur du pinceau.
- Un zoom et un déplacement dans le canevas.
- Un indicateur de connexion et de disponibilité du dessin.
- Un accès au texte d'information et aux conditions de participation.

L'interface fonctionne avec souris, écran tactile et stylet via les Pointer Events.

Les opérations de zoom et de déplacement ne modifient jamais l'image. Sur écran tactile, un pointeur dessine ; un geste à deux doigts sert au déplacement et au zoom et interrompt le dessin actif. Prévoir une commande explicite de déplacement pour la souris. Le comportement de capture, de sortie du canevas et de cancellation du pointeur est testé.

Aucune fonctionnalité publique de consultation des états antérieurs, de lecture du timelapse, de téléchargement d'image ou d'export d'historique n'est fournie.

### 2.2 Outil Pixel

- Un clic colore exactement une cellule de la grille.
- Un déplacement avec le bouton maintenu colore les cellules du tracé interpolé, sans trou.
- La couleur provient exclusivement de la palette autorisée.
- Une nouvelle intervention peut remplacer n'importe quelle couleur précédente.
- Un pixel du fond noir et blanc peut être recouvert.
- L'épaisseur de cet outil est toujours de 1 pixel.

### 2.3 Outil Pinceau

- Dessin libre par déplacement du pointeur.
- Trait continu composé de pixels opaques.
- Épaisseurs prédéfinies : 1, 3, 5, 9, 15 et 21 pixels.
- Extrémités arrondies selon un masque circulaire discret.
- Aucun anticrénelage, transparence ou mélange des couleurs.
- Les tracés peuvent se superposer et se recouvrir.
- Même système de coordonnées que l'outil Pixel.
- La pression et l'inclinaison du stylet ne modifient pas l'épaisseur en V1.

### 2.4 Comportement collaboratif

Toute intervention acceptée est répercutée aux utilisateurs connectés, sous réserve des décisions de modération.

L'affichage local est immédiat et provisoire. Le serveur décide de l'ordre définitif des modifications. Dans le rendu modéré, la dernière opération non masquée acceptée sur une cellule détermine sa couleur visible.

Le client conserve séparément :

1. La grille confirmée par le serveur.
2. Les commandes locales en attente de confirmation.

Un refus retire la prévisualisation correspondante. L'acquittement établit l'acceptation durable ; le flux ordonné ou l'état complet établit le contenu de la grille confirmée. Une commande n'est pas appliquée deux fois lorsque l'acquittement et la diffusion arrivent dans un ordre différent.

En cas de perte de connexion :

- L'interface signale le problème et suspend les nouveaux dessins.
- Les parties déjà acceptées sont conservées.
- Les commandes envoyées mais non confirmées restent en mémoire dans l'onglet.
- Après réception de l'état courant, elles sont réémises dans leur ordre d'origine, avec leurs identifiants et contenus initiaux.
- La fermeture ou le rechargement de l'onglet peut perdre les commandes non confirmées, jamais celles déjà acceptées par le serveur.

Les participants n'ont pas accès aux identifiants des autres utilisateurs.

### 2.5 Administration

Interface privée protégée par authentification, permettant de :

- Importer et vérifier le fond PNG.
- Définir et vérifier la palette avant l'ouverture.
- Ouvrir, suspendre, reprendre et clôturer l'expérience.
- Consulter l'historique ordonné des contributions.
- Afficher une image à une date ou un numéro de séquence, en mode brut ou modéré.
- Masquer ou restaurer une intervention complète.
- Exporter les images, les contributions et les décisions de modération.
- Télécharger les archives déjà produites par les outils CLI.

Le fond, les dimensions et la palette sont modifiables uniquement à l'état draft. Ils sont figés dès la première ouverture, même si aucune contribution n'a encore été acceptée.

### 2.6 Cycle de vie

Transitions autorisées :

- draft → open
- open → paused
- paused → open
- open → closed
- paused → closed

L'ouverture exige un fond et une palette valides. started_at est fixé à la première ouverture et conservé lors des reprises. closed_at est fixé à la clôture.

L'état closed est définitif. La consultation, la modération et les exports administratifs restent possibles après clôture. La grille publique demeure consultable tant que le service reste hébergé.

Les commandes nouvelles sont acceptées uniquement à l'état open. Les retransmissions de commandes déjà enregistrées restent acquittées dans tous les états.

## 3. Architecture retenue

### 3.1 Technologies

| Composant | Technologie |
|---|---|
| Langage | TypeScript |
| Frontend | Vite + TypeScript, sans framework UI obligatoire |
| Graphisme | Canvas 2D |
| Backend | Node.js + Fastify |
| Temps réel | Socket.IO |
| Base de données | SQLite en mode WAL |
| Traitement PNG | Sharp |
| Timelapse | FFmpeg |
| Déploiement | Docker Compose |
| HTTPS | Caddy |
| Tests | Vitest et Playwright |

Utiliser des versions stables et maintenues au démarrage du développement, verrouiller les dépendances avec un fichier lock et documenter les versions de Node.js, SQLite et FFmpeg.

La connexion SQLite d'écriture utilise explicitement journal_mode=WAL et synchronous=FULL. Ces valeurs sont vérifiées au démarrage. Les contraintes de références et de domaine sont activées et testées.

### 3.2 Organisation du code

~~~text
art-collectif/
├── README.md
├── CAHIER_DES_CHARGES.md
├── web/
│   ├── src/
│   │   ├── canvas/
│   │   ├── tools/
│   │   ├── realtime/
│   │   └── main.ts
│   └── index.html
├── server/
│   └── src/
│       ├── api/
│       ├── realtime/
│       ├── database/
│       ├── renderer/
│       └── admin/
├── shared/
│   ├── protocol.ts
│   ├── raster.ts
│   └── types.ts
├── scripts/
│   ├── export-archive.ts
│   └── export-video.ts
├── tests/
├── Dockerfile
├── docker-compose.yml
└── Caddyfile
~~~

Les dossiers peuvent être regroupés si cela simplifie le développement. Ne pas multiplier les packages ni introduire de monorepo complexe.

### 3.3 Règles d'architecture

- Une seule instance du backend.
- Une seule base SQLite locale faisant autorité.
- Un seul canevas partagé.
- Un seul responsable de l'ordre des écritures.
- Aucun Redis, PostgreSQL, système de comptes ou orchestrateur distribué.
- Aucun service externe requis pour le dessin et la synchronisation.
- Un stockage extérieur au VPS est nécessaire aux sauvegardes.
- Les exports vidéo s'exécutent hors du chemin de traitement des contributions.
- Les fichiers de données sont stockés sur des volumes persistants, hors du dépôt de code et hors des ressources web publiques.

Le code reste compréhensible et facilement maintenable.

## 4. Modèle graphique

### 4.1 Dimensions et calques

Grille fixe de **720 × 480 pixels**, soit **345 600 cellules**.

**Fond original :**

- PNG de 720 × 480 pixels.
- Opaque, en niveaux de gris : R = G = B.
- Fichier original conservé sans modification.
- Validation des dimensions et pixels décodés avant acceptation.
- Non accessible en écriture aux participants.

**Calque des contributions :**

- Une grille de mêmes dimensions.
- Index 0 : aucune contribution visible, le fond apparaît.
- Index 1 à 24 : couleur opaque de la palette.
- Représentation serveur : Uint8Array(720 * 480).
- Taille brute : 345 600 octets, environ 337,5 Kio.

L'index 0 est un état interne ; il ne peut jamais être soumis comme couleur de dessin.

### 4.2 Palette

L'administrateur définit 24 couleurs chromatiques distinctes avant l'ouverture. La liste RGB exacte est enregistrée dans la configuration et exportée avec le projet.

Les noirs, blancs, gris et couleurs presque neutres sont exclus. L'interface présente une prévisualisation et impose une validation de la palette avant ouverture. Le critère numérique retenu pour exclure les couleurs presque neutres est explicite, testé et documenté lors de l'implémentation ; il ne dépend pas du navigateur.

Le navigateur transmet uniquement un index de palette. Le serveur refuse toute valeur RGB libre et tout index hors de 1 à 24.

### 4.3 Rastérisation

Créer dans shared/raster.ts des fonctions pures et déterministes :

- paintPixel(x, y, colorId)
- paintLine(x0, y0, x1, y1, colorId)
- paintBrush(points, diameter, colorId)

Ces fonctions produisent les cellules à modifier ; elles ne dépendent ni du DOM ni de l'état implicite d'un Canvas.

Pour les lignes, utiliser une variante entière de Bresenham précisément définie. Le choix des cellules en cas d'égalité et l'inclusion des extrémités sont fixés dans le code et dans des tests de référence.

Pour le pinceau, appliquer un masque circulaire discret de diamètre impair autour des cellules du tracé. La liste exacte des cellules de chaque masque fait partie du moteur versionné et des tests.

Tous les points successifs d'un trajet sont reliés, y compris entre parties d'une intervention. Aucun calcul dépendant des paramètres graphiques du navigateur ne détermine le résultat définitif.

Les centres sont des coordonnées entières valides. Les empreintes dépassant les bords sont découpées. Le serveur refuse les centres hors limites.

Le client inverse les transformations de zoom et déplacement, puis utilise une règle documentée de conversion en cellule, identique pour les deux outils. Le ratio de pixels de l'écran n'affecte pas les coordonnées natives.

À la sortie du pointeur hors du canevas, le tracé est interrompu. La rentrée ne relie pas artificiellement le nouveau point au dernier point intérieur : elle commence une nouvelle intervention si le dessin reprend.

La prévisualisation, le serveur, la lecture historique et les exports utilisent le même moteur. Le rendu d'affichage agrandi désactive le lissage.

## 5. Modèle de données

SQLite est la seule base de données nécessaire. Les migrations sont versionnées.

### 5.1 Table project

Une seule ligne en V1.

| Champ | Type | Fonction |
|---|---|---|
| id | INTEGER PK | Identifiant fixe |
| width | INTEGER | 720 |
| height | INTEGER | 480 |
| status | TEXT | draft / open / paused / closed |
| palette_json | TEXT | 24 couleurs RGB exactes |
| base_image_path | TEXT | Emplacement privé du fond |
| base_image_checksum | TEXT | SHA-256 du fond original |
| title | TEXT | Titre public |
| description | TEXT | Présentation publique |
| participation_terms | TEXT | Texte des conditions |
| started_at | TEXT nullable | Première ouverture, UTC |
| closed_at | TEXT nullable | Clôture, UTC |
| moderation_revision | INTEGER | Révision courante, initialement 0 |
| event_format_version | TEXT | Version du format d'événements |
| raster_version | TEXT | Version du moteur de rastérisation |

La modification éventuelle des textes éditoriaux après ouverture ne doit pas modifier les paramètres graphiques figés. Les conditions applicables aux contributions et leurs changements sont documentés ; aucun changement rétroactif implicite n'est effectué.

### 5.2 Table participants

| Champ | Type | Fonction |
|---|---|---|
| id | TEXT PK | Identifiant aléatoire interne |
| token_hash | TEXT UNIQUE | Empreinte du jeton anonyme |
| created_at | TEXT | Première visite, UTC |
| last_seen_at | TEXT | Dernière activité, UTC |

Une session anonyme est fournie par un cookie Secure, HttpOnly et SameSite, sur la même origine que l'application. Le jeton brut n'est pas conservé en base.

Aucun profil, nom ou adresse électronique n'est demandé. La durée du cookie couvre l'expérience et est documentée. La perte du cookie crée une nouvelle identité technique sans supprimer les contributions antérieures.

Les identifiants sont pseudonymes ; ils ne sont pas diffusés publiquement.

### 5.3 Table draw_events

Journal principal append-only.

| Champ | Type | Fonction |
|---|---|---|
| seq | INTEGER PK | Ordre global des commandes acceptées |
| op_id | TEXT | Identifiant de commande dans la session |
| participant_id | TEXT | Auteur pseudonyme |
| stroke_id | TEXT | Intervention |
| part_index | INTEGER | Position de la partie, à partir de 0 |
| final | INTEGER | Booléen de fin d'intervention |
| tool | TEXT | pixel / brush |
| color_id | INTEGER | Index 1 à 24 |
| size | INTEGER | 1 pour Pixel ; taille autorisée pour Pinceau |
| points_json | TEXT | Liste ordonnée de coordonnées |
| created_at | TEXT | Date d'acceptation UTC |

Contraintes :

- UNIQUE(participant_id, op_id).
- UNIQUE(participant_id, stroke_id, part_index).
- Index sur (participant_id, stroke_id).
- Vérification des domaines : outil, couleur, taille, part_index et final.
- Référence valide au participant.
- seq est l'ordre de référence ; les événements acceptés ne sont pas supprimés.

Le contenu canonique conservé permet de comparer une retransmission au message initial, y compris son indicateur final.

Une commande de clôture technique sans points est autorisée dans les conditions du §6.2. Elle possède une séquence et ne modifie aucune cellule.

### 5.4 Table moderation_actions

| Champ | Type | Fonction |
|---|---|---|
| id | INTEGER PK | Ordre des décisions |
| revision | INTEGER UNIQUE | Révision résultante |
| participant_id | TEXT | Auteur du trait visé |
| stroke_id | TEXT | Trait visé |
| action | TEXT | hide / restore |
| reason | TEXT | Motif interne |
| created_at | TEXT | Date UTC |

Les décisions successives sont conservées. À une révision donnée, la dernière décision applicable à un trait détermine sa visibilité ; en l'absence de décision, le trait est visible.

L'insertion d'une décision et l'incrément de project.moderation_revision sont atomiques. Une modération ordinaire ne supprime jamais les événements originaux.

### 5.5 Table snapshots

| Champ | Type | Fonction |
|---|---|---|
| seq | INTEGER | Dernière commande intégrée |
| moderation_revision | INTEGER | Révision utilisée |
| file_path | TEXT | Fichier privé de grille compressée |
| checksum | TEXT | SHA-256 du fichier |
| created_at | TEXT | Date UTC |

Clé primaire composite : (seq, moderation_revision).

Les snapshots automatiques concernent la vue modérée. Un export brut n'utilise pas un snapshot modéré ; il rejoue depuis zéro ou utilise un cache brut distinct explicitement identifié.

Les snapshots sont des caches reconstructibles. Le fond, la palette, le journal et les décisions de modération font autorité.

## 6. Traitement d'une intervention

### 6.1 Format des commandes

Message Socket.IO draw:submit :

~~~json
{
  "opId": "92dbbd9a-18d8-44e0-9a52-fbd779b15452",
  "strokeId": "d8c1d745-4a96-4059-ac8f-bd0a01dd35fb",
  "partIndex": 0,
  "final": false,
  "tool": "brush",
  "colorId": 6,
  "size": 5,
  "points": [[120, 88], [125, 91], [131, 97]]
}
~~~

Les coordonnées sont entières dans le système natif du canevas.

L'outil Pixel utilise tool: "pixel", size: 1 et une liste de points. Un clic simple contient un point et final: true.

### 6.2 Regroupement, continuité et clôture

- Intervalle cible : 50 à 100 ms.
- Maximum : 64 points par commande.
- Maximum : 16 Kio par message entrant de dessin.
- Aucun quota cumulé de commandes par intervention ou session.
- Les parties commencent à 0 et suivent l'ordre sans saut.
- Pour les deux outils, le premier point d'une partie graphique suivante reprend le dernier point accepté de la précédente.
- Le serveur valide cette continuité.
- Outil, couleur et épaisseur sont constants dans une intervention ; leur changement démarre une nouvelle intervention.
- Les identifiants et les longueurs de chaînes sont bornés et validés.

Chaque partie est persistée séparément. Un trait interrompu conserve toutes ses parties acceptées.

Lors du relâchement, le dernier lot porte final: true. Si tous les points ont déjà été envoyés, le client peut envoyer une partie suivante avec points: [] et final: true. Cette clôture sans dessin :

- Est autorisée uniquement pour une intervention déjà commencée et non close.
- Respecte l'index suivant et les paramètres du trait.
- Est persistée et acquittée de façon idempotente.
- Ne repeint pas le dernier point et n'exécute pas de rastérisation.

Une partie vide avec final: false est invalide. Aucune nouvelle partie n'est acceptée après une partie finale. Un trait sans fin explicite reste reconstructible et modérable.

### 6.3 Algorithme serveur

Le traitement des commandes est sérialisé avec les changements de statut et les décisions de modération.

1. Identifier la session anonyme.
2. Vérifier la taille et la structure du message.
3. Rechercher la commande par (participant_id, op_id).
4. Si elle existe et que le contenu canonique est identique, retourner l'acquittement original, même si le projet est suspendu ou clôturé. Ne pas l'appliquer ou la diffuser une seconde fois.
5. Si l'identifiant existe avec un contenu différent, refuser avec OP_ID_CONFLICT.
6. Pour une commande nouvelle, vérifier le statut open et les protections anti-abus.
7. Valider couleur, coordonnées, outil, taille, paramètres constants, ordre des parties, continuité et clôture.
8. Attribuer la séquence et enregistrer la commande dans une transaction SQLite.
9. Valider la transaction.
10. Appliquer l'effet de la commande à l'état mémoire, selon la visibilité du trait.
11. Retourner l'acquittement.
12. Diffuser une mise à jour publique ordonnée, y compris à l'émetteur.

La recherche d'un doublon précède la vérification du statut courant et de l'index attendu. Les limites de protection des connexions restent applicables aux requêtes abusives.

Aucune commande n'est annoncée comme acceptée avant la réussite du commit. Une erreur d'écriture interdit tout acquittement positif.

En cas d'échec de mise à jour de l'état mémoire après commit, le service cesse de servir des états incohérents, suspend le traitement et reconstruit la grille depuis le journal.

En cas de redémarrage entre commit et diffusion, le journal reconstruit l'état ; les clients reconnectés reçoivent cet état et peuvent réobtenir leurs acquittements.

### 6.4 Concurrence

Les interventions sont appliquées dans l'ordre croissant de seq, partie par partie. Deux traits simultanés peuvent donc avoir leurs parties entrelacées.

La dernière écriture non masquée sur une cellule est visible. Le regroupement en trait sert notamment à la modération ; il ne transforme pas un trait long en transaction graphique indivisible.

Aucun verrouillage de zone, réservation de cellule ou CRDT n'est nécessaire.

## 7. Protocole temps réel

Utiliser Socket.IO sans dépendre exclusivement de sa récupération automatique.

### 7.1 Messages

| Sens | Message | Contenu |
|---|---|---|
| Client → serveur | draw:submit | Commande de dessin ou clôture technique |
| Client → serveur | canvas:resync | Demande d'état complet |
| Serveur → client | canvas:state | Grille, dimensions, palette, seq, moderationRevision, statut |
| Serveur → client | draw:applied | seq, moderationRevision et changements visibles |
| Serveur → client | project:status | Statut et disponibilité courante du dessin |
| Serveur → client | canvas:reset | Signal de remplacement avec l'état complet correspondant |
| Serveur → client | draw:rejected | Identifiant de la commande du destinataire et code de refus |

L'acquittement Socket.IO de chaque soumission constitue la réponse principale ; draw:rejected, s'il est émis, ne déclenche pas un second traitement du refus.

### 7.2 Acquittement et erreurs

~~~json
{
  "opId": "92dbbd9a-18d8-44e0-9a52-fbd779b15452",
  "accepted": true,
  "seq": 1842
}
~~~

Un refus renvoie accepted: false et un code explicite, sans appliquer la commande. Prévoir notamment : INVALID_MESSAGE, INVALID_COLOR, INVALID_COORDINATES, INVALID_SIZE, PROJECT_NOT_OPEN, OP_ID_CONFLICT, PART_OUT_OF_ORDER, STROKE_CLOSED, CONTINUITY_ERROR, RATE_LIMITED et STORAGE_UNAVAILABLE.

Les délais de retransmission sont bornés et espacés. Une erreur définitive n'est pas réessayée indéfiniment. Le délai d'attente d'un acquittement ne signifie pas que la commande a été refusée.

### 7.3 Diffusion publique

Ne jamais sérialiser directement une ligne de draw_events vers les participants.

Les messages publics ne contiennent ni participant_id, ni identifiants de session, ni motifs de modération. L'identifiant opId est retourné uniquement au participant concerné dans sa réponse.

La diffusion envoie les cellules modifiées et leurs nouveaux index, sous forme compacte et déterministe. Elle ne diffuse pas la géométrie d'un trait masqué. Une commande sans effet visible peut produire une mise à jour vide portant sa séquence.

Les limites de taille des messages entrants ne sont pas confondues avec celles des états ou mises à jour sortants. Le protocole sortant accepte une grille complète et les changements résultant d'une commande valide.

Chaque mise à jour porte seq et moderationRevision. Un état de dessin est identifié par ce couple.

### 7.4 Initialisation, remplacement et reconnexion

À chaque connexion ou reconnexion :

1. Le serveur organise dans la file sérialisée une capture cohérente et l'inscription au flux, sans fenêtre de perte.
2. Il transmet canvas:state.
3. Le client installe la grille confirmée et ses métadonnées.
4. Il applique les événements suivants dans l'ordre.
5. Il réconcilie puis réémet les commandes non acquittées.

Les événements déjà intégrés sont ignorés. Une séquence manquante ou une révision incompatible déclenche une resynchronisation. Le client ne mélange pas des messages de deux révisions de modération.

Une commande locale acquittée reste en attente de réconciliation graphique jusqu'à ce que l'état confirmé couvre sa séquence. Une resynchronisation couvrant déjà cette commande ne la rejoue pas dans l'état confirmé.

Les opérations en attente sont réconciliées après un reset de modération ; une ancienne prévisualisation ne doit pas persister au-dessus d'un trait désormais masqué.

## 8. API HTTP

Les limites, formats d'erreur, types de contenu et règles de cache sont documentés.

### 8.1 API publique

| Route | Fonction |
|---|---|
| GET /api/project | Dimensions, palette, statut, titre, présentation et conditions |
| GET /api/health | Disponibilité simple sans détail sensible |
| POST /api/session | Émission ou récupération du cookie anonyme ; aucun jeton brut dans la réponse JSON |

L'état visuel actuel et le fond nécessaire à son affichage sont transmis par le canal de synchronisation ou une ressource strictement limitée au fond courant. Aucune URL ne donne accès aux répertoires internes.

Il n'existe pas de route publique /api/image.png, d'export, de consultation historique ou d'information sur les participants. Aucune fonction de téléchargement n'est proposée au public.

### 8.2 API d'administration

Toutes les routes ci-dessous exigent une session administrateur valide, à l'exception du login, qui crée cette session après authentification.

| Route | Fonction |
|---|---|
| POST /api/admin/login | Authentification, protection contre tentatives répétées |
| POST /api/admin/logout | Invalidation de la session |
| POST /api/admin/base-image | Import et validation du PNG ; draft uniquement |
| PUT /api/admin/config | Configuration ; paramètres graphiques modifiables en draft uniquement |
| POST /api/admin/status | Transition autorisée du cycle de vie |
| GET /api/admin/events?after=SEQ&limit=100 | Journal paginé dans l'ordre ; limite maximale côté serveur |
| GET /api/admin/image.png?seq=1842&moderation=moderated | Reconstruction privée |
| POST /api/admin/moderation | hide ou restore pour (participant_id, stroke_id), avec motif |
| GET /api/admin/export/events.jsonl | Journal complet privé |
| GET /api/admin/export/moderation.jsonl | Décisions de modération privées |
| GET /api/admin/export/final.png | Image composée au point de capture |
| GET /api/admin/export/overlay.png | Calque couleur transparent |
| GET /api/admin/archives | Liste des archives déjà produites |
| GET /api/admin/archives/:archiveId | Téléchargement d'une archive existante |

Pour les images :

- seq et at (date ISO 8601 UTC) sont mutuellement exclusifs.
- Sans cible, utiliser l'état courant au début de la demande.
- Une date correspond au dernier événement accepté à cette date ou avant elle ; aucun événement donne seq=0.
- Les horodatages d'acceptation sont non décroissants ; seq départage les égalités et reste l'ordre de référence.
- moderation accepte raw ou moderated et vaut moderated par défaut.
- Une reconstruction modérée fige la révision utilisée et la restitue dans les métadonnées de la réponse.
- Les paramètres invalides sont refusés explicitement.

Les téléchargements administratifs ne sont pas mis en cache publiquement. Un archiveId est résolu côté serveur et n'autorise aucun chemin arbitraire.

Les exports vidéo et ZIP sont exécutés par scripts CLI privés. L'interface ne lance pas leur calcul dans une requête web longue.

## 9. Historique, snapshots et modération

### 9.1 Conservation et modes de relecture

Chaque commande acceptée conserve son auteur pseudonyme, sa date serveur, sa séquence, ses coordonnées, son outil, ses paramètres, son trait et son indicateur de fin.

On conserve la géométrie, pas une copie de l'image pour chaque modification. Le journal est la source de vérité.

Deux modes seulement :

- **Brut :** toutes les contributions jusqu'à la cible, sans appliquer les masquages.
- **Modéré :** mêmes contributions, en excluant les traits masqués à la révision fixée au début de la relecture.

Une modération actuelle s'applique rétroactivement à toutes les étapes de la relecture modérée. Le mode « exactement tel qu'affiché à l'époque, avec l'apparition et le retrait des masquages » n'est pas développé.

Les décisions successives restent conservées pour la traçabilité administrative.

### 9.2 Snapshots

Créer un snapshot :

- Toutes les 500 commandes acceptées depuis le précédent snapshot.
- Ou après 15 minutes écoulées depuis le précédent snapshot si la grille a changé.

Ne pas créer de snapshot si aucun changement graphique ni changement de révision ne le justifie. Une clôture technique seule ne nécessite pas de nouveau snapshot.

Capturer de façon cohérente la grille, seq et moderation_revision, puis compresser et écrire le fichier sans bloquer durablement les contributions. Écrire d'abord un fichier temporaire, puis le publier atomiquement et enregistrer sa référence.

Au chargement, vérifier format, taille décompressée et checksum. Un snapshot absent, corrompu ou incompatible est ignoré ; utiliser un autre cache valide ou rejouer depuis zéro.

Pour une vue modérée, utiliser uniquement un snapshot de même révision et de séquence inférieure ou égale à la cible. Rejouer ensuite les commandes restantes.

La rétention des snapshots est bornée et documentée ; supprimer un cache ne supprime jamais le journal.

### 9.3 Modération

L'administrateur masque ou restaure un trait entier identifié par (participant_id, stroke_id).

Procédure :

1. Bloquer temporairement les nouvelles écritures dans l'ordre sérialisé et signaler la suspension technique.
2. Enregistrer la décision et incrémenter la révision dans une même transaction.
3. Invalider logiquement les anciens caches modérés.
4. Reconstruire l'image avec les traits visibles à la nouvelle révision.
5. Rejouer toutes les contributions conservées dans leur ordre initial.
6. Remplacer atomiquement l'état public et transmettre canvas:reset avec son état complet.
7. Rétablir la disponibilité autorisée par le statut réel du projet.

Une suspension technique ne rouvre jamais un projet paused ou closed. En cas d'échec de reconstruction, les écritures restent suspendues jusqu'au rétablissement de la cohérence.

Les futures parties d'un trait déjà masqué restent masquées même si elles sont acceptées après la décision. Elles sont enregistrées et font progresser la séquence sans diffuser leur géométrie.

Restaurer un trait rétablit ses écritures à leur place initiale ; cela ne les remet pas par-dessus les contributions ultérieures.

## 10. Exports et vidéo

Tous les exports sont administratifs. Aucun export public, même anonymisé, n'existe.

### 10.1 Cohérence des exports

Chaque export travaille sur une copie cohérente de la base, avec :

- Une séquence maximale fixée.
- Une révision de modération fixée pour le mode modéré.
- Le fond et la palette correspondants.
- Un instant de capture et les paramètres enregistrés.

Le transfert de cette copie pour le rendu ne garde pas une transaction longue ouverte sur la base active. Tous les fichiers d'une archive proviennent du même point de capture.

### 10.2 Images

Fournir :

- Fond original inchangé.
- Calque des contributions avec transparence uniquement pour l'index 0.
- Image composée finale ou courante.
- Image composée à une séquence arbitraire.
- Image composée à une date donnée.
- Choix brut ou modéré, modéré par défaut.
- Agrandissement entier par plus proche voisin pour l'impression.

Le mode retenu figure dans les noms ou métadonnées. Les pixels de contribution restent opaques et ne sont jamais mélangés.

### 10.3 Timelapse

Créer scripts/export-video.ts.

Le script relit le journal, reconstruit les états puis les fournit à FFmpeg, avec un traitement incrémental et une utilisation bornée des fichiers temporaires.

Deux rythmes :

- **Chronologique :** échantillonnage à intervalles réguliers entre started_at et closed_at ; pour un projet non clos, utiliser l'instant de capture. Inclure les périodes sans intervention et les pauses.
- **Activité :** échantillonnage selon les séquences acceptées entre 0 et la séquence maximale.

Deux politiques indépendantes :

- **raw :** aucune modération.
- **moderated :** masquages à la révision fixée pour l'export, appliqués rétroactivement.

À paramètres identiques, les versions brute et modérée utilisent les mêmes cibles de séquence. Une opération masquée ou une clôture technique peut donc ne provoquer aucun changement visuel.

Paramètres CLI :

- --mode chronological|activity
- --moderation raw|moderated
- Durée cible.
- Images par seconde.
- Résolution et facteur d'agrandissement, avec validation de leur cohérence.
- Cible de fin ou point de capture.

Valeurs initiales :

- MP4 H.264.
- 25 images/seconde.
- 180 secondes.
- 1440 × 960 pixels, facteur 2.
- Agrandissement par plus proche voisin.
- Image initiale et image finale incluses.

Le nombre d'images est calculé selon une règle documentée à partir de la durée et de la fréquence, avec au moins deux images. Les cibles d'échantillonnage et arrondis sont déterministes. Sans contribution, produire une vidéo fixe du fond. Sans ouverture, l'export chronologique est refusé avec un message explicite.

La reproductibilité exige les mêmes états graphiques échantillonnés. Elle n'impose pas des MP4 identiques octet pour octet entre versions d'encodeur.

### 10.4 Archive complète

Créer scripts/export-archive.ts, produisant :

~~~text
archive/
├── project.json
├── manifest.json
├── base.png
├── final.png
├── overlay.png
├── events.jsonl
├── moderation.jsonl
├── snapshots/
├── replay/
├── timelapse-chronologique-brut.mp4
├── timelapse-chronologique-modere.mp4
├── timelapse-activite-brut.mp4
├── timelapse-activite-modere.mp4
└── README.txt
~~~

Seules les vidéos demandées sont présentes. final.png et overlay.png utilisent le mode indiqué dans le manifeste, modéré par défaut. Les snapshots peuvent être omis ; ils ne sont pas nécessaires à la relecture.

L'archive inclut les pseudonymes techniques nécessaires à la traçabilité, mais exclut les jetons, empreintes de jetons, sessions, secrets et journaux de sécurité. Elle n'embarque pas la base opérationnelle brute contenant ces données.

Le manifeste précise :

- Format de l'archive et des événements.
- Version du moteur et référence exacte du code.
- Séquence maximale, instant de capture et révision utilisée.
- Politique de modération et paramètres de chaque rendu.
- Versions de Node.js et FFmpeg pertinentes.
- Liste des fichiers et sommes de contrôle des autres fichiers de l'archive.

Le dossier replay contient le code de relecture, le fichier lock et les instructions nécessaires, ou une copie de la distribution correspondante. Un simple numéro de version sans code récupérable ne suffit pas.

L'archive doit permettre de reconstruire le projet indépendamment du serveur d'origine. Aucune licence publique de réutilisation des contributions n'est déduite de la visibilité du dépôt de code.

## 11. Sécurité, confidentialité et disponibilité

### 11.1 Protection

- HTTPS obligatoire.
- Validation stricte de toutes les entrées côté serveur.
- Refus des couleurs, outils, tailles et coordonnées non autorisés.
- Limites de taille et de fréquence configurables.
- Contrôle du coût de traitement des commandes, des files d'attente et de la mémoire.
- Aucun quota artistique cumulé de contributions.
- Authentification administrateur avec secret correctement haché et session sécurisée.
- Protection CSRF des actions HTTP et contrôle d'origine des connexions et messages sensibles.
- Protection contre les tentatives répétées de connexion.
- Aucune donnée de sécurité sensible dans les réponses publiques.
- Fichiers d'exports et données hors des répertoires publics.
- Validation des PNG importés, avec limites de taille avant et après décodage.
- Contrôles d'accès aussi sur les téléchargements privés.
- Échappement des textes affichés et absence d'exécution de contenu utilisateur.

Les protections anti-abus ne gênent pas un usage humain normal. Les limites tiennent compte des participants partageant une adresse IP.

En surcharge, appliquer une régulation ou un refus explicite avant acceptation, sans fausse confirmation. Les files en mémoire sont bornées. La génération répétée d'exports ne doit pas épuiser les ressources du serveur.

### 11.2 Vie privée et participation

- Aucune inscription.
- Identifiants de participation aléatoires.
- Aucune collecte volontaire de noms ou d'adresses électroniques.
- Aucun profilage ni service d'analyse publicitaire.
- Journalisation de sécurité minimale ; durée de conservation explicitement définie avant lancement.
- Conditions de participation accessibles avant de dessiner.
- Modalités de réutilisation artistique clairement présentées.

Le texte d'information indique que les contributions pourront être archivées, imprimées, modifiées, présentées en concours ou exposition et intégrées à une vidéo.

Les textes définitifs, les droits de réutilisation et la politique de conservation doivent être préparés pour le lancement. La présente spécification ne constitue pas à elle seule ces conditions.

L'application ne donne pas accès à l'historique ni aux exports publics. Elle ne peut cependant empêcher un visiteur d'enregistrer l'image ou les changements qu'il observe en direct.

### 11.3 Durabilité et sauvegardes

**Redémarrage avec stockage intact :**

- Aucune opération acquittée ne doit être perdue.
- WAL et synchronous=FULL sont vérifiés.
- Aucun acquittement positif avant commit.
- La grille est reconstruite depuis le dernier snapshot compatible et les événements suivants, ou depuis zéro.
- Les sauvegardes utilisent l'API SQLite appropriée ; aucune copie naïve du seul fichier de base active en WAL.

**Perte complète du disque ou du VPS :**

- Objectif de point de restauration : perte maximale d'une heure de contributions.
- Sauvegarde cohérente déclenchée toutes les 30 minutes.
- Transfert vers un stockage extérieur au VPS.
- Nouvelle tentative en cas d'échec, sans chevauchement non maîtrisé des tâches.
- Succès déclaré seulement après confirmation de présence et vérification d'intégrité sur le stockage extérieur.
- Surveillance de l'âge du point de restauration effectivement récupérable, pas seulement de la dernière tentative.
- Alerte dès 45 minutes ; au-delà de 60 minutes, l'objectif est déclaré non respecté et l'incident doit être traité.
- Sauvegarde de la base, du fond original et de la configuration nécessaire.
- Conservation de plusieurs versions selon une politique documentée.
- Protection des sauvegardes opérationnelles, qui peuvent contenir des données de session.

Une sauvegarde quotidienne seule ne satisfait pas cet objectif. La garantie après redémarrage ne doit pas être confondue avec la restauration après destruction du stockage.

Un test de restauration depuis le stockage extérieur est obligatoire avant lancement. Documenter le temps de restauration observé ; aucun délai maximal de remise en service n'est fixé dans cette V1.

## 12. Déploiement et capacité

### 12.1 Hébergement

Linux sur un VPS unique.

Configuration indicative à valider :

- 2 vCPU.
- 2 Go de RAM.
- 20 Go SSD.
- Domaine dédié.
- Docker Compose.
- Caddy pour HTTPS.

Cette configuration est un point de départ, pas une capacité démontrée. Dimensionner l'espace selon les volumes mesurés de journal, WAL, sauvegardes locales, caches et exports.

Prévoir :

- Volumes persistants.
- Redémarrage automatique.
- Journaux simples.
- Contrôle de disponibilité et état de préparation après reconstruction.
- Surveillance de l'espace disque et de l'âge des sauvegardes extérieures.
- Procédure documentée de sauvegarde et restauration.
- Nettoyage des caches et temporaires sans suppression des événements.
- Exécution des exports avec ressources limitées, hors du service de dessin.
- Aucune mise en veille automatique de l'hébergement pendant l'expérience.

### 12.2 Capacité cible et essai de charge

Cible : **50 participants dessinant simultanément**.

Test principal :

- Au moins 30 minutes.
- 50 clients actifs.
- Chacun envoie en moyenne 10 messages de dessin par seconde pendant son activité.
- Charge cible agrégée : 500 messages/seconde.
- Mélange d'outils, tailles, croisements, reconnexions et fins de traits.
- Tailles des lots et longueurs de segments documentées.
- Snapshots et sauvegardes habituels activés.
- Échantillons incluant des lots de 64 points et le pinceau de 21 pixels.
- Essais distincts aux limites valides et avec des messages invalides.
- Scénario court de rafale à l'intervalle minimal de 50 ms, avec comportement de surcharge documenté.

Critères :

- Aucune perte d'opération acquittée.
- Aucun doublon.
- Même grille sur le serveur, les clients resynchronisés et le rejeu du journal.
- Acquittement inférieur à 500 ms pour 95 % des commandes dans l'environnement de test documenté.
- Mesure depuis l'envoi jusqu'à la réception de l'acquittement, incluant le commit durable.
- Absence d'accumulation continue de la file d'attente.
- Mémoire bornée et consommation disque mesurée.
- Refus ou régulation explicite en surcharge, sans confirmation mensongère.

Les 500 ms constituent un critère de recette, pas un résultat acquis. Documenter le matériel, la latence réseau, le protocole du test et les résultats. Ajuster le VPS ou l'implémentation si nécessaire, sans affaiblir la durabilité.

## 13. Tests d'acceptation

Automatiser les tests lorsque pertinent. Les essais physiques de tactile/stylet et les exercices de restauration peuvent compléter l'automatisation. Ne cocher un test qu'après exécution.

### 13.1 Dessin

- [ ] Un clic modifie exactement la cellule attendue.
- [ ] Un glissement Pixel reste continu, y compris entre messages.
- [ ] Un trait de pinceau est continu pour toutes les tailles.
- [ ] Souris, tactile et stylet permettent de dessiner.
- [ ] Zoom, déplacement et gestes à deux doigts ne dessinent pas.
- [ ] Sortie et rentrée du pointeur ne créent pas de ligne artificielle.
- [ ] Les couleurs interdites, RGB libres et index invalides sont rejetés.
- [ ] Le fond original reste intact, même entièrement recouvert.
- [ ] Les contributions antérieures peuvent être recouvertes.
- [ ] Le zoom et le ratio d'écran n'affectent pas les coordonnées.
- [ ] Lignes et masques correspondent aux jeux de référence.
- [ ] Le moteur produit la même grille en dessin direct et en rejeu.
- [ ] Une clôture technique ne repeint aucune cellule.

### 13.2 Collaboration et protocole

- [ ] Deux navigateurs convergent vers le même état confirmé.
- [ ] Deux écritures concurrentes sont ordonnées par seq.
- [ ] Les parties d'un trait respectent ordre et continuité.
- [ ] Un changement de paramètres dans un trait est rejeté.
- [ ] Une partie après clôture est rejetée.
- [ ] Un trait interrompu reste visible et rejouable.
- [ ] Une retransmission identique n'ajoute aucun événement.
- [ ] Un acquittement perdu est récupérable après suspension ou clôture.
- [ ] Un même opId avec un contenu différent est rejeté.
- [ ] Un refus retire la prévisualisation locale.
- [ ] L'ordre d'arrivée acquittement/diffusion ne crée aucun doublon.
- [ ] Une reconnexion récupère l'état complet et réconcilie les attentes.
- [ ] Une coupure réseau ne crée pas de modification fantôme.
- [ ] La capture initiale et l'abonnement ne perdent aucun événement.
- [ ] Une lacune de séquence provoque une resynchronisation.
- [ ] Des révisions de modération différentes ne sont pas mélangées.
- [ ] La suspension et la clôture refusent les commandes nouvelles.

### 13.3 Historique et modération

- [ ] Chaque commande acquittée est présente en base.
- [ ] Le rendu final est reconstructible depuis le journal.
- [ ] Un snapshot compatible donne le même résultat qu'un rejeu complet.
- [ ] Un snapshot invalide ou absent est contourné sans perte.
- [ ] Les reconstructions à une date et à une séquence sont déterministes.
- [ ] Masquer un trait préserve les contributions ultérieures.
- [ ] Restaurer un trait le remet à sa position chronologique initiale.
- [ ] Les futures parties d'un trait masqué restent invisibles.
- [ ] La modération pendant un trait et une reconnexion reste cohérente.
- [ ] Un snapshot d'une ancienne révision n'altère pas le résultat.
- [ ] Un export brut n'utilise pas de cache modéré.
- [ ] Un reset ne laisse pas de prévisualisation masquée persistante.

### 13.4 Sécurité

- [ ] Aucun endpoint public ne donne l'historique ou un export.
- [ ] Aucun message public ne contient d'identifiant de participant.
- [ ] La géométrie d'un trait masqué n'est pas diffusée.
- [ ] Un participant ne peut pas accéder aux API ni archives administratives.
- [ ] Le login fonctionne sans session préalable et résiste aux tentatives répétées.
- [ ] CSRF et origines non autorisées sont bloqués.
- [ ] Une opération malformée ne fait pas planter le serveur.
- [ ] Les limites empêchent les abus sans quota artistique cumulé.
- [ ] Un identifiant d'archive ne permet pas de lire un fichier arbitraire.
- [ ] Les exports excluent les données de session et de sécurité.

### 13.5 Exploitation et exports

- [ ] Un redémarrage conserve toutes les commandes validées.
- [ ] Une panne après commit et avant diffusion n'entraîne aucune perte.
- [ ] Une erreur disque ou un disque plein ne produit aucun faux acquittement.
- [ ] Une restauration extérieure reproduit le point sauvegardé.
- [ ] Les alertes de sauvegarde utilisent l'âge du point réellement récupérable.
- [ ] L'objectif d'une heure est vérifié lors d'un exercice documenté.
- [ ] Les PNG et agrandissements sont corrects.
- [ ] Chaque combinaison de rythme et modération produit les états attendus.
- [ ] Les images initiale et finale sont incluses.
- [ ] L'absence de contribution est gérée.
- [ ] Un export pendant l'activité reste cohérent à son point de capture.
- [ ] L'archive permet une relecture sans le serveur d'origine.
- [ ] Aucun secret n'est présent dans le dépôt de code.
- [ ] Le test de 50 dessinateurs simultanés respecte les critères du §12.2.

## 14. Étapes de réalisation

### Phase 1 — Moteur graphique

Livrables :

- Projet TypeScript initialisé.
- Interface responsive.
- Fond d'essai local.
- Deux outils fonctionnels.
- Palette contrôlée.
- Gestes de navigation et de dessin distincts.
- Rastérisation déterministe.
- Tests unitaires et jeux de référence.

**Validation :** dessin local correct, sans backend ni collaboration.

### Phase 2 — Serveur et collaboration

Livrables :

- Fastify, SQLite et migrations.
- Socket.IO et sessions anonymes.
- Validation et enregistrement durable des commandes.
- Découpage et clôture des traits.
- Prévisualisation, acquittements et réconciliation.
- Synchronisation et resynchronisation.
- Idempotence et rétablissement après panne.
- Premier essai de charge pour détecter tôt les limites.

**Validation :** plusieurs utilisateurs dessinent, convergent et retrouvent le résultat après redémarrage.

### Phase 3 — Administration et reconstitution

Livrables :

- Authentification administrateur.
- Paramétrage initial et cycle de vie.
- Historique privé.
- Snapshots.
- Modération.
- Reconstructions brutes et modérées.
- Exports PNG et JSONL.

**Validation :** chaque état cible est reproductible et un trait est masquable sans détruire le journal.

### Phase 4 — Timelapse et publication

Livrables :

- Scripts vidéo et ZIP.
- Téléchargement privé des archives.
- Tests de bout en bout.
- Docker Compose, HTTPS et volumes persistants.
- Sauvegardes extérieures toutes les 30 minutes et surveillance.
- Test de restauration.
- Documentation d'installation, d'exploitation et de relecture.
- Essai de 50 dessinateurs simultanés.
- Test pilote.
- Conditions de participation finalisées.

**Validation :** application accessible publiquement pour dessiner, exports privés, fiabilité et restauration vérifiées.

Ne pas engager la phase suivante si les critères essentiels de la précédente échouent.

## 15. Hors périmètre de la V1

Ne pas développer :

- Comptes et profils utilisateurs.
- Commentaires ou chat.
- Notifications aux participants.
- Votes, scores ou classements.
- Plusieurs canevas.
- Partage de calques entre participants.
- Gomme ou annulation individuelle.
- Historique public.
- Export public, même anonymisé.
- Timelapse public dans l'application.
- Reconstitution des apparitions et retraits de modération tels qu'affichés à l'époque.
- Persistance des commandes non confirmées après fermeture de l'onglet.
- Application mobile native.
- Infrastructure multi-serveurs.
- Tableau de bord statistique avancé.
- Génération d'images par IA.

Les alertes techniques de sauvegarde et de disponibilité nécessaires à l'exploitation ne sont pas des notifications sociales et restent dans le périmètre.

Ne pas ajouter les fonctions exclues par anticipation.

## 16. Consignes de développement et définition de terminé

1. Respecter le périmètre.
2. Réutiliser les bibliothèques éprouvées lorsque leur usage est justifié.
3. Ne pas introduire d'abstraction sans besoin concret.
4. Ne pas multiplier les services et dépendances.
5. Prioriser la rastérisation déterministe et la durabilité du journal.
6. Développer par phases vérifiables.
7. Tester les comportements critiques, y compris les erreurs.
8. Ne jamais annoncer un test réussi sans l'avoir exécuté.
9. Fournir des commandes simples pour développement, tests, déploiement, sauvegarde, restauration et exports.
10. Documenter les écarts à cette spécification.
11. Ne pas versionner de secrets, données réelles de participants, sauvegardes ou exports d'exploitation dans le dépôt de code.
12. Documenter avant lancement les choix d'implémentation laissés ouverts : palette exacte, seuil de neutralité, paramètres anti-abus, durées de sessions et rétention des données et sauvegardes.

**Définition de terminé :**

La V1 est terminée lorsqu'une personne peut ouvrir une URL, dessiner sur le canevas partagé sans inscription et voir les interventions synchronisées ; lorsque toutes les commandes acquittées sont conservées et rejouables ; et lorsque l'administrateur peut consulter l'historique privé, reconstruire un état à une date ou une séquence, masquer ou restaurer une intervention et produire images, archives et timelapses bruts ou modérés.

La validation inclut un essai avec 50 participants dessinant simultanément et une restauration extérieure respectant l'objectif de perte maximale d'une heure.

Aucun export public n'est disponible.

**La priorité absolue est la conservation fiable et fidèle du processus de création collectif.**

## Annexe — Références techniques

Ces références expliquent les contraintes retenues ; la spécification ci-dessus fait foi pour le projet.

- [Socket.IO — Delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/)
- [SQLite — PRAGMA synchronous](https://www.sqlite.org/pragma.html#pragma_synchronous)
- [SQLite — Write-Ahead Logging](https://www.sqlite.org/wal.html)
- [SQLite — Online Backup API](https://www.sqlite.org/backup.html)
