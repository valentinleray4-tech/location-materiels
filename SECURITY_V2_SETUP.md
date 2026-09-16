# Loc'APEL — mise en production de `security-v2`

Cette branche conserve le site public sans compte utilisateur, mais déplace les opérations sensibles côté serveur.

## 1. Variables d'environnement Netlify

Dans **Netlify > Site configuration > Environment variables**, définir :

- `SUPABASE_URL` : URL du projet Supabase.
- `SUPABASE_SERVICE_ROLE_KEY` : clé service role Supabase. Ne jamais la placer dans un fichier HTML ou dans GitHub.
- `ADMIN_EMAILS` : liste des adresses e-mail administratrices séparées par des virgules, par exemple `admin1@exemple.fr,admin2@exemple.fr`.
- `MAKE_RESERVATION_WEBHOOK` : URL complète du webhook Make déclenché à la création d'une demande.
- `MAKE_CONFIRMATION_WEBHOOK` : URL complète du webhook Make déclenché lorsqu'une réservation est confirmée.

Les deux variables Make sont facultatives. Si elles ne sont pas renseignées, la réservation et l'administration fonctionnent quand même, mais aucune automatisation Make n'est déclenchée.

## 2. Supabase Auth

Dans **Supabase > Authentication > Users**, créer un compte pour chaque administrateur présent dans `ADMIN_EMAILS`.

La page `/administrateurs.html` utilise désormais une connexion e-mail / mot de passe Supabase. Le vieux code partagé `APEL2024` n'est plus utilisé.

## 3. Sécuriser la base et les contrats

Exécuter le fichier :

`supabase/security-v2.sql`

Il :

- laisse uniquement la lecture publique de `materiels` ;
- bloque tout accès direct public à `reservations` ;
- rend le bucket `contrats` privé ;
- bloque l'accès direct au bucket `contrats` pour les rôles `anon` et `authenticated`.

Les Netlify Functions utilisent la clé `service_role` côté serveur et continuent donc à accéder aux données nécessaires.

## 4. Webhooks Make

Les anciennes URL Make étaient présentes dans le JavaScript du navigateur. La V2 les lit uniquement depuis les variables Netlify.

Le webhook `MAKE_RESERVATION_WEBHOOK` reçoit notamment :

- `reservation_id`
- `client`
- `adresse`, `cp`, `ville`
- `email`, `telephone`
- `dates`
- `montant`, `caution`
- `articles`
- `contrat` : URL signée temporaire du PDF

Le webhook `MAKE_CONFIRMATION_WEBHOOK` reçoit la réservation complète lors du passage au statut `Confirmé`.

## 5. Test avant fusion

Tester sur le Deploy Preview de la branche :

1. Charger le catalogue.
2. Choisir une période et vérifier que la disponibilité change correctement.
3. Ajouter plusieurs articles puis modifier une date : le panier doit être vidé.
4. Créer une réservation test.
5. Vérifier que les montants enregistrés correspondent aux prix de la base et non à des valeurs modifiées dans le navigateur.
6. Se connecter sur `/administrateurs.html` avec un compte autorisé.
7. Vérifier qu'un compte Supabase non présent dans `ADMIN_EMAILS` est refusé.
8. Ouvrir le contrat depuis l'administration : le lien doit être temporaire.
9. Valider puis refuser une réservation de test.
10. Vérifier les scénarios Make si les webhooks sont configurés.

## 6. Point restant : concurrence de stock

La V2 revérifie le stock côté serveur juste avant l'insertion, ce qui empêche les falsifications côté navigateur. Il reste toutefois une très courte fenêtre de concurrence si deux personnes réservent exactement le dernier exemplaire au même instant.

Pour supprimer totalement ce risque, une étape ultérieure pourra déplacer la vérification + insertion dans une transaction PostgreSQL/RPC avec verrouillage. Pour le volume attendu de Loc'APEL, la V2 réduit déjà fortement le risque sans imposer une migration plus lourde.
