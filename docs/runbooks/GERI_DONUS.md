# Geri dönüş (runbook)

Uygulama geri dönüşü ile veri kurtarma ayrı kararlardır. Güvenliği geri getiren en küçük geri alınabilir adım seçilir.

## Tek satır

```bash
bash scripts/sunucu/rollback.sh --dry-run && bash scripts/sunucu/rollback.sh
```

- `--dry-run`: yayındaki sürümü, hedef imajı ve geçiş yöntemini (mavi/yeşil) yazar; hiçbir şey değiştirmez.
- Hedef verilmezse `public.release_history`'de yayındakinden önce `ok` biten ve sonradan geri alınmamış en yeni sürüm seçilir.
  Belirli bir sürüm için: `bash scripts/sunucu/rollback.sh 202610141107-62e14a2e`.
- Betik hedef imajın yerelde olduğunu doğrular (`deploy.sh` `prune_images` son iki `ok` sürümün imajını her zaman korur),
  hedefin statik parçalarını `/srv/emlaksoft/next-static`'e ekler ve `deploy.sh` ile AYNI mavi/yeşil geçişi yapar
  (`scripts/sunucu/bluegreen.sh` `swap_to`; KESİNTİSİZ): yeşil hedef imajla açılır, sağlıklı olunca mavi boşaltılıp hedefle
  yeniden kurulur, yeşil kaldırılır. Ardından dış adres (`https://emlaksoft.com.tr/api/health`) doğrulanır ve geri alınan sürüm için `release_history`'ye `rolled_back`
  satırı yazar (`/admin/sistem?sekme=durum`). Başarılı dönüşte `emlaksoft-app:latest` etiketi de hedef imaja taşınır:
  `APP_TAG`'siz sonraki bir `docker compose up` (elle ya da başka bir betik) geri alınan imaja dönmez. Taşıma başarısız
  olursa betik uyarır; elle `docker tag emlaksoft-app:<hedef> emlaksoft-app:latest`. Hedef (yeşil) sağlıklı olmazsa yayındaki mavi hiç kapanmaz;
  mavi hedefle kurulamazsa yayındaki sürümle yeniden kurulur. Her iki durumda `failed` yazılır, çıkış 1.
- Yeni sürüm yayın sırasında sağlıklı olmazsa `deploy.sh` zaten eski sürümü yayında tutar (ya da bekçi kesintisiz geri döner);
  `rollback.sh` yayından SONRA fark edilen sorunlar içindir.

## Şema uyumu

- Migration'lar forward-only'dir; geri dönüş DB'yi geri ALMAZ, `.env.production` `RELEASE_MIGRATION` değişmez (DB o
  migration'dadır, `/api/health` hazır döner).
- Eski kod yeni şemayla çalışmalıdır. Eklemeli (yeni tablo/kolon/indeks/fonksiyon) migration'lar uyumludur; kolon
  silme/yeniden adlandırma, NOT NULL ya da CHECK sıkılaştırma, eski kodun yazdığı değeri reddeden kısıt uyumsuzdur.
- `--dry-run` hedefin yayınlandığı migration'ı (`release_history.release_migration`) `.env.production`
  `RELEASE_MIGRATION`'dan farklıysa "Şema notu" satırı basar ve **3 ile çıkar**; böylece "Tek satır" komutu orada durur.
  O aralıktaki migration'ları (`supabase/migrations/`) uyumluluk için gözden geçirin, sonra geri dönüşü ayrı komutla
  (`bash scripts/sunucu/rollback.sh <hedef>`) çalıştırın.
- Yeni sürüm eski kodun anlamadığı veri yazdıysa körlemesine geri dönmeyin: etkilenen yolu kapatın (bayrak/bakım) ve
  ileri düzeltme (yeni kod ya da yeni migration) yayınlayın. Uygulanmış migration düzenlenmez, elle "down" SQL'i
  çalıştırılmaz.
- Satırlar bozulduysa ya da kaybolduysa kod geri dönüşü veri geri getirmez: yazmayı durdurun, `docs/runbooks/RESTORE.md`.

## Doğrulama

1. `curl -s https://emlaksoft.com.tr/api/health` → `{"ok":true}`.
2. Ayrıntı (secret ile): `curl -s -H "Authorization: Bearer $HEALTHCHECK_SECRET" https://emlaksoft.com.tr/api/health`
   → `release.sha` hedef sürümün SHA'sı, `checks.migrations.status = ready`; `services` / `checks.auth|storage|realtime`
   yalnız bilgi amaçlıdır (`degraded` genel durumu düşürmez).
3. Giriş, kiracı izolasyonu ve olaya özgü iş akışı elle denenir; `hatalar.jsonl` ve `/admin/sistem?sekme=hatalar`
   bir olağan cron aralığı boyunca izlenir (`docs/runbooks/IZLEME.md`).

## Durdurma ölçütleri

Hedef imaj doğrulanamıyorsa, migration hazırlığı başarısızsa, ortam değerleri beklenmedik biçimde farklıysa ya da eski
kod uyumsuz veri yazacaksa geri dönüşü durdurun; günlükleri saklayın ve ileri düzeltme ya da kontrollü restore seçin.

## Kayıt

Olay kaydına yayındaki/hedef etiketler, `--dry-run` çıktısı, sağlık yanıtı, şema uyumu kararı, onaylayan ve zaman
damgaları eklenir. `release_history` satırını betik yazar.
