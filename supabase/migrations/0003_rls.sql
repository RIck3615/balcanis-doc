-- =====================================================================
-- 0003 : sécurité au niveau des lignes (RLS)
-- Lecture seulement, selon le rôle et l'assignation.
-- Aucune politique d'écriture : tout passe par les fonctions de 0002.
-- =====================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'offices', 'programs', 'dossier_statuses', 'status_transitions', 'return_reasons',
    'document_categories', 'document_types', 'required_documents', 'checklist_items',
    'profiles', 'agent_payments', 'agent_counters', 'clients', 'client_counters', 'dossier_counters',
    'dossiers', 'dossier_members', 'documents', 'reviews', 'review_answers',
    'time_sessions', 'audit_log']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Rien n'est accessible sans connexion ; lecture (filtrée par RLS) une fois connecté
revoke all on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;
-- les fonctions internes ne sont pas appelables directement
revoke execute on function public._set_status(uuid, smallint, text) from authenticated;
revoke execute on function public._close_stale_sessions(uuid) from authenticated;
revoke execute on function public.write_audit(uuid, text, text, text, jsonb, jsonb, text) from authenticated;
revoke execute on function public.next_agent_code(text) from authenticated;

-- Référentiels : lisibles par tout utilisateur connecté
do $$
declare t text;
begin
  foreach t in array array[
    'offices', 'programs', 'dossier_statuses', 'status_transitions', 'return_reasons',
    'document_categories', 'document_types', 'required_documents', 'checklist_items']
  loop
    execute format('create policy "lecture référentiel" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

-- Profils : soi-même, ou CHF / ADM / GBR
create policy "profil : soi ou encadrement" on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_role('CHF') or public.has_role('ADM') or public.has_role('GBR'));

-- Coordonnées de paiement : l'agent lui-même et l'administrateur seulement
create policy "paiement : soi ou administrateur" on public.agent_payments for select to authenticated
  using (agent_id = auth.uid() or public.has_role('ADM'));

-- Annuaire sans taux ni coordonnées, pour tout le personnel actif
revoke all on public.staff_directory from anon, authenticated;
grant select on public.staff_directory to authenticated;

-- Clients : encadrement, bureau du gestionnaire ou de l'agent de collecte, ou dossier visible
create policy "clients visibles" on public.clients for select to authenticated
  using (
       public.has_role('CHF') or public.has_role('ADM')
    or ((public.has_role('GBR') or public.has_role('COL')) and office_code = public.my_office())
    or exists (select 1 from public.dossiers d where d.client_id = clients.id and public.can_view_dossier(d.id))
  );

create policy "dossiers visibles" on public.dossiers for select to authenticated
  using (public.can_view_dossier(id));

create policy "membres visibles" on public.dossier_members for select to authenticated
  using (public.can_view_dossier(dossier_id));

create policy "pièces visibles" on public.documents for select to authenticated
  using (public.can_view_dossier(dossier_id));

create policy "revues visibles" on public.reviews for select to authenticated
  using (public.can_view_dossier(dossier_id));

create policy "réponses visibles" on public.review_answers for select to authenticated
  using (exists (select 1 from public.reviews r where r.id = review_answers.review_id and public.can_view_dossier(r.dossier_id)));

-- Temps : ses propres sessions ; encadrement pour tout son périmètre
create policy "temps visibles" on public.time_sessions for select to authenticated
  using (
       agent_id = auth.uid()
    or public.has_role('CHF') or public.has_role('ADM')
    or (public.has_role('GBR') and public.can_view_dossier(dossier_id))
  );

-- Journal : encadrement, ou historique des dossiers que l'on peut voir
create policy "journal visible" on public.audit_log for select to authenticated
  using (
       public.has_role('CHF') or public.has_role('ADM')
    or (dossier_id is not null and public.can_view_dossier(dossier_id))
  );
