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
