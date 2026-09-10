-- Private, ephemeral WebRTC signaling authorization. Media and signaling payloads are never stored.
create type public.call_participant_role as enum ('visitor', 'resident');

create table public.call_participants (
  visit_id       uuid not null references public.visits(id) on delete cascade,
  participant_id uuid not null references auth.users(id) on delete cascade,
  role            public.call_participant_role not null,
  created_at      timestamptz not null default now(),
  primary key (visit_id, participant_id)
);

create unique index visits_one_active_per_apartment_idx on public.visits (apartment_id)
  where status in ('ringing', 'answered');

alter table public.call_participants enable row level security;
create policy "participants read own call grant" on public.call_participants
  for select to authenticated using (participant_id = auth.uid());

-- Realtime calls these policies when a client joins/sends on a private channel.
-- Topics are strictly call:<visit uuid>.
create or replace function public.can_access_call_topic(topic text)
returns boolean language sql stable security definer set search_path = public as $$
  select case when topic ~ '^call:[0-9a-f-]{36}$' then exists (
    select 1
    from public.visits v
    where v.id = split_part(topic, ':', 2)::uuid
      and (
        exists (
          select 1 from public.call_participants cp
          where cp.visit_id = v.id and cp.participant_id = auth.uid()
        )
      )
  ) else false end;
$$;

create policy "call participants receive signaling" on realtime.messages
  for select to authenticated using (
    extension = 'broadcast' and public.can_access_call_topic(realtime.topic())
  );
create policy "call participants send signaling" on realtime.messages
  for insert to authenticated with check (
    extension = 'broadcast' and public.can_access_call_topic(realtime.topic())
  );
