-- =====================================================================
-- 0004 : stockage des fichiers (Supabase Storage)
-- Seau privé « dossiers ». Arborescence : NUMERO_DOSSIER/NN_DOSSIER/fichier
-- Un fichier ne peut être déposé qu'au chemin généré par register_document,
-- ce qui impose la nomenclature. Aucun remplacement ni suppression.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('dossiers', 'dossiers', false)
on conflict (id) do nothing;

create policy "dossiers : lecture si dossier visible" on storage.objects for select to authenticated
  using (bucket_id = 'dossiers' and public.can_view_dossier_number((storage.foldername(name))[1]));

create policy "dossiers : dépôt au chemin enregistré" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'dossiers'
    and exists (
      select 1 from public.documents doc
      where doc.storage_path = storage.objects.name
        and doc.uploaded_by = auth.uid()
        and doc.uploaded_at > now() - interval '15 minutes'
    )
  );
