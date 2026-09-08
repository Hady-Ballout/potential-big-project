-- Demo data for local development. Loaded automatically by `supabase db reset`.
-- Demo resident login: demo@interphone.local / demo1234  (apartment 1A)
-- Device token for the firmware / virtual device: demo-device-token-change-me

insert into public.buildings (id, slug, name) values
  ('00000000-0000-0000-0000-000000000001', 'demo-building', 'Demo Building, Beirut');

insert into public.apartments (id, building_id, label, sort_order) values
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000001', '1A', 1),
  ('00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-000000000001', '1B', 2),
  ('00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-000000000001', '2A', 3),
  ('00000000-0000-0000-0000-00000000a004', '00000000-0000-0000-0000-000000000001', '2B', 4),
  ('00000000-0000-0000-0000-00000000a005', '00000000-0000-0000-0000-000000000001', '3A', 5);

insert into public.devices (id, building_id, name) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-000000000001', 'Main door');
insert into public.device_tokens (device_id, token_hash) values
  ('00000000-0000-0000-0000-00000000d001', encode(digest('demo-device-token-change-me', 'sha256'), 'hex'));

-- Demo resident. Inserting into auth.users directly is fine for local seeds.
-- The token columns must be '' not NULL, otherwise GoTrue fails with "Database error querying schema".
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change,
                        email_change_token_current, phone_change, phone_change_token, reauthentication_token)
values ('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'demo@interphone.local',
        crypt('demo1234', gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}', '{"display_name":"Hady (1A)"}', now(), now(),
        '', '', '', '', '', '', '', '');
insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
values (gen_random_uuid(), '00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000e0001', 'email',
        '{"sub":"00000000-0000-0000-0000-0000000e0001","email":"demo@interphone.local"}', now(), now(), now());

-- second resident in 2A, used to prove RLS isolation
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change,
                        email_change_token_current, phone_change, phone_change_token, reauthentication_token)
values ('00000000-0000-0000-0000-0000000e0002', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'neighbour@interphone.local',
        crypt('demo1234', gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}', '{"display_name":"Neighbour (2A)"}', now(), now(),
        '', '', '', '', '', '', '', '');
insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
values (gen_random_uuid(), '00000000-0000-0000-0000-0000000e0002', '00000000-0000-0000-0000-0000000e0002', 'email',
        '{"sub":"00000000-0000-0000-0000-0000000e0002","email":"neighbour@interphone.local"}', now(), now(), now());

insert into public.apartment_members (apartment_id, profile_id, role) values
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-0000000e0001', 'owner'),
  ('00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-0000000e0002', 'owner');
