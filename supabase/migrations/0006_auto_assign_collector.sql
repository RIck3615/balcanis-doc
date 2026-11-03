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
