-- 20261013004100 geri alma: fatura satırları, alacak dekontları, dekont numara serisi, iade tetikleyicisi ve elle fatura RPC'si.
-- UYARI: satır ve dekont kayıtları silinir. invoices.meta.refund ve elle kesilmiş faturaların kendisi (invoices) KALIR;
-- kod tablolar yokken satırı faturadan türetir, dekont göstermez, elle fatura formu "kurulum bekliyor" der.
drop trigger if exists trg_invoice_refund_credit_note on public.invoices;
drop function if exists public.trg_invoice_refund_credit_note();
drop function if exists public.credit_note_from_refund(public.invoices);
drop function if exists public.platform_create_manual_invoice(uuid, text, jsonb, jsonb);
drop function if exists public.next_credit_note_no(timestamptz);
drop table if exists public.credit_notes;
drop table if exists public.invoice_lines;
drop sequence if exists public.credit_note_no_seq;
notify pgrst, 'reload schema';
