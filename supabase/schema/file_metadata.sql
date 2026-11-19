-- Initial FileFlicker metadata. Storage and processing changes are performed
-- by trusted server-side code; clients can only read their own records.
create table public.files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  original_name text not null check (length(original_name) between 1 and 1024),
  title text check (title is null or length(title) between 1 and 1024),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint not null check (size_bytes >= 0),
  content_type text,
  object_key text not null unique,
  upload_status text not null default 'pending' check (upload_status in ('pending', 'uploaded', 'failed')),
  analysis_status text not null default 'pending' check (analysis_status in ('pending', 'processing', 'completed', 'failed', 'skipped')),
  summary text,
  category text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (owner_id, sha256)
);

create index files_owner_created_at_idx on public.files (owner_id, created_at desc);
alter table public.files enable row level security;
revoke all on table public.files from anon, authenticated;
grant select on table public.files to authenticated;
grant all on table public.files to service_role;
create policy "Users can read their own files" on public.files
  for select to authenticated using ((select auth.uid()) = owner_id);
