-- MIGRATION 20261015010000_commissions_rls_initplan.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI uygular (gölgede denendi:
--   scripts/db-shadow-replay.sh + supabase/tests/kq2_commissions_rls.test.sql).
-- Geri alma: supabase/rollbacks/20261015010000_commissions_rls_initplan.rollback.sql (eski ifade birebir, gölgeden deparse).
-- BAGIMLILIK: 20260816000500_commission_earnings_privacy.sql (can_view_commission_earnings), 20260816000200_commission_splits.sql.
--
-- AMAC (KQ2, RLS maliyeti): commissions_select ifadesi `(select can_view_commission_earnings(tenant_id, deal_id, id))` idi.
--   Arguman satir kolonu oldugu icin bu bir InitPlan DEGIL, satir basina calisan korelasyonlu SubPlan'dir: her satirda
--   DEFINER fonksiyonu + iki has_effective_permission + iki EXISTS (canli 2026-10-15 salt-okunur EXPLAIN ANALYZE,
--   danisman: 18 satirda 8,1 ms, SubPlan loops=18; ayni yuklem yeni bicimde 1,4 ms, sahip 0,7 ms).
-- YENI IFADE (anlam ayni): satirdan BAGIMSIZ kontroller (kiraci, commissions:view, earnings_all:view, auth.uid()) InitPlan
--   olarak sorgu basina BIR kez calisir. Satira bagli kalan tek kisim "danisman kendi anlasmasi / kendi payi"dir; bu da
--   korelasyonsuz IN alt sorgusu olarak yazilir (planlayici hashed SubPlan ya da semi-join kurar; satir basina fonksiyon yok):
--     deal_id  IN (bu kiracida assigned_to = ben olan deals.id)          -> idx_deals_assigned_to
--     id       IN (bu kiracida profile_id = ben olan commission_splits)   -> idx_commission_splits_profile
--   Alt sorgulardaki deals / commission_splits kendi RLS'lerine tabidir; ikisinin SELECT politikasi da (kiraci +
--   commissions:view [+ split icin profile_id = ben]) bu ifadenin zaten sart kostugu kosullardir, sonuc kumesi daralmaz.
-- can_view_commission_earnings TEKIL kontrol icin (RPC'ler, kod) aynen KORUNUR; govdesine dokunulmaz.
-- ALTER POLICY: ad, komut (SELECT), rol (TO public) ve permissive degismez. Idempotent (ayni ifade tekrar yazilir).
set local lock_timeout = '5s';

alter policy commissions_select on public.commissions
  using (
    (tenant_id = (select public.current_tenant_id()))
    and (select public.has_effective_permission('commissions', 'view'))
    and (
      (select public.has_effective_permission('earnings_all', 'view'))
      or deal_id in (
        select d.id
        from public.deals d
        where d.assigned_to = (select auth.uid())
          and d.tenant_id = (select public.current_tenant_id())
      )
      or id in (
        select s.commission_id
        from public.commission_splits s
        where s.profile_id = (select auth.uid())
          and s.tenant_id = (select public.current_tenant_id())
      )
    )
  );

comment on policy commissions_select on public.commissions is
  'KQ2 (20261015010000): satirdan bagimsiz kontroller InitPlan; danisman kendi anlasmasi/payi korelasyonsuz IN. Tekil kontrol: can_view_commission_earnings.';
