# Essai Docker local

Le 2 novembre 2026, sur Linux WSL2 x86_64 avec Docker Engine 29.1.3 et Docker Compose classique 1.29.2, les fichiers Compose ont passé `config --quiet`. Les images de `docker-compose.nas.yml` ont été construites et démarrées dans un projet et des volumes jetables distincts.

Vérifications réalisées : page et santé disponibles en HTTPS ; accès anonyme à l’administration refusé (401) ; connexion avec un mot de passe de test ; import d’un fond PNG opaque en niveaux de gris ; configuration et ouverture ; dessin d’une cellule et conservation après rechargement, puis après redémarrage du conteneur. Le certificat HTTPS a été vérifié avec l’autorité locale extraite du conteneur. Les conteneurs et volumes de test ont été supprimés ensuite.

Cet essai n’a pas utilisé le NAS Synology, ne valide pas son architecture ni sa configuration réseau et ne constitue pas un déploiement de production.
