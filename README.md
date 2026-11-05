# BalCanis : Plateforme de gestion des dossiers

Application web du cabinet d'immigration BalCanis : collecte des pièces au bureau, traitement par des agents à distance payés à l'heure, contrôle par une autre personne, validation et soumission par le chef du cabinet, avec un journal d'audit inaltérable.

Elle met en œuvre le document « Plateforme BalCanis : Cadrage fonctionnel de la gestion des dossiers ».

**Technologies** : Next.js 15 (App Router, TypeScript, Tailwind) et Supabase (PostgreSQL, authentification, stockage des fichiers).

## Ce que fait la version 1 (MVP)

| Module | Contenu |
| --- | --- |
| Clients et dossiers | Attribution automatique de l'agent de collecte (disponible et le moins chargé du bureau), numéros générés (`CL-2026-000187`, `BC-KIN-2026-00042-PE`), membres du dossier (P, C, E1…, G), référentiel des programmes avec dates d'ouverture et de fermeture |
| Pièces | Dépôt depuis le navigateur ; le système génère le nom (`BC-KIN-2026-00042_P_01_PASSEPORT_20261101_v01.pdf`) et le sous-dossier (`01_IDENTITE`). Versions conservées, pièces obligatoires manquantes affichées |
| Circuit | Statuts 00 à 99, transitions autorisées par rôle, motif obligatoire pour les retours, réassignations et annulations |
| Formulaires officiels | Liste des formulaires IRCC à remplir par programme (ex. IMM 1294, IMM 5645, IMM 5476 pour un permis d'études), téléversement par l'agent de traitement avec nom conforme à la nomenclature, blocage de l'envoi au contrôle tant qu'un formulaire manque, liste modifiable dans Administration > Formulaires |
| Suivi après la soumission | Demandes de l'autorité (biométrie, examen médical, pièces supplémentaires, entrevue, passeport…) avec date limite ; préparées par l'agent de collecte ou de traitement, envoyées par le chef ; statut 85 « Complément demandé » tant qu'une demande est ouverte ; décision impossible tant qu'il en reste ; rappels 7, 3 et 1 jour(s) avant et en cas de retard ; page Suivi IRCC |
| Alertes d'expiration | Date d'expiration obligatoire au dépôt du passeport, de la pièce d'identité, des tests de langue (TEF, TCF, IELTS, CELPIP), du certificat de police, de l'examen médical, du CAQ, du CSQ, de l'EIMT, de l'offre d'emploi et de la lettre d'admission ; badge d'échéance sur chaque pièce et encadré d'alerte dans le dossier ; page « Pièces à renouveler » (30, 60, 90 jours, 6 mois) ; rappels 90, 60, 30, 14, 7 jours avant, le jour même puis chaque semaine : agent de collecte, agent de traitement, gestionnaire du bureau (30 jours et moins) et chef (dossiers soumis) |
| Courriels | Les notifications non lues après 10 minutes partent par courriel (regroupées en un seul message) ; aucune si l'agent les a vues à l'écran ; chaque agent choisit dans son profil : au fil de l'eau, résumé quotidien ou aucun courriel ; aucun nom de client ni pièce dans les courriels ; page Administration > Courriels (mise en service, courriel de test, journal des envois et des échecs, nouvel essai automatique) |
| Contrôle qualité | Auto-vérification par l'agent de traitement, liste de contrôle par le contrôleur, renvois numérotés (`…-R01`) avec motifs. Le contrôleur ne peut jamais être le traitant |
| Validation | Seul le chef du cabinet valide et soumet (aucune délégation) ; numéro de demande obligatoire |
| Temps et paie | Chronomètre par dossier, pause automatique après 10 minutes d'inactivité, temps du statut 55 mesuré mais non payé, validation des heures après le contrôle, corrections avec motif, relevé mensuel par agent |
| Notifications | Cloche avec compteur en temps réel et fenêtre d'alerte : nouveau dossier à collecter, collecte complète à assigner, dossier assigné, information client à obtenir, prêt au contrôle, renvoi, validation finale, soumission, décision, annulation, coordonnées de paiement à confirmer, dossier bloqué depuis 7 jours |
| Bureaux | Création, modification et fermeture des bureaux par l'administrateur ou le chef ; chiffres par bureau ; un bureau fermé garde son historique mais n'accepte plus de nouveaux dossiers |
| Journal d'audit | Chaque action est enregistrée (qui, quand, avant/après, motif), y compris la consultation des pièces. Le journal ne peut être ni modifié ni effacé |
| Administration | Agents, bureaux, formulaires par programme, sécurité et paramètres (2FA obligatoire, téléchargement, inactivité, taille des fichiers), journal d'audit avec filtres et export CSV, export CSV des heures pour la paie |
| Photos de profil | Chaque agent ajoute sa photo dans Mon profil (l'administrateur et le chef peuvent la changer ou la retirer) ; recadrée et allégée dans le navigateur, sans les métadonnées d'origine (position GPS) ; seau privé visible seulement par le personnel connecté |
| Agents | Création des comptes par l'administrateur ou le chef (mot de passe temporaire à changer à la première connexion), réinitialisation du mot de passe, rôles, bureau, programmes certifiés, taux horaire ; chaque agent choisit son moyen et sa fréquence de paiement, l'administrateur confirme |

**Pas encore fait** (phase 2) : portail client, module de formation et certification, tableaux de bord avancés, envoi des notifications par courriel ou WhatsApp, saisie des formulaires IRCC dans la plateforme, export comptable.

## Principes de sécurité

- **Toutes les écritures passent par des fonctions PostgreSQL** (`supabase/migrations/0002_functions.sql`). Elles vérifient le rôle et l'assignation de l'utilisateur. Personne, même avec la clé publique, ne peut modifier une table directement.
- **Lecture filtrée par RLS** : un agent ne voit que les dossiers qui lui sont assignés, le gestionnaire ceux de son bureau, le chef et l'administrateur tout.
- **Les fichiers** ne peuvent être déposés qu'au chemin généré par la base (nomenclature imposée) ; aucun fichier ne peut être remplacé ou supprimé. Les liens de consultation expirent après 60 secondes.
- **Les coordonnées de paiement** ne sont visibles que par l'agent lui-même et l'administrateur, et ne sont pas recopiées dans le journal.

## Installation

### 1. Créer le projet Supabase

1. Créez un projet sur [supabase.com](https://supabase.com) (région : Canada si disponible).
2. Dans **SQL Editor**, collez et exécutez `supabase/install.sql` (les migrations `0001` à `0005` réunies, à lancer une seule fois sur un projet vide).
   Avec la CLI Supabase : `supabase link --project-ref VOTRE_REF` puis `supabase db push`.
3. Dans **Authentication > Providers**, gardez seulement « Email » et désactivez les inscriptions publiques (**Allow new users to sign up** : non). Les comptes sont créés par invitation.
4. Activez l'authentification à deux facteurs (**Authentication > Multi-Factor**) : c'est une exigence du cadrage.

**Mise à jour d'une base déjà installée** : exécutez seulement les nouvelles migrations, dans l'ordre (par exemple `0006_auto_assign_collector.sql`).

### 2. Désigner le premier administrateur

Invitez-vous (**Authentication > Users > Invite user**), acceptez l'invitation, puis exécutez dans le SQL Editor :

```sql
update public.profiles
set roles = '{CHF,ADM}', office_code = 'KIN', agent_code = 'CHF-0001'
where email = 'votre-courriel@exemple.com';
```

Ensuite, tout se fait dans l'application : page **Agents > Nouvel agent**. Le système crée le compte avec un mot de passe temporaire, que vous transmettez à l'agent ; il doit choisir son propre mot de passe à sa première connexion.

Aucune clé supplémentaire n'est nécessaire : la base crée le compte elle-même, après avoir vérifié que l'utilisateur est administrateur ou chef du cabinet.

### Rappel quotidien des dossiers bloqués (facultatif)

Dans Supabase, activez l'extension **pg_cron** (Database > Extensions), puis exécutez :

```sql
select cron.schedule('dossiers-bloques', '0 7 * * *', $$select public.notify_stale_dossiers(7)$$);
```

Pour les rappels d'échéance des demandes de l'autorité (après la soumission), ajoutez :

```sql
select cron.schedule('echeances-autorite', '5 7 * * *', $$select public.notify_request_deadlines()$$);
```

Pour les alertes d'expiration des pièces, ajoutez :

```sql
select cron.schedule('expirations-pieces', '10 7 * * *', $$select public.notify_document_expirations()$$);
```

Chaque matin à 7 h UTC (8 h à Kinshasa), les gestionnaires reçoivent une notification pour chaque dossier de leur bureau resté 7 jours ou plus dans le même statut.

### Notifications par courriel (facultatif)

Les courriels partent par le service **Resend** (gratuit jusqu'à 3 000 courriels par mois), directement depuis la base.

1. Créez un compte sur https://resend.com, ajoutez votre domaine (ex. `balcanis.ca`) et ajoutez chez votre hébergeur de domaine les enregistrements DNS indiqués, jusqu'à ce que le domaine soit « Verified ».
2. Créez une clé d'API (permission « Sending access »).
3. Dans Supabase, activez l'extension **pg_net** (Database > Extensions).
4. Dans le SQL Editor, rangez la clé dans le coffre (ne la collez nulle part ailleurs, ni dans le code ni dans `.env.local`) :

```sql
select vault.create_secret('VOTRE_CLE_RESEND', 'resend_api_key');
```

5. Planifiez l'envoi (toutes les 2 minutes) et le résumé du matin (7 h à Kinshasa) :

```sql
select cron.schedule('courriels', '*/2 * * * *', $$select public.process_email_queue()$$);
select cron.schedule('courriels-resume', '0 6 * * *', $$select public.send_daily_email_digest()$$);
```

6. Dans la plateforme, page **Administration > Courriels** : renseignez l'adresse d'expédition (de votre domaine vérifié) et l'adresse publique de la plateforme, cochez « Envoyer les notifications par courriel », puis envoyez-vous un courriel de test.

Pour changer de clé plus tard : `select vault.update_secret((select id from vault.secrets where name = 'resend_api_key'), 'NOUVELLE_CLE');`

### 3. Lancer l'application

```bash
cp .env.example .env.local   # puis renseignez l'URL et la clé « anon » du projet
npm install
npm run dev                  # http://localhost:3000
```

Mise en ligne : Vercel (ou tout hébergeur Node.js) avec les deux mêmes variables d'environnement.

## Sécurité

### Ce que fait l'application

| Mesure | Détail |
| --- | --- |
| Règles appliquées par la base | Toutes les écritures passent par des fonctions PostgreSQL qui vérifient rôle, assignation et session ; lecture filtrée par RLS. Aucun accès anonyme |
| Double authentification (2FA) | Code à 6 chiffres (application d'authentification). Peut être rendue obligatoire dans Administration > Sécurité ; elle est alors exigée par la base elle-même (niveau aal2), pas seulement par l'interface |
| Comptes désactivés | Connexion bloquée, sessions fermées, plus aucun accès aux dossiers (même assignés), historique conservé |
| Compte du chef protégé | Seul un chef peut modifier, désactiver, réinitialiser un chef ou attribuer ce rôle |
| Mots de passe | Temporaire à la création, changement obligatoire à la première connexion ; réinitialisation par l'administration ferme les sessions |
| Inactivité | Déconnexion automatique (30 min par défaut, réglable) |
| Pièces | PDF, JPG, PNG uniquement, taille limitée (base et stockage) ; dépôt au seul chemin généré ; aucun remplacement ni suppression ; liens de 60 s |
| Téléchargement | Réservé selon le rôle (agents de traitement : désactivé par défaut) ; chaque consultation et téléchargement est journalisé |
| Journal d'audit | Inaltérable (ni modification ni effacement, même par l'administrateur), consultable et exportable dans Administration > Journal d'audit |
| En-têtes HTTP | CSP, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, pages privées non mises en cache |
| Exports CSV | Protégés contre l'injection de formules Excel |

### Réglages à faire dans Supabase (une fois)

1. **Authentication > Sign In / Providers** : désactiver les inscriptions publiques (*Allow new users to sign up* : non) ; garder seulement Email.
2. **Authentication > Multi-Factor** : activer **TOTP** (nécessaire à la double authentification).
3. **Authentication > Policies (ou Password)** : longueur minimale **10**, exiger lettres et chiffres ; activer la protection contre les mots de passe divulgués si votre offre le permet.
4. **Authentication > URL Configuration** : *Site URL* = l'adresse de production de l'application.
5. **Authentication > Rate Limits** : garder les limites par défaut (protection contre les tentatives de mot de passe).
6. **Database > Backups** : vérifier les sauvegardes quotidiennes ; activer la restauration à un instant donné (PITR) pour la production.
7. Ne jamais mettre la clé **service_role** dans l'application ni la partager : l'application n'en a pas besoin.

### Après la mise en service

- Activez votre propre 2FA (Mon profil), puis cochez « Double authentification obligatoire » dans Administration > Sécurité.
- Désactivez immédiatement le compte d'un agent qui quitte le cabinet ; utilisez « Déconnecter partout » en cas de doute (appareil perdu).
- Consultez régulièrement Administration > Sécurité (comptes sans 2FA, sans connexion depuis 30 jours) et le journal d'audit.

## Tester la base de données

Le scénario `supabase/tests/scenario.sql` déroule un dossier complet (ouverture, collecte, traitement, renvoi, correction, contrôle, validation des heures, soumission, fermeture) et vérifie les refus attendus (agent non certifié, contrôleur = traitant, journal non modifiable, etc.).

Sur un PostgreSQL 15+ local, sans Supabase :

```bash
./supabase/tests/run.sh "psql -h localhost -U postgres"
```

Le fichier `supabase/tests/supabase_stub.sql` simule le minimum de Supabase (schémas `auth` et `storage`). Ne l'exécutez jamais sur le vrai projet.

## Organisation du code

```
supabase/migrations/
  0001_schema.sql          tables, contraintes
  0002_functions.sql       règles métier, journal d'audit, chronomètre
  0003_rls.sql             droits de lecture par rôle
  0004_storage.sql         seau « dossiers » et règles de dépôt
  0005_reference_data.sql  bureau KIN, statuts, programmes, types de pièces, listes de contrôle
src/app/
  connexion/               page de connexion
  (app)/                   pages protégées : tableau de bord, dossiers, contrôle, heures, agents, profil
  actions.ts               actions serveur (appellent les fonctions PostgreSQL)
src/components/            formulaires, dépôt de pièces, chronomètre
src/lib/                   clients Supabase, types, libellés, permissions
```

## Points à confirmer avec le cabinet

Ces règles sont codées avec une valeur provisoire, faciles à changer :

- **Taux horaire** : un taux par agent, saisi dans **Agents**. Le cabinet n'a pas encore décidé s'il sera unique, par niveau ou par pays.
- **Temps du statut 55 (corrections)** : non payé pour l'instant (`dossier_statuses.billable = false`). Le statut 75 (retour du chef) suit la même règle en attendant une décision.
- **Pièces obligatoires** : seul le socle commun et quelques exemples sont saisis (`required_documents`). Il reste à reprendre les listes officielles IRCC et MIFI, programme par programme.
- **Formulaires par programme** : la liste fournie est un point de départ. Le cabinet doit la vérifier avec les guides en vigueur (certaines demandes se font entièrement en ligne, sans formulaire PDF) et ajouter les liens officiels.
- **Programmes** : à vérifier avant la mise en service : TAU, VDE, QC-AFF et chaque programme pilote.
- **Conservation** : 90 jours après la fermeture selon le cabinet, à valider avec un juriste ; la suppression automatique n'est pas encore programmée.
- **Inactivité** : la pause du chronomètre se fait après 10 minutes sans activité.
