-- Installation complète en une fois (SQL Editor de Supabase) : concaténation des migrations.
-- À exécuter UNE seule fois, sur un projet vide.

-- >>> supabase/migrations/0001_schema.sql
-- =====================================================================
-- BalCanis — Plateforme de gestion des dossiers
-- 0001 : schéma (tables, contraintes, index)
-- Toutes les écritures passent par des fonctions (0002) ; les tables
-- ne sont lisibles que selon les politiques RLS (0003).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Rôles applicatifs (voir « Acteurs et rôles » du cadrage)
--   CHF chef du cabinet · GBR gestionnaire de bureau · COL agent de collecte
--   TRT agent de traitement · CTL contrôleur · ADM administrateur/formateur
-- ---------------------------------------------------------------------
create type public.app_role as enum ('CHF', 'GBR', 'COL', 'TRT', 'CTL', 'ADM');

-- ---------------------------------------------------------------------
-- Référentiels
-- ---------------------------------------------------------------------
create table public.offices (
  code         char(3) primary key check (code ~ '^[A-Z]{3}$'),
  name         text not null,
  country_iso  char(2) not null check (country_iso ~ '^[A-Z]{2}$'),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table public.programs (
  code             text primary key check (code ~ '^[A-Z]{2,4}(-[A-Z]{2,5})?$'),
  family           text not null,
  name             text not null,
  authority        text not null,
  reference_hours  numeric(5,2),          -- temps de référence (barème), à fixer
  opened_on        date,
  closed_on        date,
  created_at       timestamptz not null default now()
);

create table public.dossier_statuses (
  code        smallint primary key,
  label       text not null,
  timer_open  boolean not null default false,  -- le chronomètre peut tourner
  billable    boolean not null default false,  -- le temps est payé
  closed      boolean not null default false
);

create table public.status_transitions (
  from_status      smallint not null references public.dossier_statuses(code),
  to_status        smallint not null references public.dossier_statuses(code),
  roles            public.app_role[] not null,
  reason_required  boolean not null default false,
  primary key (from_status, to_status)
);

create table public.return_reasons (
  code   text primary key,
  label  text not null
);

create table public.document_categories (
  code    char(2) primary key check (code ~ '^[0-9]{2}$'),
  folder  text not null unique,
  label   text not null
);

create table public.document_types (
  code           text primary key check (code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'),
  label          text not null,
  category_code  char(2) not null references public.document_categories(code),
  active         boolean not null default true
);

-- Pièces obligatoires : program_code null = socle commun à tous les programmes
-- person_scope : 'P' = demandeur principal seulement, 'ALL' = chaque personne
create table public.required_documents (
  id            bigint generated always as identity primary key,
  program_code  text references public.programs(code),
  type_code     text not null references public.document_types(code),
  person_scope  text not null default 'ALL' check (person_scope in ('P', 'ALL')),
  unique nulls not distinct (program_code, type_code, person_scope)
);

-- Listes de contrôle : level 'auto' (agent de traitement) ou 'controle' (contrôleur)
create table public.checklist_items (
  id            bigint generated always as identity primary key,
  level         text not null check (level in ('auto', 'controle')),
  program_code  text references public.programs(code),
  label         text not null,
  sort          int not null default 0,
  active        boolean not null default true
);

-- ---------------------------------------------------------------------
-- Personnes
-- ---------------------------------------------------------------------
create table public.profiles (
  id                   uuid primary key references auth.users(id) on delete restrict,
  email                text not null,
  full_name            text not null default '',
  agent_code           text unique,                    -- ex. TRT-0031
  roles                public.app_role[] not null default '{}',
  office_code          char(3) references public.offices(code),
  certified_programs   text[] not null default '{}',   -- programmes certifiés (TRT)
  hourly_rate          numeric(8,2),
  timezone             text not null default 'Africa/Kinshasa',
  active               boolean not null default true,
  created_at           timestamptz not null default now()
);

-- Coordonnées de paiement : visibles seulement par l'agent et l'administrateur
create table public.agent_payments (
  agent_id    uuid primary key references public.profiles(id),
  method      text not null,
  frequency   text not null,
  details     text not null,
  pending     boolean not null default true,  -- changement à confirmer par ADM
  updated_at  timestamptz not null default now()
);

create table public.agent_counters (
  prefix    text primary key,
  last_seq  int not null default 0
);

create table public.clients (
  id               uuid primary key default gen_random_uuid(),
  client_code      text not null unique check (client_code ~ '^CL-[0-9]{4}-[0-9]{6}$'),
  first_name       text not null,
  last_name        text not null,
  birth_date       date,
  email            text,
  phone            text,
  country_iso      char(2),
  office_code      char(3) not null references public.offices(code),
  user_id          uuid references auth.users(id),   -- portail client (phase 2)
  created_by       uuid references public.profiles(id),
  created_at       timestamptz not null default now()
);

create table public.client_counters (
  year      int primary key,
  last_seq  int not null default 0
);

-- ---------------------------------------------------------------------
-- Dossiers
-- ---------------------------------------------------------------------
create table public.dossier_counters (
  office_code  char(3) not null references public.offices(code),
  year         int not null,
  last_seq     int not null default 0,
  primary key (office_code, year)
);

create table public.dossiers (
  id                 uuid primary key default gen_random_uuid(),
  number             text not null unique,   -- BC-KIN-2026-00042-PE
  base_number        text not null unique,   -- BC-KIN-2026-00042 (sert au nommage des fichiers)
  office_code        char(3) not null references public.offices(code),
  year               int not null,
  seq                int not null,
  program_code       text not null references public.programs(code),
  client_id          uuid not null references public.clients(id),
  status             smallint not null default 0 references public.dossier_statuses(code),
  status_changed_at  timestamptz not null default now(),
  collector_id       uuid references public.profiles(id),
  processor_id       uuid references public.profiles(id),
  controller_id      uuid references public.profiles(id),
  opened_by          uuid references public.profiles(id),
  opened_at          timestamptz not null default now(),
  return_count       int not null default 0,
  submission_number  text,
  submitted_at       timestamptz,
  decision           text,
  closed_at          timestamptz,
  unique (office_code, year, seq),
  -- séparation des tâches : le contrôleur n'est jamais le traitant
  constraint controller_not_processor check (controller_id is null or controller_id <> processor_id)
);
create index on public.dossiers (status);
create index on public.dossiers (processor_id);
create index on public.dossiers (controller_id);
create index on public.dossiers (collector_id);

create table public.dossier_members (
  id           uuid primary key default gen_random_uuid(),
  dossier_id   uuid not null references public.dossiers(id),
  person_code  text not null check (person_code ~ '^(P|C|G|E[1-9][0-9]?)$'),
  first_name   text not null,
  last_name    text not null,
  birth_date   date,
  accompanying boolean not null default true,
  unique (dossier_id, person_code)
);

create table public.documents (
  id                 uuid primary key default gen_random_uuid(),
  dossier_id         uuid not null references public.dossiers(id),
  person_code        text not null,
  category_code      char(2) not null references public.document_categories(code),
  type_code          text not null references public.document_types(code),
  version            int not null,
  file_name          text not null unique,  -- nom généré par le système
  storage_path       text not null unique,  -- DOSSIER/NN_DOSSIER/fichier
  mime_type          text,
  size_bytes         bigint,
  is_current         boolean not null default true,
  source             text not null default 'agent' check (source in ('agent', 'client')),
  validation_status  text not null default 'valide' check (validation_status in ('a_valider', 'valide', 'rejete')),
  issued_on          date,
  expires_on         date,
  uploaded_by        uuid references public.profiles(id),
  uploaded_at        timestamptz not null default now(),
  unique (dossier_id, person_code, type_code, version),
  foreign key (dossier_id, person_code) references public.dossier_members(dossier_id, person_code)
);
create index on public.documents (dossier_id);

-- ---------------------------------------------------------------------
-- Contrôle qualité
-- ---------------------------------------------------------------------
create table public.reviews (
  id            uuid primary key default gen_random_uuid(),
  dossier_id    uuid not null references public.dossiers(id),
  level         text not null check (level in ('auto', 'controle', 'validation')),
  reviewer_id   uuid not null references public.profiles(id),
  result        text not null check (result in ('accepte', 'renvoye')),
  return_code   text,                 -- BC-KIN-2026-00042-PE-R02
  reason_codes  text[] not null default '{}',
  comment       text,
  created_at    timestamptz not null default now()
);
create index on public.reviews (dossier_id);

create table public.review_answers (
  review_id  uuid not null references public.reviews(id),
  item_id    bigint not null references public.checklist_items(id),
  answer     text not null check (answer in ('conforme', 'non_conforme', 'sans_objet')),
  comment    text,
  primary key (review_id, item_id)
);

-- ---------------------------------------------------------------------
-- Temps (agents de traitement payés à l'heure)
-- ---------------------------------------------------------------------
create table public.time_sessions (
  id                 uuid primary key default gen_random_uuid(),
  dossier_id         uuid not null references public.dossiers(id),
  agent_id           uuid not null references public.profiles(id),
  status_at_start    smallint not null references public.dossier_statuses(code),
  billable           boolean not null,
  started_at         timestamptz not null default now(),
  last_activity_at   timestamptz not null default now(),
  ended_at           timestamptz,
  end_reason         text check (end_reason in ('arret', 'inactivite', 'changement_statut', 'correction')),
  corrected          boolean not null default false,
  correction_reason  text,
  correction_approved_by uuid references public.profiles(id),
  validated          boolean not null default false,
  validated_by       uuid references public.profiles(id),
  validated_at       timestamptz,
  check (ended_at is null or ended_at >= started_at)
);
-- une seule session active par agent
create unique index one_active_session_per_agent on public.time_sessions (agent_id) where ended_at is null;
create index on public.time_sessions (dossier_id);

-- ---------------------------------------------------------------------
-- Journal d'audit (inaltérable : voir triggers en 0002)
-- ---------------------------------------------------------------------
create table public.audit_log (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  actor_id     uuid,
  actor_code   text,
  actor_roles  public.app_role[],
  dossier_id   uuid,
  action       text not null,
  object_type  text not null,
  object_id    text,
  before       jsonb,
  after        jsonb,
  reason       text
);
create index on public.audit_log (dossier_id, created_at);
create index on public.audit_log (actor_id, created_at);

-- >>> supabase/migrations/0002_functions.sql
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

-- >>> supabase/migrations/0003_rls.sql
-- =====================================================================
-- 0003 : sécurité au niveau des lignes (RLS)
-- Lecture seulement, selon le rôle et l'assignation.
-- Aucune politique d'écriture : tout passe par les fonctions de 0002.
-- =====================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'offices', 'programs', 'dossier_statuses', 'status_transitions', 'return_reasons',
    'document_categories', 'document_types', 'required_documents', 'checklist_items',
    'profiles', 'agent_payments', 'agent_counters', 'clients', 'client_counters', 'dossier_counters',
    'dossiers', 'dossier_members', 'documents', 'reviews', 'review_answers',
    'time_sessions', 'audit_log']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Rien n'est accessible sans connexion ; lecture (filtrée par RLS) une fois connecté
revoke all on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;
-- les fonctions internes ne sont pas appelables directement
revoke execute on function public._set_status(uuid, smallint, text) from authenticated;
revoke execute on function public._close_stale_sessions(uuid) from authenticated;
revoke execute on function public.write_audit(uuid, text, text, text, jsonb, jsonb, text) from authenticated;
revoke execute on function public.next_agent_code(text) from authenticated;

-- Référentiels : lisibles par tout utilisateur connecté
do $$
declare t text;
begin
  foreach t in array array[
    'offices', 'programs', 'dossier_statuses', 'status_transitions', 'return_reasons',
    'document_categories', 'document_types', 'required_documents', 'checklist_items']
  loop
    execute format('create policy "lecture référentiel" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

-- Profils : soi-même, ou CHF / ADM / GBR
create policy "profil : soi ou encadrement" on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_role('CHF') or public.has_role('ADM') or public.has_role('GBR'));

-- Coordonnées de paiement : l'agent lui-même et l'administrateur seulement
create policy "paiement : soi ou administrateur" on public.agent_payments for select to authenticated
  using (agent_id = auth.uid() or public.has_role('ADM'));

-- Annuaire sans taux ni coordonnées, pour tout le personnel actif
revoke all on public.staff_directory from anon, authenticated;
grant select on public.staff_directory to authenticated;

-- Clients : encadrement, bureau du gestionnaire ou de l'agent de collecte, ou dossier visible
create policy "clients visibles" on public.clients for select to authenticated
  using (
       public.has_role('CHF') or public.has_role('ADM')
    or ((public.has_role('GBR') or public.has_role('COL')) and office_code = public.my_office())
    or exists (select 1 from public.dossiers d where d.client_id = clients.id and public.can_view_dossier(d.id))
  );

create policy "dossiers visibles" on public.dossiers for select to authenticated
  using (public.can_view_dossier(id));

create policy "membres visibles" on public.dossier_members for select to authenticated
  using (public.can_view_dossier(dossier_id));

create policy "pièces visibles" on public.documents for select to authenticated
  using (public.can_view_dossier(dossier_id));

create policy "revues visibles" on public.reviews for select to authenticated
  using (public.can_view_dossier(dossier_id));

create policy "réponses visibles" on public.review_answers for select to authenticated
  using (exists (select 1 from public.reviews r where r.id = review_answers.review_id and public.can_view_dossier(r.dossier_id)));

-- Temps : ses propres sessions ; encadrement pour tout son périmètre
create policy "temps visibles" on public.time_sessions for select to authenticated
  using (
       agent_id = auth.uid()
    or public.has_role('CHF') or public.has_role('ADM')
    or (public.has_role('GBR') and public.can_view_dossier(dossier_id))
  );

-- Journal : encadrement, ou historique des dossiers que l'on peut voir
create policy "journal visible" on public.audit_log for select to authenticated
  using (
       public.has_role('CHF') or public.has_role('ADM')
    or (dossier_id is not null and public.can_view_dossier(dossier_id))
  );

-- >>> supabase/migrations/0004_storage.sql
-- =====================================================================
-- 0004 : stockage des fichiers (Supabase Storage)
-- Seau privé « dossiers ». Arborescence : NUMERO_DOSSIER/NN_DOSSIER/fichier
-- Un fichier ne peut être déposé qu'au chemin généré par register_document,
-- ce qui impose la nomenclature. Aucun remplacement ni suppression.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('dossiers', 'dossiers', false)
on conflict (id) do nothing;

create policy "dossiers : lecture si dossier visible" on storage.objects for select to authenticated
  using (bucket_id = 'dossiers' and public.can_view_dossier_number((storage.foldername(name))[1]));

create policy "dossiers : dépôt au chemin enregistré" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'dossiers'
    and exists (
      select 1 from public.documents doc
      where doc.storage_path = storage.objects.name
        and doc.uploaded_by = auth.uid()
        and doc.uploaded_at > now() - interval '15 minutes'
    )
  );

-- >>> supabase/migrations/0005_reference_data.sql
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

-- >>> supabase/migrations/0006_auto_assign_collector.sql
-- =====================================================================
-- 0006 : attribution automatique de l'agent de collecte
-- À l'ouverture d'un dossier, s'il n'est pas choisi à la main, l'agent est
-- celui du bureau qui est disponible et qui a le moins de dossiers en
-- collecte (statuts 10 et 35). À égalité : celui qui a reçu un dossier
-- le moins récemment.
-- =====================================================================

alter table public.profiles add column if not exists available boolean not null default true;

create or replace view public.staff_directory as
  select id, full_name, email, agent_code, roles, office_code, certified_programs, active, available
  from public.profiles;

-- Charge de chaque agent de collecte d'un bureau
create or replace function public.collector_loads(p_office char(3))
returns table (id uuid, agent_code text, full_name text, available boolean, open_count bigint, last_assigned timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.agent_code, p.full_name, p.available,
         (select count(*) from dossiers d where d.collector_id = p.id and d.status in (10, 35)),
         (select max(d.opened_at) from dossiers d where d.collector_id = p.id)
  from profiles p
  where p.active and 'COL' = any (p.roles) and p.office_code = p_office
  order by 4 desc, 5 asc, 6 asc nulls first, 2;
$$;

-- Disponibilité : l'agent lui-même, ou l'encadrement (gestionnaire du même bureau)
create or replace function public.set_availability(p_user uuid, p_available boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_target uuid := coalesce(p_user, auth.uid());
begin
  if v_target <> auth.uid() and not (
       has_role('ADM') or has_role('CHF')
    or (has_role('GBR') and (select office_code from profiles where id = v_target) = my_office())
  ) then
    raise exception 'Action non autorisée' using errcode = '42501';
  end if;
  perform set_audit_context(case when p_available then 'agent disponible' else 'agent indisponible' end);
  update profiles set available = coalesce(p_available, true) where id = v_target;
end;
$$;

drop function if exists public.create_dossier(uuid, text, uuid, char);

create function public.create_dossier(
  p_client uuid, p_program text, p_collector uuid default null, p_office char(3) default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_client public.clients;
  v_prog public.programs;
  v_office char(3);
  v_year int := extract(year from now() at time zone 'UTC');
  v_seq int; v_base text; v_id uuid;
  v_collector uuid := p_collector;
  v_load bigint;
  v_reason text;
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

  if v_collector is null then
    select l.id, l.open_count into v_collector, v_load
    from collector_loads(v_office) l
    where l.available
    limit 1;
    if v_collector is null then
      raise exception 'Aucun agent de collecte disponible au bureau %', v_office;
    end if;
    v_reason := format('attribution automatique : agent disponible le moins chargé (%s dossier(s) en collecte)', v_load);
  else
    if not exists (select 1 from profiles where id = v_collector and active and 'COL' = any (roles)) then
      raise exception 'L''agent de collecte choisi n''a pas le rôle COL';
    end if;
    v_reason := 'agent de collecte choisi à l''ouverture';
  end if;

  insert into dossier_counters (office_code, year, last_seq) values (v_office, v_year, 1)
  on conflict (office_code, year) do update set last_seq = dossier_counters.last_seq + 1
  returning last_seq into v_seq;
  v_base := 'BC-' || v_office || '-' || v_year || '-' || lpad(v_seq::text, 5, '0');

  perform set_audit_context('dossier ouvert', v_reason);
  insert into dossiers (number, base_number, office_code, year, seq, program_code, client_id, status, collector_id, opened_by)
  values (v_base || '-' || p_program, v_base, v_office, v_year, v_seq, p_program, p_client, 0, v_collector, auth.uid())
  returning id into v_id;

  perform set_audit_context('membre ajouté');
  insert into dossier_members (dossier_id, person_code, first_name, last_name, birth_date)
  values (v_id, 'P', v_client.first_name, v_client.last_name, v_client.birth_date);

  perform _set_status(v_id, 10::smallint, v_reason);
  return v_id;
end;
$$;

revoke execute on function public.create_dossier(uuid, text, uuid, char) from public, anon;
grant execute on function public.create_dossier(uuid, text, uuid, char) to authenticated;
revoke execute on function public.collector_loads(char) from public, anon;
grant execute on function public.collector_loads(char) to authenticated;
revoke execute on function public.set_availability(uuid, boolean) from public, anon;
grant execute on function public.set_availability(uuid, boolean) to authenticated;
grant select on public.staff_directory to authenticated;

-- >>> supabase/migrations/0007_notifications.sql
-- =====================================================================
-- 0007 : notifications dans l'application
-- Créées automatiquement par la base à chaque étape du circuit, pour la
-- personne qui doit agir. L'auteur de l'action n'est jamais notifié.
-- =====================================================================

create table public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id),
  dossier_id  uuid references public.dossiers(id),
  kind        text not null,
  title       text not null,
  body        text,
  link        text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  emailed_at  timestamptz          -- réservé à l'envoi par courriel (phase 2)
);
create index on public.notifications (user_id, read_at, created_at desc);

alter table public.notifications enable row level security;
revoke insert, update, delete, truncate on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
create policy "mes notifications" on public.notifications for select to authenticated
  using (user_id = auth.uid());

-- Diffusion en temps réel (cloche mise à jour sans recharger la page)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Envoi
-- ---------------------------------------------------------------------
create or replace function public.notify(
  p_user uuid, p_dossier uuid, p_kind text, p_title text, p_body text default null, p_link text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user is not distinct from auth.uid() then return; end if;
  if not exists (select 1 from profiles where id = p_user and active) then return; end if;
  insert into notifications (user_id, dossier_id, kind, title, body, link)
  values (p_user, p_dossier, p_kind, p_title, p_body,
          coalesce(p_link, case when p_dossier is not null then '/dossiers/' || p_dossier end));
end;
$$;

-- Tous les agents actifs d'un rôle (et d'un bureau si précisé), sauf certains
create or replace function public.notify_role(
  p_role public.app_role, p_office char(3), p_dossier uuid, p_kind text, p_title text, p_body text default null,
  p_except uuid default null, p_link text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  for v in
    select id from profiles
    where active and p_role = any (roles)
      and (p_office is null or office_code = p_office)
      and id is distinct from p_except
  loop
    perform notify(v, p_dossier, p_kind, p_title, p_body, p_link);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Règles : qui est prévenu à quelle étape
-- ---------------------------------------------------------------------
create or replace function public.dossier_notifications()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n text := new.number;
  v_reason text := nullif(current_setting('app.reason', true), '');
begin
  -- agent de collecte assigné (ouverture ou réassignation)
  if new.collector_id is distinct from (case when tg_op = 'UPDATE' then old.collector_id end) and new.status < 15 then
    perform notify(new.collector_id, new.id, 'collecte', 'Nouveau dossier à collecter', n);
  end if;

  -- agent de traitement assigné ou réassigné
  if tg_op = 'UPDATE' and new.processor_id is distinct from old.processor_id then
    perform notify(new.processor_id, new.id, 'traitement', 'Dossier assigné pour traitement', n);
  end if;

  -- contrôleur désigné par le gestionnaire (s'il se prend lui-même en charge, notify l'ignore)
  if tg_op = 'UPDATE' and new.controller_id is distinct from old.controller_id then
    perform notify(new.controller_id, new.id, 'controle', 'Dossier assigné pour contrôle', n);
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    case new.status
      when 15 then
        perform notify_role('GBR', new.office_code, new.id, 'assignation', 'Collecte complète : dossier à assigner', n);
      when 35 then
        perform notify(new.collector_id, new.id, 'attente_client', 'Information à obtenir du client', coalesce(v_reason, n));
      when 30 then
        if old.status = 35 then
          perform notify(new.processor_id, new.id, 'reprise', 'Information reçue : vous pouvez reprendre', n);
        end if;
      when 40 then
        perform notify_role('CTL', null, new.id, 'controle', 'Dossier prêt au contrôle', n, new.processor_id);
      when 55 then
        perform notify(new.processor_id, new.id, 'renvoi', 'Dossier renvoyé par le contrôle', coalesce(v_reason, n));
      when 60 then
        perform notify_role('CHF', null, new.id, 'validation', 'Dossier contrôlé : validation finale', n);
      when 75 then
        perform notify(new.processor_id, new.id, 'renvoi', 'Dossier retourné par le chef du cabinet', coalesce(v_reason, n));
        perform notify(new.controller_id, new.id, 'renvoi', 'Dossier retourné par le chef du cabinet', coalesce(v_reason, n));
      when 80 then
        perform notify_role('GBR', new.office_code, new.id, 'soumission', 'Dossier soumis aux autorités', n);
        perform notify(new.processor_id, new.id, 'soumission', 'Dossier soumis aux autorités', n);
      when 90 then
        perform notify_role('GBR', new.office_code, new.id, 'decision', 'Décision reçue', coalesce(new.decision, n));
        perform notify(new.collector_id, new.id, 'decision', 'Décision reçue : informer le client', coalesce(new.decision, n));
      when 99 then
        perform notify(new.collector_id, new.id, 'annulation', 'Dossier annulé', coalesce(v_reason, n));
        perform notify(new.processor_id, new.id, 'annulation', 'Dossier annulé', coalesce(v_reason, n));
      else
        null;
    end case;
  end if;
  return new;
end;
$$;

create trigger dossier_notifications after insert or update on public.dossiers
  for each row execute function public.dossier_notifications();

-- Changement de coordonnées de paiement : l'administrateur doit confirmer
create or replace function public.payment_notifications()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if new.pending and (tg_op = 'INSERT' or not old.pending or new.updated_at <> old.updated_at) then
    select coalesce(agent_code, full_name) into v_code from profiles where id = new.agent_id;
    perform notify_role('ADM', null, null, 'paiement', 'Coordonnées de paiement à confirmer', v_code, null, '/admin/agents');
  end if;
  return new;
end;
$$;

create trigger payment_notifications after insert or update on public.agent_payments
  for each row execute function public.payment_notifications();

-- Dossiers bloqués depuis 7 jours ou plus : rappel au gestionnaire, une fois par jour au plus.
-- À planifier avec pg_cron (voir README) ; peut aussi être appelée à la main.
create or replace function public.notify_stale_dossiers(p_days int default 7)
returns int language plpgsql security definer set search_path = public as $$
declare d record; v_count int := 0;
begin
  for d in
    select * from dossiers
    where status < 80 and status_changed_at < now() - make_interval(days => p_days)
  loop
    if not exists (select 1 from notifications where dossier_id = d.id and kind = 'bloque'
                   and created_at > now() - interval '20 hours') then
      perform notify_role('GBR', d.office_code, d.id, 'bloque',
        format('Dossier bloqué depuis %s jours', extract(day from now() - d.status_changed_at)::int), d.number);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- Lecture
-- ---------------------------------------------------------------------
create or replace function public.mark_notifications_read(p_ids bigint[] default null)
returns void language sql security definer set search_path = public as $$
  update notifications set read_at = now()
  where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
$$;

revoke execute on function public.notify(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.notify_role(public.app_role, char, uuid, text, text, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.notify_stale_dossiers(int) from public, anon, authenticated;
revoke execute on function public.dossier_notifications() from public, anon, authenticated;
revoke execute on function public.payment_notifications() from public, anon, authenticated;
revoke execute on function public.mark_notifications_read(bigint[]) from public, anon;
grant execute on function public.mark_notifications_read(bigint[]) to authenticated;

-- >>> supabase/migrations/0008_agent_creation.sql
-- =====================================================================
-- 0008 : création des agents depuis l'application (ADM et CHF)
-- Le compte est créé côté serveur avec un mot de passe temporaire ;
-- l'agent doit le changer à sa première connexion.
-- =====================================================================

alter table public.profiles add column if not exists must_change_password boolean not null default false;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name, must_change_password)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce((new.raw_user_meta_data ->> 'must_change_password')::boolean, false)
  );
  return new;
end;
$$;

-- Appelée par l'agent après avoir choisi son propre mot de passe
create or replace function public.password_changed()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_audit_context('mot de passe personnel défini');
  update profiles set must_change_password = false where id = auth.uid() and must_change_password;
end;
$$;

-- L'administrateur peut exiger un nouveau changement (ex. mot de passe réinitialisé)
create or replace function public.require_password_change(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role(array['ADM', 'CHF']::app_role[]);
  perform set_audit_context('changement de mot de passe exigé');
  update profiles set must_change_password = true where id = p_user;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.password_changed() from public, anon;
grant execute on function public.password_changed() to authenticated;
revoke execute on function public.require_password_change(uuid) from public, anon;
grant execute on function public.require_password_change(uuid) to authenticated;

-- >>> supabase/migrations/0009_create_agent_in_platform.sql
-- =====================================================================
-- 0009 : création des agents entièrement dans la plateforme
-- Plus besoin de la clé service_role : l'administrateur ou le chef crée
-- le compte depuis la page Agents, la base génère un mot de passe
-- temporaire que l'agent change à sa première connexion.
-- =====================================================================

-- Mot de passe temporaire lisible, sans caractères ambigus (0/O, 1/l)
create or replace function public._temporary_password()
returns text language plpgsql volatile set search_path = public, extensions as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  bytes bytea := gen_random_bytes(12);
  out text := '';
  i int;
begin
  for i in 0..11 loop
    out := out || substr(chars, (get_byte(bytes, i) % length(chars)) + 1, 1);
    if i in (3, 7) then out := out || '-'; end if;
  end loop;
  return out;
end;
$$;

create or replace function public.create_agent(
  p_email text, p_full_name text, p_roles public.app_role[], p_office char(3) default null,
  p_certified text[] default '{}', p_hourly_rate numeric default null
) returns table (user_id uuid, agent_code text, temporary_password text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_email text := lower(trim(p_email));
  v_name text := trim(p_full_name);
  v_id uuid := gen_random_uuid();
  v_password text := _temporary_password();
  v_code text;
begin
  perform require_role(array['ADM', 'CHF']::app_role[]);
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Courriel invalide'; end if;
  if coalesce(v_name, '') = '' then raise exception 'Le nom est obligatoire'; end if;
  if cardinality(coalesce(p_roles, '{}')) = 0 then raise exception 'Choisissez au moins un rôle'; end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Un compte existe déjà avec ce courriel';
  end if;
  if p_office is not null and not exists (select 1 from offices where code = p_office) then
    raise exception 'Bureau inconnu : %', p_office;
  end if;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new
  ) values (
    v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    v_email, crypt(v_password, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', v_name, 'must_change_password', true),
    now(), now(), '', '', '', ''
  );
  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text, 'email',
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
          null, now(), now());

  -- le profil vient d'être créé par le trigger on_auth_user_created
  perform set_audit_context('agent créé');
  update profiles set
    full_name = v_name,
    roles = p_roles,
    office_code = p_office,
    certified_programs = coalesce((select array_agg(upper(trim(c))) from unnest(p_certified) c where trim(c) <> ''), '{}'),
    hourly_rate = p_hourly_rate,
    active = true,
    must_change_password = true,
    agent_code = next_agent_code(p_roles[1]::text)
  where id = v_id
  returning profiles.agent_code into v_code;

  return query select v_id, v_code, v_password;
end;
$$;

-- Nouveau mot de passe temporaire pour un agent qui a oublié le sien
create or replace function public.reset_agent_password(p_user uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_password text := _temporary_password();
begin
  perform require_role(array['ADM', 'CHF']::app_role[]);
  if p_user = auth.uid() then raise exception 'Changez votre propre mot de passe depuis Mon profil'; end if;
  update auth.users set encrypted_password = crypt(v_password, gen_salt('bf')), updated_at = now() where id = p_user;
  if not found then raise exception 'Agent introuvable'; end if;
  perform set_audit_context('mot de passe réinitialisé par l''administration');
  update profiles set must_change_password = true where id = p_user;
  return v_password;
end;
$$;

revoke execute on function public._temporary_password() from public, anon, authenticated;
revoke execute on function public.create_agent(text, text, public.app_role[], char, text[], numeric) from public, anon;
grant execute on function public.create_agent(text, text, public.app_role[], char, text[], numeric) to authenticated;
revoke execute on function public.reset_agent_password(uuid) from public, anon;
grant execute on function public.reset_agent_password(uuid) to authenticated;

-- >>> supabase/migrations/0010_offices_admin.sql
-- =====================================================================
-- 0010 : gestion des bureaux par l'administrateur (et le chef du cabinet)
-- Création, modification, fermeture. Un bureau fermé garde ses dossiers
-- et son historique, mais n'accepte plus de nouveaux clients ni dossiers.
-- =====================================================================

create trigger audit_offices after insert or update or delete on public.offices
  for each row execute function public.audit_row();

create or replace function public.create_office(p_code text, p_name text, p_country text)
returns public.offices language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(trim(p_code));
  v_country text := upper(trim(p_country));
  v public.offices;
begin
  perform require_role(array['ADM', 'CHF']::app_role[]);
  if v_code !~ '^[A-Z]{3}$' then raise exception 'Le code du bureau doit faire exactement 3 lettres (ex. BZV)'; end if;
  if v_country !~ '^[A-Z]{2}$' then raise exception 'Le code pays doit faire 2 lettres (ex. CG)'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Le nom du bureau est obligatoire'; end if;
  if exists (select 1 from offices where code = v_code) then
    raise exception 'Le code % est déjà utilisé', v_code;
  end if;
  perform set_audit_context('bureau créé');
  insert into offices (code, name, country_iso) values (v_code, trim(p_name), v_country) returning * into v;
  return v;
end;
$$;

-- Le code ne change jamais : il figure dans les numéros de dossiers déjà émis
create or replace function public.update_office(p_code text, p_name text, p_country text, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_country text := upper(trim(p_country));
begin
  perform require_role(array['ADM', 'CHF']::app_role[]);
  if v_country !~ '^[A-Z]{2}$' then raise exception 'Le code pays doit faire 2 lettres (ex. CG)'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Le nom du bureau est obligatoire'; end if;
  perform set_audit_context(case when p_active then 'bureau modifié' else 'bureau fermé ou modifié' end);
  update offices set name = trim(p_name), country_iso = v_country, active = coalesce(p_active, active)
  where code = upper(trim(p_code));
  if not found then raise exception 'Bureau introuvable'; end if;
end;
$$;

-- Un bureau fermé n'accepte plus de nouveaux clients ni dossiers
create or replace function public.check_office_active()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from offices where code = new.office_code and active) then
    raise exception 'Le bureau % est fermé : impossible d''y ouvrir un client ou un dossier', new.office_code;
  end if;
  return new;
end;
$$;
create trigger clients_office_active before insert on public.clients
  for each row execute function public.check_office_active();
create trigger dossiers_office_active before insert on public.dossiers
  for each row execute function public.check_office_active();

-- Chiffres par bureau pour la page d'administration
create or replace function public.office_stats()
returns table (code char(3), agents bigint, collectors bigint, collectors_available bigint, open_dossiers bigint, clients bigint)
language sql stable security definer set search_path = public as $$
  select o.code,
    (select count(*) from profiles p where p.office_code = o.code and p.active),
    (select count(*) from profiles p where p.office_code = o.code and p.active and 'COL' = any (p.roles)),
    (select count(*) from profiles p where p.office_code = o.code and p.active and p.available and 'COL' = any (p.roles)),
    (select count(*) from dossiers d where d.office_code = o.code and d.status < 90),
    (select count(*) from clients c where c.office_code = o.code)
  from offices o
  where public.has_role('ADM') or public.has_role('CHF');
$$;

revoke execute on function public.check_office_active() from public, anon, authenticated;
revoke execute on function public.create_office(text, text, text) from public, anon;
grant execute on function public.create_office(text, text, text) to authenticated;
revoke execute on function public.update_office(text, text, text, boolean) from public, anon;
grant execute on function public.update_office(text, text, text, boolean) to authenticated;
revoke execute on function public.office_stats() from public, anon;
grant execute on function public.office_stats() to authenticated;

-- >>> supabase/migrations/0011_program_forms.sql
-- =====================================================================
-- 0011 : formulaires officiels à remplir selon le programme
-- Chaque formulaire est un type de pièce de la catégorie 10_FORMULAIRES
-- (ex. FORMULAIRE-IMM1294), ce qui donne des noms de fichiers conformes
-- à la nomenclature. L'agent de traitement remplit le formulaire puis le
-- téléverse ; le dossier ne peut pas aller au contrôle s'il en manque un.
-- La liste par programme est indicative : le cabinet la vérifie et la
-- complète dans Administration > Formulaires.
-- =====================================================================

alter table public.document_types add column if not exists form_number text;
alter table public.document_types add column if not exists official_url text;

insert into public.document_types (code, label, category_code, form_number, official_url) values
  ('FORMULAIRE-IMM5476', 'Recours aux services d''un représentant', '10', 'IMM 5476',
   'https://www.canada.ca/fr/immigration-refugies-citoyennete/services/demande/formulaires-demande-guides/recours-services-representant.htm'),
  ('FORMULAIRE-IMM1294', 'Demande de permis d''études présentée à l''extérieur du Canada', '10', 'IMM 1294', null),
  ('FORMULAIRE-IMM1295', 'Demande de permis de travail présentée à l''extérieur du Canada', '10', 'IMM 1295', null),
  ('FORMULAIRE-IMM5257', 'Demande de visa de résident temporaire', '10', 'IMM 5257', null),
  ('FORMULAIRE-IMM5645', 'Renseignements sur la famille', '10', 'IMM 5645', null),
  ('FORMULAIRE-IMM5710', 'Modifier les conditions ou prolonger le séjour (travailleur)', '10', 'IMM 5710', null),
  ('FORMULAIRE-IMM0008', 'Demande générique pour le Canada', '10', 'IMM 0008', null),
  ('FORMULAIRE-IMM5669', 'Annexe A : antécédents et déclaration', '10', 'IMM 5669', null),
  ('FORMULAIRE-IMM5406', 'Renseignements additionnels sur la famille', '10', 'IMM 5406', null),
  ('FORMULAIRE-IMM1344', 'Demande de parrainage et engagement', '10', 'IMM 1344', null),
  ('FORMULAIRE-IMM5532', 'Renseignements sur la relation et évaluation du parrainage', '10', 'IMM 5532', null),
  ('FORMULAIRE-IMM5444', 'Demande de carte de résident permanent', '10', 'IMM 5444', null),
  ('FORMULAIRE-IMM5524', 'Demande de titre de voyage de résident permanent', '10', 'IMM 5524', null),
  ('FORMULAIRE-CIT0002', 'Demande de citoyenneté canadienne (adultes)', '10', 'CIT 0002', null)
on conflict (code) do nothing;

create table public.program_forms (
  id            bigint generated always as identity primary key,
  program_code  text not null references public.programs(code),
  type_code     text not null references public.document_types(code),
  person_scope  text not null default 'P' check (person_scope in ('P', 'ALL')),
  sort          int not null default 0,
  unique (program_code, type_code)
);

-- Recours à un représentant : tous les programmes (le cabinet représente le client)
insert into public.program_forms (program_code, type_code, person_scope, sort)
select code, 'FORMULAIRE-IMM5476', 'P', 0 from public.programs;

insert into public.program_forms (program_code, type_code, person_scope, sort) values
  ('VR', 'FORMULAIRE-IMM5257', 'ALL', 10), ('VR', 'FORMULAIRE-IMM5645', 'P', 20),
  ('SV', 'FORMULAIRE-IMM5257', 'P', 10), ('SV', 'FORMULAIRE-IMM5645', 'P', 20),
  ('PE', 'FORMULAIRE-IMM1294', 'P', 10), ('PE', 'FORMULAIRE-IMM5645', 'P', 20),
  ('PT-EIMT', 'FORMULAIRE-IMM1295', 'P', 10), ('PT-EIMT', 'FORMULAIRE-IMM5645', 'P', 20),
  ('PT-MI', 'FORMULAIRE-IMM1295', 'P', 10), ('PT-MI', 'FORMULAIRE-IMM5645', 'P', 20),
  ('PT-PDE', 'FORMULAIRE-IMM5710', 'P', 10),
  ('PCP', 'FORMULAIRE-IMM0008', 'P', 10), ('PCP', 'FORMULAIRE-IMM5669', 'ALL', 20), ('PCP', 'FORMULAIRE-IMM5406', 'ALL', 30),
  ('PIA', 'FORMULAIRE-IMM0008', 'P', 10), ('PIA', 'FORMULAIRE-IMM5669', 'ALL', 20), ('PIA', 'FORMULAIRE-IMM5406', 'ALL', 30),
  ('PF-CONJ', 'FORMULAIRE-IMM1344', 'P', 10), ('PF-CONJ', 'FORMULAIRE-IMM5532', 'P', 20),
  ('PF-CONJ', 'FORMULAIRE-IMM0008', 'P', 30), ('PF-CONJ', 'FORMULAIRE-IMM5669', 'ALL', 40), ('PF-CONJ', 'FORMULAIRE-IMM5406', 'ALL', 50),
  ('PF-ENF', 'FORMULAIRE-IMM1344', 'P', 10), ('PF-ENF', 'FORMULAIRE-IMM0008', 'P', 20),
  ('PF-ENF', 'FORMULAIRE-IMM5669', 'ALL', 30), ('PF-ENF', 'FORMULAIRE-IMM5406', 'ALL', 40),
  ('PF-PGP', 'FORMULAIRE-IMM1344', 'P', 10), ('PF-PGP', 'FORMULAIRE-IMM0008', 'P', 20),
  ('PF-PGP', 'FORMULAIRE-IMM5669', 'ALL', 30), ('PF-PGP', 'FORMULAIRE-IMM5406', 'ALL', 40),
  ('CRP', 'FORMULAIRE-IMM5444', 'P', 10),
  ('TVRP', 'FORMULAIRE-IMM5524', 'P', 10),
  ('CIT', 'FORMULAIRE-CIT0002', 'P', 10);

alter table public.program_forms enable row level security;
revoke insert, update, delete, truncate on public.program_forms from anon, authenticated;
grant select on public.program_forms to authenticated;
create policy "lecture référentiel" on public.program_forms for select to authenticated using (true);
create trigger audit_program_forms after insert or update or delete on public.program_forms
  for each row execute function public.audit_row();

-- État des formulaires d'un dossier : un par personne concernée et par formulaire
create or replace function public.dossier_forms(p_dossier uuid)
returns table (
  person_code text, type_code text, form_number text, label text, official_url text,
  document_id uuid, file_name text, version int, uploaded_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select m.person_code, t.code, t.form_number, t.label, t.official_url,
         doc.id, doc.file_name, doc.version, doc.uploaded_at
  from dossiers d
  join program_forms f on f.program_code = d.program_code
  join document_types t on t.code = f.type_code and t.active
  join dossier_members m on m.dossier_id = d.id and (f.person_scope = 'ALL' or m.person_code = 'P')
  left join documents doc on doc.dossier_id = d.id and doc.person_code = m.person_code
                         and doc.type_code = t.code and doc.is_current
  where d.id = p_dossier and public.can_view_dossier(d.id)
  order by m.person_code, f.sort, t.code;
$$;

-- Pas d'envoi au contrôle tant qu'un formulaire manque
create or replace function public.check_forms_before_control()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_missing text;
begin
  if new.status = 40 and old.status is distinct from 40 then
    select string_agg(t.form_number || ' (' || m.person_code || ')', ', ' order by m.person_code, t.form_number)
      into v_missing
    from program_forms f
    join document_types t on t.code = f.type_code and t.active
    join dossier_members m on m.dossier_id = new.id and (f.person_scope = 'ALL' or m.person_code = 'P')
    where f.program_code = new.program_code
      and not exists (select 1 from documents doc where doc.dossier_id = new.id and doc.person_code = m.person_code
                      and doc.type_code = t.code and doc.is_current);
    if v_missing is not null then
      raise exception 'Formulaires à téléverser avant le contrôle : %', v_missing;
    end if;
  end if;
  return new;
end;
$$;
create trigger dossiers_forms_before_control before update of status on public.dossiers
  for each row execute function public.check_forms_before_control();

-- ---------------------------------------------------------------------
-- Administration de la liste (ADM, CHF)
-- ---------------------------------------------------------------------
create or replace function public.save_form_type(p_number text, p_label text, p_url text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_number text := upper(regexp_replace(trim(p_number), '\s+', ' ', 'g'));
  v_code text := 'FORMULAIRE-' || regexp_replace(upper(trim(p_number)), '[^A-Z0-9]', '', 'g');
begin
  perform require_role(array['ADM', 'CHF']::app_role[]);
  if v_code = 'FORMULAIRE-' or coalesce(trim(p_label), '') = '' then
    raise exception 'Numéro et titre du formulaire obligatoires';
  end if;
  if nullif(trim(p_url), '') is not null and trim(p_url) !~ '^https://' then
    raise exception 'Le lien doit commencer par https://';
  end if;
  insert into document_types (code, label, category_code, form_number, official_url)
  values (v_code, trim(p_label), '10', v_number, nullif(trim(p_url), ''))
  on conflict (code) do update set label = excluded.label, form_number = excluded.form_number,
    official_url = excluded.official_url, active = true;
  return v_code;
end;
$$;

create or replace function public.add_program_form(p_program text, p_type text, p_scope text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role(array['ADM', 'CHF']::app_role[]);
  if not exists (select 1 from document_types where code = p_type and form_number is not null) then
    raise exception 'Formulaire inconnu';
  end if;
  perform set_audit_context('formulaire ajouté au programme ' || p_program);
  insert into program_forms (program_code, type_code, person_scope, sort)
  values (p_program, p_type, coalesce(p_scope, 'P'),
          coalesce((select max(sort) + 10 from program_forms where program_code = p_program), 10))
  on conflict (program_code, type_code) do update set person_scope = excluded.person_scope;
end;
$$;

create or replace function public.remove_program_form(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role(array['ADM', 'CHF']::app_role[]);
  perform set_audit_context('formulaire retiré d''un programme');
  delete from program_forms where id = p_id;
end;
$$;

revoke execute on function public.check_forms_before_control() from public, anon, authenticated;
revoke execute on function public.dossier_forms(uuid) from public, anon;
grant execute on function public.dossier_forms(uuid) to authenticated;
revoke execute on function public.save_form_type(text, text, text) from public, anon;
grant execute on function public.save_form_type(text, text, text) to authenticated;
revoke execute on function public.add_program_form(text, text, text) from public, anon;
grant execute on function public.add_program_form(text, text, text) to authenticated;
revoke execute on function public.remove_program_form(bigint) from public, anon;
grant execute on function public.remove_program_form(bigint) to authenticated;

-- >>> supabase/migrations/0012_security_hardening.sql
-- =====================================================================
-- 0012 : renforcement de la sécurité et paramètres de l'application
--  1. Paramètres modifiables par l'administration (journalisés)
--  2. Session valide = compte actif ET double authentification si exigée :
--     appliqué dans la base elle-même, pas seulement dans l'interface
--  3. Compte désactivé : connexion bloquée et sessions fermées
--  4. Protection du compte du chef du cabinet
--  5. Pièces : types et tailles de fichiers autorisés ; téléchargement
--     réservé selon le rôle
--  6. Outils d'administration : vue sécurité, déconnexion forcée
--  7. Fermeture d'accès résiduels (anon, fonctions internes, annuaire)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Paramètres
-- ---------------------------------------------------------------------
create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  label       text not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id)
);

insert into public.app_settings (key, value, label) values
  ('mfa_obligatoire',              'false', 'Double authentification obligatoire pour tout le personnel'),
  ('telechargement_traitement',    'false', 'Les agents de traitement peuvent télécharger les pièces'),
  ('inactivite_minutes',           '30',    'Déconnexion automatique après inactivité (minutes)'),
  ('taille_max_fichier_mo',        '20',    'Taille maximale d''un fichier déposé (Mo)');

alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon;
revoke insert, update, delete, truncate on public.app_settings from authenticated;
grant select on public.app_settings to authenticated;
create policy "lecture des paramètres" on public.app_settings for select to authenticated using (true);

create or replace function public.setting(p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select value from app_settings where key = p_key;
$$;

create or replace function public.audit_settings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform write_audit(null, 'paramètre modifié : ' || new.key, 'app_settings', new.key,
                      jsonb_build_object('value', old.value), jsonb_build_object('value', new.value), null);
  return new;
end;
$$;
create trigger audit_app_settings after update on public.app_settings
  for each row execute function public.audit_settings();

-- ---------------------------------------------------------------------
-- 2. Session valide : compte actif, et niveau aal2 si la 2FA est exigée
-- ---------------------------------------------------------------------
create or replace function public.session_ok()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active)
     and (
          coalesce((select (value)::text::boolean from app_settings where key = 'mfa_obligatoire'), false) = false
       or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
     );
$$;

create or replace function public.has_role(r public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select public.session_ok() and exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.active and r = any (p.roles)
  );
$$;

create or replace function public.require_role(rs public.app_role[])
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.session_ok() then
    raise exception 'Session non autorisée : compte inactif ou double authentification requise' using errcode = '42501';
  end if;
  if not exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.active and p.roles && rs
  ) then
    raise exception 'Action non autorisée : rôle requis parmi %', rs using errcode = '42501';
  end if;
end;
$$;

-- l'accès par assignation exige aussi une session valide (corrige : un agent désactivé
-- gardait l'accès aux dossiers qui lui étaient assignés)
create or replace function public.can_view_dossier(p_dossier uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.session_ok() and exists (
    select 1 from dossiers d
    where d.id = p_dossier and (
         public.has_role('CHF') or public.has_role('ADM')
      or (public.has_role('GBR') and d.office_code = public.my_office())
      or d.collector_id = auth.uid()
      or d.processor_id = auth.uid()
      or d.controller_id = auth.uid()
      or (public.has_role('CTL') and d.status = 40 and d.processor_id is distinct from auth.uid())
    )
  );
$$;

create or replace function public._actor_can(d public.dossiers, rs public.app_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select public.session_ok() and (
       ('CHF' = any (rs) and has_role('CHF'))
    or ('ADM' = any (rs) and has_role('ADM'))
    or ('GBR' = any (rs) and has_role('GBR') and d.office_code = my_office())
    or ('COL' = any (rs) and has_role('COL') and d.collector_id = auth.uid())
    or ('TRT' = any (rs) and has_role('TRT') and d.processor_id = auth.uid())
    or ('CTL' = any (rs) and has_role('CTL') and d.processor_id is distinct from auth.uid()
        and (d.controller_id = auth.uid() or (d.status = 40 and d.controller_id is null)))
  );
$$;

-- les notifications restent visibles après 2FA seulement
drop policy if exists "mes notifications" on public.notifications;
create policy "mes notifications" on public.notifications for select to authenticated
  using (user_id = auth.uid() and public.session_ok());

-- pièces manquantes : uniquement pour un dossier visible
create or replace function public.missing_documents(p_dossier uuid)
returns table (person_code text, type_code text, type_label text)
language sql stable security definer set search_path = public as $$
  select m.person_code, r.type_code, t.label
  from dossiers d
  join required_documents r on (r.program_code is null or r.program_code = d.program_code)
  join dossier_members m on m.dossier_id = d.id and (r.person_scope = 'ALL' or m.person_code = 'P')
  join document_types t on t.code = r.type_code
  where d.id = p_dossier and public.can_view_dossier(d.id)
    and not exists (
      select 1 from documents doc
      where doc.dossier_id = d.id and doc.person_code = m.person_code
        and doc.type_code = r.type_code and doc.is_current and doc.validation_status = 'valide'
    )
  order by m.person_code, r.type_code;
$$;

-- charge des agents de collecte : réservée à ceux qui ouvrent des dossiers
create or replace function public.collector_loads(p_office char(3))
returns table (id uuid, agent_code text, full_name text, available boolean, open_count bigint, last_assigned timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.agent_code, p.full_name, p.available,
         (select count(*) from dossiers d where d.collector_id = p.id and d.status in (10, 35)),
         (select max(d.opened_at) from dossiers d where d.collector_id = p.id)
  from profiles p
  where p.active and 'COL' = any (p.roles) and p.office_code = p_office
    and (public.has_role('GBR') or public.has_role('CHF') or public.has_role('ADM')
         or auth.uid() is null)  -- appel interne depuis create_dossier
  order by 4 desc, 5 asc, 6 asc nulls first, 2;
$$;

-- ---------------------------------------------------------------------
-- 3. Compte désactivé : connexion bloquée, sessions fermées
-- ---------------------------------------------------------------------
create or replace function public.sync_account_ban()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.active is distinct from old.active then
    update auth.users set banned_until = case when new.active then null else 'infinity'::timestamptz end
    where id = new.id;
    if not new.active then
      delete from auth.sessions where user_id = new.id;
    end if;
  end if;
  return new;
end;
$$;
create trigger profiles_sync_ban after update of active on public.profiles
  for each row execute function public.sync_account_ban();

-- ---------------------------------------------------------------------
-- 4. Protection du chef du cabinet : seul un chef peut modifier, désactiver
--    ou réinitialiser le compte d'un chef, ou attribuer ce rôle
-- ---------------------------------------------------------------------
create or replace function public.protect_chief()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;  -- SQL Editor (propriétaire du projet)
  if ('CHF' = any (old.roles) or 'CHF' = any (new.roles))
     and (new.roles is distinct from old.roles or new.active is distinct from old.active)
     and not public.has_role('CHF') then
    raise exception 'Seul le chef du cabinet peut modifier un compte de chef ou attribuer ce rôle';
  end if;
  return new;
end;
$$;
create trigger profiles_protect_chief before update on public.profiles
  for each row execute function public.protect_chief();

create or replace function public.reset_agent_password(p_user uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_password text := _temporary_password();
begin
  perform require_role(array['ADM', 'CHF']::app_role[]);
  if p_user = auth.uid() then raise exception 'Changez votre propre mot de passe depuis Mon profil'; end if;
  if exists (select 1 from profiles where id = p_user and 'CHF' = any (roles)) and not has_role('CHF') then
    raise exception 'Seul le chef du cabinet peut réinitialiser le mot de passe d''un chef';
  end if;
  update auth.users set encrypted_password = crypt(v_password, gen_salt('bf')), updated_at = now() where id = p_user;
  if not found then raise exception 'Agent introuvable'; end if;
  delete from auth.sessions where user_id = p_user;  -- l'ancien mot de passe ne garde aucune session
  perform set_audit_context('mot de passe réinitialisé par l''administration');
  update profiles set must_change_password = true where id = p_user;
  return v_password;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Pièces : formats et taille ; téléchargement selon le rôle
-- ---------------------------------------------------------------------
create or replace function public.check_document_file()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_max bigint := coalesce((setting('taille_max_fichier_mo'))::text::int, 20) * 1024 * 1024;
begin
  if lower(substring(new.file_name from '\.([a-zA-Z0-9]+)$')) not in ('pdf', 'jpg', 'jpeg', 'png') then
    raise exception 'Format refusé : seuls les fichiers PDF, JPG et PNG sont acceptés';
  end if;
  if new.size_bytes is not null and new.size_bytes > v_max then
    raise exception 'Fichier trop volumineux (maximum % Mo)', v_max / 1024 / 1024;
  end if;
  if new.mime_type is not null and new.mime_type not in ('application/pdf', 'image/jpeg', 'image/png') then
    raise exception 'Type de fichier refusé : %', new.mime_type;
  end if;
  return new;
end;
$$;
create trigger documents_check_file before insert on public.documents
  for each row execute function public.check_document_file();

-- Limites appliquées aussi par le stockage lui-même
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    update storage.buckets
    set file_size_limit = 20 * 1024 * 1024,
        allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png']
    where id = 'dossiers';
  end if;
end $$;

create or replace function public.can_download()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('COL') or public.has_role('CTL') or public.has_role('GBR')
      or public.has_role('CHF') or public.has_role('ADM')
      or (public.has_role('TRT') and coalesce((setting('telechargement_traitement'))::text::boolean, false));
$$;

create or replace function public.log_document_access(p_document uuid, p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare doc public.documents;
begin
  select * into doc from documents where id = p_document;
  if not found or not can_view_dossier(doc.dossier_id) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if p_action not in ('consultation', 'telechargement') then raise exception 'Action invalide'; end if;
  if p_action = 'telechargement' and not can_download() then
    raise exception 'Téléchargement non autorisé pour votre rôle : consultez la pièce dans la plateforme' using errcode = '42501';
  end if;
  perform write_audit(doc.dossier_id, case p_action when 'telechargement' then 'pièce téléchargée' else 'pièce consultée' end,
                      'documents', doc.id::text, null, jsonb_build_object('file_name', doc.file_name), null);
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Outils d'administration
-- ---------------------------------------------------------------------
create or replace function public.update_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role(array['ADM', 'CHF']::app_role[]);
  if p_key = 'mfa_obligatoire' and p_value = 'true'::jsonb
     and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'Activez d''abord votre propre double authentification avant de l''exiger pour tous';
  end if;
  if p_key = 'inactivite_minutes' and ((p_value)::text::int < 5 or (p_value)::text::int > 480) then
    raise exception 'Délai d''inactivité entre 5 et 480 minutes';
  end if;
  if p_key = 'taille_max_fichier_mo' and ((p_value)::text::int < 1 or (p_value)::text::int > 50) then
    raise exception 'Taille maximale entre 1 et 50 Mo';
  end if;
  update app_settings set value = p_value, updated_at = now(), updated_by = auth.uid() where key = p_key;
  if not found then raise exception 'Paramètre inconnu : %', p_key; end if;
end;
$$;

-- Vue sécurité : dernière connexion, double authentification, état du compte
create or replace function public.security_overview()
returns table (
  id uuid, email text, full_name text, agent_code text, roles public.app_role[], active boolean,
  last_sign_in_at timestamptz, mfa_enabled boolean, must_change_password boolean, banned boolean, open_sessions bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_role(array['ADM', 'CHF']::app_role[]);
  return query
    select p.id, p.email, p.full_name, p.agent_code, p.roles, p.active,
           u.last_sign_in_at,
           exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status::text = 'verified'),
           p.must_change_password,
           coalesce(u.banned_until > now(), false),
           (select count(*) from auth.sessions s where s.user_id = p.id)
    from profiles p join auth.users u on u.id = p.id
    order by p.active desc, u.last_sign_in_at desc nulls last;
end;
$$;

-- Déconnexion forcée (appareil perdu, départ, doute) : ferme toutes les sessions
create or replace function public.force_sign_out(p_user uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_count bigint;
begin
  perform require_role(array['ADM', 'CHF']::app_role[]);
  if exists (select 1 from profiles where id = p_user and 'CHF' = any (roles)) and not has_role('CHF') and p_user <> auth.uid() then
    raise exception 'Seul le chef du cabinet peut déconnecter un chef';
  end if;
  delete from auth.sessions where user_id = p_user;
  get diagnostics v_count = row_count;
  perform write_audit(null, 'déconnexion forcée', 'profiles', p_user::text, null, jsonb_build_object('sessions', v_count), null);
  return v_count;
end;
$$;

-- Retrait de la double authentification d'un agent (téléphone perdu) : il devra la réactiver
create or replace function public.reset_mfa(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role(array['ADM', 'CHF']::app_role[]);
  if exists (select 1 from profiles where id = p_user and 'CHF' = any (roles)) and not has_role('CHF') then
    raise exception 'Seul le chef du cabinet peut réinitialiser la double authentification d''un chef';
  end if;
  delete from auth.mfa_factors where user_id = p_user;
  delete from auth.sessions where user_id = p_user;
  perform write_audit(null, 'double authentification réinitialisée', 'profiles', p_user::text, null, null, null);
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Fermeture d'accès résiduels
-- ---------------------------------------------------------------------
-- annuaire du personnel : sans courriel, sans comptes inactifs, session valide exigée
drop view if exists public.staff_directory;
create view public.staff_directory as
  select id, full_name, agent_code, roles, office_code, certified_programs, active, available
  from public.profiles
  where active and public.session_ok();
revoke all on public.staff_directory from anon, public;
grant select on public.staff_directory to authenticated;

-- aucun accès anonyme, aux tables comme aux fonctions (y compris celles créées après 0003)
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;

-- fonctions internes ou de déclenchement : jamais appelables directement
do $$
declare f text;
begin
  foreach f in array array[
    'public.audit_row()', 'public.audit_log_immutable()', 'public.handle_new_user()',
    'public.dossier_notifications()', 'public.payment_notifications()', 'public.check_office_active()',
    'public.check_forms_before_control()', 'public.audit_settings()', 'public.sync_account_ban()',
    'public.protect_chief()', 'public.check_document_file()', 'public._set_status(uuid, smallint, text)',
    'public._close_stale_sessions(uuid)', 'public.write_audit(uuid, text, text, text, jsonb, jsonb, text)',
    'public.next_agent_code(text)', 'public._temporary_password()', 'public.set_audit_context(text, text)',
    'public.notify(uuid, uuid, text, text, text, text)',
    'public.notify_role(public.app_role, char, uuid, text, text, text, uuid, text)',
    'public.notify_stale_dossiers(integer)']
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;

grant execute on function public.update_setting(text, jsonb) to authenticated;
grant execute on function public.security_overview() to authenticated;
grant execute on function public.force_sign_out(uuid) to authenticated;
grant execute on function public.reset_mfa(uuid) to authenticated;
grant execute on function public.reset_agent_password(uuid) to authenticated;
grant execute on function public.can_download() to authenticated;
grant execute on function public.session_ok() to authenticated;
grant execute on function public.setting(text) to authenticated;

-- >>> supabase/migrations/0013_profile_photos.sql
-- =====================================================================
-- 0013 : photo de profil des agents
-- Seau privé « avatars » (lecture réservée au personnel connecté),
-- un dossier par agent : avatars/<id de l'agent>/<nom aléatoire>.jpg
-- L'agent change sa propre photo ; l'administrateur et le chef peuvent
-- changer ou retirer celle de n'importe quel agent. Changements journalisés.
-- =====================================================================

alter table public.profiles add column if not exists avatar_path text;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    update storage.buckets
    set file_size_limit = 2 * 1024 * 1024,
        allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
    where id = 'avatars';
  end if;
end $$;

create or replace function public.can_manage_avatar(p_user text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.session_ok()
     and (p_user = auth.uid()::text or public.has_role('ADM') or public.has_role('CHF'));
$$;

create policy "avatars : lecture par le personnel" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and public.session_ok());

create policy "avatars : dépôt" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and public.can_manage_avatar((storage.foldername(name))[1])
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
  );

create policy "avatars : suppression" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and public.can_manage_avatar((storage.foldername(name))[1]));

-- Enregistre (ou retire, avec null) la photo d'un agent
create or replace function public.set_avatar(p_user uuid, p_path text)
returns text language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  if not can_manage_avatar(p_user::text) then
    raise exception 'Vous ne pouvez modifier que votre propre photo' using errcode = '42501';
  end if;
  if p_path is not null and p_path !~ ('^' || p_user::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
    raise exception 'Chemin de photo invalide';
  end if;
  select avatar_path into v_old from profiles where id = p_user;
  perform set_audit_context(case when p_path is null then 'photo de profil retirée' else 'photo de profil modifiée' end);
  update profiles set avatar_path = p_path where id = p_user;
  return v_old;  -- l'application supprime l'ancien fichier
end;
$$;

-- l'annuaire expose aussi le chemin de la photo
drop view if exists public.staff_directory;
create view public.staff_directory as
  select id, full_name, agent_code, roles, office_code, certified_programs, active, available, avatar_path
  from public.profiles
  where active and public.session_ok();
revoke all on public.staff_directory from anon, public;
grant select on public.staff_directory to authenticated;

-- vue sécurité : avec la photo
drop function if exists public.security_overview();
create function public.security_overview()
returns table (
  id uuid, email text, full_name text, agent_code text, roles public.app_role[], active boolean,
  last_sign_in_at timestamptz, mfa_enabled boolean, must_change_password boolean, banned boolean, open_sessions bigint,
  avatar_path text
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_role(array['ADM', 'CHF']::app_role[]);
  return query
    select p.id, p.email, p.full_name, p.agent_code, p.roles, p.active,
           u.last_sign_in_at,
           exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status::text = 'verified'),
           p.must_change_password,
           coalesce(u.banned_until > now(), false),
           (select count(*) from auth.sessions s where s.user_id = p.id),
           p.avatar_path
    from profiles p join auth.users u on u.id = p.id
    order by p.active desc, u.last_sign_in_at desc nulls last;
end;
$$;

revoke execute on function public.security_overview() from public, anon;
grant execute on function public.security_overview() to authenticated;
revoke execute on function public.can_manage_avatar(text) from public, anon;
grant execute on function public.can_manage_avatar(text) to authenticated;
revoke execute on function public.set_avatar(uuid, text) from public, anon;
grant execute on function public.set_avatar(uuid, text) to authenticated;

-- >>> supabase/migrations/0014_post_submission.sql
-- =====================================================================
-- 0014 : suivi après la soumission
-- Après le dépôt du dossier, l'autorité (IRCC, MIFI) peut demander la
-- biométrie, un examen médical, des pièces supplémentaires, une entrevue,
-- le passeport... toujours avec une date limite.
-- Circuit d'une demande :
--   à faire (agent assigné) → prête (préparée) → répondue (envoyée par le chef)
-- Le dossier passe au statut 85 « Complément demandé » tant qu'une demande
-- est ouverte, et revient à 80 « Soumis » quand toutes sont répondues.
-- La décision (90) est impossible tant qu'une demande reste ouverte.
-- =====================================================================

insert into public.dossier_statuses (code, label, timer_open, billable, closed)
values (85, 'Complément demandé', true, true, false)
on conflict (code) do nothing;

insert into public.status_transitions (from_status, to_status, roles, reason_required) values
  (80, 85, '{GBR,CHF}', true),
  (85, 80, '{CHF}', false),
  (85, 99, '{GBR,CHF}', true)
on conflict do nothing;

create table public.authority_requests (
  id             uuid primary key default gen_random_uuid(),
  dossier_id     uuid not null references public.dossiers(id),
  kind           text not null check (kind in ('biometrie', 'examen_medical', 'pieces', 'entrevue', 'passeport', 'formulaire', 'autre')),
  title          text not null,
  details        text,
  received_on    date not null default current_date,
  due_on         date not null,
  assignee_role  text not null check (assignee_role in ('COL', 'TRT')),
  status         text not null default 'a_faire' check (status in ('a_faire', 'prete', 'repondue', 'annulee')),
  ready_note     text,
  ready_at       timestamptz,
  ready_by       uuid references public.profiles(id),
  sent_on        date,
  answered_at    timestamptz,
  answered_by    uuid references public.profiles(id),
  cancel_reason  text,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  check (due_on >= received_on)
);
create index on public.authority_requests (dossier_id);
create index on public.authority_requests (status, due_on);

alter table public.authority_requests enable row level security;
revoke all on public.authority_requests from anon;
revoke insert, update, delete, truncate on public.authority_requests from authenticated;
grant select on public.authority_requests to authenticated;
create policy "demandes visibles" on public.authority_requests for select to authenticated
  using (public.can_view_dossier(dossier_id));

create trigger audit_authority_requests after insert or update or delete on public.authority_requests
  for each row execute function public.audit_row();

-- Personne chargée d'une demande : l'agent de collecte ou de traitement du dossier
create or replace function public._request_assignee(r public.authority_requests)
returns uuid language sql stable security definer set search_path = public as $$
  select case r.assignee_role when 'COL' then d.collector_id else d.processor_id end
  from dossiers d where d.id = r.dossier_id;
$$;

-- Plus aucune demande ouverte : le dossier revient à « Soumis »
create or replace function public._close_complement_if_done(p_dossier uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from authority_requests where dossier_id = p_dossier and status in ('a_faire', 'prete'))
     and (select status from dossiers where id = p_dossier) = 85 then
    perform _set_status(p_dossier, 80::smallint, 'toutes les demandes de l''autorité sont répondues');
  end if;
end;
$$;

create or replace function public.add_authority_request(
  p_dossier uuid, p_kind text, p_title text, p_details text, p_received date, p_due date, p_assignee_role text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  d public.dossiers;
  v_id uuid;
  v_assignee uuid;
begin
  select * into d from dossiers where id = p_dossier for update;
  if not found then raise exception 'Dossier introuvable'; end if;
  if not _actor_can(d, array['GBR', 'CHF', 'ADM']::app_role[]) then
    raise exception 'Seuls le gestionnaire du bureau et le chef du cabinet enregistrent une demande de l''autorité' using errcode = '42501';
  end if;
  if d.status not in (80, 85) then
    raise exception 'Une demande de l''autorité s''enregistre sur un dossier soumis (statut 80 ou 85)';
  end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Décrivez la demande'; end if;
  if p_due is null then raise exception 'La date limite est obligatoire'; end if;
  if p_assignee_role = 'TRT' and d.processor_id is null then raise exception 'Aucun agent de traitement sur ce dossier'; end if;
  if p_assignee_role = 'COL' and d.collector_id is null then raise exception 'Aucun agent de collecte sur ce dossier'; end if;

  perform set_audit_context('demande de l''autorité enregistrée', trim(p_title));
  insert into authority_requests (dossier_id, kind, title, details, received_on, due_on, assignee_role, created_by)
  values (p_dossier, p_kind, trim(p_title), nullif(trim(p_details), ''), coalesce(p_received, current_date), p_due, p_assignee_role, auth.uid())
  returning id into v_id;

  if d.status = 80 then
    perform _set_status(p_dossier, 85::smallint, 'demande de l''autorité : ' || trim(p_title));
  end if;

  v_assignee := case p_assignee_role when 'COL' then d.collector_id else d.processor_id end;
  perform notify(v_assignee, p_dossier, 'demande_autorite',
    'Demande de l''autorité à préparer avant le ' || to_char(p_due, 'DD/MM/YYYY'), d.number || ' : ' || trim(p_title));
  return v_id;
end;
$$;

-- L'agent assigné a préparé la réponse (pièces déposées, rendez-vous pris...)
create or replace function public.mark_request_ready(p_request uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.authority_requests;
  d public.dossiers;
begin
  select * into r from authority_requests where id = p_request for update;
  if not found or not can_view_dossier(r.dossier_id) then raise exception 'Demande introuvable'; end if;
  select * into d from dossiers where id = r.dossier_id;
  if not (auth.uid() = _request_assignee(r) and session_ok()) and not _actor_can(d, array['GBR', 'CHF']::app_role[]) then
    raise exception 'Seul l''agent chargé de la demande peut la marquer comme prête' using errcode = '42501';
  end if;
  if r.status <> 'a_faire' then raise exception 'Cette demande n''est plus à faire'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Indiquez ce qui a été préparé'; end if;
  perform set_audit_context('demande de l''autorité prête', trim(p_note));
  update authority_requests set status = 'prete', ready_note = trim(p_note), ready_at = now(), ready_by = auth.uid()
  where id = p_request;
  perform notify_role('CHF', null, r.dossier_id, 'demande_autorite',
    'Réponse prête à envoyer à l''autorité', d.number || ' : ' || r.title);
end;
$$;

-- Le chef du cabinet a envoyé la réponse à l'autorité
create or replace function public.mark_request_answered(p_request uuid, p_sent_on date, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.authority_requests;
begin
  perform require_role(array['CHF']::app_role[]);
  select * into r from authority_requests where id = p_request for update;
  if not found or not can_view_dossier(r.dossier_id) then raise exception 'Demande introuvable'; end if;
  if r.status not in ('a_faire', 'prete') then raise exception 'Cette demande est déjà fermée'; end if;
  if p_sent_on is null or p_sent_on > current_date then raise exception 'Date d''envoi invalide'; end if;
  perform set_audit_context('réponse envoyée à l''autorité', coalesce(nullif(trim(p_note), ''), r.title));
  update authority_requests set status = 'repondue', sent_on = p_sent_on, answered_at = now(), answered_by = auth.uid(),
         ready_note = coalesce(ready_note, nullif(trim(p_note), ''))
  where id = p_request;
  perform notify(_request_assignee(r), r.dossier_id, 'demande_autorite', 'Réponse envoyée à l''autorité', r.title);
  perform _close_complement_if_done(r.dossier_id);
end;
$$;

create or replace function public.cancel_request(p_request uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.authority_requests;
  d public.dossiers;
begin
  select * into r from authority_requests where id = p_request for update;
  if not found or not can_view_dossier(r.dossier_id) then raise exception 'Demande introuvable'; end if;
  select * into d from dossiers where id = r.dossier_id;
  if not _actor_can(d, array['GBR', 'CHF']::app_role[]) then
    raise exception 'Action réservée au gestionnaire et au chef du cabinet' using errcode = '42501';
  end if;
  if r.status not in ('a_faire', 'prete') then raise exception 'Cette demande est déjà fermée'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Motif obligatoire'; end if;
  perform set_audit_context('demande de l''autorité annulée', trim(p_reason));
  update authority_requests set status = 'annulee', cancel_reason = trim(p_reason) where id = p_request;
  perform _close_complement_if_done(r.dossier_id);
end;
$$;

-- Pas de décision ni de retour à « Soumis » tant qu'une demande est ouverte
create or replace function public.check_open_requests()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if new.status in (80, 90) and old.status = 85 or new.status = 90 then
    select count(*) into v_n from authority_requests where dossier_id = new.id and status in ('a_faire', 'prete');
    if v_n > 0 then
      raise exception '% demande(s) de l''autorité encore ouverte(s) : répondez-y ou annulez-les d''abord', v_n;
    end if;
  end if;
  return new;
end;
$$;
create trigger dossiers_check_open_requests before update of status on public.dossiers
  for each row execute function public.check_open_requests();

-- Rappels d'échéance : 7, 3 et 1 jour(s) avant, puis chaque jour en retard.
-- À planifier avec pg_cron (voir README), une fois par jour.
create or replace function public.notify_request_deadlines()
returns int language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_days int;
  v_title text;
  v_count int := 0;
begin
  for r in
    select a.*, d.number, d.office_code, case a.assignee_role when 'COL' then d.collector_id else d.processor_id end as assignee
    from authority_requests a join dossiers d on d.id = a.dossier_id
    where a.status in ('a_faire', 'prete') and d.status in (80, 85)
  loop
    v_days := r.due_on - current_date;
    if v_days in (7, 3, 1) or v_days <= 0 then
      v_title := case
        when v_days < 0 then format('En retard de %s jour(s) : demande de l''autorité', -v_days)
        when v_days = 0 then 'Échéance aujourd''hui : demande de l''autorité'
        else format('Échéance dans %s jour(s) : demande de l''autorité', v_days) end;
      if not exists (select 1 from notifications where dossier_id = r.dossier_id and kind = 'echeance'
                     and body = r.number || ' : ' || r.title and created_at > now() - interval '20 hours') then
        if r.status = 'a_faire' then
          perform notify(r.assignee, r.dossier_id, 'echeance', v_title, r.number || ' : ' || r.title);
        end if;
        perform notify_role('CHF', null, r.dossier_id, 'echeance', v_title, r.number || ' : ' || r.title);
        if v_days <= 1 then
          perform notify_role('GBR', r.office_code, r.dossier_id, 'echeance', v_title, r.number || ' : ' || r.title);
        end if;
        v_count := v_count + 1;
      end if;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public._request_assignee(public.authority_requests) from public, anon, authenticated;
revoke execute on function public._close_complement_if_done(uuid) from public, anon, authenticated;
revoke execute on function public.check_open_requests() from public, anon, authenticated;
revoke execute on function public.notify_request_deadlines() from public, anon, authenticated;
revoke execute on function public.add_authority_request(uuid, text, text, text, date, date, text) from public, anon;
grant execute on function public.add_authority_request(uuid, text, text, text, date, date, text) to authenticated;
revoke execute on function public.mark_request_ready(uuid, text) from public, anon;
grant execute on function public.mark_request_ready(uuid, text) to authenticated;
revoke execute on function public.mark_request_answered(uuid, date, text) from public, anon;
grant execute on function public.mark_request_answered(uuid, date, text) to authenticated;
revoke execute on function public.cancel_request(uuid, text) from public, anon;
grant execute on function public.cancel_request(uuid, text) to authenticated;

-- >>> supabase/migrations/0015_document_expiry_alerts.sql
-- =====================================================================
-- 0015 : alertes d'expiration des pièces
-- - Date d'expiration obligatoire pour les pièces qui expirent (passeport,
--   tests de langue, certificat de police, examen médical, CAQ, CSQ, EIMT...)
-- - Correction d'une date mal saisie (journalisée)
-- - Liste des pièces qui expirent bientôt, selon les dossiers visibles
-- - Rappels automatiques 90, 60, 30, 14 et 7 jours avant, le jour même,
--   puis chaque semaine tant que la pièce expirée n'est pas remplacée
-- Seuls les dossiers en cours sont concernés (fermés et annulés exclus).
-- =====================================================================

alter table public.document_types add column if not exists expiry_required boolean not null default false;

update public.document_types set expiry_required = true
where code in ('PASSEPORT', 'CARTE-IDENTITE', 'RESULTAT-TEF', 'RESULTAT-TCF', 'RESULTAT-IELTS', 'RESULTAT-CELPIP',
               'CERTIFICAT-POLICE', 'EXAMEN-MEDICAL', 'CAQ', 'CSQ', 'EIMT', 'OFFRE-EMPLOI', 'LETTRE-ADMISSION');

-- Une pièce qui expire doit avoir sa date d'expiration
create or replace function public.check_document_expiry()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_required boolean;
begin
  select expiry_required into v_required from document_types where code = new.type_code;
  if v_required and new.expires_on is null then
    raise exception 'Date d''expiration obligatoire pour cette pièce (%)',
      (select label from document_types where code = new.type_code);
  end if;
  if new.expires_on is not null and new.issued_on is not null and new.expires_on <= new.issued_on then
    raise exception 'La date d''expiration doit être après la date d''émission';
  end if;
  return new;
end;
$$;
-- nom choisi pour passer après documents_check_file (ordre alphabétique des déclencheurs)
create trigger documents_validate_expiry before insert on public.documents
  for each row execute function public.check_document_expiry();

-- Correction de la date d'expiration d'une pièce (erreur de saisie)
create or replace function public.set_document_expiry(p_document uuid, p_expires_on date)
returns void language plpgsql security definer set search_path = public as $$
declare
  doc public.documents;
  d public.dossiers;
begin
  select * into doc from documents where id = p_document;
  if not found or not can_view_dossier(doc.dossier_id) then raise exception 'Pièce introuvable'; end if;
  select * into d from dossiers where id = doc.dossier_id;
  if not _actor_can(d, array['COL', 'TRT', 'GBR', 'CHF', 'ADM']::app_role[]) then
    raise exception 'Action non autorisée sur ce dossier' using errcode = '42501';
  end if;
  if d.status in (90, 99) then raise exception 'Dossier fermé : lecture seule'; end if;
  if p_expires_on is null and (select expiry_required from document_types where code = doc.type_code) then
    raise exception 'Date d''expiration obligatoire pour cette pièce';
  end if;
  perform set_audit_context('date d''expiration corrigée', doc.file_name);
  update documents set expires_on = p_expires_on where id = p_document;
end;
$$;

-- Pièces en vigueur qui expirent dans les p_days prochains jours (ou déjà expirées)
create or replace function public.document_expirations(p_days int default 90)
returns table (
  document_id uuid, dossier_id uuid, dossier_number text, dossier_status smallint, office_code char(3),
  person_code text, person_name text, type_code text, type_label text, file_name text,
  expires_on date, days_left int, collector_id uuid, processor_id uuid
)
language sql stable security definer set search_path = public as $$
  select doc.id, d.id, d.number, d.status, d.office_code,
         doc.person_code, m.last_name || ' ' || m.first_name, t.code, t.label, doc.file_name,
         doc.expires_on, (doc.expires_on - current_date)::int, d.collector_id, d.processor_id
  from documents doc
  join dossiers d on d.id = doc.dossier_id
  join document_types t on t.code = doc.type_code
  left join dossier_members m on m.dossier_id = d.id and m.person_code = doc.person_code
  where doc.is_current
    and doc.expires_on is not null
    and doc.expires_on <= current_date + greatest(p_days, 0)
    and d.status not in (90, 99)
    and public.can_view_dossier(d.id)
  order by doc.expires_on, d.number;
$$;

-- Rappels quotidiens (à planifier avec pg_cron, voir README)
create or replace function public.notify_document_expirations()
returns int language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_title text;
  v_body text;
  v_count int := 0;
begin
  for r in
    select doc.id, doc.dossier_id, doc.person_code, doc.expires_on, (doc.expires_on - current_date)::int as days_left,
           t.label, d.number, d.status, d.office_code, d.collector_id, d.processor_id
    from documents doc
    join dossiers d on d.id = doc.dossier_id
    join document_types t on t.code = doc.type_code
    where doc.is_current and doc.expires_on is not null and d.status not in (90, 99)
      and doc.expires_on <= current_date + 90
  loop
    if not (r.days_left in (90, 60, 30, 14, 7, 0) or (r.days_left < 0 and r.days_left % 7 = 0)) then
      continue;
    end if;
    v_title := case
      when r.days_left < 0 then format('Pièce expirée depuis %s jour(s)', -r.days_left)
      when r.days_left = 0 then 'Pièce qui expire aujourd''hui'
      else format('Pièce qui expire dans %s jours', r.days_left) end;
    v_body := r.number || ' : ' || r.label || ' (' || r.person_code || '), expire le ' || to_char(r.expires_on, 'DD/MM/YYYY');
    if exists (select 1 from notifications where dossier_id = r.dossier_id and kind = 'expiration'
               and body = v_body and created_at > now() - interval '20 hours') then
      continue;
    end if;
    -- l'agent de collecte obtient la nouvelle pièce auprès du client
    perform notify(r.collector_id, r.dossier_id, 'expiration', v_title, v_body);
    -- l'agent de traitement est prévenu pendant qu'il travaille sur le dossier
    if r.status between 20 and 85 then
      perform notify(r.processor_id, r.dossier_id, 'expiration', v_title, v_body);
    end if;
    -- à 30 jours ou moins : le gestionnaire du bureau ; après soumission : aussi le chef
    if r.days_left <= 30 then
      perform notify_role('GBR', r.office_code, r.dossier_id, 'expiration', v_title, v_body);
      if r.status in (80, 85) then
        perform notify_role('CHF', null, r.dossier_id, 'expiration', v_title, v_body);
      end if;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.check_document_expiry() from public, anon, authenticated;
revoke execute on function public.notify_document_expirations() from public, anon, authenticated;
revoke execute on function public.set_document_expiry(uuid, date) from public, anon;
grant execute on function public.set_document_expiry(uuid, date) to authenticated;
revoke execute on function public.document_expirations(int) from public, anon;
grant execute on function public.document_expirations(int) to authenticated;
