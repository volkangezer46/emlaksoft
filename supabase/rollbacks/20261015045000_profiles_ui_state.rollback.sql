-- Geri alma: 20261015045000_profiles_ui_state.sql
-- Kayitli tur/davet karti isaretleri KAYBOLUR. Kod sutun ve fonksiyon yokken yalniz tarayici onbellegiyle (localStorage) calisir.
set local lock_timeout = '5s';
drop function if exists public.profile_ui_state_mark(text);
alter table public.profiles drop constraint if exists profiles_ui_state_shape_check;
alter table public.profiles drop column if exists ui_state;
notify pgrst, 'reload schema';
