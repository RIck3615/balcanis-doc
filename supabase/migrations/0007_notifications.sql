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
