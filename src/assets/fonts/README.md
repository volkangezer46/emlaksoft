# Rapor merkezi PDF yazı tipi

`Geist-Regular.ttf` — Vercel Geist (SIL Open Font License 1.1). Türkçe karakterleri (ğ ü ş ı ö ç İ Ğ Ş) kapsar;
yalnız sunucuda PDF üretiminde (`src/lib/report-center/format/pdf.ts`) okunur, istemci paketine girmez.
`₺` glifi yoktur: PDF'te "TL" yazılır.
