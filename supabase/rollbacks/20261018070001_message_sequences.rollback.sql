-- 20261018070001 geri alma: takip dizisi tabloları (kayıt ve adım sonuçlarıyla birlikte) kaldırılır.
-- Kod tablolar yokken diziler sekmesini "kurulum bekleniyor" durumunda gösterir, çalıştırıcı boş döner.
drop table if exists public.message_sequence_step_runs;
drop table if exists public.message_sequence_enrollments;
drop table if exists public.message_sequence_steps;
drop table if exists public.message_sequences;
