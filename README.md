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
