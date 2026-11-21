-- User roles and approval status for FileFlicker.
-- Role and status changes are performed only by trusted server-side code.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'user' check (role in ('admin', 'user')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz
);

create index if not exists profiles_status_created_at_idx on public.profiles (status, created_at desc);

alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant all on table public.profiles to service_role;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, role, status, note)
  values (new.id, coalesce(new.email, ''), 'user', 'pending', nullif(trim(coalesce(new.raw_user_meta_data ->> 'note', '')), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

-- Backfill existing users and grant admin + approved status to khan@ynarcher.com.
insert into public.profiles (id, email, role, status, approved_at)
select
  id,
  coalesce(email, ''),
  case when lower(coalesce(email, '')) = 'khan@ynarcher.com' then 'admin' else 'user' end,
  case when lower(coalesce(email, '')) = 'khan@ynarcher.com' then 'approved' else 'pending' end,
  case when lower(coalesce(email, '')) = 'khan@ynarcher.com' then now() else null end
from auth.users
on conflict (id) do update
  set email = excluded.email,
      role = case when lower(excluded.email) = 'khan@ynarcher.com' then 'admin' else public.profiles.role end,
      status = case when lower(excluded.email) = 'khan@ynarcher.com' then 'approved' else public.profiles.status end,
      approved_at = coalesce(public.profiles.approved_at, excluded.approved_at);

-- Enforce approved status on public.files reads as well.
drop policy if exists "Users can read their own files" on public.files;
create policy "Users can read their own files" on public.files
  for select to authenticated using (
    (select auth.uid()) = owner_id
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.status = 'approved'
    )
  );
