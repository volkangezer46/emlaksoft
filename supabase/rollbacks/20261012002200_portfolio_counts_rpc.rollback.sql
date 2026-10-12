-- 20261012001700 geri alma: sayim RPC'leri düşer (kod fonksiyon yokken eski head-count sorgularına döner).
drop function if exists public.portfolio_counts(uuid[], text[], text[], text[], text[], text[], text[], timestamptz);
drop function if exists public.task_counts(uuid[], timestamptz, timestamptz, timestamptz, timestamptz, text[]);
notify pgrst, 'reload schema';
