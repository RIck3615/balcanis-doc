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
