-- Geri alma: 20261014009000_cl_app_canonical_links.sql
-- portal_account_report_login govdesi 20261013007000 tanimina doner (bildirim href'i eski Ayarlar sekmesi).
-- Kayitli bildirim/icgoru href duzeltmesi GERI ALINMAZ: eski yollar artik yok (kod yayini geri alinmadikca acilmaz);
-- kod da geri alinirsa eski yollar yeniden gecerli olur, yeni yollara giden satirlar o durumda 404 verir.

create or replace function public.portal_account_report_login(p_portal text, p_ok boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_role text := public.current_profile_role();
  v_row public.tenant_portal_accounts%rowtype;
  v_notified integer := 0;
  v_label text;
begin
  if v_tenant is null or auth.uid() is null or coalesce(v_role, '') in ('', 'readonly') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if p_portal is null or p_portal not in ('sahibinden', 'hepsiemlak', 'emlakjet') or p_ok is null then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  insert into public.tenant_portal_accounts as t (tenant_id, portal, status, source, updated_at)
  values (v_tenant, p_portal, 'unknown', 'extension_login', now())
  on conflict (tenant_id, portal) do nothing;

  select * into v_row from public.tenant_portal_accounts
  where tenant_id = v_tenant and portal = p_portal
  for update;

  if v_row.status = 'none' then
    return jsonb_build_object('outcome', 'not_member');
  end if;

  if p_ok then
    update public.tenant_portal_accounts
       set last_login_ok_at = now(), login_fail_streak = 0
     where tenant_id = v_tenant and portal = p_portal;
    return jsonb_build_object('outcome', 'ok', 'streak', 0, 'notified', 0);
  end if;

  update public.tenant_portal_accounts
     set last_login_fail_at = now(), login_fail_streak = login_fail_streak + 1
   where tenant_id = v_tenant and portal = p_portal
  returning * into v_row;

  if v_row.login_fail_streak = 3 then
    v_label := case p_portal when 'sahibinden' then 'Sahibinden' when 'hepsiemlak' then 'Hepsiemlak' else 'Emlakjet' end;
    insert into public.notifications (tenant_id, user_id, title, body, href, kind, dedupe_key)
    select v_tenant, p.id,
           v_label || ' üyeliğiniz bitti mi?',
           'Eklenti ' || v_label || ' mağaza sayfanızı üst üste 3 kez açamadı (portal giriş istedi). Üyelik bittiyse Portal üyelikleri kartında "Üye değiliz" seçin; eklenti bu portala istek atmayı bırakır. Devam ediyorsa tarayıcıda portala yeniden giriş yapın.',
           '/app/ayarlar?sekme=entegrasyon#portal-uyelikleri',
           'warning',
           'portal-login-fail:' || p_portal || ':' || coalesce(to_char(v_row.last_login_ok_at at time zone 'UTC', 'YYYYMMDDHH24MISS'), 'never')
             || ':' || p.id::text
      from public.profiles p
     where p.tenant_id = v_tenant and p.is_active = true and p.role = 'owner'
    on conflict (tenant_id, dedupe_key) where dedupe_key is not null do nothing;
    get diagnostics v_notified = row_count;
  end if;

  return jsonb_build_object('outcome', 'ok', 'streak', v_row.login_fail_streak, 'notified', v_notified);
end;
$$;

revoke all on function public.portal_account_report_login(text, boolean) from public, anon;
grant execute on function public.portal_account_report_login(text, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';
