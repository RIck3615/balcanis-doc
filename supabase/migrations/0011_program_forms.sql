-- =====================================================================
-- 0011 : formulaires officiels à remplir selon le programme
-- Chaque formulaire est un type de pièce de la catégorie 10_FORMULAIRES
-- (ex. FORMULAIRE-IMM1294), ce qui donne des noms de fichiers conformes
-- à la nomenclature. L'agent de traitement remplit le formulaire puis le
-- téléverse ; le dossier ne peut pas aller au contrôle s'il en manque un.
-- La liste par programme est indicative : le cabinet la vérifie et la
-- complète dans Administration > Formulaires.
-- =====================================================================

alter table public.document_types add column if not exists form_number text;
alter table public.document_types add column if not exists official_url text;

insert into public.document_types (code, label, category_code, form_number, official_url) values
  ('FORMULAIRE-IMM5476', 'Recours aux services d''un représentant', '10', 'IMM 5476',
   'https://www.canada.ca/fr/immigration-refugies-citoyennete/services/demande/formulaires-demande-guides/recours-services-representant.htm'),
  ('FORMULAIRE-IMM1294', 'Demande de permis d''études présentée à l''extérieur du Canada', '10', 'IMM 1294', null),
  ('FORMULAIRE-IMM1295', 'Demande de permis de travail présentée à l''extérieur du Canada', '10', 'IMM 1295', null),
  ('FORMULAIRE-IMM5257', 'Demande de visa de résident temporaire', '10', 'IMM 5257', null),
  ('FORMULAIRE-IMM5645', 'Renseignements sur la famille', '10', 'IMM 5645', null),
  ('FORMULAIRE-IMM5710', 'Modifier les conditions ou prolonger le séjour (travailleur)', '10', 'IMM 5710', null),
  ('FORMULAIRE-IMM0008', 'Demande générique pour le Canada', '10', 'IMM 0008', null),
  ('FORMULAIRE-IMM5669', 'Annexe A : antécédents et déclaration', '10', 'IMM 5669', null),
  ('FORMULAIRE-IMM5406', 'Renseignements additionnels sur la famille', '10', 'IMM 5406', null),
  ('FORMULAIRE-IMM1344', 'Demande de parrainage et engagement', '10', 'IMM 1344', null),
  ('FORMULAIRE-IMM5532', 'Renseignements sur la relation et évaluation du parrainage', '10', 'IMM 5532', null),
  ('FORMULAIRE-IMM5444', 'Demande de carte de résident permanent', '10', 'IMM 5444', null),
  ('FORMULAIRE-IMM5524', 'Demande de titre de voyage de résident permanent', '10', 'IMM 5524', null),
  ('FORMULAIRE-CIT0002', 'Demande de citoyenneté canadienne (adultes)', '10', 'CIT 0002', null)
on conflict (code) do nothing;

create table public.program_forms (
  id            bigint generated always as identity primary key,
  program_code  text not null references public.programs(code),
  type_code     text not null references public.document_types(code),
  person_scope  text not null default 'P' check (person_scope in ('P', 'ALL')),
  sort          int not null default 0,
  unique (program_code, type_code)
);

-- Recours à un représentant : tous les programmes (le cabinet représente le client)
insert into public.program_forms (program_code, type_code, person_scope, sort)
select code, 'FORMULAIRE-IMM5476', 'P', 0 from public.programs;

insert into public.program_forms (program_code, type_code, person_scope, sort) values
  ('VR', 'FORMULAIRE-IMM5257', 'ALL', 10), ('VR', 'FORMULAIRE-IMM5645', 'P', 20),
  ('SV', 'FORMULAIRE-IMM5257', 'P', 10), ('SV', 'FORMULAIRE-IMM5645', 'P', 20),
  ('PE', 'FORMULAIRE-IMM1294', 'P', 10), ('PE', 'FORMULAIRE-IMM5645', 'P', 20),
  ('PT-EIMT', 'FORMULAIRE-IMM1295', 'P', 10), ('PT-EIMT', 'FORMULAIRE-IMM5645', 'P', 20),
  ('PT-MI', 'FORMULAIRE-IMM1295', 'P', 10), ('PT-MI', 'FORMULAIRE-IMM5645', 'P', 20),
  ('PT-PDE', 'FORMULAIRE-IMM5710', 'P', 10),
  ('PCP', 'FORMULAIRE-IMM0008', 'P', 10), ('PCP', 'FORMULAIRE-IMM5669', 'ALL', 20), ('PCP', 'FORMULAIRE-IMM5406', 'ALL', 30),
  ('PIA', 'FORMULAIRE-IMM0008', 'P', 10), ('PIA', 'FORMULAIRE-IMM5669', 'ALL', 20), ('PIA', 'FORMULAIRE-IMM5406', 'ALL', 30),
  ('PF-CONJ', 'FORMULAIRE-IMM1344', 'P', 10), ('PF-CONJ', 'FORMULAIRE-IMM5532', 'P', 20),
  ('PF-CONJ', 'FORMULAIRE-IMM0008', 'P', 30), ('PF-CONJ', 'FORMULAIRE-IMM5669', 'ALL', 40), ('PF-CONJ', 'FORMULAIRE-IMM5406', 'ALL', 50),
  ('PF-ENF', 'FORMULAIRE-IMM1344', 'P', 10), ('PF-ENF', 'FORMULAIRE-IMM0008', 'P', 20),
  ('PF-ENF', 'FORMULAIRE-IMM5669', 'ALL', 30), ('PF-ENF', 'FORMULAIRE-IMM5406', 'ALL', 40),
  ('PF-PGP', 'FORMULAIRE-IMM1344', 'P', 10), ('PF-PGP', 'FORMULAIRE-IMM0008', 'P', 20),
  ('PF-PGP', 'FORMULAIRE-IMM5669', 'ALL', 30), ('PF-PGP', 'FORMULAIRE-IMM5406', 'ALL', 40),
  ('CRP', 'FORMULAIRE-IMM5444', 'P', 10),
  ('TVRP', 'FORMULAIRE-IMM5524', 'P', 10),
  ('CIT', 'FORMULAIRE-CIT0002', 'P', 10);

alter table public.program_forms enable row level security;
revoke insert, update, delete, truncate on public.program_forms from anon, authenticated;
grant select on public.program_forms to authenticated;
create policy "lecture référentiel" on public.program_forms for select to authenticated using (true);
create trigger audit_program_forms after insert or update or delete on public.program_forms
  for each row execute function public.audit_row();

-- État des formulaires d'un dossier : un par personne concernée et par formulaire
create or replace function public.dossier_forms(p_dossier uuid)
returns table (
  person_code text, type_code text, form_number text, label text, official_url text,
  document_id uuid, file_name text, version int, uploaded_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select m.person_code, t.code, t.form_number, t.label, t.official_url,
         doc.id, doc.file_name, doc.version, doc.uploaded_at
  from dossiers d
  join program_forms f on f.program_code = d.program_code
  join document_types t on t.code = f.type_code and t.active
  join dossier_members m on m.dossier_id = d.id and (f.person_scope = 'ALL' or m.person_code = 'P')
  left join documents doc on doc.dossier_id = d.id and doc.person_code = m.person_code
                         and doc.type_code = t.code and doc.is_current
  where d.id = p_dossier and public.can_view_dossier(d.id)
  order by m.person_code, f.sort, t.code;
$$;

-- Pas d'envoi au contrôle tant qu'un formulaire manque
create or replace function public.check_forms_before_control()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_missing text;
begin
  if new.status = 40 and old.status is distinct from 40 then
    select string_agg(t.form_number || ' (' || m.person_code || ')', ', ' order by m.person_code, t.form_number)
      into v_missing
    from program_forms f
    join document_types t on t.code = f.type_code and t.active
    join dossier_members m on m.dossier_id = new.id and (f.person_scope = 'ALL' or m.person_code = 'P')
    where f.program_code = new.program_code
      and not exists (select 1 from documents doc where doc.dossier_id = new.id and doc.person_code = m.person_code
                      and doc.type_code = t.code and doc.is_current);
    if v_missing is not null then
      raise exception 'Formulaires à téléverser avant le contrôle : %', v_missing;
    end if;
  end if;
  return new;
end;
$$;
create trigger dossiers_forms_before_control before update of status on public.dossiers
  for each row execute function public.check_forms_before_control();

-- ---------------------------------------------------------------------
-- Administration de la liste (ADM, CHF)
-- ---------------------------------------------------------------------
create or replace function public.save_form_type(p_number text, p_label text, p_url text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_number text := upper(regexp_replace(trim(p_number), '\s+', ' ', 'g'));
  v_code text := 'FORMULAIRE-' || regexp_replace(upper(trim(p_number)), '[^A-Z0-9]', '', 'g');
begin
  perform require_role(array['ADM', 'CHF']::app_role[]);
  if v_code = 'FORMULAIRE-' or coalesce(trim(p_label), '') = '' then
    raise exception 'Numéro et titre du formulaire obligatoires';
  end if;
  if nullif(trim(p_url), '') is not null and trim(p_url) !~ '^https://' then
    raise exception 'Le lien doit commencer par https://';
  end if;
  insert into document_types (code, label, category_code, form_number, official_url)
  values (v_code, trim(p_label), '10', v_number, nullif(trim(p_url), ''))
  on conflict (code) do update set label = excluded.label, form_number = excluded.form_number,
    official_url = excluded.official_url, active = true;
  return v_code;
end;
$$;

create or replace function public.add_program_form(p_program text, p_type text, p_scope text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role(array['ADM', 'CHF']::app_role[]);
  if not exists (select 1 from document_types where code = p_type and form_number is not null) then
    raise exception 'Formulaire inconnu';
  end if;
  perform set_audit_context('formulaire ajouté au programme ' || p_program);
  insert into program_forms (program_code, type_code, person_scope, sort)
  values (p_program, p_type, coalesce(p_scope, 'P'),
          coalesce((select max(sort) + 10 from program_forms where program_code = p_program), 10))
  on conflict (program_code, type_code) do update set person_scope = excluded.person_scope;
end;
$$;

create or replace function public.remove_program_form(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role(array['ADM', 'CHF']::app_role[]);
  perform set_audit_context('formulaire retiré d''un programme');
  delete from program_forms where id = p_id;
end;
$$;

revoke execute on function public.check_forms_before_control() from public, anon, authenticated;
revoke execute on function public.dossier_forms(uuid) from public, anon;
grant execute on function public.dossier_forms(uuid) to authenticated;
revoke execute on function public.save_form_type(text, text, text) from public, anon;
grant execute on function public.save_form_type(text, text, text) to authenticated;
revoke execute on function public.add_program_form(text, text, text) from public, anon;
grant execute on function public.add_program_form(text, text, text) to authenticated;
revoke execute on function public.remove_program_form(bigint) from public, anon;
grant execute on function public.remove_program_form(bigint) to authenticated;
