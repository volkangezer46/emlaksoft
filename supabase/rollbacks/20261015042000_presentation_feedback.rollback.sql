-- Geri alma: 20261015042000_presentation_feedback.sql
-- Yeni tablo (politika, indeks ve FK'larıyla) ve bileşik FK için presentations'a eklenen benzersiz indeks
-- kaldırılır; başka nesne/veri değişmez. Kod tablo yokken
-- sunum geri bildirimini yine bildirim olarak iletir, kayıt atlanır. DİKKAT: müşterilerin bıraktığı geri bildirim
-- satırları silinir (gerekirse önce dışa alın).
drop table if exists public.presentation_feedback;
drop index if exists public.idx_presentations_id_tenant_unique;
notify pgrst, 'reload schema';
