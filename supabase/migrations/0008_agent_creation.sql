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
