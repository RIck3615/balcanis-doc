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
