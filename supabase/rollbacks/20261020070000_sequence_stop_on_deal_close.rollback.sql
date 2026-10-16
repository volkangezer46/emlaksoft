-- Geri alma: 20261020070000_sequence_stop_on_deal_close.sql
-- Tetik ve fonksiyon kaldırılır; 'deal_closed' ile durmuş kayıtlar 'manual' sayılır (durum değişmez, yeniden başlamaz)
-- ve stop_reason CHECK eski kümesine döner.
set local lock_timeout = '5s';

drop trigger if exists trg_deals_stop_sequences_on_close on public.deals;
drop function if exists public.stop_sequences_on_deal_close();

do $$
begin
  if to_regclass('public.message_sequence_enrollments') is null then
    return;
  end if;
  update public.message_sequence_enrollments set stop_reason = 'manual' where stop_reason = 'deal_closed';
  alter table public.message_sequence_enrollments
    drop constraint if exists message_sequence_enrollments_stop_reason_check;
  alter table public.message_sequence_enrollments
    add constraint message_sequence_enrollments_stop_reason_check
    check (stop_reason is null or stop_reason in ('reply', 'manual', 'sequence_inactive', 'customer_removed', 'completed'));
end $$;
