-- Geri alma: 20261019070004_support_article_deflections.sql
-- Olcum tablosu duser (makaleyle cozulen talep sayilari silinir); talepler ve yardim makaleleri degismez.
set local lock_timeout = '5s';
drop table if exists public.support_article_deflections;
