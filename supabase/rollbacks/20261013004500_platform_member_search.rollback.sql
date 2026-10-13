-- 20261013004500 geri alma: platform üye arama RPC'si düşer (üye listesi eski profil sorgusuna düşer;
-- e-posta araması ve giriş/2FA süzgeçleri "kurulum bekliyor" gösterir). Veri değişmez.
drop function if exists public.platform_member_search(text, uuid, boolean, text, uuid, boolean, text, uuid[], integer, integer);
notify pgrst, 'reload schema';
