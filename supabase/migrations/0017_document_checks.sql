-- =====================================================================
-- 0017 : vérification pièce par pièce par le contrôleur
-- Le contrôleur regarde chaque pièce et coche, point par point, si les
-- informations enregistrées sont exactes (bonne personne, nom, date de
-- naissance, dates d'émission et d'expiration, lisibilité…). Une seule
-- information inexacte rend la pièce non conforme et renvoie le dossier.
-- Les vérifications sont enregistrées au fur et à mesure : le contrôleur
-- peut s'arrêter et reprendre. Elles sont rattachées au tour de contrôle.
-- =====================================================================

create table public.document_checks (
  id            bigint generated always as identity primary key,
  dossier_id    uuid not null references public.dossiers(id),
  document_id   uuid not null references public.documents(id),
  round         int not null,                         -- 1er contrôle, 2e après renvoi…
  controller_id uuid not null references public.profiles(id),
  points        jsonb not null,                       -- { "personne": "exact", "naissance": "inexact", … }
  result        text not null check (result in ('conforme', 'non_conforme')),
  comment       text,
  review_id     uuid references public.reviews(id),
  checked_at    timestamptz not null default now(),
  unique (document_id, round)
);
create index on public.document_checks (dossier_id, round);

alter table public.document_checks enable row level security;
revoke insert, update, delete, truncate on public.document_checks from anon, authenticated;
grant select on public.document_checks to authenticated;
create policy "vérifications des dossiers visibles" on public.document_checks for select to authenticated
  using (public.can_view_dossier(dossier_id));

-- Tour de contrôle en cours : 1 + nombre de contrôles déjà enregistrés
create or replace function public.control_round(p_dossier uuid)
returns int language sql stable security definer set search_path = public as $$
  select 1 + count(*)::int from reviews where dossier_id = p_dossier and level = 'controle';
$$;

-- Points à vérifier pour une pièce, avec la valeur enregistrée dans la plateforme
create or replace function public.document_check_points(p_document uuid)
returns table (key text, label text, expected text)
language plpgsql stable security definer set search_path = public as $$
declare
  doc documents;
  t document_types;
  m dossier_members;
begin
  select * into doc from documents where id = p_document;
  if not found or not can_view_dossier(doc.dossier_id) then raise exception 'Pièce introuvable'; end if;
  select * into t from document_types where code = doc.type_code;
  select * into m from dossier_members where dossier_id = doc.dossier_id and person_code = doc.person_code;

  return query select 'piece', 'Bonne pièce', t.label;
  return query select 'personne', 'Bonne personne : nom et prénom identiques',
    upper(m.last_name) || ' ' || m.first_name || ' (' || doc.person_code || ')';
  if m.birth_date is not null then
    return query select 'naissance', 'Date de naissance identique', to_char(m.birth_date, 'DD/MM/YYYY');
  end if;
  if doc.issued_on is not null then
    return query select 'emission', 'Date d''émission identique', to_char(doc.issued_on, 'DD/MM/YYYY');
  end if;
  if doc.expires_on is not null then
    return query select 'expiration', 'Date d''expiration identique et pièce encore valide',
      to_char(doc.expires_on, 'DD/MM/YYYY') ||
      case when doc.expires_on < current_date then ' (expirée)'
           else ' (' || (doc.expires_on - current_date) || ' jours restants)' end;
  end if;
  if t.form_number is not null then
    return query select 'formulaire', 'Formulaire à jour, toutes les sections remplies, signé et daté', t.form_number;
    return query select 'concordance', 'Informations identiques aux pièces d''identité et aux autres formulaires', null::text;
  end if;
  return query select 'lisible', 'Lisible, complète (toutes les pages), sans retouche', null::text;
end;
$$;

-- Enregistrement de la vérification d'une pièce (contrôleur du dossier, statut 50)
create or replace function public.save_document_check(p_document uuid, p_points jsonb, p_comment text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  doc documents;
  d dossiers;
  v_expected text[];
  v_given text[];
  v_bad int;
  v_result text;
  v_round int;
begin
  select * into doc from documents where id = p_document;
  if not found or not can_view_dossier(doc.dossier_id) then raise exception 'Pièce introuvable'; end if;
  select * into d from dossiers where id = doc.dossier_id;
  if d.status <> 50 then raise exception 'La vérification des pièces se fait pendant le contrôle (statut 50)'; end if;
  if not _actor_can(d, array['CTL']::app_role[]) or d.controller_id is distinct from auth.uid() then
    raise exception 'Seul le contrôleur du dossier vérifie les pièces' using errcode = '42501';
  end if;
  if not doc.is_current then raise exception 'Seule la version en cours d''une pièce se vérifie'; end if;

  select array_agg(key order by key) into v_expected from document_check_points(p_document);
  select array_agg(k order by k) into v_given from jsonb_object_keys(coalesce(p_points, '{}'::jsonb)) k;
  if v_given is distinct from v_expected then
    raise exception 'Répondez à chaque point de la pièce';
  end if;
  if exists (select 1 from jsonb_each_text(p_points) where value not in ('exact', 'inexact')) then
    raise exception 'Réponse invalide : exact ou inexact';
  end if;
  select count(*) into v_bad from jsonb_each_text(p_points) where value = 'inexact';
  v_result := case when v_bad > 0 then 'non_conforme' else 'conforme' end;
  if v_bad > 0 and coalesce(trim(p_comment), '') = '' then
    raise exception 'Expliquez ce qui est inexact pour que l''agent de traitement puisse corriger';
  end if;

  v_round := control_round(d.id);
  insert into document_checks (dossier_id, document_id, round, controller_id, points, result, comment)
  values (d.id, p_document, v_round, auth.uid(), p_points, v_result, nullif(trim(p_comment), ''))
  on conflict (document_id, round) do update
    set points = excluded.points, result = excluded.result, comment = excluded.comment,
        controller_id = excluded.controller_id, checked_at = now();

  perform write_audit(d.id, 'pièce vérifiée : ' || replace(v_result, '_', ' '), 'documents', doc.id::text,
                      null, jsonb_build_object('file_name', doc.file_name, 'points', p_points), nullif(trim(p_comment), ''));
  return v_result;
end;
$$;

-- Annuler la vérification d'une pièce (pour la reprendre)
create or replace function public.clear_document_check(p_document uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  doc documents;
  d dossiers;
begin
  select * into doc from documents where id = p_document;
  if not found or not can_view_dossier(doc.dossier_id) then raise exception 'Pièce introuvable'; end if;
  select * into d from dossiers where id = doc.dossier_id;
  if d.status <> 50 or d.controller_id is distinct from auth.uid() or not _actor_can(d, array['CTL']::app_role[]) then
    raise exception 'Seul le contrôleur du dossier modifie la vérification' using errcode = '42501';
  end if;
  delete from document_checks where document_id = p_document and round = control_round(d.id);
end;
$$;

-- ---------------------------------------------------------------------
-- Enregistrement du contrôle : toutes les pièces doivent être vérifiées,
-- et une pièce non conforme renvoie le dossier comme un point de la liste.
-- (reprise de la fonction de 0002 avec ces deux règles)
-- ---------------------------------------------------------------------
create or replace function public.submit_review(
  p_dossier uuid, p_level text, p_answers jsonb,
  p_comment text default null, p_reason_codes text[] default '{}'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  d public.dossiers;
  v_review uuid;
  v_expected int; v_given int; v_bad int;
  v_returns int; v_return_code text;
  v_bad_reason text;
  v_round int;
  v_unchecked int;
  v_bad_docs int := 0;
begin
  select * into d from dossiers where id = p_dossier for update;
  if not found then raise exception 'Dossier introuvable'; end if;

  if p_level = 'auto' then
    if d.status not in (30, 55, 75) then raise exception 'L''auto-vérification se fait aux statuts 30, 55 ou 75'; end if;
  elsif p_level = 'controle' then
    if d.status <> 50 then raise exception 'Le contrôle se fait au statut 50'; end if;
  else
    raise exception 'Niveau de revue invalide';
  end if;

  -- toutes les questions applicables doivent avoir une réponse valide
  select count(*) into v_expected from checklist_items
  where level = p_level and active and (program_code is null or program_code = d.program_code);
  select count(distinct (a ->> 'item_id')::bigint),
         count(*) filter (where a ->> 'answer' = 'non_conforme')
    into v_given, v_bad
  from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) a
  join checklist_items i on i.id = (a ->> 'item_id')::bigint
   and i.level = p_level and i.active and (i.program_code is null or i.program_code = d.program_code)
  where a ->> 'answer' in ('conforme', 'non_conforme', 'sans_objet');
  if v_given < v_expected then
    raise exception 'Liste de contrôle incomplète : % réponse(s) sur %', v_given, v_expected;
  end if;

  -- contrôle : chaque pièce en cours doit avoir été vérifiée pendant ce tour
  if p_level = 'controle' then
    v_round := control_round(d.id);
    select count(*) into v_unchecked from documents doc
    where doc.dossier_id = d.id and doc.is_current
      and not exists (select 1 from document_checks c where c.document_id = doc.id and c.round = v_round);
    if v_unchecked > 0 then
      raise exception 'Vérifiez toutes les pièces avant d''enregistrer le contrôle : % pièce(s) restante(s)', v_unchecked;
    end if;
    select count(*) into v_bad_docs from document_checks c
    join documents doc on doc.id = c.document_id and doc.is_current
    where c.dossier_id = d.id and c.round = v_round and c.result = 'non_conforme';
    v_bad := v_bad + v_bad_docs;
  end if;

  if p_level = 'auto' then
    perform _check_transition(d, 40::smallint, null);
    if v_bad > 0 then raise exception 'Corrigez les points non conformes avant de soumettre au contrôle'; end if;
    perform set_audit_context('auto-vérification');
    insert into reviews (dossier_id, level, reviewer_id, result, comment)
    values (p_dossier, 'auto', auth.uid(), 'accepte', p_comment) returning id into v_review;
  else
    if v_bad > 0 then
      perform _check_transition(d, 55::smallint, 'renvoi');
      if cardinality(coalesce(p_reason_codes, '{}')) = 0 then
        raise exception 'Choisissez au moins un motif de renvoi';
      end if;
      select string_agg(x, ', ') into v_bad_reason from unnest(p_reason_codes) x
      where x not in (select code from return_reasons);
      if v_bad_reason is not null then raise exception 'Motif de renvoi inconnu : %', v_bad_reason; end if;
      if coalesce(trim(p_comment), '') = '' then raise exception 'Un commentaire est obligatoire pour un renvoi'; end if;
      select count(*) into v_returns from reviews where dossier_id = p_dossier and result = 'renvoye';
      v_return_code := d.number || '-R' || lpad((v_returns + 1)::text, 2, '0');
    else
      perform _check_transition(d, 60::smallint, null);
    end if;
    perform set_audit_context(case when v_bad > 0 then 'contrôle : renvoi ' || v_return_code else 'contrôle : accepté' end, p_comment);
    insert into reviews (dossier_id, level, reviewer_id, result, return_code, reason_codes, comment)
    values (p_dossier, 'controle', auth.uid(), case when v_bad > 0 then 'renvoye' else 'accepte' end,
            v_return_code, coalesce(p_reason_codes, '{}'), p_comment)
    returning id into v_review;
    update document_checks set review_id = v_review where dossier_id = d.id and round = v_round;
  end if;

  insert into review_answers (review_id, item_id, answer, comment)
  select v_review, (a ->> 'item_id')::bigint, a ->> 'answer', nullif(a ->> 'comment', '')
  from jsonb_array_elements(p_answers) a
  join checklist_items i on i.id = (a ->> 'item_id')::bigint and i.level = p_level
  on conflict do nothing;

  if p_level = 'auto' then
    perform _set_status(p_dossier, 40::smallint, null);
  elsif v_bad > 0 then
    perform _set_status(p_dossier, 55::smallint, v_return_code || ' : ' || p_comment);
  else
    perform _set_status(p_dossier, 60::smallint, null);
  end if;
  return v_review;
end;
$$;

revoke execute on function public.control_round(uuid) from public, anon;
grant execute on function public.control_round(uuid) to authenticated;
revoke execute on function public.document_check_points(uuid) from public, anon;
grant execute on function public.document_check_points(uuid) to authenticated;
revoke execute on function public.save_document_check(uuid, jsonb, text) from public, anon;
grant execute on function public.save_document_check(uuid, jsonb, text) to authenticated;
revoke execute on function public.clear_document_check(uuid) from public, anon;
grant execute on function public.clear_document_check(uuid) to authenticated;
revoke execute on function public.submit_review(uuid, text, jsonb, text, text[]) from public, anon;
grant execute on function public.submit_review(uuid, text, jsonb, text, text[]) to authenticated;
