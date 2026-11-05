-- =====================================================================
-- 0016 : notifications par courriel
-- Un agent qui n'est pas connecté reçoit par courriel les notifications
-- qu'il n'a pas lues dans l'application après un court délai (10 minutes
-- par défaut). S'il les a déjà vues à l'écran, aucun courriel ne part.
--
-- Envoi : service Resend (https://resend.com), appelé depuis la base par
-- l'extension pg_net. La clé d'API est rangée dans le coffre de Supabase
-- (Vault), sous le nom « resend_api_key » ; elle n'est jamais lisible par
-- l'application ni par les agents.
--
-- Les courriels ne contiennent ni nom de client ni pièce : seulement le
-- numéro de dossier et un lien vers la plateforme (connexion obligatoire).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Paramètres et préférences
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value, label) values
  ('courriel_actif',         'false',                                    'Envoyer les notifications par courriel'),
  ('courriel_expediteur',    '"BalCanis <notifications@balcanis.ca>"',   'Adresse d''expédition des courriels'),
  ('url_application',        '"http://localhost:3000"',                  'Adresse de la plateforme (liens dans les courriels)'),
  ('courriel_delai_minutes', '10',                                       'Délai avant l''envoi d''une notification non lue (minutes)')
on conflict (key) do nothing;

-- tous : chaque notification non lue (regroupées) ; quotidien : un résumé
-- chaque matin ; aucun : seulement dans l'application
alter table public.profiles add column if not exists email_pref text not null default 'tous'
  check (email_pref in ('tous', 'quotidien', 'aucun'));

create or replace function public.set_email_pref(p_pref text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.session_ok() then raise exception 'Session non autorisée' using errcode = '42501'; end if;
  if p_pref not in ('tous', 'quotidien', 'aucun') then raise exception 'Préférence inconnue : %', p_pref; end if;
  perform set_config('app.action', 'préférence de courriel modifiée', true);
  update profiles set email_pref = p_pref where id = auth.uid();
end;
$$;

-- Validation des nouveaux paramètres (les règles de 0012 sont reprises)
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
  if p_key = 'courriel_delai_minutes' and ((p_value)::text::int < 0 or (p_value)::text::int > 240) then
    raise exception 'Délai d''envoi entre 0 et 240 minutes';
  end if;
  if p_key = 'courriel_expediteur'
     and (jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^[^<>]*<?[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+>?$') then
    raise exception 'Adresse d''expédition invalide (ex. BalCanis <notifications@balcanis.ca>)';
  end if;
  if p_key = 'url_application'
     and (jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^https?://[^\s"<>]+$') then
    raise exception 'Adresse de la plateforme invalide (ex. https://dossiers.balcanis.ca)';
  end if;
  update app_settings set value = p_value, updated_at = now(), updated_by = auth.uid() where key = p_key;
  if not found then raise exception 'Paramètre inconnu : %', p_key; end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. File d'envoi (journal des courriels)
-- ---------------------------------------------------------------------
create table public.email_outbox (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references public.profiles(id),
  to_email         text not null,
  kind             text not null,              -- notifications | resume | test
  subject          text not null,
  html             text not null,
  text_body        text not null,
  notification_ids bigint[] not null default '{}',
  status           text not null default 'en_attente'
                   check (status in ('en_attente', 'transmis', 'envoye', 'echec')),
  attempts         int not null default 0,
  request_id       bigint,
  last_error       text,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz
);
create index on public.email_outbox (status, created_at);
create index on public.email_outbox (user_id, created_at desc);

-- aucune lecture directe : le journal passe par email_log() (ADM, CHF)
alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Mise en forme
-- ---------------------------------------------------------------------
create or replace function public.html_escape(t text)
returns text language sql immutable as $$
  select replace(replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;');
$$;

-- p_items : [{ "title": …, "body": …, "link": "/dossiers/…", "at": … }]
create or replace function public.email_render(p_name text, p_intro text, p_items jsonb, out html text, out txt text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_url text := rtrim(coalesce(setting('url_application') #>> '{}', ''), '/');
  it jsonb;
  v_rows text := '';
  v_lines text := '';
  v_link text;
begin
  for it in select * from jsonb_array_elements(p_items) loop
    v_link := v_url || coalesce(it ->> 'link', '/');
    v_rows := v_rows ||
      '<tr><td style="padding:14px 0;border-bottom:1px solid #e2e8f0">' ||
      '<div style="font-size:15px;font-weight:600;color:#21337D">' || html_escape(it ->> 'title') || '</div>' ||
      case when coalesce(it ->> 'body', '') <> '' then
        '<div style="margin-top:3px;font-size:14px;color:#475569">' || html_escape(it ->> 'body') || '</div>' else '' end ||
      '<div style="margin-top:8px"><a href="' || html_escape(v_link) || '" style="font-size:13px;font-weight:600;color:#EC1C2C;text-decoration:none">Ouvrir dans la plateforme</a></div>' ||
      '</td></tr>';
    v_lines := v_lines || '- ' || (it ->> 'title') ||
      case when coalesce(it ->> 'body', '') <> '' then ' : ' || (it ->> 'body') else '' end ||
      E'\n  ' || v_link || E'\n';
  end loop;

  html :=
    '<!doctype html><html lang="fr"><body style="margin:0;background:#f4f6fb;font-family:Segoe UI,Arial,sans-serif">' ||
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 12px"><tr><td align="center">' ||
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0">' ||
    '<tr><td style="background:#21337D;padding:18px 24px;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.3px">BalCanis' ||
    '<span style="display:block;font-size:12px;font-weight:400;opacity:.8">Gestion des dossiers</span></td></tr>' ||
    '<tr><td style="height:4px;background:#EC1C2C"></td></tr>' ||
    '<tr><td style="padding:24px">' ||
    '<p style="margin:0 0 6px;font-size:15px;color:#0f172a">Bonjour ' || html_escape(coalesce(nullif(p_name, ''), '')) || ',</p>' ||
    '<p style="margin:0 0 8px;font-size:14px;color:#475569">' || html_escape(p_intro) || '</p>' ||
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' || v_rows || '</table>' ||
    '<p style="margin:22px 0 0"><a href="' || html_escape(v_url || '/') || '" style="display:inline-block;background:#21337D;color:#ffffff;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none">Se connecter à la plateforme</a></p>' ||
    '</td></tr>' ||
    '<tr><td style="padding:14px 24px;background:#f8fafc;font-size:12px;color:#64748b">' ||
    'Courriel automatique : n''y répondez pas. Pour la confidentialité des clients, aucun nom ni aucune pièce n''est envoyé par courriel. ' ||
    'Vous pouvez choisir de recevoir un résumé par jour, ou aucun courriel, dans Mon profil.' ||
    '</td></tr></table></td></tr></table></body></html>';

  txt := 'Bonjour ' || coalesce(p_name, '') || E',\n\n' || p_intro || E'\n\n' || v_lines ||
         E'\nSe connecter : ' || v_url || E'/\n\n' ||
         E'Courriel automatique : n''y répondez pas. Préférences de courriel : Mon profil.\n';
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Envoi par Resend (pg_net)
-- ---------------------------------------------------------------------
create or replace function public.email_key()
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if to_regclass('vault.decrypted_secrets') is null then return null; end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into v using 'resend_api_key';
  return nullif(v, '');
end;
$$;

create or replace function public.email_dispatch(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  e email_outbox;
  v_key text := email_key();
  v_req bigint;
begin
  select * into e from email_outbox where id = p_id for update;
  if not found or e.status not in ('en_attente', 'echec') then return; end if;
  if v_key is null or to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null then
    update email_outbox set status = 'echec', last_error = case when v_key is null
      then 'Clé d''envoi absente (coffre Supabase : resend_api_key)' else 'Extension pg_net non activée' end
    where id = p_id;
    return;
  end if;
  execute 'select net.http_post(url := $1, body := $2, params := ''{}''::jsonb, headers := $3, timeout_milliseconds := 10000)'
    into v_req
    using 'https://api.resend.com/emails',
          jsonb_build_object('from', setting('courriel_expediteur') #>> '{}', 'to', jsonb_build_array(e.to_email),
                             'subject', e.subject, 'html', e.html, 'text', e.text_body),
          jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key);
  update email_outbox set status = 'transmis', request_id = v_req, attempts = attempts + 1, last_error = null
  where id = p_id;
end;
$$;

-- Lecture des réponses de Resend (pg_net les range dans net._http_response)
create or replace function public.email_check_responses()
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if to_regclass('net._http_response') is null then return; end if;
  for r in execute
    'select o.id, o.attempts, h.status_code, h.timed_out, coalesce(h.error_msg, left(h.content::text, 300)) as err
       from public.email_outbox o join net._http_response h on h.id = o.request_id
      where o.status = ''transmis'''
  loop
    if r.status_code between 200 and 299 then
      update email_outbox set status = 'envoye', sent_at = now() where id = r.id;
    else
      update email_outbox set status = 'echec',
        last_error = coalesce('HTTP ' || r.status_code || ' : ', '') || coalesce(r.err, case when r.timed_out then 'délai dépassé' else 'erreur inconnue' end)
      where id = r.id;
    end if;
  end loop;
  -- pas de réponse après 15 minutes : considéré en échec
  update email_outbox set status = 'echec', last_error = 'Aucune réponse du service d''envoi'
  where status = 'transmis' and created_at < now() - interval '15 minutes';
end;
$$;

create or replace function public.email_enqueue(
  p_user uuid, p_kind text, p_subject text, p_intro text, p_items jsonb, p_notifs bigint[] default '{}'
) returns bigint language plpgsql security definer set search_path = public as $$
declare
  p profiles;
  m record;
  v_id bigint;
begin
  select * into p from profiles where id = p_user;
  if not found or p.email is null or p.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return null; end if;
  select * into m from email_render(split_part(p.full_name, ' ', 1), p_intro, p_items);
  insert into email_outbox (user_id, to_email, kind, subject, html, text_body, notification_ids)
  values (p.id, p.email, p_kind, p_subject, m.html, m.txt, p_notifs)
  returning id into v_id;
  perform email_dispatch(v_id);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Traitement de la file (pg_cron, toutes les 2 minutes)
-- ---------------------------------------------------------------------
create or replace function public.process_email_queue()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_delay int := coalesce((setting('courriel_delai_minutes'))::text::int, 10);
  u record;
  v_count int := 0;
  v_items jsonb;
  v_ids bigint[];
  v_n int;
  v_subject text;
  r record;
begin
  perform email_check_responses();
  if coalesce((setting('courriel_actif'))::text::boolean, false) = false then return 0; end if;
  -- service pas encore configuré : on attend, sans rien marquer comme envoyé
  if email_key() is null or to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null then
    return 0;
  end if;

  -- nouvel essai pour les échecs temporaires (au plus 3 tentatives)
  for r in select id from email_outbox
           where status = 'echec' and attempts between 1 and 2 and created_at > now() - interval '1 day'
             and (last_error like 'HTTP 5%' or last_error like 'HTTP 429%' or last_error like 'Aucune réponse%')
  loop
    perform email_dispatch(r.id);
  end loop;

  for u in
    select n.user_id, array_agg(n.id order by n.id) as ids
    from notifications n
    join profiles p on p.id = n.user_id
    left join auth.users au on au.id = p.id
    where n.read_at is null and n.emailed_at is null
      and n.created_at <= now() - make_interval(mins => v_delay)
      and n.created_at > now() - interval '3 days'      -- pas d'ancien arriéré à l'activation
      and p.active and p.email_pref = 'tous'
      and coalesce(au.banned_until, now() - interval '1 second') < now()
    group by n.user_id
  loop
    select jsonb_agg(jsonb_build_object('title', title, 'body', body, 'link', link) order by id), count(*)
      into v_items, v_n
    from (select * from notifications where id = any (u.ids) order by id limit 20) s;
    select title into v_subject from notifications where id = u.ids[1];
    v_subject := case when v_n = 1 and cardinality(u.ids) = 1 then 'BalCanis : ' || v_subject
                      else 'BalCanis : ' || cardinality(u.ids) || ' notifications en attente' end;
    perform email_enqueue(u.user_id, 'notifications', v_subject,
      case when cardinality(u.ids) = 1 then 'Une action vous attend dans la plateforme BalCanis.'
           else cardinality(u.ids) || ' actions vous attendent dans la plateforme BalCanis.' end,
      v_items, u.ids);
    update notifications set emailed_at = now() where id = any (u.ids);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Résumé du matin pour ceux qui l'ont choisi (pg_cron, une fois par jour)
create or replace function public.send_daily_email_digest()
returns int language plpgsql security definer set search_path = public as $$
declare
  u record;
  v_items jsonb;
  v_count int := 0;
begin
  if coalesce((setting('courriel_actif'))::text::boolean, false) = false then return 0; end if;
  if email_key() is null or to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null then
    return 0;
  end if;
  for u in
    select n.user_id, array_agg(n.id order by n.id) as ids
    from notifications n join profiles p on p.id = n.user_id
    left join auth.users au on au.id = p.id
    where n.read_at is null and n.emailed_at is null
      and n.created_at > now() - interval '7 days'
      and p.active and p.email_pref = 'quotidien'
      and coalesce(au.banned_until, now() - interval '1 second') < now()
    group by n.user_id
  loop
    select jsonb_agg(jsonb_build_object('title', title, 'body', body, 'link', link) order by id)
      into v_items
    from (select * from notifications where id = any (u.ids) order by id limit 30) s;
    perform email_enqueue(u.user_id, 'resume', 'BalCanis : résumé du jour (' || cardinality(u.ids) || ')',
      'Voici les notifications que vous n''avez pas encore lues.', v_items, u.ids);
    update notifications set emailed_at = now() where id = any (u.ids);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Administration : test, état et journal (ADM, CHF)
-- ---------------------------------------------------------------------
create or replace function public.send_test_email()
returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  perform require_role(array['ADM', 'CHF']::app_role[]);
  v := email_enqueue(auth.uid(), 'test', 'BalCanis : courriel de test',
    'Ce courriel confirme que l''envoi des notifications fonctionne.',
    jsonb_build_array(jsonb_build_object('title', 'Courriel de test', 'body', 'Envoyé depuis Administration > Sécurité', 'link', '/admin/securite')));
  if v is null then raise exception 'Votre profil n''a pas d''adresse courriel valide'; end if;
  perform write_audit(null, 'courriel de test envoyé', 'email_outbox', v::text, null, null, null);
  return v;
end;
$$;

create or replace function public.email_status()
returns table (key_configured boolean, pg_net_enabled boolean, sent_7d bigint, failed_7d bigint, pending bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_role(array['ADM', 'CHF']::app_role[]);
  return query select
    email_key() is not null,
    to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is not null,
    (select count(*) from email_outbox where status = 'envoye' and created_at > now() - interval '7 days'),
    (select count(*) from email_outbox where status = 'echec' and created_at > now() - interval '7 days'),
    (select count(*) from email_outbox where status in ('en_attente', 'transmis'));
end;
$$;

create or replace function public.email_log(p_limit int default 50)
returns table (id bigint, created_at timestamptz, agent_code text, full_name text, to_email text,
               kind text, subject text, status text, attempts int, last_error text, sent_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_role(array['ADM', 'CHF']::app_role[]);
  return query
    select o.id, o.created_at, p.agent_code, p.full_name, o.to_email, o.kind, o.subject, o.status, o.attempts, o.last_error, o.sent_at
    from email_outbox o join profiles p on p.id = o.user_id
    order by o.id desc limit least(greatest(p_limit, 1), 200);
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Droits
-- ---------------------------------------------------------------------
revoke execute on function public.email_key() from public, anon, authenticated;
revoke execute on function public.email_dispatch(bigint) from public, anon, authenticated;
revoke execute on function public.email_check_responses() from public, anon, authenticated;
revoke execute on function public.email_enqueue(uuid, text, text, text, jsonb, bigint[]) from public, anon, authenticated;
revoke execute on function public.email_render(text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.process_email_queue() from public, anon, authenticated;
revoke execute on function public.send_daily_email_digest() from public, anon, authenticated;
revoke execute on function public.send_test_email() from public, anon;
grant execute on function public.send_test_email() to authenticated;
revoke execute on function public.email_status() from public, anon;
grant execute on function public.email_status() to authenticated;
revoke execute on function public.email_log(int) from public, anon;
grant execute on function public.email_log(int) to authenticated;
revoke execute on function public.set_email_pref(text) from public, anon;
grant execute on function public.set_email_pref(text) to authenticated;
