# Essai local préliminaire de charge

Le 1 novembre 2026, `npx tsx scripts/load-test.ts 10` a utilisé 50 clients Socket.IO dans le même processus que le serveur, une base temporaire dans `/tmp` en WAL et `synchronous=FULL`, et un pixel par commande. Environnement : Linux WSL2 6.18.40.1, 12 processeurs logiques visibles, Node 24.22.1 ; pas de latence réseau externe simulée. Snapshots actifs ; aucune sauvegarde extérieure pendant l'essai.

Résultat observé : 4 850 commandes envoyées et acquittées, aucune erreur ni expiration, 100 commandes simultanément en attente au maximum, p95 de 207,54 ms, séquence finale 4 850. La durée totale mesurée avec vidage de la file était de 10,17 s. La cible de génération était de 500 messages/s, mais l'essai n'a pas atteint 5 000 envois en 10 secondes.

Cet essai sert uniquement à détecter tôt des limites. Il ne couvre ni la charge de 30 minutes, ni le mélange de pinceaux, les lots de 64 points, les reconnexions, les rafales, les scénarios invalides, les sauvegardes et la convergence/relecture requises au §12.2. Il ne démontre pas la capacité de production ni la conformité au critère de recette.

## Charge mixte, processus séparés

Le même jour, `npx tsx scripts/load-full.ts 10` a utilisé 50 clients dans un processus distinct du serveur, des pinceaux variés dont des lots de 64 points en taille 21, une reconnexion et une sauvegarde SQLite locale. Après regroupement des écritures en transactions durables, 5 049 commandes ont été envoyées et acquittées, sans refus ni expiration ; p95 : 58,27 ms, pic de 83 commandes en attente, mémoire RSS maximale du serveur : 329 220 096 octets. Les 50 grilles resynchronisées et le rejeu concordaient ; la base et son WAL occupaient 8 481 992 octets. L’essai a duré 10 secondes et ne valide ni les 30 minutes de recette ni le VPS cible, le stockage extérieur, les rafales ou les messages invalides.

## Limites et rafale locales

`npx tsx scripts/load-boundaries.ts` a accepté un lot de 64 points avec un pinceau de 21, rejeté cinq cas invalides (couleur, taille, coordonnée, conflit d’identifiant et nombre de points), puis accepté 100 commandes espacées de 50 ms avec un p95 de 11,42 ms. Cet essai utilise un seul client local et ne démontre pas le comportement à cette cadence pour 50 clients ni la tenue dans l’infrastructure de production.

Le 2 novembre, deux nouvelles exécutions mixtes courtes sur le code courant ont toutes deux conservé 5 049 commandes et retrouvé la convergence et le rejeu. La première a mesuré un p95 de 788,40 ms, 93 retransmissions et un pic de 1 143 commandes en attente ; elle échoue au seuil de 500 ms. La seconde, lancée après vérification de l’activité locale, a mesuré un p95 de 43,57 ms, aucune retransmission et un pic de 50 commandes en attente. La cause de cet écart n’est pas établie : ces résultats ne prouvent pas la stabilité sous charge prolongée.

## Essai prolongé local

Le 2 novembre 2026, `npx tsx scripts/load-full.ts 1800` a exécuté le scénario mixte pendant 30 minutes sur le poste WSL décrit ci-dessus, avec le serveur et les clients dans des processus séparés. La version exécutée était `7e8179e` ; des travaux locaux ont eu lieu en parallèle. Sur 899 737 commandes envoyées, 892 611 ont été acquittées et 7 126 rejetées ; 73 110 retransmissions ont été enregistrées. La file a culminé à 2 558 et a été vidée. Le p95 d'acquittement est de 2 883,62 ms : **le seuil de 500 ms n'est pas atteint**. Le RSS maximal observé du serveur était de 399 421 440 octets ; la base et son WAL occupaient 678 550 984 octets.

Les 50 clients resynchronisés ont convergé avec le serveur et le rejeu ; aucune rupture de séquence n'a été relevée. Une sauvegarde SQLite locale a réussi. Ce résultat ne constitue pas la recette de production : le VPS, les sauvegardes extérieures et leur restauration, ainsi que l'ensemble des scénarios de charge requis, restent à vérifier. Les rejets et retransmissions appellent une analyse avant de retenir une capacité.


## Instrumentation après revue du 2 novembre

Le générateur distingue désormais les refus par code, les retransmissions par cause (expiration d’acquittement, limitation ou stockage indisponible) et les commandes non envoyées lorsque sa propre file atteint sa limite. Les chiffres historiques ne contiennent pas ces catégories : ils ne permettent donc pas d’attribuer les 7 126 rejets à une cause précise. Une nouvelle mesure instrumentée est nécessaire.

Un essai local de 10 secondes après ces changements a envoyé et acquitté 5 049 commandes, sans rejet ni retransmission ; p95 : 276,46 ms ; convergence et rejeu réussis. Il a chevauché la fin de la suite de tests navigateur et reste indicatif. Il ne valide ni la charge prolongée, ni l’hébergement cible.

## Mesurer le délai avant envoi et l’acquittement

Lancer `node --import tsx scripts/load-full.ts 1800` sur un environnement de recette disposant de la même capacité que l’hébergement cible. Le script démarre un serveur de test avec sa propre base SQLite, simule 50 clients et effectue une sauvegarde locale. Il affiche le p95 du retard entre l’envoi planifié et l’envoi effectif (`p95BeforeSendMs`), le p95 depuis le premier envoi (`p95Ms`) et le p95 de la dernière tentative réussie (`p95SuccessfulAttemptMs`). Les compteurs de file, les motifs de refus et les comparaisons du rejeu et des clients accompagnent ces mesures.

Sur un essai local de 60 secondes avec l’optimisation de la rastérisation, les 30 043 commandes ont été acquittées sans refus ni retransmission. Le p95 d’acquittement était de 64,63 ms, le retard avant envoi de 2,52 ms au p95 et le pic de file de 100 commandes. Les grilles ont convergé, le rejeu concordait et la sauvegarde locale a réussi. La recette de 30 minutes avec sauvegarde extérieure sur l’hébergement cible reste à faire.

Le 22 novembre 2026, le même scénario de 60 secondes a été exécuté dans l’image Docker de production allégée, sur WSL2 avec Docker Engine 29.1.3 et une limite de mémoire de 1 500 Mio pour le conteneur. Les 50 clients et le serveur étaient dans le même conteneur, dans des processus séparés. Les 30 044 commandes ont été acquittées sans refus ni retransmission. Le p95 d’acquittement était de 47,20 ms, le retard avant envoi de 1,90 ms au p95 et le pic de file de 100 commandes. Les six reconnexions, la convergence avant et après resynchronisation, le rejeu et la sauvegarde locale ont été vérifiés. La recette sur l’hébergement cible reste à faire.

## Diagnostic des refus sur le NAS

L’essai Synology de 60 secondes a envoyé 29 912 commandes. Le générateur a reçu 17 573 acquittements et déclaré 12 339 échecs, dont 12 306 `RATE_LIMITED`. Le p95 d’acquittement était de 8 206 ms. Le journal contenait 17 689 événements. La sauvegarde SQLite, la convergence et le rejeu ont réussi.

- `drawDiagnostics` compte les refus enregistrés par le serveur pour chaque tentative. `participant` indique que la cadence individuelle est dépassée et `queue` que la file de dessin est pleine. Le rapport indique aussi la cause du premier refus et la profondeur maximale de cette file.
- `rejectedEventsPersisted` et `pendingEventsPersisted` comptent les identifiants que le générateur a classés en échec ou laissés en attente et qu’il retrouve dans le journal à la séquence capturée. `eventCountDiscrepancy` donne l’écart restant après ce rapprochement. `duplicateAcks` compte les acquittements signalant qu’une opération avait déjà été enregistrée.

L’essai Synology suivant, sur `e66795f`, a rencontré son premier refus lorsque la file serveur a atteint 1 000 commandes. Le serveur a compté 30 448 tentatives refusées pour file pleine et 22 223 pour cadence individuelle dépassée. Sur 29 990 commandes envoyées, 19 047 ont été acquittées et 33 autres ont été retrouvées dans SQLite, ce qui explique l’écart avec les 19 080 événements du journal. Le p95 d’acquittement était de 7 601 ms. La sauvegarde, la convergence et le rejeu ont réussi.

### Temps de traitement des lots

`drawDiagnostics.batchTimings` indique le nombre de lots et de commandes traités. Chaque phase donne le temps cumulé, le p95 et le maximum par lot, en millisecondes. Le rapport distingue la sélection du lot, l’ouverture de la transaction SQLite, les insertions, le commit, la rastérisation avec mise à jour de la grille et la diffusion synchrone. Cette dernière mesure couvre la préparation et l’émission Socket.IO côté serveur. La réception par les clients est mesurée par le scénario de charge.

`storeOtherMs` inclut notamment les lectures SQLite, la validation et la sérialisation. `otherMs` inclut notamment l’envoi des acquittements et la planification des snapshots. `totalMs` mesure le traitement synchrone du lot. Les temps d’attente en file et entre lots ne sont pas inclus. Comparer les cumuls pour identifier les phases qui mobilisent le plus de temps et le p95 par lot pour repérer des pointes.

### Essai local en mode NORMAL

Le 23 novembre 2026, un essai de 60 secondes sous WSL avec `synchronous=NORMAL` a acquitté les 30 044 commandes envoyées. Le p95 d’acquittement était de 55,23 ms et le p95 du commit par lot de 30,62 ms. La sauvegarde locale, la convergence et le rejeu ont réussi. Les essais Synology précédents utilisaient `synchronous=FULL`.

### Essais sur le NAS en mode NORMAL et après optimisations

Deux essais isolés de 60 secondes ont été exécutés sur le NAS Synology le 23 novembre 2026 dans un conteneur jetable (`--network none`, base SQLite et temporaires sur le disque du NAS via `TMPDIR=/data`) :

- Sur `96f1663` (mode `synchronous=NORMAL`, cache des requêtes préparées SQLite, état binaire) : 21 255 commandes envoyées, 21 009 acceptées, 246 refusées (`RATE_LIMITED`), 11 711 retransmissions, `p95BeforeSendMs` de 14 886,76 ms et p95 d’acquittement de 7 876,27 ms. `storeOtherMs` (3,20 s cumulé, p95 18,71 ms) et `sqliteInsertMs` (1,76 s cumulé, p95 10,74 ms) baissent nettement par rapport aux essais du 22 novembre, tandis que `sqliteCommitMs` (18,31 s cumulé, p95 308,28 ms, max 1 199,57 ms) et la contention CPU/disque des snapshots et diffusions unitaires ralentissent l’envoi. Convergence, rejeu et sauvegarde locale ont réussi (`serverPeakRssBytes` : 242 700 288 octets).
- Sur `944b5ba` (diffusion `draw:applied` regroupée par lot, fenêtre `flush` de 15 ms, intervalle minimal de 30 s entre snapshots) : les **30 028 commandes envoyées ont toutes été acquittées** (`0` refus, `0` rate-limit participant, `30` rate-limits file, `63` retransmissions, `p95BeforeSendMs` de 40,24 ms). La diffusion synchrone tombe à 843,18 ms cumulé (p95 3,61 ms) et le RSS maximal du serveur à 153 935 872 octets (198 324 224 octets côté clients). Le p95 d’acquittement passe à **1 562,27 ms** : ce seuil reste au-dessus de 500 ms sur le NAS car 85 % du temps de lots serveur (39,92 s en `sqliteCommitMs`, p95 355,73 ms, max 1 693,45 ms, et 5,05 s en `sqliteInsertMs` pour 31,17 Mio écrits) relèvent des disques mécaniques du NAS, contre 7,98 s cumulé pour l’ensemble du traitement applicatif. Les six reconnexions, la convergence avant et après resynchronisation, le rejeu et la sauvegarde locale ont réussi (`eventCountDiscrepancy: 0`).

Les essais sur le NAS de test sont clos à ce stade. La recette de 30 minutes (p95 < 500 ms, §12.2) avec sauvegardes extérieures et restauration reste à exécuter sur le VPS cible doté d’un SSD.
