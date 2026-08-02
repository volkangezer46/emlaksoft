-- DÜZELTME: `invoices.meta->>'conversationId'` üzerinde olması gereken UNIQUE
-- index (20260731000138_atomic_billing_fulfillment.sql'de tanımlanan
-- `uq_invoices_conversation_id`) canlıda hiç yoktu; bunun yerine hiçbir
-- migration dosyasında tanımlı olmayan, elle eklenmiş UNIQUE OLMAYAN bir
-- `idx_invoices_conversation_id` vardı (ifadesi de btrim'i WHERE'e alıyor,
-- indekslenen ifadeye değil). Bu, iyzico ödeme mükerrerlik korumasının
-- (aynı conversationId için iki kez fulfillment) DB seviyesinde aslında
-- ZORLANMADIĞI anlamına geliyordu — yalnız uygulama kodundaki `on conflict`
-- mantığına güveniliyordu. Orijinal migration'daki tanımı birebir uygular ve
-- artık gereksiz kalan eski, yönetilmeyen index'i kaldırır.
drop index if exists public.idx_invoices_conversation_id;

create unique index if not exists uq_invoices_conversation_id
  on public.invoices ((btrim(meta ->> 'conversationId')))
  where nullif(btrim(meta ->> 'conversationId'), '') is not null;
