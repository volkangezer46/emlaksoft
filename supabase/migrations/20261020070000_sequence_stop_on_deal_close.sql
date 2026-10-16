-- MIGRATION 20261020070000_sequence_stop_on_deal_close.sql
-- COM-05 (A7 kalanı): müşterinin anlaşması KAZANILDI ya da KAYBEDİLDİ olunca o müşterinin AKTİF takip dizisi kayıtları
-- durdurulur (stop_reason = 'deal_closed'). Neden: "ev arıyor musunuz?" dizisi, satın alma tamamlanmış ya da vazgeçmiş
-- müşteriye mesaj göndermeye devam ediyordu. Anlaşma aşaması birden çok yoldan değişir (detay, pano sürükle-bırak, toplu
-- aşama, kapanış sihirbazı, transition_deal_stage_atomic); TEK kural için deals üzerinde AFTER UPDATE OF stage tetikleyici.
--
-- Güvenlik: tetik fonksiyonu SECURITY DEFINER + search_path '' (kayıt RLS'i customers:edit ister; aşamayı değiştiren
-- danışmanda bu yetki olmayabilir). Yalnız NEW.tenant_id + NEW.customer_id ile süzer; başka kiracıya dokunamaz. EXECUTE
-- herkesten geri alınır (yalnız tetik çağırır).
-- Bağımlılık: 20261018070001_message_sequences (tablo yoksa migration hiçbir şey yapmaz).
-- GERİ ALMA: supabase/rollbacks/20261020070000_sequence_stop_on_deal_close.rollback.sql
-- RİSK: düşük (CHECK genişler; tetik yalnız aktif dizi kaydı olan müşteride tek UPDATE). İdempotent.

set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.message_sequence_enrollments') is null then
    raise notice 'message_sequence_enrollments yok; 20261020070000 atlandı';
    return;
  end if;

  alter table public.message_sequence_enrollments
    drop constraint if exists message_sequence_enrollments_stop_reason_check;
  alter table public.message_sequence_enrollments
    add constraint message_sequence_enrollments_stop_reason_check
    check (stop_reason is null or stop_reason in ('reply', 'manual', 'sequence_inactive', 'customer_removed', 'completed', 'deal_closed'));
end $$;

create or replace function public.stop_sequences_on_deal_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ts timestamptz := now();
begin
  if new.customer_id is null
     or new.stage not in ('won', 'lost')
     or old.stage is not distinct from new.stage then
    return new;
  end if;
  if to_regclass('public.message_sequence_enrollments') is null then
    return new;
  end if;

  update public.message_sequence_enrollments e
     set status = 'stopped',
         stop_reason = 'deal_closed',
         finished_at = v_ts,
         next_due_at = null,
         updated_at = v_ts,
         last_result = coalesce(e.last_result, '{}'::jsonb)
           || jsonb_build_object('stopped_by_deal', new.id, 'deal_stage', new.stage)
   where e.tenant_id = new.tenant_id
     and e.customer_id = new.customer_id
     and e.status = 'active';
  return new;
end;
$$;

revoke all on function public.stop_sequences_on_deal_close() from public, anon, authenticated;

drop trigger if exists trg_deals_stop_sequences_on_close on public.deals;
create trigger trg_deals_stop_sequences_on_close
  after update of stage on public.deals
  for each row
  when (new.stage in ('won', 'lost') and old.stage is distinct from new.stage and new.customer_id is not null)
  execute function public.stop_sequences_on_deal_close();

comment on function public.stop_sequences_on_deal_close() is
  'COM-05: anlaşma won/lost olunca müşterinin aktif takip dizisi kayıtlarını durdurur (stop_reason deal_closed).';
