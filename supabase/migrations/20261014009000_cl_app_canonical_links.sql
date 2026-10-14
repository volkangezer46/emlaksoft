-- CL-APP temizlik: kaldirilan /app yollarina giden KAYITLI baglantilar kanonik hedefe cevrilir (yonlendirme/takma ad YOK).
--  1) portal_account_report_login: portal girisi 3 kez basarisiz olunca sahibe giden bildirimin baglantisi
--     /app/ayarlar?sekme=entegrasyon#portal-uyelikleri -> /app/ayarlar/entegrasyonlar#portal-uyelikleri (govde 20261013007000 ile
--     AYNI, yalniz href degisir).
--  2) Mevcut bildirim ve icgoru satirlarindaki eski yollar yeni yollara cevrilir (yalniz href; baslik/govde degismez).
-- Bagimsiz; KOD YAYINIYLA AYNI pencerede ya da hemen sonra uygulanir (once uygulanirsa yeni yollar kod gelene kadar 404 verir).
-- Idempotent: ikinci calistirmada eslesen satir kalmaz.

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
           '/app/ayarlar/entegrasyonlar#portal-uyelikleri',
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

-- ---------------------------------------------------------------------------
-- Kayitli baglanti duzeltmesi (bildirimler + icgoruler). Eslesme tam yol siniriyla: ardindan $, /, ? ya da # gelir.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.cl_app_canonical_href(p_href text)
returns text
language sql
immutable
as $f$
  select case
    when p_href is null then null
    when p_href ~ '^/app/ayarlar\?sekme=entegrasyon#portal-uyelikleri$' then '/app/ayarlar/entegrasyonlar#portal-uyelikleri'
    when p_href ~ '^/app/ayarlar\?sekme=entegrasyon($|#)' then '/app/ayarlar/entegrasyonlar#eids'
    when p_href ~ '^/app/ayarlar\?sekme=(tum|bildirim)($|#)' then '/app/ayarlar'
    when p_href ~ '^/app/portallar($|[/?#])' then regexp_replace(p_href, '^/app/portallar', '/app/ilan-kontrol/portallar')
    when p_href ~ '^/app/kayip-kacak($|[/?#])' then regexp_replace(p_href, '^/app/kayip-kacak', '/app/ilan-kontrol/kapanis')
    when p_href ~ '^/app/akilli-listeler($|[/?#])' then '/app/musteriler?segment=risk'
    when p_href ~ '^/app/denetim($|[/?#])' then regexp_replace(p_href, '^/app/denetim', '/app/ofis-kontrol/kayit')
    when p_href ~ '^/app/ayarlar/roller($|[/?#])' then '/app/ayarlar/yetkilendirme?sekme=roller'
    when p_href ~ '^/app/raporlar/kar-zarar($|[/?#])' then '/app/giderler?sekme=raporlar'
    when p_href ~ '^/app/raporlar/memnuniyet($|[/?#])' then '/app/anketler?sekme=sonuc'
    when p_href ~ '^/app/ofis-kontrol/karne($|[/?#])' then '/app/danisman-kpi'
    when p_href ~ '^/app/giderler\?sekme=faturalar($|[&#])' then regexp_replace(p_href, '^/app/giderler\?sekme=faturalar', '/app/giderler?sekme=belgeler&tur=fatura')
    when p_href ~ '^/app/giderler\?portal=' then '/app/giderler?sekme=butce#portal-getirisi'
    else p_href
  end
$f$;

update public.notifications
   set href = pg_temp.cl_app_canonical_href(href)
 where href is not null
   and href is distinct from pg_temp.cl_app_canonical_href(href);

do $$
begin
  if pg_catalog.to_regclass('public.insights') is not null then
    execute $q$
      update public.insights
         set href = pg_temp.cl_app_canonical_href(href)
       where href is distinct from pg_temp.cl_app_canonical_href(href)
    $q$;
  end if;
end $$;

notify pgrst, 'reload schema';
