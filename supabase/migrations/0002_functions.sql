-- =====================================================================
-- 0002 : journal d'audit, règles métier et fonctions appelées par l'application
-- Toutes les fonctions d'écriture sont SECURITY DEFINER : elles vérifient
-- elles-mêmes le rôle et l'assignation de l'utilisateur (auth.uid()).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Aides : qui est l'utilisateur courant ?
-- ---------------------------------------------------------------------
create or replace function public.has_role(r public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.active and r = any (p.roles)
  );
$$;

create or replace function public.my_office()
returns char(3) language sql stable security definer set search_path = public as $$
  select office_code from profiles where id = auth.uid();
$$;

create or replace function public.require_role(rs public.app_role[])
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.active and p.roles && rs
  ) then
    raise exception 'Action non autorisée : rôle requis parmi %', rs using errcode = '42501';
  end if;
end;
$$;

create or replace function public.can_view_dossier(p_dossier uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from dossiers d
    where d.id = p_dossier and (
         public.has_role('CHF') or public.has_role('ADM')
      or (public.has_role('GBR') and d.office_code = public.my_office())
      or d.collector_id = auth.uid()
      or d.processor_id = auth.uid()
      or d.controller_id = auth.uid()
      -- file d'attente du contrôle : visible par tout contrôleur qui n'est pas le traitant
      or (public.has_role('CTL') and d.status = 40 and d.processor_id is distinct from auth.uid())
    )
  );
$$;

create or replace function public.can_view_dossier_number(p_number text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select public.can_view_dossier(id) from dossiers where number = p_number), false);
$$;

-- ---------------------------------------------------------------------
-- Journal d'audit
-- Chaque fonction métier pose l'action et le motif dans la transaction
-- (set_config local) ; le trigger les recopie dans le journal.
-- ---------------------------------------------------------------------
create or replace function public.set_audit_context(p_action text, p_reason text default null)
returns void language sql as $$
  select set_config('app.action', coalesce(p_action, ''), true),
         set_config('app.reason', coalesce(p_reason, ''), true);
$$;

create or replace function public.write_audit(
  p_dossier uuid, p_action text, p_object_type text, p_object_id text,
  p_before jsonb, p_after jsonb, p_reason text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_code text; v_roles app_role[];
begin
  select agent_code, roles into v_code, v_roles from profiles where id = auth.uid();
  insert into audit_log (actor_id, actor_code, actor_roles, dossier_id, action, object_type, object_id, before, after, reason)
  values (auth.uid(), v_code, v_roles, p_dossier, p_action, p_object_type, p_object_id, p_before, p_after, p_reason);
end;
$$;

create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_before jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_after jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_dossier uuid;
  v_action text := nullif(current_setting('app.action', true), '');
begin
  -- le signal d'activité du chronomètre (toutes les minutes) n'encombre pas le journal
  if tg_table_name = 'time_sessions' and tg_op = 'UPDATE'
     and (to_jsonb(new) - 'last_activity_at') = (to_jsonb(old) - 'last_activity_at') then
    return new;
  end if;
  if tg_table_name = 'agent_payments' then
    -- les coordonnées elles-mêmes ne sont pas recopiées dans le journal
    v_before := v_before - 'details';
    v_after := v_after - 'details';
  end if;
  if tg_table_name = 'dossiers' then
    v_dossier := (v_row ->> 'id')::uuid;
  elsif v_row ? 'dossier_id' then
    v_dossier := (v_row ->> 'dossier_id')::uuid;
  end if;
  perform write_audit(
    v_dossier,
    coalesce(v_action, lower(tg_op) || ' ' || tg_table_name),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'agent_id'),
    v_before,
    v_after,
    nullif(current_setting('app.reason', true), '')
  );
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['clients', 'dossiers', 'dossier_members', 'documents', 'reviews', 'time_sessions', 'profiles', 'agent_payments']
  loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I
                    for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- Le journal est inaltérable, même pour l'administrateur
create or replace function public.audit_log_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'Le journal d''audit ne peut être ni modifié ni effacé';
end;
$$;
create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_immutable();

-- ---------------------------------------------------------------------
-- Comptes et profils
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.next_agent_code(p_prefix text)
returns text language plpgsql security definer set search_path = public as $$
declare v_seq int;
begin
  insert into agent_counters (prefix, last_seq) values (p_prefix, 1)
  on conflict (prefix) do update set last_seq = agent_counters.last_seq + 1
  returning last_seq into v_seq;
  return p_prefix || '-' || lpad(v_seq::text, 4, '0');
end;
$$;

-- ADM ou CHF : rôles, bureau, certifications, taux, activation
create or replace function public.admin_set_profile(
  p_user uuid, p_full_name text, p_roles public.app_role[], p_office char(3),
  p_certified text[], p_hourly_rate numeric, p_active boolean
) returns public.profiles language plpgsql security definer set search_path = public as $$
declare v public.profiles;
begin
  perform require_role(array['ADM', 'CHF']::app_role[]);
  if p_user = auth.uid() and not ('ADM' = any (p_roles) or 'CHF' = any (p_roles)) then
    raise exception 'Vous ne pouvez pas retirer vos propres droits d''administration';
  end if;
  perform set_audit_context('profil modifié');
  update profiles set
    full_name = coalesce(nullif(p_full_name, ''), full_name),
    roles = coalesce(p_roles, roles),
    office_code = p_office,
    certified_programs = coalesce(p_certified, '{}'),
    hourly_rate = p_hourly_rate,
    active = coalesce(p_active, active),
    agent_code = case
      when agent_code is null and cardinality(coalesce(p_roles, '{}')) > 0
      then next_agent_code(p_roles[1]::text) else agent_code end
  where id = p_user
  returning * into v;
  if not found then raise exception 'Profil introuvable'; end if;
  return v;
end;
$$;

-- L'agent choisit son moyen et sa périodicité de paiement ; l'ADM confirme
create or replace function public.update_my_payment(p_method text, p_frequency text, p_details text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(p_method), '') = '' or coalesce(trim(p_frequency), '') = '' or coalesce(trim(p_details), '') = '' then
    raise exception 'Moyen, fréquence et coordonnées sont obligatoires';
  end if;
  perform set_audit_context('coordonnées de paiement modifiées (à confirmer)');
  insert into agent_payments (agent_id, method, frequency, details, pending, updated_at)
  values (auth.uid(), trim(p_method), trim(p_frequency), trim(p_details), true, now())
  on conflict (agent_id) do update set method = excluded.method, frequency = excluded.frequency,
    details = excluded.details, pending = true, updated_at = now();
end;
$$;

create or replace function public.approve_payment(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role(array['ADM']::app_role[]);
  perform set_audit_context('coordonnées de paiement confirmées');
  update agent_payments set pending = false where agent_id = p_user;
end;
$$;

-- ---------------------------------------------------------------------
-- Clients et dossiers
-- ---------------------------------------------------------------------
create or replace function public.create_client(
  p_first_name text, p_last_name text, p_birth_date date, p_email text,
  p_phone text, p_country char(2), p_office char(3) default null
) returns public.clients language plpgsql security definer set search_path = public as $$
declare
  v_year int := extract(year from now() at time zone 'UTC');
  v_seq int; v_office char(3); v public.clients;
begin
  perform require_role(array['GBR', 'COL', 'CHF', 'ADM']::app_role[]);
  v_office := coalesce(p_office, my_office());
  if v_office is null then raise exception 'Bureau requis'; end if;
  if not (has_role('CHF') or has_role('ADM')) and v_office <> my_office() then
    raise exception 'Vous ne pouvez créer des clients que pour votre bureau';
  end if;
  insert into client_counters (year, last_seq) values (v_year, 1)
  on conflict (year) do update set last_seq = client_counters.last_seq + 1
  returning last_seq into v_seq;
  perform set_audit_context('client créé');
  insert into clients (client_code, first_name, last_name, birth_date, email, phone, country_iso, office_code, created_by)
  values ('CL-' || v_year || '-' || lpad(v_seq::text, 6, '0'), trim(p_first_name), upper(trim(p_last_name)),
          p_birth_date, nullif(trim(p_email), ''), nullif(trim(p_phone), ''), nullif(upper(p_country), ''),
          v_office, auth.uid())
  returning * into v;
  return v;
end;
$$;

-- Changement de statut interne : journalise, arrête les chronomètres, compte les renvois
create or replace function public._set_status(p_dossier uuid, p_to smallint, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_from smallint;
  v_timer_open boolean;
begin
  select status into v_from from dossiers where id = p_dossier for update;
  select timer_open into v_timer_open from dossier_statuses where code = p_to;

  -- le chronomètre ne tourne qu'aux statuts prévus : on arrête les sessions actives
  if not v_timer_open then
    perform set_audit_context('chronomètre arrêté (changement de statut)');
    update time_sessions set ended_at = least(now(), last_activity_at + interval '10 minutes'),
                             end_reason = 'changement_statut'
    where dossier_id = p_dossier and ended_at is null;
  end if;

  perform set_audit_context(format('statut %s → %s', lpad(v_from::text, 2, '0'), lpad(p_to::text, 2, '0')), p_reason);
  update dossiers set
    status = p_to,
    status_changed_at = now(),
    return_count = return_count + case when p_to in (55, 75) then 1 else 0 end,
    closed_at = case when p_to in (90, 99) then now() else closed_at end
  where id = p_dossier;
end;
$$;

-- L'utilisateur peut-il agir avec l'un de ces rôles sur ce dossier ?
create or replace function public._actor_can(d public.dossiers, rs public.app_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select
       ('CHF' = any (rs) and has_role('CHF'))
    or ('ADM' = any (rs) and has_role('ADM'))
    or ('GBR' = any (rs) and has_role('GBR') and d.office_code = my_office())
    or ('COL' = any (rs) and has_role('COL') and d.collector_id = auth.uid())
    or ('TRT' = any (rs) and has_role('TRT') and d.processor_id = auth.uid())
    or ('CTL' = any (rs) and has_role('CTL') and d.processor_id is distinct from auth.uid()
        and (d.controller_id = auth.uid() or (d.status = 40 and d.controller_id is null)));
$$;

-- Vérifie qu'une transition est permise et renvoie si un motif est exigé
create or replace function public._check_transition(d public.dossiers, p_to smallint, p_reason text)
returns void language plpgsql stable security definer set search_path = public as $$
declare t public.status_transitions;
begin
  select * into t from status_transitions where from_status = d.status and to_status = p_to;
  if not found then
    raise exception 'Transition interdite : % → %', d.status, p_to;
  end if;
  if not _actor_can(d, t.roles) then
    raise exception 'Vous ne pouvez pas faire passer ce dossier de % à % (rôle ou assignation)', d.status, p_to
      using errcode = '42501';
  end if;
  if t.reason_required and coalesce(trim(p_reason), '') = '' then
    raise exception 'Un motif est obligatoire pour cette transition';
  end if;
end;
$$;

create or replace function public.create_dossier(
  p_client uuid, p_program text, p_collector uuid, p_office char(3) default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_client public.clients;
  v_prog public.programs;
  v_office char(3);
  v_year int := extract(year from now() at time zone 'UTC');
  v_seq int; v_base text; v_id uuid;
begin
  perform require_role(array['GBR', 'CHF', 'ADM']::app_role[]);
  select * into v_client from clients where id = p_client;
  if not found then raise exception 'Client introuvable'; end if;
  v_office := coalesce(p_office, v_client.office_code);
  if not (has_role('CHF') or has_role('ADM')) and v_office <> my_office() then
    raise exception 'Vous ne pouvez ouvrir des dossiers que pour votre bureau';
  end if;

  select * into v_prog from programs where code = p_program;
  if not found then raise exception 'Programme inconnu : %', p_program; end if;
  if (v_prog.opened_on is not null and v_prog.opened_on > current_date)
     or (v_prog.closed_on is not null and v_prog.closed_on <= current_date) then
    raise exception 'Le programme % n''est pas ouvert', p_program;
  end if;

  if not exists (select 1 from profiles where id = p_collector and active and 'COL' = any (roles)) then
    raise exception 'L''agent de collecte choisi n''a pas le rôle COL';
  end if;

  insert into dossier_counters (office_code, year, last_seq) values (v_office, v_year, 1)
  on conflict (office_code, year) do update set last_seq = dossier_counters.last_seq + 1
  returning last_seq into v_seq;
  v_base := 'BC-' || v_office || '-' || v_year || '-' || lpad(v_seq::text, 5, '0');

  perform set_audit_context('dossier ouvert');
  insert into dossiers (number, base_number, office_code, year, seq, program_code, client_id, status, collector_id, opened_by)
  values (v_base || '-' || p_program, v_base, v_office, v_year, v_seq, p_program, p_client, 0, p_collector, auth.uid())
  returning id into v_id;

  perform set_audit_context('membre ajouté');
  insert into dossier_members (dossier_id, person_code, first_name, last_name, birth_date)
  values (v_id, 'P', v_client.first_name, v_client.last_name, v_client.birth_date);

  perform _set_status(v_id, 10::smallint, 'agent de collecte assigné à l''ouverture');
  return v_id;
end;
$$;

create or replace function public.add_member(
  p_dossier uuid, p_person_code text, p_first_name text, p_last_name text,
  p_birth_date date, p_accompanying boolean default true
) returns void language plpgsql security definer set search_path = public as $$
declare d public.dossiers;
begin
  select * into d from dossiers where id = p_dossier;
  if not found then raise exception 'Dossier introuvable'; end if;
  if not _actor_can(d, array['COL', 'TRT', 'GBR', 'CHF', 'ADM']::app_role[]) then
    raise exception 'Action non autorisée sur ce dossier' using errcode = '42501';
  end if;
  if d.status >= 40 then raise exception 'On ne peut plus ajouter de membre à partir du contrôle'; end if;
  perform set_audit_context('membre ajouté');
  insert into dossier_members (dossier_id, person_code, first_name, last_name, birth_date, accompanying)
  values (p_dossier, upper(p_person_code), trim(p_first_name), upper(trim(p_last_name)), p_birth_date, coalesce(p_accompanying, true));
end;
$$;

-- Pièces obligatoires manquantes (socle commun + programme)
create or replace function public.missing_documents(p_dossier uuid)
returns table (person_code text, type_code text, type_label text)
language sql stable security definer set search_path = public as $$
  select m.person_code, r.type_code, t.label
  from dossiers d
  join required_documents r on (r.program_code is null or r.program_code = d.program_code)
  join dossier_members m on m.dossier_id = d.id and (r.person_scope = 'ALL' or m.person_code = 'P')
  join document_types t on t.code = r.type_code
  where d.id = p_dossier
    and not exists (
      select 1 from documents doc
      where doc.dossier_id = d.id and doc.person_code = m.person_code
        and doc.type_code = r.type_code and doc.is_current and doc.validation_status = 'valide'
    )
  order by m.person_code, r.type_code;
$$;

-- Transitions simples. Les autres passent par des fonctions dédiées :
-- 15 → 20 assign_dossier · → 40 et 50 → 55/60 submit_review · 70 → 80 submit_dossier
create or replace function public.transition_dossier(p_dossier uuid, p_to smallint, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  d public.dossiers;
  v_missing int;
begin
  select * into d from dossiers where id = p_dossier for update;
  if not found then raise exception 'Dossier introuvable'; end if;

  if p_to = 20 or p_to = 40 or p_to = 80 or (d.status = 50 and p_to in (55, 60)) then
    raise exception 'Cette étape se fait par l''action dédiée (assignation, liste de contrôle ou soumission)';
  end if;

  perform _check_transition(d, p_to, p_reason);

  if d.status = 10 and p_to = 15 then
    select count(*) into v_missing from missing_documents(p_dossier);
    if v_missing > 0 then
      raise exception 'Collecte incomplète : % pièce(s) obligatoire(s) manquante(s)', v_missing;
    end if;
  end if;

  if p_to = 50 then
    perform set_audit_context('contrôleur assigné (prise en charge)');
    update dossiers set controller_id = auth.uid() where id = p_dossier;
  end if;

  if p_to = 90 then
    perform set_audit_context('décision enregistrée', p_reason);
    update dossiers set decision = p_reason where id = p_dossier;
  end if;

  perform _set_status(p_dossier, p_to, p_reason);
end;
$$;

-- Assignation et réassignation (motif obligatoire pour une réassignation)
create or replace function public.assign_dossier(p_dossier uuid, p_role public.app_role, p_agent uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  d public.dossiers;
  a public.profiles;
begin
  select * into d from dossiers where id = p_dossier for update;
  if not found then raise exception 'Dossier introuvable'; end if;
  if not _actor_can(d, array['GBR', 'CHF', 'ADM']::app_role[]) then
    raise exception 'Seul le gestionnaire du bureau ou le chef peut assigner' using errcode = '42501';
  end if;
  if d.status in (80, 90, 99) then raise exception 'Dossier soumis ou fermé'; end if;

  select * into a from profiles where id = p_agent and active;
  if not found or not (p_role = any (a.roles)) then
    raise exception 'Cet agent n''a pas le rôle %', p_role;
  end if;

  if p_role = 'COL' then
    if d.collector_id is not null and coalesce(trim(p_reason), '') = '' then
      raise exception 'Motif obligatoire pour une réassignation';
    end if;
    perform set_audit_context('agent de collecte assigné', p_reason);
    update dossiers set collector_id = p_agent where id = p_dossier;

  elsif p_role = 'TRT' then
    if not (d.program_code = any (a.certified_programs) or '*' = any (a.certified_programs)) then
      raise exception 'Agent non certifié pour le programme %', d.program_code;
    end if;
    if p_agent = d.controller_id then
      raise exception 'Le traitant ne peut pas être le contrôleur de ce dossier';
    end if;
    if d.status = 15 then
      perform set_audit_context('agent de traitement assigné', p_reason);
      update dossiers set processor_id = p_agent where id = p_dossier;
      perform _set_status(p_dossier, 20::smallint, p_reason);
    elsif d.status < 15 then
      raise exception 'La collecte doit être complète (statut 15) avant d''assigner un traitant';
    else
      if coalesce(trim(p_reason), '') = '' then raise exception 'Motif obligatoire pour une réassignation'; end if;
      perform set_audit_context('chronomètre arrêté (réassignation)');
      update time_sessions set ended_at = now(), end_reason = 'changement_statut'
      where dossier_id = p_dossier and ended_at is null;
      perform set_audit_context('agent de traitement réassigné', p_reason);
      update dossiers set processor_id = p_agent where id = p_dossier;
    end if;

  elsif p_role = 'CTL' then
    if p_agent = d.processor_id then
      raise exception 'Le contrôleur ne peut pas être la personne qui a traité le dossier';
    end if;
    if coalesce(trim(p_reason), '') = '' then raise exception 'Motif obligatoire'; end if;
    perform set_audit_context('contrôleur assigné', p_reason);
    update dossiers set controller_id = p_agent where id = p_dossier;
  else
    raise exception 'Rôle d''assignation invalide : %', p_role;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Pièces
-- Étape 1 : register_document crée la fiche et renvoie le nom et le chemin
--           générés selon la nomenclature.
-- Étape 2 : l'application dépose le fichier à ce chemin dans le stockage
--           (la politique de stockage n'accepte que les chemins enregistrés).
-- ---------------------------------------------------------------------
create or replace function public.register_document(
  p_dossier uuid, p_person_code text, p_type text, p_extension text,
  p_mime text default null, p_size bigint default null,
  p_issued_on date default null, p_expires_on date default null
) returns table (id uuid, file_name text, storage_path text)
language plpgsql security definer set search_path = public as $$
declare
  d public.dossiers;
  t public.document_types;
  c public.document_categories;
  v_version int;
  v_ext text := lower(trim(both '.' from coalesce(p_extension, '')));
  v_name text; v_path text; v_id uuid;
begin
  select * into d from dossiers where dossiers.id = p_dossier;
  if not found then raise exception 'Dossier introuvable'; end if;
  if d.status in (90, 99) then raise exception 'Dossier fermé : lecture seule'; end if;
  if d.status = 80 and not has_role('CHF') then raise exception 'Dossier soumis : seul le chef peut ajouter une pièce'; end if;
  if not _actor_can(d, array['COL', 'TRT', 'GBR', 'CHF', 'ADM']::app_role[]) then
    raise exception 'Action non autorisée sur ce dossier' using errcode = '42501';
  end if;
  if v_ext !~ '^[a-z0-9]{2,5}$' then raise exception 'Extension de fichier invalide'; end if;

  select * into t from document_types where code = p_type and active;
  if not found then raise exception 'Type de pièce inconnu : %', p_type; end if;
  select * into c from document_categories where code = t.category_code;
  if not exists (select 1 from dossier_members where dossier_id = p_dossier and person_code = p_person_code) then
    raise exception 'Personne % absente du dossier', p_person_code;
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from documents where dossier_id = p_dossier and person_code = p_person_code and type_code = p_type;

  v_name := d.base_number || '_' || p_person_code || '_' || t.category_code || '_' || t.code || '_'
            || to_char(now() at time zone 'UTC', 'YYYYMMDD') || '_v' || lpad(v_version::text, 2, '0') || '.' || v_ext;
  v_path := d.number || '/' || c.folder || '/' || v_name;

  perform set_audit_context('ancienne version remplacée');
  update documents set is_current = false
  where dossier_id = p_dossier and person_code = p_person_code and type_code = p_type and is_current;

  perform set_audit_context('pièce ajoutée');
  insert into documents (dossier_id, person_code, category_code, type_code, version, file_name, storage_path,
                         mime_type, size_bytes, issued_on, expires_on, uploaded_by)
  values (p_dossier, p_person_code, t.category_code, t.code, v_version, v_name, v_path,
          p_mime, p_size, p_issued_on, p_expires_on, auth.uid())
  returning documents.id into v_id;

  return query select v_id, v_name, v_path;
end;
$$;

-- Annule une fiche dont le dépôt du fichier a échoué (15 minutes max, par son auteur)
create or replace function public.discard_document(p_document uuid)
returns void language plpgsql security definer set search_path = public as $$
declare doc public.documents;
begin
  select * into doc from documents where id = p_document;
  if not found then return; end if;
  if doc.uploaded_by <> auth.uid() or doc.uploaded_at < now() - interval '15 minutes' then
    raise exception 'Annulation impossible';
  end if;
  perform set_audit_context('pièce annulée (échec du dépôt)');
  delete from documents where id = p_document;
  perform set_audit_context('version précédente rétablie');
  update documents set is_current = true
  where id = (select id from documents where dossier_id = doc.dossier_id and person_code = doc.person_code
              and type_code = doc.type_code order by version desc limit 1);
end;
$$;

-- Consultation et téléchargement sont journalisés
create or replace function public.log_document_access(p_document uuid, p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare doc public.documents;
begin
  select * into doc from documents where id = p_document;
  if not found or not can_view_dossier(doc.dossier_id) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if p_action not in ('consultation', 'telechargement') then raise exception 'Action invalide'; end if;
  perform write_audit(doc.dossier_id, 'pièce ' || p_action, 'documents', doc.id::text, null,
                      jsonb_build_object('file_name', doc.file_name), null);
end;
$$;

-- ---------------------------------------------------------------------
-- Contrôle qualité
-- p_answers : [{"item_id": 1, "answer": "conforme", "comment": "..."}]
-- ---------------------------------------------------------------------
create or replace function public.submit_review(
  p_dossier uuid, p_level text, p_answers jsonb,
  p_comment text default null, p_reason_codes text[] default '{}'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  d public.dossiers;
  v_review uuid;
  v_expected int; v_given int; v_bad int;
  v_returns int; v_return_code text;
  v_bad_reason text;
begin
  select * into d from dossiers where id = p_dossier for update;
  if not found then raise exception 'Dossier introuvable'; end if;

  if p_level = 'auto' then
    if d.status not in (30, 55, 75) then raise exception 'L''auto-vérification se fait aux statuts 30, 55 ou 75'; end if;
  elsif p_level = 'controle' then
    if d.status <> 50 then raise exception 'Le contrôle se fait au statut 50'; end if;
  else
    raise exception 'Niveau de revue invalide';
  end if;

  -- toutes les questions applicables doivent avoir une réponse valide
  select count(*) into v_expected from checklist_items
  where level = p_level and active and (program_code is null or program_code = d.program_code);
  select count(distinct (a ->> 'item_id')::bigint),
         count(*) filter (where a ->> 'answer' = 'non_conforme')
    into v_given, v_bad
  from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) a
  join checklist_items i on i.id = (a ->> 'item_id')::bigint
   and i.level = p_level and i.active and (i.program_code is null or i.program_code = d.program_code)
  where a ->> 'answer' in ('conforme', 'non_conforme', 'sans_objet');
  if v_given < v_expected then
    raise exception 'Liste de contrôle incomplète : % réponse(s) sur %', v_given, v_expected;
  end if;

  if p_level = 'auto' then
    perform _check_transition(d, 40::smallint, null);
    if v_bad > 0 then raise exception 'Corrigez les points non conformes avant de soumettre au contrôle'; end if;
    perform set_audit_context('auto-vérification');
    insert into reviews (dossier_id, level, reviewer_id, result, comment)
    values (p_dossier, 'auto', auth.uid(), 'accepte', p_comment) returning id into v_review;
  else
    if v_bad > 0 then
      perform _check_transition(d, 55::smallint, 'renvoi');
      if cardinality(coalesce(p_reason_codes, '{}')) = 0 then
        raise exception 'Choisissez au moins un motif de renvoi';
      end if;
      select string_agg(x, ', ') into v_bad_reason from unnest(p_reason_codes) x
      where x not in (select code from return_reasons);
      if v_bad_reason is not null then raise exception 'Motif de renvoi inconnu : %', v_bad_reason; end if;
      if coalesce(trim(p_comment), '') = '' then raise exception 'Un commentaire est obligatoire pour un renvoi'; end if;
      select count(*) into v_returns from reviews where dossier_id = p_dossier and result = 'renvoye';
      v_return_code := d.number || '-R' || lpad((v_returns + 1)::text, 2, '0');
    else
      perform _check_transition(d, 60::smallint, null);
    end if;
    perform set_audit_context(case when v_bad > 0 then 'contrôle : renvoi ' || v_return_code else 'contrôle : accepté' end, p_comment);
    insert into reviews (dossier_id, level, reviewer_id, result, return_code, reason_codes, comment)
    values (p_dossier, 'controle', auth.uid(), case when v_bad > 0 then 'renvoye' else 'accepte' end,
            v_return_code, coalesce(p_reason_codes, '{}'), p_comment)
    returning id into v_review;
  end if;

  insert into review_answers (review_id, item_id, answer, comment)
  select v_review, (a ->> 'item_id')::bigint, a ->> 'answer', nullif(a ->> 'comment', '')
  from jsonb_array_elements(p_answers) a
  join checklist_items i on i.id = (a ->> 'item_id')::bigint and i.level = p_level
  on conflict do nothing;

  if p_level = 'auto' then
    perform _set_status(p_dossier, 40::smallint, null);
  elsif v_bad > 0 then
    perform _set_status(p_dossier, 55::smallint, v_return_code || ' : ' || p_comment);
  else
    perform _set_status(p_dossier, 60::smallint, null);
  end if;
  return v_review;
end;
$$;

-- Soumission par le chef du cabinet uniquement (aucune délégation)
create or replace function public.submit_dossier(p_dossier uuid, p_submission_number text)
returns void language plpgsql security definer set search_path = public as $$
declare d public.dossiers;
begin
  select * into d from dossiers where id = p_dossier for update;
  if not found then raise exception 'Dossier introuvable'; end if;
  perform _check_transition(d, 80::smallint, null);
  if coalesce(trim(p_submission_number), '') = '' then
    raise exception 'Le numéro de demande (accusé de réception) est obligatoire';
  end if;
  perform set_audit_context('numéro de demande enregistré');
  update dossiers set submission_number = trim(p_submission_number), submitted_at = now() where id = p_dossier;
  perform _set_status(p_dossier, 80::smallint, 'soumis : ' || trim(p_submission_number));
end;
$$;

-- ---------------------------------------------------------------------
-- Chronomètre (agents de traitement)
-- Pause automatique après 10 minutes sans activité (heartbeat de l'application)
-- ---------------------------------------------------------------------
create or replace function public._close_stale_sessions(p_agent uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from time_sessions where agent_id = p_agent and ended_at is null
             and last_activity_at < now() - interval '10 minutes') then
    perform set_audit_context('chronomètre arrêté (inactivité)');
    update time_sessions set ended_at = last_activity_at, end_reason = 'inactivite'
    where agent_id = p_agent and ended_at is null and last_activity_at < now() - interval '10 minutes';
  end if;
end;
$$;

create or replace function public.start_timer(p_dossier uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  d public.dossiers;
  s public.dossier_statuses;
  v_id uuid;
begin
  select * into d from dossiers where id = p_dossier;
  if not found then raise exception 'Dossier introuvable'; end if;
  if d.processor_id is distinct from auth.uid() or not has_role('TRT') then
    raise exception 'Seul l''agent de traitement assigné peut démarrer le chronomètre';
  end if;
  select * into s from dossier_statuses where code = d.status;
  if not s.timer_open then
    raise exception 'Le chronomètre ne fonctionne pas au statut % (%)', d.status, s.label;
  end if;
  perform _close_stale_sessions(auth.uid());
  if exists (select 1 from time_sessions where agent_id = auth.uid() and ended_at is null) then
    raise exception 'Une session est déjà active : arrêtez-la d''abord';
  end if;
  perform set_audit_context('chronomètre démarré');
  insert into time_sessions (dossier_id, agent_id, status_at_start, billable)
  values (p_dossier, auth.uid(), d.status, s.billable)
  returning id into v_id;
  return v_id;
end;
$$;

-- Appelé régulièrement par l'application tant que l'agent est actif.
-- Renvoie false si la session a été arrêtée pour inactivité.
create or replace function public.timer_heartbeat()
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform _close_stale_sessions(auth.uid());
  update time_sessions set last_activity_at = now()
  where agent_id = auth.uid() and ended_at is null;
  return found;
end;
$$;

create or replace function public.stop_timer()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _close_stale_sessions(auth.uid());
  perform set_audit_context('chronomètre arrêté');
  update time_sessions set ended_at = now(), end_reason = 'arret'
  where agent_id = auth.uid() and ended_at is null;
end;
$$;

-- Correction d'une session (oubli d'arrêt, etc.) : par le gestionnaire, avec motif
create or replace function public.correct_session(p_session uuid, p_started timestamptz, p_ended timestamptz, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare d public.dossiers;
begin
  select dos.* into d from dossiers dos join time_sessions t on t.dossier_id = dos.id where t.id = p_session;
  if not found then raise exception 'Session introuvable'; end if;
  if not _actor_can(d, array['GBR', 'ADM']::app_role[]) then
    raise exception 'Seul le gestionnaire ou l''administrateur corrige une session' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Motif obligatoire'; end if;
  if p_ended is null or p_ended < p_started or p_ended > now() then raise exception 'Heures invalides'; end if;
  perform set_audit_context('session de temps corrigée', p_reason);
  update time_sessions set started_at = p_started, ended_at = p_ended, end_reason = 'correction',
         corrected = true, correction_reason = p_reason, correction_approved_by = auth.uid(), validated = false
  where id = p_session;
end;
$$;

-- Validation des heures d'un dossier : après acceptation au contrôle (statut ≥ 60)
create or replace function public.validate_hours(p_dossier uuid)
returns int language plpgsql security definer set search_path = public as $$
declare d public.dossiers; v_count int;
begin
  select * into d from dossiers where id = p_dossier;
  if not found then raise exception 'Dossier introuvable'; end if;
  if not _actor_can(d, array['GBR', 'CHF', 'ADM']::app_role[]) then
    raise exception 'Seul le gestionnaire valide les heures' using errcode = '42501';
  end if;
  if d.status < 60 or d.status = 99 then
    raise exception 'Les heures se valident après acceptation au contrôle (statut 60)';
  end if;
  perform set_audit_context('heures validées');
  update time_sessions set validated = true, validated_by = auth.uid(), validated_at = now()
  where dossier_id = p_dossier and ended_at is not null and billable and not validated;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- Vues de lecture
-- ---------------------------------------------------------------------
-- Annuaire sans données de paie (visible de tous les membres du personnel)
create or replace view public.staff_directory as
  select id, full_name, email, agent_code, roles, office_code, certified_programs, active
  from public.profiles;

-- Heures par agent, dossier et période (base du relevé de paie)
create or replace view public.time_summary with (security_invoker = true) as
  select t.agent_id, p.agent_code, p.full_name, t.dossier_id, d.number,
         date_trunc('month', t.started_at) as month,
         round(sum(extract(epoch from (t.ended_at - t.started_at))) filter (where t.billable) / 3600.0, 2) as billable_hours,
         round(sum(extract(epoch from (t.ended_at - t.started_at))) filter (where t.billable and t.validated) / 3600.0, 2) as validated_hours,
         round(sum(extract(epoch from (t.ended_at - t.started_at))) filter (where not t.billable) / 3600.0, 2) as unpaid_hours,
         p.hourly_rate
  from public.time_sessions t
  join public.profiles p on p.id = t.agent_id
  join public.dossiers d on d.id = t.dossier_id
  where t.ended_at is not null
  group by t.agent_id, p.agent_code, p.full_name, t.dossier_id, d.number, date_trunc('month', t.started_at), p.hourly_rate;
