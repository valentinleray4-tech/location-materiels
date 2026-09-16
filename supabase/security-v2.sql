-- Loc'APEL - durcissement Supabase pour security-v2
-- A exécuter dans Supabase > SQL Editor avant mise en production.

-- 1) Le catalogue reste lisible publiquement, mais pas modifiable par le navigateur.
alter table public.materiels enable row level security;
revoke insert, update, delete on table public.materiels from anon, authenticated;
grant select on table public.materiels to anon, authenticated;

-- 2) Les réservations deviennent totalement inaccessibles depuis les clés publiques.
-- Les Netlify Functions utilisent la SERVICE_ROLE_KEY et continuent donc à fonctionner.
alter table public.reservations enable row level security;
revoke all on table public.reservations from anon, authenticated;

-- 3) Le bucket des contrats doit être privé.
update storage.buckets
set public = false
where id = 'contrats';

-- 4) Même si d'anciennes policies permissives existent sur storage.objects,
-- ces policies restrictives empêchent anon/authenticated d'accéder au bucket contrats.
drop policy if exists "security_v2_block_contracts_select" on storage.objects;
create policy "security_v2_block_contracts_select"
on storage.objects as restrictive
for select to anon, authenticated
using (bucket_id <> 'contrats');

drop policy if exists "security_v2_block_contracts_insert" on storage.objects;
create policy "security_v2_block_contracts_insert"
on storage.objects as restrictive
for insert to anon, authenticated
with check (bucket_id <> 'contrats');

drop policy if exists "security_v2_block_contracts_update" on storage.objects;
create policy "security_v2_block_contracts_update"
on storage.objects as restrictive
for update to anon, authenticated
using (bucket_id <> 'contrats')
with check (bucket_id <> 'contrats');

drop policy if exists "security_v2_block_contracts_delete" on storage.objects;
create policy "security_v2_block_contracts_delete"
on storage.objects as restrictive
for delete to anon, authenticated
using (bucket_id <> 'contrats');

-- Les comptes administrateurs sont gérés dans Supabase Auth.
-- Aucune policy d'accès direct aux réservations n'est nécessaire :
-- le tableau de bord passe exclusivement par les Netlify Functions protégées.
