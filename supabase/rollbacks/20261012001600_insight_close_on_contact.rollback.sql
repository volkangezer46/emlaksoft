-- 20261012001600 geri alma: olay anında kapatma RPC'si düşer (kod fonksiyon yokken hatayı yutar; öneriler motor turunda kapanır).
drop function if exists public.insight_close_call_priority(uuid);
notify pgrst, 'reload schema';
