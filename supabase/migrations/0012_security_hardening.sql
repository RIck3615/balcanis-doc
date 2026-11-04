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
