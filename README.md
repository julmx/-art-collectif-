# Art Collectif

Application web de création plastique collaborative sur un canevas partagé de **720 × 480 pixels**, pour une expérience artistique de **1 à 2 mois**.

## Spécifications

Le [cahier des charges complet V1.1](CAHIER_DES_CHARGES.md) décrit le périmètre fonctionnel, l'architecture, le protocole, les données, les exports, l'exploitation et les tests d'acceptation.

Décisions retenues :

- Participation sans inscription ; outils Pixel et Pinceau.
- Palette de 24 couleurs chromatiques.
- Journal durable, rejeu déterministe et modération privée.
- **Aucun export public**, même anonymisé.
- Images et timelapses administratifs en version brute ou modérée.
- Aucune perte d'opération acquittée après redémarrage avec stockage intact.
- Objectif de perte maximale d'une heure en cas de perte du disque ou du VPS.
- Capacité cible de 50 participants dessinant simultanément.

## État du projet

Ce dépôt contient les spécifications consolidées. L'application n'est pas encore implémentée et aucun test applicatif ou de performance n'a encore été exécuté.

Le développement suit les quatre phases du cahier des charges : moteur graphique, serveur et collaboration, administration et reconstitution, puis timelapse et publication.

Les secrets, sessions, contributions réelles, sauvegardes et exports d'exploitation ne doivent pas être ajoutés au dépôt.

## Prototype local (phase 1 en cours)

Prérequis : Node.js 24 et npm. Exécuter `npm ci`, puis `npm run dev`. `npm test` vérifie le moteur, `npm run build` vérifie la compilation et `npm run test:e2e` exécute les tests navigateur (installer Chromium avec `npx playwright install chromium`).

Le prototype actuel dessine uniquement dans l'onglet : aucune contribution n'est encore synchronisée ou enregistrée. Le fond en damier est un fond d'essai. Les essais physiques sur écran tactile et stylet restent à effectuer.

Le moteur emploie Bresenham entier avec extrémités incluses et avance les deux axes lorsque leurs conditions respectives sont satisfaites. Les masques incluent les centres de cellules dont la distance au centre est inférieure ou égale à la moitié du diamètre. Les coordonnées d'écran sont transformées en coordonnées natives puis arrondies à l'entier inférieur. Une couleur est considérée chromatique si son écart maximal entre composantes RGB est d'au moins 40 sur 255 ; les 24 couleurs doivent être distinctes.

Le serveur en cours de construction démarre avec `APP_ORIGIN=http://127.0.0.1:5173 npm run server`, et Vite avec `npm run dev`. La base démarre en mode brouillon ; aucune interface d'ouverture n'est encore disponible. Les valeurs anti-abus provisoires sont de 20 commandes par seconde et par session (rafale de 40), et 400 000 opérations estimées de cellules par commande ; elles restent à valider par essai de charge avant mise en service.
