-- Filigran (watermark): ilan fotoğraflarına ofis logosu/adı basma ayarları.
-- İlan çalınmasına karşı koruma; damgalama İSTEMCİDE (canvas) yükleme sırasında
-- yapılır, bu tablo yalnızca ofis ayarını ve hangi görsele basıldığını tutar.

alter table public.tenants
  add column if not exists watermark_settings jsonb;

comment on column public.tenants.watermark_settings is
  'Filigran ayarı: {enabled: bool, mode: "logo"|"text"|"both", position: "sag-alt"|"sol-alt"|"orta"|"sag-ust"|"sol-ust", opacity: 0-100, scale: 5-40 (görsel genişliğinin %si), text?: string, marginPct?: number}. null = varsayılan (kapalı).';

alter table public.property_media
  add column if not exists has_watermark boolean not null default false;

comment on column public.property_media.has_watermark is
  'Yüklenirken filigran basıldı mı? Geriye dönük damgalama yapılmaz — eski kayıtlar false kalır.';
