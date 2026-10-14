# Hız: HTTP sıkıştırma (gzip → Brotli/zstd)

Durum (2026-10-13, `curl -H 'accept-encoding: br, gzip' -D - https://emlaksoft.com.tr/`): yanıt `content-encoding: gzip`.
Hız ekranındaki **Sıkıştırma** öz testi (`/admin/site/hiz`) aynı isteği atar ve sonucu "gzip (br önerilir; operasyon onayı
gerekir)" olarak gösterir. Bu belge Brotli'yi açmanın, doğrulamanın ve geri almanın adımlarıdır. **Operasyon onayı olmadan
uygulanmaz**; uygulama kodu bu ayarı değiştirmez.

## Neden gzip kalıyor

İki katman sıkıştırıyor:

1. **Next** (`next.config.ts` → `compress: true`): Node sunucusu yanıtı kendisi gzip'ler (Next yalnız gzip üretir).
2. **Traefik** (`deploy/compose.prod.yml` → `traefik.http.middlewares.emlaksoft-gzip.compress: "true"`): Traefik v3
   `compress` ara katmanı `zstd`, `br` ve `gzip` üretebilir; ancak yanıt zaten `Content-Encoding` taşıyorsa **yeniden
   sıkıştırmaz**. Next gzip'lediği için Traefik'in Brotli'si hiç devreye girmez.

Brotli için sıkıştırma tek yerde, Traefik'te yapılmalı.

## Uygulama (bakım penceresinde)

1. `deploy/compose.prod.yml` etiketlerine kodlama sırasını açıkça yazın:
   ```yaml
   traefik.http.middlewares.emlaksoft-gzip.compress: "true"
   traefik.http.middlewares.emlaksoft-gzip.compress.encodings: "zstd,br,gzip"
   traefik.http.middlewares.emlaksoft-gzip.compress.minresponsebodybytes: "1024"
   ```
   (Ara katmanın adı geriye uyum için `emlaksoft-gzip` kalabilir.)
2. `next.config.ts` içinde `compress: false` yapın (Next sıkıştırmayı bıraksın, Traefik üstlensin). Bu değişiklik ayrı,
   gözden geçirilmiş bir PR'dır (CSP/önbellek başlıklarıyla aynı dosya; başka satıra dokunulmaz).
3. Normal yayın: `scripts/sunucu/deploy.sh` (imaj + etiketler birlikte gider).

## Doğrulama

```bash
curl -s -o /dev/null -D - -H 'accept-encoding: br, gzip' https://emlaksoft.com.tr/ | grep -i content-encoding   # br
curl -s -o /dev/null -D - -H 'accept-encoding: gzip' https://emlaksoft.com.tr/ | grep -i content-encoding       # gzip
curl -s -o /dev/null -D - https://emlaksoft.com.tr/ | grep -i content-encoding                                  # (boş)
curl -s -o /dev/null -w '%{size_download}\n' -H 'accept-encoding: br' https://emlaksoft.com.tr/                 # gzip'ten ~%15-20 küçük
```

Ardından `/admin/site/hiz` → **Sıkıştırmayı sına**: "Brotli (br) — en iyi seçenek açık". Kokpitteki `compression_no_br`
bilgisi bir sonraki denetimde kapanır. Statik sayfalar (öz testte `X-Static: 1`) ve `/_next/static` dosyaları aynı yoldan sıkıştırılır.

## Geri dönüş

Herhangi bir sorun (bozuk karakter, akış/streaming gecikmesi, SSE/olay akışlarında tamponlama) görülürse:

1. `next.config.ts` → `compress: true` (eski hâl) ve `compose.prod.yml`'den `compress.encodings` /
   `compress.minresponsebodybytes` satırlarını kaldırın.
2. Yeniden yayın. Doğrulama: `content-encoding: gzip`.

Ara durum güvenlidir: Next `compress: true` iken Traefik etiketleri ne olursa olsun yanıt gzip kalır (bugünkü davranış).

## Notlar

- Akışlı (streaming) RSC yanıtlarında Traefik sıkıştırması parçaları tamponlayabilir; yayın sonrası `/app` gezinmesinde
  ilk bayt süresini `scripts/perf/measure-live.mts` ile karşılaştırın.
- Brotli CPU maliyeti Traefik'tedir (sunucu aynı); yük testi gerekmez ama ilk gün `docker stats coolify-proxy` izlenir.
- Bu belge Hız ekranından `docs/runbooks/HIZ_SIKISTIRMA.md` adıyla anılır.
