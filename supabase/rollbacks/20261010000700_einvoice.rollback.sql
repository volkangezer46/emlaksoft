-- 20261010000700 geri alma: e-Fatura tablolari ve RPC'leri duser (kod tablo yokken e-Fatura bolumunu "etkin degil" der; saglayicida kesilmis belgeler saglayicida kalir).
drop function if exists public.einvoice_store_rotated_credentials(text);
drop function if exists public.einvoice_connection_secret();
drop table if exists public.einvoices;
drop function if exists public.einvoices_guard();
drop table if exists public.einvoice_connections;
