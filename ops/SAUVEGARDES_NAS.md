# Stratégie de sauvegarde extérieure sur NAS Synology

Architecture retenue pour les sauvegardes extérieures du VPS de production, sans exposer le NAS sur Internet.

## Principes retenus

- **Cadence et objectif (RPO) :**
  - Sauvegarde cohérente toutes les **3 heures** (soit 8 points par jour).
  - **Alerte (WARNING)** dès **4 heures** sans point récupérable vérifié.
  - **Incident critique (CRITICAL)** au-delà de **6 heures** (objectif de perte maximale dépassé).
- **Mode Pull depuis le NAS :** c’est le NAS Synology qui initie la connexion vers le VPS via **Tailscale**. Aucun port n’est ouvert sur la box Internet ni sur le NAS, et aucune clé SSH donnant accès au NAS n’est présente sur le VPS.
- **Rotation GFS et immutabilité :** confiées à **Synology Snapshot Replication** sur un volume **Btrfs** (avec option **Cloud Sync** chiffré vers Google Drive pour une seconde copie hors domicile).
- **Capture SQLite cohérente obligatoire :** ne jamais copier `/data/art.sqlite` directement en mode WAL. Toujours passer par `node --import tsx scripts/backup.ts /data/art.sqlite <dossier>` dans le conteneur `app`.

## 1. Cloisonnement réseau (Tailscale)

L’objectif est qu’une compromission du VPS (exposé publiquement sur Internet) ne permette ni d’atteindre le NAS ni de supprimer les sauvegardes déjà collectées.

1. Attribuer un tag dédié au VPS dans Tailscale (par exemple `tag:art-vps`).
2. Configurer les **ACL Tailscale** en sens unique :
   - Autoriser uniquement `NAS -> tag:art-vps` sur le port SSH (`22` ou port SSH dédié).
   - Bloquer toute connexion initiée par `tag:art-vps` vers le NAS (y compris DSM `5000`/`5001`) et vers les autres appareils du tailnet.
   - Ne pas annoncer de sous-réseau local (*subnet routing*) vers `tag:art-vps`.
3. Côté VPS, créer un compte SSH dédié à la sauvegarde (authentification par clé uniquement, clé privée stockée uniquement sur le NAS) restreint à la génération et à la lecture de la capture cohérente (idéalement via un script dédié et `ForceCommand`).

## 2. Collecte toutes les 3 heures (Planificateur de tâches DSM)

Créer une tâche planifiée sur le NAS Synology exécutée toutes les **3 heures**, protégée contre les chevauchements (verrou local `flock` ou `mkdir`) :

1. Demander au VPS d’exécuter `node --import tsx scripts/backup.ts /data/art.sqlite /data/backup-staging/<id>` dans le conteneur `app` (qui vérifie `PRAGMA integrity_check`, copie `base.png` si présent, écrit `backup.json` et `SHA256SUMS`).
2. Inclure `.env` (permissions `600`, sous le nom `deployment.env`) et ajouter son empreinte à `SHA256SUMS`.
3. Rapatrier la capture vers un dossier partagé Btrfs dédié sur le NAS (permissions strictes `0700`/`0600`) via `rsync` sur SSH/Tailscale.
4. Vérifier `sha256sum -c SHA256SUMS` localement sur le NAS avant de déclarer la sauvegarde valide, puis nettoyer le répertoire temporaire sur le VPS.
5. Mettre à jour un horodatage local du dernier point vérifié et envoyer un ping de succès à un service de surveillance externe (voir §5).

## 3. Rotation GFS et immutabilité (Synology Snapshot Replication)

Le volume du NAS étant en **Btrfs**, la rotation GFS est déléguée à **Snapshot Replication** plutôt qu’à un script de purge maison :

1. Créer un dossier partagé Btrfs dédié aux sauvegardes Art Collectif, inaccessible aux utilisateurs ordinaires.
2. Pour éviter de dupliquer inutilement les fichiers entre captures, la tâche DSM peut :
   - soit maintenir un dossier courant mis à jour de manière atomique après vérification (ou ne conserver localement que quelques captures récentes, par ex. les 8 dernières = 24 h),
   - et laisser **Snapshot Replication** conserver l’historique en GFS.
3. Configurer une politique GFS dans **Snapshot Replication**, par exemple :
   - snapshots toutes les 3 heures conservés sur **24 à 48 heures** (8 à 16 snapshots),
   - **7** snapshots quotidiens,
   - **4** snapshots hebdomadaires (à adapter à la durée de l’expérience).
4. Activer les **snapshots immuables (WORM)** afin qu’aucune suppression accidentelle ou malveillante ne puisse effacer l’historique avant expiration.

## 4. Copie hors domicile optionnelle (Synology Cloud Sync → Google Drive)

Si une seconde copie hors du domicile est souhaitée (règle 3-2-1) :

1. Utiliser **Synology Cloud Sync** pour répliquer le dossier de sauvegardes vers **Google Drive** en synchronisation unidirectionnelle (envoi seul depuis le NAS).
2. **Activer obligatoirement le chiffrement côté client** dans Cloud Sync : les sauvegardes contiennent `.env` (hash du mot de passe d’administration) et les empreintes de sessions de participants. Conserver la clé de chiffrement Cloud Sync dans un gestionnaire de mots de passe hors du NAS et hors du VPS.
3. Le VPS ne détient aucun jeton OAuth Google Drive ; l’authentification et le renouvellement restent gérés dans DSM.

## 5. Surveillance et alertes

La surveillance doit mesurer l’âge du **dernier point réellement vérifié et récupérable**, et détecter aussi une panne de la box Internet ou du NAS :

- **Seuils :**
  - `WARNING` dès **4 heures** (`14 400 s`) sans point vérifié.
  - `CRITICAL` dès **6 heures** (`21 600 s`) : objectif RPO dépassé, incident à traiter.
- **Mécanisme recommandé :** un *dead man’s switch* externe (par exemple Healthchecks.io ou un moniteur externe dédié) appelé par la tâche DSM **uniquement après vérification réussie de `SHA256SUMS`**. Si le NAS, la fibre ou le VPS tombe, l’absence de signal déclenche l’alerte automatiquement.
- Activer également les notifications DSM en cas d’échec de la tâche planifiée ou d’espace disque faible sur le volume Btrfs.

## 6. Vérification avant lancement (obligatoire)

Avant toute ouverture publique, exécuter et documenter un exercice complet de restauration depuis une sauvegarde présente sur le NAS :

1. Sélectionner une sauvegarde récente (ou un snapshot Btrfs) sur le NAS.
2. Lancer `node --import tsx scripts/restore.ts /chemin/sauvegarde /chemin/restauration-nouvelle` dans un environnement propre.
3. Vérifier `SHA256SUMS`, `PRAGMA integrity_check`, le fond `base.png`, la configuration `deployment.env` et le démarrage complet de l’application restaurée.
4. Consigner la date de l’exercice et le temps de restauration observé.
