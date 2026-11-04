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
