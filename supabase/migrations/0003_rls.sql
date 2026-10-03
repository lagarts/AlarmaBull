-- ============================================================
-- 0003_rls.sql
-- Row Level Security: activación + políticas.
-- Regla general: el cliente sólo LEE lo que le corresponde;
-- las escrituras sensibles pasan por funciones SECURITY DEFINER.
-- ============================================================

-- ------------------------------------------------------------
-- Helper sin RLS (evita recursión entre políticas)
-- ------------------------------------------------------------
create or replace function public.is_active_member(p_community_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
      from public.community_members
     where community_id = p_community_id
       and user_id = auth.uid()
       and membership_status = 'active'
  );
$$;

create or replace function public.is_member_any(p_community_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
      from public.community_members
     where community_id = p_community_id
       and user_id = auth.uid()
       and membership_status in ('pending', 'active')
  );
$$;

create or replace function public.is_community_admin(p_community_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
      from public.community_members
     where community_id = p_community_id
       and user_id = auth.uid()
       and role = 'admin'
       and membership_status = 'active'
  );
$$;

-- ------------------------------------------------------------
-- profiles
-- ------------------------------------------------------------
alter table public.profiles enable row level security;

create policy "profiles_select_self_or_admin"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- Vecinos que comparten comunidad activa pueden verse entre sí
-- (nombres en listados, emisor de alertas y destinatarios).
create policy "profiles_select_community_peers"
  on public.profiles for select to authenticated
  using (
    exists (
      select 1
        from public.community_members mine
        join public.community_members theirs
          on theirs.community_id = mine.community_id
       where mine.user_id = auth.uid()
         and mine.membership_status = 'active'
         and theirs.user_id = profiles.id
         and theirs.membership_status in ('active', 'pending')
    )
  );

-- Datos básicos visibles; nada sensible (no hay documento ni email acá).
revoke select on public.profiles from authenticated, anon;
grant select (id, full_name, phone, role, suspended, created_at, updated_at)
  on public.profiles to authenticated;

create policy "profiles_update_self"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Sólo columnas editables por el propio usuario (rol/suspensión: servidor).
revoke update on public.profiles from authenticated, anon;
grant update (full_name, phone, updated_at) on public.profiles to authenticated;
revoke insert, delete on public.profiles from authenticated, anon;

-- ------------------------------------------------------------
-- communities
-- ------------------------------------------------------------
alter table public.communities enable row level security;

create policy "communities_select_member"
  on public.communities for select to authenticated
  using (public.is_member_any(id) or created_by = auth.uid() or public.is_admin());

create policy "communities_update_admin"
  on public.communities for update to authenticated
  using (public.is_community_admin(id))
  with check (public.is_community_admin(id));

-- Crear/eliminar comunidades: únicamente vía create_community().
revoke insert, delete on public.communities from authenticated, anon;

-- ------------------------------------------------------------
-- community_members
-- ------------------------------------------------------------
alter table public.community_members enable row level security;

create policy "community_members_select"
  on public.community_members for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_active_member(community_id)
    or public.is_admin()
  );

-- Altas, aprobaciones y bajas: únicamente vía funciones del servidor.
revoke insert, update, delete on public.community_members from authenticated, anon;

-- ------------------------------------------------------------
-- community_invites
-- ------------------------------------------------------------
alter table public.community_invites enable row level security;

create policy "invites_select_admin"
  on public.community_invites for select to authenticated
  using (created_by = auth.uid() or public.is_community_admin(community_id) or public.is_admin());

revoke insert, update, delete on public.community_invites from authenticated, anon;

-- ------------------------------------------------------------
-- community_logs
-- ------------------------------------------------------------
alter table public.community_logs enable row level security;

create policy "community_logs_select_admin"
  on public.community_logs for select to authenticated
  using (public.is_community_admin(community_id) or public.is_admin());

revoke insert, update, delete on public.community_logs from authenticated, anon;

-- ------------------------------------------------------------
-- subscription_plans (sólo lectura pública del precio vigente)
-- ------------------------------------------------------------
alter table public.subscription_plans enable row level security;

create policy "plans_select"
  on public.subscription_plans for select to authenticated
  using (active = true or public.is_admin());

revoke insert, update, delete on public.subscription_plans from authenticated, anon;

-- ------------------------------------------------------------
-- user_subscriptions (NUNCA modificable desde el cliente)
-- ------------------------------------------------------------
alter table public.user_subscriptions enable row level security;

create policy "subscriptions_select_own_or_admin"
  on public.user_subscriptions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

revoke insert, update, delete on public.user_subscriptions from authenticated, anon;

-- ------------------------------------------------------------
-- payment_events (sólo lectura del propio historial)
-- ------------------------------------------------------------
alter table public.payment_events enable row level security;

create policy "payment_events_select_own_or_admin"
  on public.payment_events for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
        from public.user_subscriptions s
       where s.id = payment_events.user_subscription_id
         and s.user_id = auth.uid()
    )
  );

revoke insert, update, delete on public.payment_events from authenticated, anon;

-- ------------------------------------------------------------
-- alerts
-- ------------------------------------------------------------
alter table public.alerts enable row level security;

create policy "alerts_select_members"
  on public.alerts for select to authenticated
  using (public.is_active_member(community_id) or public.is_admin());

revoke insert, update, delete on public.alerts from authenticated, anon;

-- ------------------------------------------------------------
-- alert_recipients
-- ------------------------------------------------------------
alter table public.alert_recipients enable row level security;

create policy "alert_recipients_select"
  on public.alert_recipients for select to authenticated
  using (
    recipient_user_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1
        from public.alerts a
       where a.id = alert_recipients.alert_id
         and public.is_active_member(a.community_id)
    )
  );

create policy "alert_recipients_update_seen"
  on public.alert_recipients for update to authenticated
  using (recipient_user_id = auth.uid())
  with check (recipient_user_id = auth.uid());

-- El cliente sólo puede marcar "visto"; el estado de envío lo gestiona el servidor.
revoke update on public.alert_recipients from authenticated;
grant update (seen_at) on public.alert_recipients to authenticated;
revoke insert, delete on public.alert_recipients from authenticated, anon;

-- ------------------------------------------------------------
-- push_subscriptions (dispositivos propios)
-- ------------------------------------------------------------
alter table public.push_subscriptions enable row level security;

create policy "push_select_own"
  on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy "push_delete_own"
  on public.push_subscriptions for delete to authenticated
  using (user_id = auth.uid());

-- Registro/upsert: vía register_push_subscription().
revoke insert, update on public.push_subscriptions from authenticated, anon;

-- ------------------------------------------------------------
-- notification_jobs (interno)
-- ------------------------------------------------------------
alter table public.notification_jobs enable row level security;

create policy "notification_jobs_select_admin"
  on public.notification_jobs for select to authenticated
  using (public.is_admin());

revoke insert, update, delete on public.notification_jobs from authenticated, anon;

-- ------------------------------------------------------------
-- emergency_contacts (lectura para todos los autenticados)
-- ------------------------------------------------------------
alter table public.emergency_contacts enable row level security;

create policy "emergency_contacts_select"
  on public.emergency_contacts for select to authenticated
  using (active = true or public.is_admin());

revoke insert, update, delete on public.emergency_contacts from authenticated, anon;

-- ------------------------------------------------------------
-- audit_logs / signup_attempts (sólo servidor y admin)
-- ------------------------------------------------------------
alter table public.audit_logs enable row level security;

create policy "audit_logs_select_admin"
  on public.audit_logs for select to authenticated
  using (public.is_admin());

revoke insert, update, delete on public.audit_logs from authenticated, anon;

alter table public.signup_attempts enable row level security;
revoke all on public.signup_attempts from anon, authenticated;

-- ------------------------------------------------------------
-- Anon no accede a ninguna tabla de la aplicación
-- ------------------------------------------------------------
revoke all on all tables in schema public from anon;

-- ------------------------------------------------------------
-- Realtime (alertas y membresías para las pantallas abiertas)
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'alerts'
  ) then
    alter publication supabase_realtime add table public.alerts;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'alert_recipients'
  ) then
    alter publication supabase_realtime add table public.alert_recipients;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'community_members'
  ) then
    alter publication supabase_realtime add table public.community_members;
  end if;
end
$$;

-- ------------------------------------------------------------
-- Ejecución de funciones
-- ------------------------------------------------------------
revoke execute on all functions in schema public from anon;
grant execute on all functions in schema public to authenticated;

-- Sólo el SQL editor / service role (el grant anterior no debe reabrirla).
revoke execute on function public.admin_promote_by_email(text) from anon, authenticated;
grant execute on function public.admin_promote_by_email(text) to postgres, service_role;
