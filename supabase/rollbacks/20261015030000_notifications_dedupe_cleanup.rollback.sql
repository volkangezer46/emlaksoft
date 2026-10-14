-- 20261015030000 geri alma: BILINCLI OLARAK ISLEM YAPMAZ.
-- Migration yalniz veri temizligidir (tekrarli 'Portal teyit gecikti' kopyalari ve gelecek tarihli kopyalar silinir,
-- kalan gelecek tarihli created_at degerleri now() ile kelepcelenir). Silinen satirlar ayni uyarinin kopyalaridir;
-- sema, fonksiyon ve politika degismedigi icin geri alinacak nesne yoktur. Gerekirse PITR yedeginden geri donulur.
select 1;
