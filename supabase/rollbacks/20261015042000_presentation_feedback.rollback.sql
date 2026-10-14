-- Geri alma: 20261015042000_presentation_feedback.sql
-- Yalnız yeni tablo (politika, indeks ve FK'larıyla) kaldırılır; başka nesne/veri değişmez. Kod tablo yokken
-- sunum geri bildirimini yine bildirim olarak iletir, kayıt atlanır. DİKKAT: müşterilerin bıraktığı geri bildirim
-- satırları silinir (gerekirse önce dışa alın).
drop table if exists public.presentation_feedback;
notify pgrst, 'reload schema';
