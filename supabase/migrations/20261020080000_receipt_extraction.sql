-- MIGRATION 20261020080000_receipt_extraction.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- Geri alma: supabase/rollbacks/20261020080000_receipt_extraction.rollback.sql
-- BAGIMLILIK: 20261014001000 (finance_attachments, finance_settings), 20261014001100 (finance_v2_ctx, finance_v2_raise),
--   20261007000700 (expense-receipts kovasi).
--
-- AMAC (FN5+, akilli fis okuma): katmanli okuma (GIB karekodu, UBL-TR XML, PDF metni, yerel OCR, istege bagli yapay zeka)
--   sonucunu ek satirinda saklamak ve yapay zeka katmanina AYRI acik onay vermek.
--  * finance_attachments.extraction jsonb: alan degerleri + guven + kaynak + uyarilar + oneriler. HAM METIN YOK (KVKK).
--    Boyut <= 32 KB, nesne olmali.
--  * finance_settings.ocr_ai_enabled boolean (varsayilan KAPALI): yapay zeka katmani ana anahtar (ocr_enabled) acik
--    olsa bile ayrica acilmadikca calismaz.
--  * finance_attachment_set_extraction(p_id, p_extraction, p_legacy): ek satirina cikarimi + eski bicim oneriyi
--    (ocr_json, fis kutusu bunu okur) yazar; ocr_status = 'done'. Yetki: expenses:create (finance_v2_ctx).
--  * finance_settings_set_ocr_ai(p_enabled): yapay zeka katmani anahtari. Yetki: expenses:edit.
--  * expense-receipts kovasi: e-Fatura XML eki 'text/plain' olarak saklanabilsin (tarayicida betik calistiramaz).
-- GUVENLIK: SECURITY DEFINER + search_path ''; kiraci finance_v2_ctx'ten (JWT), anon/public calistiramaz.
-- ETKI: ek (yeni sutun/fonksiyon, varsayilan kapali). KOD YAYININDAN ONCE ya da SONRA uygulanabilir: kod sutun/fonksiyon
--   yokken eski ocr_json'a yazar ve yapay zeka anahtarini kapali sayar. Idempotent.
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.finance_attachments') is null or pg_catalog.to_regclass('public.finance_settings') is null then
    raise exception '20261020080000: finance_attachments / finance_settings yok (20261014001000 once uygulanmali).';
  end if;
  if pg_catalog.to_regprocedure('public.finance_v2_ctx(text)') is null then
    raise exception '20261020080000: public.finance_v2_ctx(text) yok (20261014001100 once uygulanmali).';
  end if;
end
$$;

alter table public.finance_attachments add column if not exists extraction jsonb;
do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'finance_attachments_extraction_check'
                   and conrelid = 'public.finance_attachments'::regclass) then
    alter table public.finance_attachments add constraint finance_attachments_extraction_check
      check (extraction is null or (pg_catalog.jsonb_typeof(extraction) = 'object' and pg_catalog.pg_column_size(extraction) <= 32768));
  end if;
end
$$;

alter table public.finance_settings add column if not exists ocr_ai_enabled boolean not null default false;

create or replace function public.finance_attachment_set_extraction(p_id uuid, p_extraction jsonb, p_legacy jsonb default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('create');
begin
  if p_id is null or p_extraction is null or pg_catalog.jsonb_typeof(p_extraction) <> 'object'
     or pg_catalog.pg_column_size(p_extraction) > 32768
     or (p_legacy is not null and (pg_catalog.jsonb_typeof(p_legacy) <> 'object' or pg_catalog.pg_column_size(p_legacy) > 20000)) then
    perform public.finance_v2_raise('invalid_input');
  end if;
  update public.finance_attachments fa
     set extraction = p_extraction,
         ocr_json = coalesce(p_legacy, fa.ocr_json),
         ocr_status = 'done'
   where fa.id = p_id and fa.tenant_id = v_tenant;
  if not found then perform public.finance_v2_raise('not_found'); end if;
end;
$$;

create or replace function public.finance_settings_set_ocr_ai(p_enabled boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('edit');
begin
  if p_enabled is null then perform public.finance_v2_raise('invalid_input'); end if;
  insert into public.finance_settings (tenant_id, ocr_ai_enabled, updated_by, updated_at)
  values (v_tenant, p_enabled, auth.uid(), pg_catalog.now())
  on conflict (tenant_id) do update
    set ocr_ai_enabled = excluded.ocr_ai_enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.finance_attachment_set_extraction(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.finance_settings_set_ocr_ai(boolean) from public, anon;
grant execute on function public.finance_attachment_set_extraction(uuid, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.finance_settings_set_ocr_ai(boolean) to authenticated, service_role;

-- Kova: XML eki text/plain olarak (betik calistiramayan tur) saklanir.
do $$
begin
  if pg_catalog.to_regclass('storage.buckets') is not null then
    update storage.buckets
       set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain']::text[]
     where id = 'expense-receipts';
  end if;
end
$$;
