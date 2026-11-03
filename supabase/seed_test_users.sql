-- =====================================================================
-- Comptes de TEST (à exécuter dans le SQL Editor de Supabase, après install.sql)
-- Crée 5 comptes confirmés et leur attribue rôles, bureau et certifications.
-- Mot de passe commun : Balcanis-Test-2026
-- Ne jamais exécuter sur le projet de production réel.
-- Le script peut être relancé : les comptes existants sont ignorés.
-- =====================================================================

do $$
declare
  u record;
  v_id uuid;
begin
  for u in
    select * from (values
      ('chef@balcanis.test', 'Chef du cabinet (test)',     '{CHF,ADM}'::public.app_role[], 'KIN', '{}'::text[], null::numeric),
      ('gbr@balcanis.test',  'Gestionnaire KIN (test)',    '{GBR}',                        'KIN', '{}',         null),
      ('col@balcanis.test',  'Agent de collecte (test)',   '{COL}',                        'KIN', '{}',         null),
      ('trt@balcanis.test',  'Agent de traitement (test)', '{TRT}',                        null,  '{*}',        10.00),
      ('ctl@balcanis.test',  'Contrôleur (test)',          '{CTL}',                        null,  '{}',         null)
    ) as t(email, full_name, roles, office, certified, rate)
  loop
    select id into v_id from auth.users where email = u.email;

    if v_id is null then
      v_id := gen_random_uuid();
      insert into auth.users (
        id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change, email_change_token_new
      ) values (
        v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        u.email, crypt('Balcanis-Test-2026', gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', u.full_name),
        now(), now(), '', '', '', ''
      );
      insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
      values (
        gen_random_uuid(), v_id, v_id::text, 'email',
        jsonb_build_object('sub', v_id::text, 'email', u.email, 'email_verified', true),
        now(), now(), now()
      );
    end if;

    -- le profil est créé par le trigger on_auth_user_created ; on lui donne ses droits
    perform public.set_audit_context('profil de test configuré');
    update public.profiles set
      full_name = u.full_name,
      roles = u.roles,
      office_code = u.office,
      certified_programs = u.certified,
      hourly_rate = u.rate,
      active = true,
      agent_code = coalesce(agent_code, public.next_agent_code(u.roles[1]::text))
    where id = v_id;
  end loop;
end $$;

select email, agent_code, roles, office_code, certified_programs, hourly_rate
from public.profiles where email like '%@balcanis.test' order by agent_code;
