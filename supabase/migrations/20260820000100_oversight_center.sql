-- Ofis Kontrol Merkezi: esik/onay-kurali ayarlari + uyari "incelendi" durumu.
-- TASLAK: canli DB'ye UYGULANMADI. Forward-only, yeniden calistirilabilir.
-- Kod bu tablolar yokken de calisir (varsayilan esikler, onay kurali kapali, "incelendi" kaydedilemez uyarisi).
-- Yeni modul/izin YOK: ekran mevcut `team` (ofis gorunumu) ve `settings` (kural yazma) yetkilerini kullanir;
-- bu nedenle permission_defaults seed'i gerekmez.
-- Hukuki metin icermez; izleme politikasi aydinlatma metni sahibin kararidir.

create table if not exists public.oversight_settings (
  tenant_id      uuid primary key references public.tenants(id) on delete cascade,
  -- Uyari esikleri ve kural bazli acik/kapali (bkz. src/lib/oversight/settings.ts normalizeThresholds)
  thresholds     jsonb not null default '{}'::jsonb,
  -- Onay zorunlulugu kurallari; varsayilan bos = hepsi KAPALI (danismani yavaslatma)
  approval_rules jsonb not null default '{}'::jsonb,
  updated_by     uuid references public.profiles(id) on delete set null,
  updated_at     timestamptz not null default now()
);

alter table public.oversight_settings enable row level security;

drop policy if exists oversight_settings_select on public.oversight_settings;
create policy oversight_settings_select on public.oversight_settings
  for select using (tenant_id = public.current_tenant_id());

-- Yazma: yalniz ofis sahibi / genel mudur.
drop policy if exists oversight_settings_insert on public.oversight_settings;
create policy oversight_settings_insert on public.oversight_settings
  for insert with check (
    tenant_id = public.current_tenant_id() and public.current_profile_role() in ('owner', 'gm')
  );

drop policy if exists oversight_settings_update on public.oversight_settings;
create policy oversight_settings_update on public.oversight_settings
  for update using (
    tenant_id = public.current_tenant_id() and public.current_profile_role() in ('owner', 'gm')
  ) with check (
    tenant_id = public.current_tenant_id() and public.current_profile_role() in ('owner', 'gm')
  );

drop policy if exists oversight_settings_staff on public.oversight_settings;
create policy oversight_settings_staff on public.oversight_settings
  for all using (public.is_platform_staff()) with check (public.is_platform_staff());

grant select, insert, update on public.oversight_settings to authenticated;

create table if not exists public.oversight_alert_reviews (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  -- Deterministik olay anahtari (kural:kayit[:gun]); ayni olay tekrar uyari uretmez.
  alert_key   text not null check (char_length(alert_key) between 3 and 200),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz not null default now(),
  note        text check (note is null or char_length(note) <= 500),
  unique (tenant_id, alert_key)
);

create index if not exists idx_oversight_alert_reviews_tenant
  on public.oversight_alert_reviews (tenant_id, reviewed_at desc);

alter table public.oversight_alert_reviews enable row level security;

drop policy if exists oversight_alert_reviews_select on public.oversight_alert_reviews;
create policy oversight_alert_reviews_select on public.oversight_alert_reviews
  for select using (
    tenant_id = public.current_tenant_id()
    and public.current_profile_role() in ('owner', 'gm', 'branch_manager')
  );

drop policy if exists oversight_alert_reviews_insert on public.oversight_alert_reviews;
create policy oversight_alert_reviews_insert on public.oversight_alert_reviews
  for insert with check (
    tenant_id = public.current_tenant_id()
    and public.current_profile_role() in ('owner', 'gm', 'branch_manager')
  );

drop policy if exists oversight_alert_reviews_staff on public.oversight_alert_reviews;
create policy oversight_alert_reviews_staff on public.oversight_alert_reviews
  for all using (public.is_platform_staff()) with check (public.is_platform_staff());

grant select, insert on public.oversight_alert_reviews to authenticated;

-- Akis sorgusu: danisman + zaman (denetim akisi).
create index if not exists idx_audit_logs_tenant_actor_created
  on public.audit_logs (tenant_id, actor_id, created_at desc);

notify pgrst, 'reload schema';
