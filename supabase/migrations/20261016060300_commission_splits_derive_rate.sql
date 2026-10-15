-- MIGRATION 20261016060300_commission_splits_derive_rate.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI uygular.
-- Geri alma: supabase/rollbacks/20261016060300_commission_splits_derive_rate.rollback.sql (20261012001500 govdesi birebir;
--   demo satiri geri cevrilmez, ornek veri).
-- BAGIMLILIK: 20261011001000_commission_split_profile.sql (commission_splits esitleme tetikleyicisi),
--   20261012001500_commission_splits_integrity.sql (normalize govdesi + BEFORE tetikleyici + ACL).
--
-- BULGU SK6/B109 (komisyon pay orani ile tutar celisiyor): commission_normalize_splits 'rate' anahtari yoksa orani 0 kabul ediyordu;
--   'pct' anahtariyla (ve 'name' etiketiyle) gelen satir commission_splits'e share_rate 0 / amount 128.000 ve etiket 'Taraf' olarak
--   iniyordu. 'Ofis' etiketli satir profil kimligi tasidigi icin kind 'advisor' kaliyor, ofis payi kar/zararda dis pay gibi dusuluyordu.
-- COZUM (imza, guvenlik ve ACL AYNI; yalniz govde):
--   1) Oran: 'rate' -> yoksa 'pct' takma adi -> o da yoksa tutardan turetilir: round(amount / gross x 100, 4) (brut > 0).
--      Etiket: 'label' -> yoksa 'name' takma adi. Cikti normallesir: 'rate' ve 'label' yazilir, 'pct'/'name' atilir.
--   2) 'Ofis' / 'Ofis payi' etiketli (ya da kind 'office') satir profil kimligi tasisa bile kind 'office' olur (profil dusurulur).
--   3) Tutarlilik: oran ve tutar ikisi de verilmisse satir bazinda, her durumda toplamda round(brut x oran / 100, 2) ile tutar
--      arasindaki fark yuvarlama toleransini (satir: 0,01 + brut x 0,0001; toplam: satir sayisi x 0,01 + brut x 0,0001) asarsa
--      23514 ile reddedilir. Eski kurallar (oran toplami <= 100,01; tutar toplami <= brut; negatif yok) aynen kalir.
--   Mevcut yazicilar (kapanis RPC'leri, kiralama ice aktarma, updateCommissionSplits, demo seed buildSplits) oran ve tutari
--   tutarli yazar (fark <= 0,005); etkilenmez.
-- VERI: yalniz demo-ofis kiracisindaki 1be1a3b9-802e-4d5a-b334-5d45e56ecb25 komisyonunun splits'i yeni kurala gore yeniden yazilir
--   (pct/name -> rate/label; 'Ofis' -> office). Hakedisi yok (dogrulandi). Gercek ofislerde veri degismez; eski kayitlara backfill YOK.
-- KOD SIRASI: bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir (kod rate/pct/amount'u kendisi de okur).
set local lock_timeout = '5s';

create or replace function public.commission_normalize_splits(p_tenant uuid, p_deal uuid, p_gross numeric, p_splits jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_assigned uuid;
  v_out jsonb := '[]'::jsonb;
  r record;
  v_label text;
  v_key text;
  v_rate numeric;
  v_has_rate boolean;
  v_has_amount boolean;
  v_kind text;
  v_pid uuid;
  v_unres boolean;
  v_n integer;
  v_amount numeric;
  v_gross numeric := coalesce(p_gross, 0);
  v_rows integer := 0;
  v_rate_sum numeric := 0;
  v_amount_sum numeric := 0;
begin
  if p_splits is null or pg_catalog.jsonb_typeof(p_splits) <> 'array' then return coalesce(p_splits, '[]'::jsonb); end if;
  if p_deal is not null then
    select d.assigned_to into v_assigned from public.deals d where d.id = p_deal and d.tenant_id = p_tenant;
  end if;
  for r in select e.value as v from pg_catalog.jsonb_array_elements(p_splits) as e(value) loop
    if pg_catalog.jsonb_typeof(r.v) <> 'object' then continue; end if;
    v_label := pg_catalog.btrim(coalesce(nullif(pg_catalog.btrim(coalesce(r.v ->> 'label', '')), ''), r.v ->> 'name', ''));
    v_key := pg_catalog.lower(v_label);
    v_has_amount := nullif(r.v ->> 'amount', '') is not null;
    -- Oran: 'rate', yoksa 'pct' takma adi; ikisi de yoksa tutardan turetilir (brut > 0).
    v_rate := coalesce(nullif(r.v ->> 'rate', '')::numeric, nullif(r.v ->> 'pct', '')::numeric);
    v_has_rate := v_rate is not null;
    if not v_has_rate then
      v_rate := case when v_has_amount and v_gross > 0
                     then pg_catalog.round((r.v ->> 'amount')::numeric / v_gross * 100, 4)
                     else 0 end;
    end if;
    v_kind := nullif(r.v ->> 'kind', '');
    v_pid := null;
    v_unres := false;
    if v_key in ('ofis', 'ofis payı', 'ofis payi') or v_kind = 'office' then
      -- Ofis payi: profil kimligi tasisa bile (ör. ofis sahibinin profili) ofis payidir; dis pay gibi dusulmez.
      v_kind := 'office';
    else
      if coalesce(r.v ->> 'profile_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        select p.id into v_pid from public.profiles p where p.id = (r.v ->> 'profile_id')::uuid and p.tenant_id = p_tenant;
      end if;
      if v_pid is not null then
        v_kind := 'advisor';
      elsif v_kind in ('referral', 'franchise') then
        null; -- acik tur korunur
      elsif v_kind = 'other' and coalesce((r.v ->> 'unresolved')::boolean, false) is not true then
        v_kind := 'other'; -- acikca dis taraf (editor)
      else
        -- Serbest metin: once "Danisman" -> anlasma sorumlusu, sonra tek tam ad eslesmesi.
        if v_key in ('danışman', 'danisman') and v_assigned is not null then
          v_pid := v_assigned;
        else
          select count(*) into v_n from public.profiles p
            where p.tenant_id = p_tenant and pg_catalog.lower(pg_catalog.btrim(coalesce(p.full_name, ''))) = v_key and v_key <> '';
          if v_n = 1 then
            select p.id into v_pid from public.profiles p
              where p.tenant_id = p_tenant and pg_catalog.lower(pg_catalog.btrim(coalesce(p.full_name, ''))) = v_key;
          end if;
        end if;
        if v_pid is not null then
          v_kind := 'advisor';
        else
          v_kind := 'other';
          v_unres := true;
        end if;
      end if;
    end if;
    v_amount := case when v_has_amount then (r.v ->> 'amount')::numeric
                     else pg_catalog.round(v_gross * v_rate / 100, 2) end;
    if v_rate < 0 or v_amount < 0 then
      raise exception 'Paylaşım oranı ve tutarı negatif olamaz.' using errcode = '23514';
    end if;
    if v_has_rate and v_has_amount and v_gross > 0
       and pg_catalog.abs(pg_catalog.round(v_gross * v_rate / 100, 2) - v_amount) > 0.01 + v_gross * 0.0001 then
      raise exception 'Paylaşım satırında oran (%%%) ile tutar (%) birbirini tutmuyor.', pg_catalog.round(v_rate, 2), pg_catalog.round(v_amount, 2)
        using errcode = '23514';
    end if;
    v_rows := v_rows + 1;
    v_rate_sum := v_rate_sum + v_rate;
    v_amount_sum := v_amount_sum + v_amount;
    v_out := v_out || pg_catalog.jsonb_build_array(
      (r.v - 'profile_id' - 'kind' - 'unresolved' - 'pct' - 'name')
      || pg_catalog.jsonb_build_object('kind', v_kind, 'amount', v_amount, 'rate', v_rate)
      || case when v_label <> '' then pg_catalog.jsonb_build_object('label', v_label) else '{}'::jsonb end
      || case when v_pid is not null then pg_catalog.jsonb_build_object('profile_id', v_pid) else '{}'::jsonb end
      || case when v_unres then pg_catalog.jsonb_build_object('unresolved', true) else '{}'::jsonb end
    );
  end loop;
  if v_rate_sum > 100.01 then
    raise exception 'Paylaşım oranlarının toplamı %%100''ü aşamaz (şu an %%%).', pg_catalog.round(v_rate_sum, 2) using errcode = '23514';
  end if;
  if v_amount_sum > v_gross * 1.0001 + 0.01 then
    raise exception 'Paylaşım tutarlarının toplamı brüt komisyon tutarını aşamaz.' using errcode = '23514';
  end if;
  if v_gross > 0 and pg_catalog.abs(v_gross * v_rate_sum / 100 - v_amount_sum) > v_rows * 0.01 + v_gross * 0.0001 then
    raise exception 'Paylaşım oranlarının toplamı (%%%) ile tutarların toplamı (%) birbirini tutmuyor.', pg_catalog.round(v_rate_sum, 2),
      pg_catalog.round(v_amount_sum, 2) using errcode = '23514';
  end if;
  return v_out;
end;
$$;

revoke all on function public.commission_normalize_splits(uuid, uuid, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.commission_normalize_splits(uuid, uuid, numeric, jsonb) to service_role;

-- Demo duzeltmesi (yalniz demo-ofis): splits yeniden yazilir; BEFORE tetikleyici yeni kurali uygular, AFTER tetikleyici
-- commission_splits'i esitler (share_rate 50 / 50, 'Ofis' -> office). Satir yoksa (yeniden tohumlanmis demo) hicbir sey yapmaz.
update public.commissions c
   set splits = c.splits
 where c.id = '1be1a3b9-802e-4d5a-b334-5d45e56ecb25'::uuid
   and exists (select 1 from public.tenants t where t.id = c.tenant_id and t.slug = 'demo-ofis')
   and c.splits::text like '%"pct"%';
