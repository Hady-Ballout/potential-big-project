-- Interphone schema v1. Apply with `supabase db reset` (local) or `supabase db push` (cloud).
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- buildings / apartments
create table public.buildings (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null check (slug ~ '^[a-z0-9-]{3,40}$'),
  name        text not null,
  created_at  timestamptz not null default now()
);

create table public.apartments (
  id          uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  label       text not null,
  sort_order  int  not null default 0,
  unique (building_id, label)
);

-- ---------------------------------------------------------------- people
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.apartment_members (
  apartment_id uuid not null references public.apartments(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  primary key (apartment_id, profile_id)
);

-- ---------------------------------------------------------------- devices (door controllers)
create table public.devices (
  id           uuid primary key default gen_random_uuid(),
  building_id  uuid not null references public.buildings(id) on delete cascade,
  name         text not null default 'Main door',
  fw_version   text,
  last_state   text,
  last_seen_at timestamptz,
  created_at   timestamptz not null default now()
);

-- Device secrets live in their own table with no client grants at all.
create table public.device_tokens (
  device_id  uuid primary key references public.devices(id) on delete cascade,
  token_hash text not null unique            -- sha256 hex of the device token
);
revoke all on public.device_tokens from anon, authenticated;

-- ---------------------------------------------------------------- visits
create type public.visit_status as enum ('ringing', 'answered', 'unlocked', 'denied', 'expired', 'cancelled');

create table public.visits (
  id           uuid primary key default gen_random_uuid(),
  apartment_id uuid not null references public.apartments(id) on delete cascade,
  status       public.visit_status not null default 'ringing',
  visitor_note text check (char_length(visitor_note) <= 140),
  visitor_ip   inet,
  created_at   timestamptz not null default now(),
  answered_by  uuid references public.profiles(id),
  answered_at  timestamptz,
  ended_at     timestamptz
);
create index visits_apartment_created_idx on public.visits (apartment_id, created_at desc);

-- ---------------------------------------------------------------- commands to the door
create table public.door_commands (
  id           uuid primary key default gen_random_uuid(),
  device_id    uuid not null references public.devices(id) on delete cascade,
  visit_id     uuid references public.visits(id) on delete set null,
  action       text not null check (action in ('unlock', 'deny')),
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '30 seconds',
  delivered_at timestamptz,   -- handed to the device in a poll response
  acked_at     timestamptz    -- device confirmed it in a later poll
);
create index door_commands_pending_idx on public.door_commands (device_id) where delivered_at is null;

-- ---------------------------------------------------------------- web push
create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- ring rate limiting
create table public.ring_log (
  ip         inet not null,
  created_at timestamptz not null default now()
);
create index ring_log_ip_idx on public.ring_log (ip, created_at desc);

-- ---------------------------------------------------------------- helpers
create or replace function public.is_apartment_member(apt uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.apartment_members m
    where m.apartment_id = apt and m.profile_id = auth.uid()
  );
$$;

create or replace function public.is_building_member(bld uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.apartment_members m
    join public.apartments a on a.id = m.apartment_id
    where a.building_id = bld and m.profile_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------- row level security
alter table public.buildings          enable row level security;
alter table public.apartments         enable row level security;
alter table public.profiles           enable row level security;
alter table public.apartment_members  enable row level security;
alter table public.devices            enable row level security;
alter table public.device_tokens      enable row level security;
alter table public.visits             enable row level security;
alter table public.door_commands      enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.ring_log           enable row level security;

-- Residents can see their own building and its apartments.
create policy "members read building"   on public.buildings  for select to authenticated using (public.is_building_member(id));
create policy "members read apartments" on public.apartments for select to authenticated using (public.is_building_member(building_id));

create policy "own profile read"   on public.profiles for select to authenticated using (id = auth.uid());
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid());

create policy "read own memberships" on public.apartment_members for select to authenticated using (profile_id = auth.uid());

-- Residents see their building's devices (for the online/offline indicator). Tokens are in device_tokens.
create policy "members read devices" on public.devices for select to authenticated using (public.is_building_member(building_id));

-- Visits: members of the apartment can read; all writes go through edge functions (service role).
create policy "members read visits" on public.visits for select to authenticated using (public.is_apartment_member(apartment_id));

-- door_commands: no client access at all (service role bypasses RLS).

create policy "own push subs" on public.push_subscriptions for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- ring_log: service role only.

-- ---------------------------------------------------------------- realtime
-- Resident app subscribes to visits changes for its apartments (RLS applies to realtime too).
alter publication supabase_realtime add table public.visits;
alter publication supabase_realtime add table public.devices;
