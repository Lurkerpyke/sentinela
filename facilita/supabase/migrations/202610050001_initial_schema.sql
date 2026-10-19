create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'worker' check (role in ('admin', 'worker')),
  created_at timestamptz not null default now()
);

create table if not exists public.sectors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.repositors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  barcode text primary key,
  name text not null,
  updated_at timestamptz not null default now(),
  constraint products_barcode_digits check (barcode ~ '^[0-9]+$'),
  constraint products_barcode_length check (char_length(barcode) in (8, 13))
);

create table if not exists public.conferences (
  id uuid primary key,
  sector_id uuid not null references public.sectors(id),
  repositor_id uuid not null references public.repositors(id),
  created_by uuid not null references public.profiles(id),
  started_at timestamptz not null,
  finalized_at timestamptz not null,
  received_at timestamptz,
  status text not null default 'submitted' check (status in ('submitted', 'received')),
  created_at timestamptz not null default now()
);

create table if not exists public.items (
  id uuid primary key,
  conference_id uuid not null references public.conferences(id) on delete cascade,
  barcode text not null,
  name text not null,
  quantity integer not null check (quantity >= 1),
  due_date date not null,
  unregistered boolean not null default false,
  created_at timestamptz not null default now(),
  unique (conference_id, barcode, due_date)
);

create index if not exists conferences_sector_started_idx on public.conferences(sector_id, started_at desc);
create index if not exists conferences_repositor_started_idx on public.conferences(repositor_id, started_at desc);
create index if not exists conferences_status_started_idx on public.conferences(status, started_at desc);
create index if not exists items_due_date_idx on public.items(due_date);
create index if not exists items_unregistered_idx on public.items(unregistered) where unregistered = true;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

create or replace function public.create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role) values (new.id, 'worker')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_facilita on auth.users;
create trigger on_auth_user_created_facilita
after insert on auth.users
for each row execute function public.create_profile_for_auth_user();

alter table public.profiles enable row level security;
alter table public.sectors enable row level security;
alter table public.repositors enable row level security;
alter table public.products enable row level security;
alter table public.conferences enable row level security;
alter table public.items enable row level security;

revoke all on public.profiles, public.sectors, public.repositors, public.products, public.conferences, public.items from anon;
revoke all on function public.is_admin() from public, anon;
grant select, insert, update, delete on public.profiles, public.sectors, public.repositors, public.products, public.conferences, public.items to authenticated;
grant execute on function public.is_admin() to authenticated;

create policy "profiles_read_self_or_admin" on public.profiles
for select to authenticated using (id = (select auth.uid()) or (select public.is_admin()));
create policy "profiles_admin_manage" on public.profiles
for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "sectors_authenticated_read" on public.sectors
for select to authenticated using (active or (select public.is_admin()));
create policy "sectors_admin_manage" on public.sectors
for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "repositors_authenticated_read" on public.repositors
for select to authenticated using (active or (select public.is_admin()));
create policy "repositors_admin_manage" on public.repositors
for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "products_authenticated_read" on public.products
for select to authenticated using (true);
create policy "products_admin_manage" on public.products
for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "conferences_read_own_or_admin" on public.conferences
for select to authenticated using (created_by = (select auth.uid()) or (select public.is_admin()));
create policy "conferences_worker_insert_own" on public.conferences
for insert to authenticated with check (
  created_by = (select auth.uid())
  and exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('worker', 'admin'))
);
create policy "conferences_update_own_or_admin" on public.conferences
for update to authenticated
using (created_by = (select auth.uid()) or (select public.is_admin()))
with check (created_by = (select auth.uid()) or (select public.is_admin()));
create policy "conferences_admin_delete" on public.conferences
for delete to authenticated using ((select public.is_admin()));

create policy "items_read_own_conference_or_admin" on public.items
for select to authenticated using (
  exists (
    select 1 from public.conferences c
    where c.id = conference_id and (c.created_by = (select auth.uid()) or (select public.is_admin()))
  )
);
create policy "items_insert_own_conference_or_admin" on public.items
for insert to authenticated with check (
  exists (
    select 1 from public.conferences c
    where c.id = conference_id and (c.created_by = (select auth.uid()) or (select public.is_admin()))
  )
);
create policy "items_update_own_conference_or_admin" on public.items
for update to authenticated
using (
  exists (
    select 1 from public.conferences c
    where c.id = conference_id and (c.created_by = (select auth.uid()) or (select public.is_admin()))
  )
)
with check (
  exists (
    select 1 from public.conferences c
    where c.id = conference_id and (c.created_by = (select auth.uid()) or (select public.is_admin()))
  )
);
create policy "items_delete_own_conference_or_admin" on public.items
for delete to authenticated using (
  exists (
    select 1 from public.conferences c
    where c.id = conference_id and (c.created_by = (select auth.uid()) or (select public.is_admin()))
  )
);
