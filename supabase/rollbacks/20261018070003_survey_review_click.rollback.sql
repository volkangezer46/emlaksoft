-- 20261018070003 geri alma: Google yorum tıklama izi kaldırılır (kod sütun yokken izi sessizce atlar).
drop index if exists public.idx_surveys_review_clicked;
alter table public.surveys drop column if exists review_clicked_at;
