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
