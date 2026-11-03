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
