-- Scénario complet d'un dossier, de l'ouverture à la fermeture,
-- avec vérification des refus attendus. À exécuter après supabase_stub.sql
-- et les migrations, sur une base de test.
\set ON_ERROR_STOP 1

create schema test;
grant usage on schema test to authenticated;
create function test.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'ÉCHEC : aucune erreur pour %', p_sql;
exception when others then
  if sqlerrm like 'ÉCHEC%' then raise; end if;
  if sqlerrm not ilike '%' || p_like || '%' then
    raise exception 'ÉCHEC : erreur inattendue pour % : %', p_sql, sqlerrm;
  end if;
  raise notice 'refus attendu : %', sqlerrm;
end $$;
grant execute on function test.expect_error(text, text) to authenticated;

create function test.as_user(p_email text) returns void language sql security definer as $$
  select set_config('request.jwt.claim.sub', (select id::text from auth.users where email = p_email), false);
$$;
grant execute on function test.as_user(text) to authenticated;
grant select on auth.users to authenticated; -- test seulement

-- Comptes
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000001', 'chef@balcanis.test', '{"full_name":"Chef du cabinet"}'),
  ('00000000-0000-0000-0000-000000000002', 'gbr@balcanis.test',  '{"full_name":"Gestionnaire Kinshasa"}'),
  ('00000000-0000-0000-0000-000000000003', 'col@balcanis.test',  '{"full_name":"Agent collecte"}'),
  ('00000000-0000-0000-0000-000000000004', 'trt@balcanis.test',  '{"full_name":"Agent traitement"}'),
  ('00000000-0000-0000-0000-000000000005', 'trt2@balcanis.test', '{"full_name":"Agent traitement 2"}'),
  ('00000000-0000-0000-0000-000000000006', 'ctl@balcanis.test',  '{"full_name":"Contrôleur"}');

-- Amorçage : le premier administrateur est désigné en SQL (voir README)
update public.profiles set roles = '{CHF,ADM}', office_code = 'KIN', agent_code = 'CHF-0001'
where email = 'chef@balcanis.test';

set role authenticated;
select test.as_user('chef@balcanis.test');
select (public.admin_set_profile(id, null, '{GBR}', 'KIN', '{}', null, true)).agent_code from auth.users where email = 'gbr@balcanis.test';
select (public.admin_set_profile(id, null, '{COL}', 'KIN', '{}', null, true)).agent_code from auth.users where email = 'col@balcanis.test';
select (public.admin_set_profile(id, null, '{TRT}', null, '{PE}', 8.50, true)).agent_code from auth.users where email = 'trt@balcanis.test';
select (public.admin_set_profile(id, null, '{TRT,CTL}', null, '{PE}', 8.50, true)).agent_code from auth.users where email = 'trt2@balcanis.test';
select (public.admin_set_profile(id, null, '{CTL}', null, '{}', null, true)).agent_code from auth.users where email = 'ctl@balcanis.test';

-- Un agent ne peut pas modifier une table directement
select test.as_user('trt@balcanis.test');
select test.expect_error($$update public.dossiers set status = 90$$, 'permission denied');
select test.expect_error($$insert into public.audit_log (action, object_type) values ('x','y')$$, 'permission denied');

-- Le gestionnaire crée le client et ouvre le dossier
select test.as_user('gbr@balcanis.test');
create temp table ctx (k text primary key, v text);
grant all on ctx to authenticated;
insert into ctx select 'client', (public.create_client('Marie', 'Mbuyi', '1998-04-12', 'marie@example.com', '+243000', 'CD')).id::text;
insert into ctx select 'dossier', public.create_dossier((select v::uuid from ctx where k = 'client'), 'PE',
  (select id from auth.users where email = 'col@balcanis.test'));
select number, base_number, status from public.dossiers;
select test.expect_error(format($$select public.create_dossier(%L, 'QC-PEQ-X', %L)$$,
  (select v from ctx where k = 'client'), (select id from auth.users where email = 'col@balcanis.test')), 'Programme inconnu');

-- Le traitant ne voit pas encore le dossier
select test.as_user('trt@balcanis.test');
select count(*) as dossiers_vus_par_trt_avant_assignation from public.dossiers;

-- Collecte : passage à 15 refusé tant que des pièces manquent
select test.as_user('col@balcanis.test');
select test.expect_error(format($$select public.transition_dossier(%L, 15::smallint)$$, (select v from ctx where k = 'dossier')), 'Collecte incomplète');
select * from public.missing_documents((select v::uuid from ctx where k = 'dossier'));
select r.file_name, r.storage_path
from unnest(array['PASSEPORT','ACTE-NAISSANCE','PHOTO','CONTRAT','MANDAT-REPRESENTATION','CONSENTEMENT','LETTRE-ADMISSION','PREUVE-FONDS']) t,
lateral public.register_document((select v::uuid from ctx where k = 'dossier'), 'P', t, 'pdf') r;
-- nouvelle version du passeport
select file_name from public.register_document((select v::uuid from ctx where k = 'dossier'), 'P', 'PASSEPORT', 'pdf');
select type_code, version, is_current from public.documents where type_code = 'PASSEPORT' order by version;
select public.transition_dossier((select v::uuid from ctx where k = 'dossier'), 15::smallint);

-- Assignation : refusée pour un agent non certifié, acceptée sinon
select test.as_user('gbr@balcanis.test');
select test.expect_error(format($$select public.assign_dossier(%L, 'TRT', %L)$$,
  (select v from ctx where k = 'dossier'), (select id from auth.users where email = 'ctl@balcanis.test')), 'rôle TRT');
select public.assign_dossier((select v::uuid from ctx where k = 'dossier'), 'TRT', (select id from auth.users where email = 'trt@balcanis.test'));

-- Traitement + chronomètre
select test.as_user('trt@balcanis.test');
select count(*) as dossiers_vus_par_trt_apres_assignation from public.dossiers;
select test.expect_error(format($$select public.start_timer(%L)$$, (select v from ctx where k = 'dossier')), 'ne fonctionne pas');
select public.transition_dossier((select v::uuid from ctx where k = 'dossier'), 30::smallint);
select public.start_timer((select v::uuid from ctx where k = 'dossier')) is not null as session_demarree;
select test.expect_error(format($$select public.start_timer(%L)$$, (select v from ctx where k = 'dossier')), 'déjà active');
select public.timer_heartbeat() as session_active;
reset role;
-- on simule 45 minutes de travail
update public.time_sessions set started_at = now() - interval '45 minutes';
set role authenticated;
select public.stop_timer();
-- auto-vérification incomplète, puis complète
select test.expect_error(format($$select public.submit_review(%L, 'auto', '[]'::jsonb)$$, (select v from ctx where k = 'dossier')), 'incomplète');
select public.submit_review((select v::uuid from ctx where k = 'dossier'), 'auto',
  (select jsonb_agg(jsonb_build_object('item_id', id, 'answer', 'conforme')) from public.checklist_items where level = 'auto')) is not null as auto_ok;

-- Contrôle : le traitant (même avec le rôle CTL) ne peut pas contrôler son propre dossier
select test.as_user('ctl@balcanis.test');
select number, status from public.dossiers;
select public.transition_dossier((select v::uuid from ctx where k = 'dossier'), 50::smallint);
-- renvoi sans motif refusé, puis renvoi avec motif
select test.expect_error(format($$select public.submit_review(%L, 'controle', %L::jsonb, 'x')$$,
  (select v from ctx where k = 'dossier'),
  (select jsonb_agg(jsonb_build_object('item_id', id, 'answer', case when sort = 50 then 'non_conforme' else 'conforme' end)) from public.checklist_items where level = 'controle')), 'motif');
select public.submit_review((select v::uuid from ctx where k = 'dossier'), 'controle',
  (select jsonb_agg(jsonb_build_object('item_id', id, 'answer', case when sort = 50 then 'non_conforme' else 'conforme' end)) from public.checklist_items where level = 'controle'),
  'Traduction de l''acte de naissance manquante', '{traduction}') is not null as renvoi_ok;
select return_code, result, reason_codes from public.reviews where level = 'controle';

-- Correction (temps mesuré mais non payé au statut 55)
select test.as_user('trt@balcanis.test');
select public.start_timer((select v::uuid from ctx where k = 'dossier')) is not null;
select public.register_document((select v::uuid from ctx where k = 'dossier'), 'P', 'TRADUCTION', 'pdf');
reset role;
update public.time_sessions set started_at = now() - interval '20 minutes' where ended_at is null;
set role authenticated;
select public.submit_review((select v::uuid from ctx where k = 'dossier'), 'auto',
  (select jsonb_agg(jsonb_build_object('item_id', id, 'answer', 'conforme')) from public.checklist_items where level = 'auto')) is not null;
select status_at_start, billable, end_reason, round(extract(epoch from ended_at - started_at) / 60) as minutes from public.time_sessions order by started_at;

-- Second contrôle : accepté
select test.as_user('ctl@balcanis.test');
select public.transition_dossier((select v::uuid from ctx where k = 'dossier'), 50::smallint);
select public.submit_review((select v::uuid from ctx where k = 'dossier'), 'controle',
  (select jsonb_agg(jsonb_build_object('item_id', id, 'answer', 'conforme')) from public.checklist_items where level = 'controle')) is not null as controle_ok;

-- Le gestionnaire valide les heures ; seul le chef valide et soumet
select test.as_user('gbr@balcanis.test');
select public.validate_hours((select v::uuid from ctx where k = 'dossier')) as sessions_validees;
select test.expect_error(format($$select public.transition_dossier(%L, 70::smallint)$$, (select v from ctx where k = 'dossier')), 'ne pouvez pas');
select test.as_user('chef@balcanis.test');
select public.transition_dossier((select v::uuid from ctx where k = 'dossier'), 70::smallint);
select test.expect_error(format($$select public.submit_dossier(%L, '')$$, (select v from ctx where k = 'dossier')), 'obligatoire');
select public.submit_dossier((select v::uuid from ctx where k = 'dossier'), 'E001234567');
select public.transition_dossier((select v::uuid from ctx where k = 'dossier'), 90::smallint, 'Permis d''études approuvé');
select test.expect_error(format($$select public.register_document(%L, 'P', 'DECISION', 'pdf')$$, (select v from ctx where k = 'dossier')), 'lecture seule');

-- Résultats
select number, status, return_count, submission_number, decision, closed_at is not null as ferme from public.dossiers;
select agent_code, number, billable_hours, validated_hours, unpaid_hours from public.time_summary;
select action, actor_code, reason from public.audit_log where dossier_id = (select v::uuid from ctx where k = 'dossier') order by id;

-- Le journal est inaltérable, même pour le superutilisateur
reset role;
select test.expect_error($$delete from public.audit_log$$, 'ni modifié ni effacé');
select test.expect_error($$update public.audit_log set reason = 'x'$$, 'ni modifié ni effacé');

-- Stockage : dépôt refusé hors d'un chemin enregistré
set role authenticated;
select test.as_user('trt@balcanis.test');
select test.expect_error($$insert into storage.objects (bucket_id, name) values ('dossiers', 'BC-KIN-2026-00001-PE/01_IDENTITE/nimporte.pdf')$$, 'row-level security');
-- Paiement : l'agent choisit, l'ADM confirme ; personne d'autre ne voit les coordonnées
select public.update_my_payment('Mobile money', 'Chaque mois', '+243 000 000');
select count(*) as mes_coordonnees from public.agent_payments;
select test.as_user('gbr@balcanis.test');
select count(*) as coordonnees_vues_par_gbr from public.agent_payments;
select test.as_user('chef@balcanis.test');
select public.approve_payment((select id from auth.users where email = 'trt@balcanis.test'));
select pending from public.agent_payments;
select action, after ? 'details' as coordonnees_dans_journal from public.audit_log where object_type = 'agent_payments';
-- Attribution automatique de l'agent de collecte (0006)
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000007', 'col2@balcanis.test', '{"full_name":"Agent collecte 2"}');
set role authenticated;
select test.as_user('chef@balcanis.test');
select (public.admin_set_profile(id, null, '{COL}', 'KIN', '{}', null, true)).agent_code from auth.users where email = 'col2@balcanis.test';
select test.as_user('gbr@balcanis.test');
-- COL-0001 a déjà eu un dossier, COL-0002 aucun : le nouveau dossier va à COL-0002
insert into ctx select 'auto1', public.create_dossier((select v::uuid from ctx where k = 'client'), 'PE');
select p.agent_code as attribue_a from public.dossiers d join public.profiles p on p.id = d.collector_id where d.id = (select v::uuid from ctx where k = 'auto1');
-- COL-0002 a maintenant 1 dossier en collecte, COL-0001 aucun (son dossier est fermé) : retour à COL-0001
insert into ctx select 'auto2', public.create_dossier((select v::uuid from ctx where k = 'client'), 'VR');
select p.agent_code as attribue_a from public.dossiers d join public.profiles p on p.id = d.collector_id where d.id = (select v::uuid from ctx where k = 'auto2');
-- COL-0001 se déclare indisponible : le dossier va à COL-0002 même s'il est plus chargé
select test.as_user('col@balcanis.test');
select public.set_availability(null, false);
select test.as_user('gbr@balcanis.test');
insert into ctx select 'auto3', public.create_dossier((select v::uuid from ctx where k = 'client'), 'PE');
select p.agent_code as attribue_a from public.dossiers d join public.profiles p on p.id = d.collector_id where d.id = (select v::uuid from ctx where k = 'auto3');
select reason from public.audit_log where action = 'dossier ouvert' order by id desc limit 1;
-- personne de disponible : refus clair
select test.as_user('col2@balcanis.test');
select public.set_availability(null, false);
select test.as_user('gbr@balcanis.test');
select test.expect_error(format($$select public.create_dossier(%L, 'PE')$$, (select v from ctx where k = 'client')), 'Aucun agent de collecte disponible');
-- Notifications (0007)
reset role;
select p.agent_code, n.kind, n.title, n.body
from public.notifications n join public.profiles p on p.id = n.user_id
where n.dossier_id = (select v::uuid from ctx where k = 'dossier')
order by n.id;
select count(*) as notifs_paiement_adm from public.notifications where kind = 'paiement';
set role authenticated;
select test.as_user('trt@balcanis.test');
select count(*) as mes_notifs, count(*) filter (where read_at is null) as non_lues from public.notifications;
select test.expect_error($$update public.notifications set read_at = now()$$, 'permission denied');
select public.mark_notifications_read();
select count(*) filter (where read_at is null) as non_lues_apres from public.notifications;
select test.expect_error($$select public.notify(auth.uid(), null, 'x', 'y')$$, 'permission denied');
select 'SCÉNARIO RÉUSSI' as resultat;
