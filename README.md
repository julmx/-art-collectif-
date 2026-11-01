# Art Collectif

Application de création plastique collaborative sur un canevas 720 × 480. Le [cahier des charges](CAHIER_DES_CHARGES.md) fait foi. L’application est en développement : les essais d’exploitation et plusieurs critères de recette indiqués ci-dessous restent à réaliser avant toute ouverture au public.

## Développement

Prérequis : Node.js 24, npm, FFmpeg et FFprobe. Installer avec `npm ci`. En développement, lancer le serveur avec `APP_ORIGIN=http://127.0.0.1:5173 npm run server`, puis Vite avec `npm run dev`. Le serveur stocke ses données dans `./data` par défaut, ou dans `DATA_DIR` ; ce dossier doit rester privé et persistant. L’interface est sur `/`, l’administration sur `/admin.html`.

Le projet initial est en brouillon. Pour créer le hash d’administration, saisir un mot de passe long sans l’inscrire dans l’historique du shell :

```bash
read -rs ART_PASSWORD
printf '%s' "$ART_PASSWORD" | node --import tsx scripts/hash-password.ts
unset ART_PASSWORD
```

Configurer la valeur affichée dans `ADMIN_PASSWORD_HASH` dans l’environnement du serveur. Le mot de passe lui-même n’est pas enregistré. Depuis l’administration, importer un PNG opaque de 720 × 480 en niveaux de gris, saisir une palette chromatique de 24 couleurs distinctes et les conditions de participation, puis ouvrir le projet. La clôture est définitive.

`npm test` exécute les tests unitaires et d’intégration ; `npm run build` vérifie TypeScript et construit les pages. `npx playwright install chromium` puis `npm run test:e2e` exécutent les tests navigateur. L’essai de charge court et ses limites sont décrits dans [ops/ESSAI_COURT.md](ops/ESSAI_COURT.md).

## Déploiement prévu

Le dépôt fournit Docker Compose et Caddy. Créer un fichier `.env` privé, non versionné, contenant `DOMAIN`, `ADMIN_PASSWORD_HASH` et `CODE_REVISION` (SHA exact du code déployé). Faire pointer le domaine vers le VPS et autoriser les ports 80 et 443. `docker compose up -d --build` crée les services et les volumes persistants. Ne pas exposer directement le port du serveur Node. Cette configuration n’a pas encore été testée dans cet environnement, où Docker Compose n’est pas disponible.

Le cookie de participation, aléatoire et HttpOnly, expire après 90 jours ; seule son empreinte est enregistrée. La session d’administration expire après huit heures et disparaît au redémarrage. Le seuil chromatique retenu est un écart d’au moins 40 entre les composantes RGB extrêmes. Les limites provisoires sont 20 commandes/s par session, rafale de 40 et coût estimé maximal de 400 000 cellules par commande ; elles doivent être confirmées par l’essai de charge complet. Aucun quota cumulé artistique n’est appliqué. Les journaux de sécurité et leur rétention restent à définir avant le lancement.

## Exports privés

Les liens de l’administration servent les images et journaux uniquement après connexion. Les scripts suivants s’exécutent hors du chemin de dessin, avec des accès privés au volume de données et aux fichiers de sortie :

```bash
node --import tsx scripts/export-video.ts --database /data/art.sqlite --output /data/video.mp4 --mode chronological --moderation moderated --duration 180 --fps 25 --scale 2
node --import tsx scripts/export-archive.ts --database /data/art.sqlite --output /data/archives/experience.zip --moderation moderated --videos false
```

`activity` et `chronological`, `raw` et `moderated` sont indépendants. La vidéo utilise au moins deux images, avec `max(2, arrondi(durée × fps))` images ; l’image initiale et l’image finale sont incluses. L’option `--videos true` ajoute les quatre vidéos à l’archive. Précréer le répertoire de sortie privé. Les archives nommées avec lettres, chiffres, tirets ou soulignés dans `/data/archives` sont téléchargeables depuis l’administration. Le manifeste contient les sommes et l’archive embarque le code et le lockfile nécessaires à la relecture.

## Sauvegarde et restauration

`node --import tsx scripts/backup.ts /data/art.sqlite /data/backup-nouvelle` crée une copie cohérente avec l’API de sauvegarde SQLite, le fond, les métadonnées et les sommes de contrôle ; le dossier de destination ne doit pas exister. `node --import tsx scripts/restore.ts /chemin/sauvegarde /chemin/restauration-nouvelle` vérifie les sommes et l’intégrité puis restaure dans un dossier neuf. La remise en service doit être effectuée serveur arrêté, après sauvegarde du volume existant et vérification de la configuration restaurée. Une restauration locale est testée automatiquement ; une restauration depuis le stockage extérieur reste obligatoire avant lancement.

Les fichiers sous `ops/` préparent un transfert SSH/rsync toutes les 30 minutes et une vérification toutes les cinq minutes. Installer les unités systemd en mode 0644 et renseigner le fichier protégé `/etc/art-collectif-backup.env` avec `PROJECT_DIR`, `BACKUP_STATE_DIR`, `BACKUP_HOST` et `BACKUP_REMOTE_DIR`. Le compte doit accéder à Docker, à `.env` et à un stockage distinct du VPS par SSH non interactif. Le transfert enregistre son succès uniquement après vérification des sommes à distance ; le contrôle vérifie à nouveau ce point et échoue après 45 minutes (alerte) ou 60 minutes (objectif non respecté). Raccorder les échecs du service de contrôle à un système d’alerte externe et définir une rétention de plusieurs versions avec l’opérateur de stockage. Les sauvegardes comprennent des données opérationnelles et `.env` : leur accès et leur chiffrement doivent être protégés.

## État et limites avant lancement

- La recette de 30 minutes avec 50 dessinateurs, les pinceaux et lots limites, les reconnexions, les sauvegardes et les mesures de convergence n’a pas été effectuée. L’essai court ne prouve pas la capacité cible.
- Le transfert extérieur, les alertes, l’exercice de restauration et le déploiement Compose n’ont pas été vérifiés dans une infrastructure réelle. La disponibilité, l’espace disque et la rétention doivent être surveillés.
- Les essais physiques souris, tactile et stylet, le test pilote et les conditions définitives de participation et de réutilisation artistique restent à réaliser ou finaliser.
- La couverture automatisée ne démontre pas encore tous les cas de reconnexion, de panne disque, de révision de modération et de relecture vidéo. Ne pas considérer la V1 comme validée tant que les cases pertinentes du cahier des charges ne sont pas exécutées.
- Les snapshots modérés sont utilisés par les exports d’image lorsqu’ils sont compatibles ; le démarrage rejoue actuellement le journal complet.

Ne jamais ajouter au dépôt secrets, données réelles de participants, sauvegardes ou exports d’exploitation.
