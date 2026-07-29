-- A.2 — expense_category ENUM → text.
-- expenses.category bir Postgres enum'du; ayarlar ekranı (definitions) yeni gider
-- kategorisi eklemeye izin veriyormuş gibi görünüyordu ama enum yeni değer kabul
-- etmediğinden definitions'ta tanımlı kategori expenses'e yazılamıyordu.
-- text'e çevrilir: uygulama katmanı zaten definitions'a göre doğruluyor.
-- Mevcut 6 enum değeri text olarak aynen geçerli kalır; enum tipi (varsa başka
-- kullanan) bilinçli olarak DÜŞÜRÜLMEZ — yetim tip zararsızdır, bağımlılık riski yok.
alter table public.expenses alter column category drop default;
alter table public.expenses alter column category type text using category::text;
alter table public.expenses alter column category set default 'diger';
