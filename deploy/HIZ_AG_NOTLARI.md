# Hız / ağ notları (PKG-3, 2026-10-27)

Bu dosyadaki adımlar **dış / sunucu değişikliğidir**: uygulanmadan önce duyurulur, kod yayınından bağımsızdır.

## PERF-3: sunucu Supabase çağrıları iç ağdan

Kod hazır (`src/lib/supabase/fetch-guard.ts`): `SUPABASE_INTERNAL_URL` tanımlıysa sunucu istemcilerinin
(`supabase/{server,admin,middleware}.ts`) genel köke (`NEXT_PUBLIC_SUPABASE_URL`) giden istekleri yalnız TAŞIMADA iç köke
gider. İstemci URL'i genel kalır: çerez adı (`sb-api-auth-token`), Storage genel/imzalı bağlantıları ve JWT `iss`
denetimi değişmez. İç köke bağlanılamazsa istek genel köke düşer (30 sn soğuma, `[supabase-internal]` uyarısı).

Sıra:

1. `deploy/compose.prod.yml` `x-app` çapasına Supabase ağı (Kong'un `supabase-kong` takma adı bu ağda):

   ```yaml
     networks:
       coolify:
         aliases: [emlaksoft-app]
       moqbebljyeyprktd19zb1ihn: {}
   # dosya sonu
   networks:
     coolify:
       external: true
     moqbebljyeyprktd19zb1ihn:
       external: true
   ```

   `traefik.docker.network: coolify` etiketi zaten var (Traefik doğru ağı seçer).
2. `.env.production`: `SUPABASE_INTERNAL_URL=http://supabase-kong:8000`
3. Yayın (`scripts/sunucu/release.sh`). Doğrulama:
   `docker exec emlaksoft-app getent hosts supabase-kong` iç IP döner;
   `docker exec emlaksoft-app node -e "fetch('http://supabase-kong:8000/auth/v1/health').then(r=>console.log(r.status))"` → 200 (ya da 401: Kong anahtar ister, ağ çalışıyor demektir);
   oturumlu kullanıcı yayından sonra çıkış yapmadan devam eder (çerez adı aynı).
4. Geri dönüş: env satırını silip yeniden başlatmak yeterli (kod genel köke döner).

Keep-alive: Node'un yerleşik `fetch`'i (undici) bağlantıları zaten açık tutar; `setGlobalDispatcher` için ayrı `undici`
paketi gerekir (bağımlılık eklenmedi). İç ağda TLS el sıkışması kalktığı için soğuk bağlantı maliyeti zaten düşer.

## PERF-10: dinamik HTML brotli değil

Kök neden (2026-10-27 ölçüm): Next standalone `compress: true` (next.config.ts) yanıtı KENDİSİ gzip'liyor; Traefik
`emlaksoft-gzip` ara katmanı (`encodings: br,gzip`, zaten tanımlı) önceden sıkıştırılmış yanıtı yeniden sıkıştırmaz.
`/giris` → `content-encoding: gzip` (konteyner içinden de gzip); statik ana sayfa / yönlendirme Next sıkıştırmasından
geçmediği için br.

Öneri: Hetzner'de Next sıkıştırmasını kapatmak (`compress: isVercel`), sıkıştırmayı Traefik'e bırakmak. Duyurulup
denenmeli: akışlı (Suspense) HTML'in Traefik sıkıştırıcısında parça parça iletildiği (flush) ölçülmeli
(`curl --compressed -N` ile ilk bayt / parça zamanları, `scripts/perf/measure-live.mts`).

## PERF-4: takas ve sunucuda derleme (yalnız öneri, uygulanmadı)

- Derleme sunucu dışında (CI'da imaj üretip `docker load`/kayıt) ya da `docker build --cpu-quota`/`nice -n 10 ionice -c3`
  ile kısılmış.
- Takas kullanan konteynerler (`docker stats --no-stream`, `smem`/`/proc/<pid>/status VmSwap`) belirlenip analytics / Kong
  için `mem_limit` konmalı; watchdog örnekleri derleme sırasında etiketlenmeli.
