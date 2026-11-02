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

## Modération et bannissement

Dans l’administration, cliquer sur la toile affiche les traits au point choisi ou à une cellule de distance, les traits visibles en premier. Un clic sur un résultat le surligne ; les listes permettent de retrouver les traits masqués ou ceux du même participant et de sélectionner jusqu’à 50 traits. Un aperçu montre l’image résultante avant la confirmation. Si une contribution ou une décision intervient depuis l’aperçu, il faut le recalculer ; en cas de forte activité, suspendre temporairement le projet. Le masquage reste réversible et porte sur le trait entier.

La recherche examine au maximum les 300 000 commandes les plus récentes et 30 résultats ; l’interface signale une recherche tronquée. La surbrillance de chaque trait est limitée à ses 200 premières parties et le signale si elle est incomplète ; l’aperçu et la décision portent toujours sur le trait entier. Le bannissement est réversible, journalisé et empêche les nouvelles contributions depuis la session concernée, y compris les connexions déjà actives ; il ne masque pas automatiquement les traits et laisse leur consultation possible. Comme les participants sont anonymes et identifiés par un cookie, une personne peut créer une nouvelle session : cette mesure ne garantit pas l’identification ni le blocage durable d’une personne physique.

## Déploiement prévu

Le dépôt fournit Docker Compose et Caddy. Créer un fichier `.env` privé, non versionné, contenant `DOMAIN`, `ADMIN_PASSWORD_HASH` et `CODE_REVISION` (SHA exact du code déployé). Faire pointer le domaine vers le VPS et autoriser les ports 80 et 443. `docker compose up -d --build` crée les services et les volumes persistants. Ne pas exposer directement le port du serveur Node. La configuration NAS a été construite et testée localement avec Docker Compose classique ; elle reste à vérifier sur le NAS et la configuration VPS reste à valider en production.

Le cookie de participation, aléatoire et HttpOnly, expire après 90 jours ; seule son empreinte est enregistrée. La session d’administration expire après huit heures et disparaît au redémarrage. Le seuil chromatique retenu est un écart d’au moins 40 entre les composantes RGB extrêmes. Les limites provisoires sont 20 commandes/s par session, rafale de 40 et coût estimé maximal de 400 000 cellules par commande ; elles doivent être confirmées par l’essai de charge complet. Aucun quota cumulé artistique n’est appliqué. Les journaux de sécurité et leur rétention restent à définir avant le lancement.

## Exports privés

Les liens de l’administration servent les images et journaux uniquement après connexion. Les scripts suivants s’exécutent hors du chemin de dessin, avec des accès privés au volume de données et aux fichiers de sortie :

Depuis « Exports privés », un administrateur peut lancer une archive ZIP, éventuellement avec les quatre vidéos, ou une vidéo avec choix du rythme, de la modération, de la durée, du nombre d’images par seconde et de l’agrandissement. L’interface indique si le travail est en cours, terminé ou en échec ; les fichiers terminés restent téléchargeables après redémarrage. Une seule génération longue est acceptée à la fois. La vidéo est limitée à 600 secondes, 30 images/s, 9 000 images et un agrandissement de 3 ; les archives contenant des vidéos peuvent prendre beaucoup de temps. Un redémarrage interrompt une génération en cours. Les traitements tournent dans un processus distinct de priorité réduite, avec une limite de mémoire JavaScript ; ils partagent néanmoins les ressources du conteneur applicatif.

```bash
node --import tsx scripts/export-video.ts --database /data/art.sqlite --output /data/video.mp4 --mode chronological --moderation moderated --duration 180 --fps 25 --scale 2
node --import tsx scripts/export-archive.ts --database /data/art.sqlite --output /data/archives/experience.zip --moderation moderated --videos false
```

`activity` et `chronological`, `raw` et `moderated` sont indépendants. La vidéo utilise au moins deux images, avec `max(2, arrondi(durée × fps))` images ; l’image initiale et l’image finale sont incluses. L’option `--videos true` ajoute les quatre vidéos à l’archive. Précréer le répertoire de sortie privé. Les archives nommées avec lettres, chiffres, tirets ou soulignés dans `/data/archives` sont téléchargeables depuis l’administration. Le manifeste contient les sommes et l’archive embarque le code et le lockfile nécessaires à la relecture.

## Sauvegarde et restauration

`node --import tsx scripts/backup.ts /data/art.sqlite /data/backup-nouvelle` crée une copie cohérente avec l’API de sauvegarde SQLite, le fond, les métadonnées et les sommes de contrôle ; le dossier de destination ne doit pas exister. `node --import tsx scripts/restore.ts /chemin/sauvegarde /chemin/restauration-nouvelle` vérifie les sommes et l’intégrité puis restaure dans un dossier neuf. La remise en service doit être effectuée serveur arrêté, après sauvegarde du volume existant et vérification de la configuration restaurée. Une restauration locale est testée automatiquement ; une restauration depuis le stockage extérieur reste obligatoire avant lancement.

Les fichiers sous `ops/` préparent un transfert SSH/rsync toutes les 30 minutes et une vérification toutes les cinq minutes. Installer les unités systemd en mode 0644 et renseigner le fichier protégé `/etc/art-collectif-backup.env` avec `PROJECT_DIR`, `BACKUP_STATE_DIR`, `BACKUP_HOST` et `BACKUP_REMOTE_DIR`. Le compte doit accéder à Docker, à `.env` et à un stockage distinct du VPS par SSH non interactif. Le transfert enregistre son succès uniquement après vérification des sommes à distance ; le contrôle vérifie à nouveau ce point et échoue après 45 minutes (alerte) ou 60 minutes (objectif non respecté). Le contrôle `art-disk-check.timer` vérifie aussi le volume toutes les cinq minutes et signale 80 % et 90 % d’occupation. Raccorder les échecs des services de contrôle à un système d’alerte externe et définir une rétention de plusieurs versions avec l’opérateur de stockage. Les sauvegardes comprennent des données opérationnelles et `.env` : leur accès et leur chiffrement doivent être protégés.

## État et limites avant lancement

- La recette de 30 minutes avec 50 dessinateurs, les pinceaux et lots limites, les reconnexions, les sauvegardes et les mesures de convergence n’a pas été effectuée. L’essai court ne prouve pas la capacité cible.
- Le transfert extérieur, les alertes, l’exercice de restauration et le déploiement Compose n’ont pas été vérifiés dans une infrastructure réelle. La disponibilité, l’espace disque et la rétention doivent être surveillés.
- Les essais physiques souris, tactile et stylet, le test pilote et les conditions définitives de participation et de réutilisation artistique restent à réaliser ou finaliser.
- La couverture automatisée ne démontre pas encore tous les cas de reconnexion, de panne disque, de révision de modération et de relecture vidéo. Ne pas considérer la V1 comme validée tant que les cases pertinentes du cahier des charges ne sont pas exécutées.
- Les snapshots modérés compatibles accélèrent les reconstructions au démarrage et les exports ; un snapshot absent ou invalide est ignoré au profit du journal.

Ne jamais ajouter au dépôt secrets, données réelles de participants, sauvegardes ou exports d’exploitation.

## Essai sur un NAS Synology

Le fichier `docker-compose.nas.yml` prépare un environnement de développement séparé, avec des volumes propres et HTTPS local sur le port 8443. Copier le dépôt sur le NAS, créer un fichier privé `.env.nas` avec `DOMAIN` (adresse IP ou nom DNS local du NAS, sans port), `LAN_BIND_IP` (adresse IPv4 locale sur laquelle écouter), `ADMIN_PASSWORD_HASH` et `CODE_REVISION`, puis démarrer depuis le dossier du projet :

```bash
docker compose --env-file .env.nas -p artcollectif-test -f docker-compose.nas.yml up -d --build
```

Selon la version de Container Manager, la commande peut être `docker-compose` à la place de `docker compose`. Consulter `https://ADRESSE_DU_NAS:8443/` et `/admin.html`. Caddy crée une autorité de certification locale : le navigateur du poste de test doit reconnaître son certificat racine avant d’accepter la connexion. Ce certificat public peut être récupéré depuis le conteneur Caddy avec `docker compose --env-file .env.nas -p artcollectif-test -f docker-compose.nas.yml cp web:/data/caddy/pki/authorities/local/root.crt ./root.crt`. Ne transférer que le certificat public, jamais la clé privée de l’autorité. Cette configuration ne publie pas automatiquement le service sur Internet et ne remplace pas une sauvegarde physiquement extérieure.
