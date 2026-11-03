-- =====================================================================
-- 0005 : données de référence (issues du cadrage fonctionnel)
-- Elles se modifient ensuite dans l'application ou par migration.
-- =====================================================================

insert into public.offices (code, name, country_iso) values
  ('KIN', 'Kinshasa', 'CD');

insert into public.dossier_statuses (code, label, timer_open, billable, closed) values
  (0,  'Ouvert',               false, false, false),
  (10, 'Collecte en cours',    false, false, false),
  (15, 'Collecte complète',    false, false, false),
  (20, 'Assigné',              false, false, false),
  (30, 'En traitement',        true,  true,  false),
  (35, 'En attente client',    false, false, false),
  (40, 'Prêt au contrôle',     false, false, false),
  (50, 'En contrôle',          false, false, false),
  -- 55 : temps mesuré mais non payé (décision du cabinet, à confirmer)
  (55, 'À corriger',           true,  false, false),
  (60, 'Contrôlé',             false, false, false),
  (70, 'En validation finale', false, false, false),
  -- 75 : traité comme 55 en attendant la décision du cabinet
  (75, 'Retourné par le chef', true,  false, false),
  (80, 'Soumis',               false, false, false),
  (90, 'Fermé',                false, false, true),
  (99, 'Annulé',               false, false, true);

insert into public.status_transitions (from_status, to_status, roles, reason_required) values
  (0,  10, '{GBR,CHF,ADM}', false),
  (10, 15, '{COL,GBR}',     false),
  (15, 20, '{GBR,CHF,ADM}', false),
  (20, 30, '{TRT}',         false),
  (30, 35, '{TRT}',         true),
  (55, 35, '{TRT}',         true),
  (35, 30, '{COL,GBR}',     false),
  (30, 40, '{TRT}',         false),
  (55, 40, '{TRT}',         false),
  (75, 40, '{TRT}',         false),
  (40, 50, '{CTL}',         false),
  (50, 55, '{CTL}',         true),
  (50, 60, '{CTL}',         false),
  (60, 70, '{CHF}',         false),
  (70, 75, '{CHF}',         true),
  (70, 80, '{CHF}',         false),
  (80, 90, '{CHF}',         true);

-- Annulation possible avant la soumission, avec motif
insert into public.status_transitions (from_status, to_status, roles, reason_required)
select code, 99, '{GBR,CHF}', true from public.dossier_statuses where code < 80 and code not in (0);

insert into public.return_reasons (code, label) values
  ('piece_manquante', 'Pièce manquante'),
  ('erreur_saisie',   'Erreur de saisie'),
  ('incoherence',     'Incohérence entre pièces ou formulaires'),
  ('traduction',      'Traduction manquante ou non conforme'),
  ('autre',           'Autre');

insert into public.programs (code, family, name, authority, opened_on, closed_on) values
  ('EE-TQF',  'RP économique fédéral',  'Travailleurs qualifiés (fédéral), via Entrée express', 'IRCC', null, null),
  ('EE-CEC',  'RP économique fédéral',  'Catégorie de l''expérience canadienne, via Entrée express', 'IRCC', null, null),
  ('EE-TMS',  'RP économique fédéral',  'Travailleurs de métiers spécialisés (fédéral), via Entrée express', 'IRCC', null, null),
  ('PCP',     'RP économique régional', 'Programme des candidats des provinces', 'Province + IRCC', null, null),
  ('PIA',     'RP économique régional', 'Programme d''immigration au Canada atlantique', 'Province + IRCC', null, null),
  ('PIL',     'RP économique',          'Programmes pilotes', 'IRCC', null, null),
  ('VDE',     'RP affaires',            'Visa pour démarrage d''entreprise', 'IRCC', null, null),
  ('TAU',     'RP affaires',            'Travailleurs autonomes', 'IRCC', null, null),
  ('QC-PSTQ', 'RP Québec',              'Programme de sélection des travailleurs qualifiés', 'MIFI + IRCC', null, null),
  ('QC-PEQ',  'RP Québec',              'Programme de l''expérience québécoise', 'MIFI + IRCC', '2026-07-02', '2028-07-02'),
  ('QC-AFF',  'RP Québec',              'Gens d''affaires du Québec', 'MIFI + IRCC', null, null),
  ('PF-CONJ', 'RP famille',             'Parrainage d''un époux, conjoint de fait ou partenaire conjugal', 'IRCC (+ MIFI au Québec)', null, null),
  ('PF-ENF',  'RP famille',             'Parrainage d''un enfant à charge ou adopté', 'IRCC (+ MIFI au Québec)', null, null),
  ('PF-PGP',  'RP famille',             'Parrainage des parents et grands-parents', 'IRCC (+ MIFI au Québec)', null, null),
  ('CH',      'RP humanitaire',         'Considérations d''ordre humanitaire', 'IRCC', null, null),
  ('REF',     'RP humanitaire',         'Réfugiés : parrainage privé, personnes protégées', 'IRCC', null, null),
  ('VR',      'Temporaire',             'Visa de résident temporaire (visiteur)', 'IRCC', null, null),
  ('AVE',     'Temporaire',             'Autorisation de voyage électronique', 'IRCC', null, null),
  ('SV',      'Temporaire',             'Super visa pour parents et grands-parents', 'IRCC', null, null),
  ('PE',      'Temporaire',             'Permis d''études', 'IRCC (+ MIFI)', null, null),
  ('PT-EIMT', 'Temporaire',             'Permis de travail avec EIMT', 'IRCC + EDSC (+ MIFI)', null, null),
  ('PT-MI',   'Temporaire',             'Permis de travail, mobilité internationale', 'IRCC', null, null),
  ('PT-PDE',  'Temporaire',             'Permis de travail postdiplôme', 'IRCC', null, null),
  ('PT-OUV',  'Temporaire',             'Permis de travail ouvert', 'IRCC', null, null),
  ('PROL',    'Temporaire',             'Prolongation ou changement de statut au Canada', 'IRCC', null, null),
  ('RET',     'Temporaire',             'Rétablissement du statut', 'IRCC', null, null),
  ('CRP',     'Après la RP',            'Renouvellement de la carte de résident permanent', 'IRCC', null, null),
  ('TVRP',    'Après la RP',            'Titre de voyage de résident permanent', 'IRCC', null, null),
  ('CIT',     'Citoyenneté',            'Demande de citoyenneté', 'IRCC', null, null),
  ('CIT-PRV', 'Citoyenneté',            'Preuve de citoyenneté', 'IRCC', null, null);

insert into public.document_categories (code, folder, label) values
  ('00', '00_ADMIN',           'Contrat, mandat, consentements, paiements'),
  ('01', '01_IDENTITE',        'Passeports, actes de naissance, photos'),
  ('02', '02_ETAT_CIVIL',      'Mariage, divorce, enfants'),
  ('03', '03_ETUDES',          'Diplômes, relevés, évaluations'),
  ('04', '04_LANGUE',          'Résultats de tests de langue'),
  ('05', '05_EMPLOI',          'Lettres d''employeur, contrats, fiches de paie'),
  ('06', '06_FINANCES',        'Relevés bancaires, preuves de fonds'),
  ('07', '07_ADMISSION_OFFRE', 'Admission, CAQ, CSQ, offre d''emploi'),
  ('08', '08_SANTE_POLICE',    'Examen médical, certificats de police'),
  ('09', '09_TRADUCTIONS',     'Traductions certifiées'),
  ('10', '10_FORMULAIRES',     'Formulaires remplis'),
  ('11', '11_CONTROLE',        'Listes de contrôle, rapports de renvoi'),
  ('12', '12_SOUMISSION',      'Paquet final, accusé de réception'),
  ('13', '13_CORRESPONDANCE',  'Lettres des autorités, décision');

insert into public.document_types (code, label, category_code) values
  ('CONTRAT',                'Contrat de service',                     '00'),
  ('MANDAT-REPRESENTATION',  'Mandat de représentation',               '00'),
  ('CONSENTEMENT',           'Consentement au traitement des données', '00'),
  ('PREUVE-PAIEMENT',        'Preuve de paiement',                     '00'),
  ('PASSEPORT',              'Passeport',                              '01'),
  ('ACTE-NAISSANCE',         'Acte de naissance',                      '01'),
  ('PHOTO',                  'Photo aux normes',                       '01'),
  ('CARTE-IDENTITE',         'Carte d''identité nationale',            '01'),
  ('ACTE-MARIAGE',           'Acte de mariage',                        '02'),
  ('JUGEMENT-DIVORCE',       'Jugement de divorce',                    '02'),
  ('PREUVE-UNION-FAIT',      'Preuve d''union de fait',                '02'),
  ('ACTE-DECES',             'Acte de décès',                          '02'),
  ('PREUVE-RELATION',        'Preuves de la relation',                 '02'),
  ('DIPLOME',                'Diplôme',                                '03'),
  ('RELEVE-NOTES',           'Relevé de notes',                        '03'),
  ('EVALUATION-DIPLOME',     'Évaluation des diplômes',                '03'),
  ('RESULTAT-TEF',           'Résultat TEF',                           '04'),
  ('RESULTAT-TCF',           'Résultat TCF',                           '04'),
  ('RESULTAT-IELTS',         'Résultat IELTS',                         '04'),
  ('RESULTAT-CELPIP',        'Résultat CELPIP',                        '04'),
  ('LETTRE-EMPLOYEUR',       'Lettre d''employeur',                    '05'),
  ('CONTRAT-TRAVAIL',        'Contrat de travail',                     '05'),
  ('FICHE-PAIE',             'Fiche de paie',                          '05'),
  ('RELEVE-BANCAIRE',        'Relevé bancaire',                        '06'),
  ('PREUVE-FONDS',           'Preuve de fonds',                        '06'),
  ('PRISE-EN-CHARGE',        'Attestation de prise en charge',         '06'),
  ('PLAN-AFFAIRES',          'Plan d''affaires',                       '06'),
  ('LETTRE-ADMISSION',       'Lettre d''admission',                    '07'),
  ('CAQ',                    'Certificat d''acceptation du Québec',    '07'),
  ('CSQ',                    'Certificat de sélection du Québec',      '07'),
  ('OFFRE-EMPLOI',           'Offre d''emploi',                        '07'),
  ('EIMT',                   'Étude d''impact sur le marché du travail','07'),
  ('DESIGNATION-PROVINCIALE','Certificat de désignation provinciale',  '07'),
  ('ENGAGEMENT-PARRAINAGE',  'Engagement de parrainage',               '07'),
  ('EXAMEN-MEDICAL',         'Examen médical',                         '08'),
  ('CERTIFICAT-POLICE',      'Certificat de police',                   '08'),
  ('TRADUCTION',             'Traduction certifiée',                   '09'),
  ('FORMULAIRE',             'Formulaire rempli',                      '10'),
  ('LISTE-CONTROLE',         'Liste de contrôle signée',               '11'),
  ('RAPPORT-RENVOI',         'Rapport de renvoi',                      '11'),
  ('PAQUET-SOUMISSION',      'Paquet de soumission',                   '12'),
  ('ACCUSE-RECEPTION',       'Accusé de réception',                    '12'),
  ('LETTRE-AUTORITE',        'Lettre des autorités',                   '13'),
  ('DECISION',               'Décision',                               '13');

-- Socle commun (tous programmes) + exemples par programme, à compléter
-- à partir des listes officielles IRCC / MIFI
insert into public.required_documents (program_code, type_code, person_scope) values
  (null, 'PASSEPORT', 'ALL'),
  (null, 'ACTE-NAISSANCE', 'ALL'),
  (null, 'PHOTO', 'ALL'),
  (null, 'CONTRAT', 'P'),
  (null, 'MANDAT-REPRESENTATION', 'P'),
  (null, 'CONSENTEMENT', 'P'),
  ('PE', 'LETTRE-ADMISSION', 'P'),
  ('PE', 'PREUVE-FONDS', 'P'),
  ('EE-TQF', 'EVALUATION-DIPLOME', 'P'),
  ('EE-TQF', 'LETTRE-EMPLOYEUR', 'P'),
  ('EE-TQF', 'PREUVE-FONDS', 'P'),
  ('EE-CEC', 'LETTRE-EMPLOYEUR', 'P'),
  ('EE-TMS', 'LETTRE-EMPLOYEUR', 'P'),
  ('PT-EIMT', 'OFFRE-EMPLOI', 'P'),
  ('PT-EIMT', 'EIMT', 'P'),
  ('PF-CONJ', 'PREUVE-RELATION', 'P'),
  ('PF-CONJ', 'ENGAGEMENT-PARRAINAGE', 'P');

insert into public.checklist_items (level, program_code, label, sort) values
  ('auto', null, 'Formulaires signés et datés', 10),
  ('auto', null, 'Toutes les pièces sont lisibles', 20),
  ('auto', null, 'Noms et dates de naissance identiques au passeport partout', 30),
  ('auto', null, 'Pièces classées et nommées selon la nomenclature', 40),
  ('controle', null, 'Identité : mêmes nom, date de naissance et numéro de passeport dans tous les formulaires et pièces', 10),
  ('controle', null, 'Validité : passeport, résultats de langue et certificats de police non expirés à la date prévue de soumission', 20),
  ('controle', null, 'Complétude : toutes les pièces obligatoires du programme, pour chaque personne du dossier', 30),
  ('controle', null, 'Cohérence : dates d''emploi et d''études sans trou inexpliqué ; montants conformes aux seuils du programme', 40),
  ('controle', null, 'Traductions : toute pièce ni en français ni en anglais a sa traduction certifiée', 50),
  ('controle', null, 'Forme : nommage et classement conformes à la nomenclature', 60);
