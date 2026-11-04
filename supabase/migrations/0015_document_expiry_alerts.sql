-- =====================================================================
-- 0015 : alertes d'expiration des pièces
-- - Date d'expiration obligatoire pour les pièces qui expirent (passeport,
--   tests de langue, certificat de police, examen médical, CAQ, CSQ, EIMT...)
-- - Correction d'une date mal saisie (journalisée)
-- - Liste des pièces qui expirent bientôt, selon les dossiers visibles
-- - Rappels automatiques 90, 60, 30, 14 et 7 jours avant, le jour même,
--   puis chaque semaine tant que la pièce expirée n'est pas remplacée
-- Seuls les dossiers en cours sont concernés (fermés et annulés exclus).
-- =====================================================================

alter table public.document_types add column if not exists expiry_required boolean not null default false;

update public.document_types set expiry_required = true
where code in ('PASSEPORT', 'CARTE-IDENTITE', 'RESULTAT-TEF', 'RESULTAT-TCF', 'RESULTAT-IELTS', 'RESULTAT-CELPIP',
               'CERTIFICAT-POLICE', 'EXAMEN-MEDICAL', 'CAQ', 'CSQ', 'EIMT', 'OFFRE-EMPLOI', 'LETTRE-ADMISSION');

-- Une pièce qui expire doit avoir sa date d'expiration
create or replace function public.check_document_expiry()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_required boolean;
begin
  select expiry_required into v_required from document_types where code = new.type_code;
  if v_required and new.expires_on is null then
    raise exception 'Date d''expiration obligatoire pour cette pièce (%)',
      (select label from document_types where code = new.type_code);
  end if;
  if new.expires_on is not null and new.issued_on is not null and new.expires_on <= new.issued_on then
    raise exception 'La date d''expiration doit être après la date d''émission';
  end if;
  return new;
end;
$$;
-- nom choisi pour passer après documents_check_file (ordre alphabétique des déclencheurs)
create trigger documents_validate_expiry before insert on public.documents
  for each row execute function public.check_document_expiry();

-- Correction de la date d'expiration d'une pièce (erreur de saisie)
create or replace function public.set_document_expiry(p_document uuid, p_expires_on date)
returns void language plpgsql security definer set search_path = public as $$
declare
  doc public.documents;
  d public.dossiers;
begin
  select * into doc from documents where id = p_document;
  if not found or not can_view_dossier(doc.dossier_id) then raise exception 'Pièce introuvable'; end if;
  select * into d from dossiers where id = doc.dossier_id;
  if not _actor_can(d, array['COL', 'TRT', 'GBR', 'CHF', 'ADM']::app_role[]) then
    raise exception 'Action non autorisée sur ce dossier' using errcode = '42501';
  end if;
  if d.status in (90, 99) then raise exception 'Dossier fermé : lecture seule'; end if;
  if p_expires_on is null and (select expiry_required from document_types where code = doc.type_code) then
    raise exception 'Date d''expiration obligatoire pour cette pièce';
  end if;
  perform set_audit_context('date d''expiration corrigée', doc.file_name);
  update documents set expires_on = p_expires_on where id = p_document;
end;
$$;

-- Pièces en vigueur qui expirent dans les p_days prochains jours (ou déjà expirées)
create or replace function public.document_expirations(p_days int default 90)
returns table (
  document_id uuid, dossier_id uuid, dossier_number text, dossier_status smallint, office_code char(3),
  person_code text, person_name text, type_code text, type_label text, file_name text,
  expires_on date, days_left int, collector_id uuid, processor_id uuid
)
language sql stable security definer set search_path = public as $$
  select doc.id, d.id, d.number, d.status, d.office_code,
         doc.person_code, m.last_name || ' ' || m.first_name, t.code, t.label, doc.file_name,
         doc.expires_on, (doc.expires_on - current_date)::int, d.collector_id, d.processor_id
  from documents doc
  join dossiers d on d.id = doc.dossier_id
  join document_types t on t.code = doc.type_code
  left join dossier_members m on m.dossier_id = d.id and m.person_code = doc.person_code
  where doc.is_current
    and doc.expires_on is not null
    and doc.expires_on <= current_date + greatest(p_days, 0)
    and d.status not in (90, 99)
    and public.can_view_dossier(d.id)
  order by doc.expires_on, d.number;
$$;

-- Rappels quotidiens (à planifier avec pg_cron, voir README)
create or replace function public.notify_document_expirations()
returns int language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_title text;
  v_body text;
  v_count int := 0;
begin
  for r in
    select doc.id, doc.dossier_id, doc.person_code, doc.expires_on, (doc.expires_on - current_date)::int as days_left,
           t.label, d.number, d.status, d.office_code, d.collector_id, d.processor_id
    from documents doc
    join dossiers d on d.id = doc.dossier_id
    join document_types t on t.code = doc.type_code
    where doc.is_current and doc.expires_on is not null and d.status not in (90, 99)
      and doc.expires_on <= current_date + 90
  loop
    if not (r.days_left in (90, 60, 30, 14, 7, 0) or (r.days_left < 0 and r.days_left % 7 = 0)) then
      continue;
    end if;
    v_title := case
      when r.days_left < 0 then format('Pièce expirée depuis %s jour(s)', -r.days_left)
      when r.days_left = 0 then 'Pièce qui expire aujourd''hui'
      else format('Pièce qui expire dans %s jours', r.days_left) end;
    v_body := r.number || ' : ' || r.label || ' (' || r.person_code || '), expire le ' || to_char(r.expires_on, 'DD/MM/YYYY');
    if exists (select 1 from notifications where dossier_id = r.dossier_id and kind = 'expiration'
               and body = v_body and created_at > now() - interval '20 hours') then
      continue;
    end if;
    -- l'agent de collecte obtient la nouvelle pièce auprès du client
    perform notify(r.collector_id, r.dossier_id, 'expiration', v_title, v_body);
    -- l'agent de traitement est prévenu pendant qu'il travaille sur le dossier
    if r.status between 20 and 85 then
      perform notify(r.processor_id, r.dossier_id, 'expiration', v_title, v_body);
    end if;
    -- à 30 jours ou moins : le gestionnaire du bureau ; après soumission : aussi le chef
    if r.days_left <= 30 then
      perform notify_role('GBR', r.office_code, r.dossier_id, 'expiration', v_title, v_body);
      if r.status in (80, 85) then
        perform notify_role('CHF', null, r.dossier_id, 'expiration', v_title, v_body);
      end if;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.check_document_expiry() from public, anon, authenticated;
revoke execute on function public.notify_document_expirations() from public, anon, authenticated;
revoke execute on function public.set_document_expiry(uuid, date) from public, anon;
grant execute on function public.set_document_expiry(uuid, date) to authenticated;
revoke execute on function public.document_expirations(int) from public, anon;
grant execute on function public.document_expirations(int) to authenticated;
