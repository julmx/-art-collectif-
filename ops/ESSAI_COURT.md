# Essai local préliminaire de charge

Le 1 novembre 2026, `npx tsx scripts/load-test.ts 10` a utilisé 50 clients Socket.IO dans le même processus que le serveur, une base temporaire dans `/tmp` en WAL et `synchronous=FULL`, et un pixel par commande. Environnement : Linux WSL2 6.18.40.1, 12 processeurs logiques visibles, Node 24.22.1 ; pas de latence réseau externe simulée. Snapshots actifs ; aucune sauvegarde extérieure pendant l'essai.

Résultat observé : 4 850 commandes envoyées et acquittées, aucune erreur ni expiration, 100 commandes simultanément en attente au maximum, p95 de 207,54 ms, séquence finale 4 850. La durée totale mesurée avec vidage de la file était de 10,17 s. La cible de génération était de 500 messages/s, mais l'essai n'a pas atteint 5 000 envois en 10 secondes.

Cet essai sert uniquement à détecter tôt des limites. Il ne couvre ni la charge de 30 minutes, ni le mélange de pinceaux, les lots de 64 points, les reconnexions, les rafales, les scénarios invalides, les sauvegardes et la convergence/relecture requises au §12.2. Il ne démontre pas la capacité de production ni la conformité au critère de recette.

## Charge mixte, processus séparés

Le même jour, `npx tsx scripts/load-full.ts 10` a utilisé 50 clients dans un processus distinct du serveur, des pinceaux variés dont des lots de 64 points en taille 21, une reconnexion et une sauvegarde SQLite locale. Après regroupement des écritures en transactions durables, 5 049 commandes ont été envoyées et acquittées, sans refus ni expiration ; p95 : 58,27 ms, pic de 83 commandes en attente, mémoire RSS maximale du serveur : 329 220 096 octets. Les 50 grilles resynchronisées et le rejeu concordaient ; la base et son WAL occupaient 8 481 992 octets. L’essai a duré 10 secondes et ne valide ni les 30 minutes de recette ni le VPS cible, le stockage extérieur, les rafales ou les messages invalides.
