# Migration Guide

EmlakSoft migration'ları `supabase/migrations/` altında forward-only SQL
dosyalarıdır. Uygulanan dosyanın adı ve ilk 16 karakter SHA-256 checksum'ı
`public.schema_migrations` ledger'ında tutulur.

## Yeni migration

1. UTC tarih + altı haneli artan sıra ile küçük harfli bir dosya ekleyin:
   `YYYYMMDDNNNNNN_aciklama.sql`.
2. Yeni değişikliği idempotent ve mümkünse geriye uyumlu tasarlayın.
3. Eski migration'ı değiştirmeyin; düzeltme için yeni dosya ekleyin.
4. Statik kapıları çalıştırın:

```bash
npm run check:migrations
npm test
npm run type-check
```

Validator geçersiz adları, yeni 14 haneli sıra çakışmalarını, aynı SQL içeriğini
ve boş dosyaları reddeder. Repoda önceden var olan üç sıra çakışması, deployed
ledger kayıtlarını yeniden adlandırmamak için exact legacy allowlist ile
dondurulmuştur; bu liste yeni dosya kabul etmez.

## Uygulama

`.env.local` içinde `DATABASE_POOLER_URL` veya `DATABASE_URL` tanımlayın:

```bash
npm run db:migrate -- --dry-run
npm run db:migrate
npm run check:migrations -- --database
```

Runner advisory lock alır, her dosyayı ayrı transaction içinde uygular ve
checksum kaydını aynı transaction'da yazar. Hata halinde migration rollback
olur. Uygulanmış dosyanın checksum'ı değiştiyse runner hiçbir yeni migration'a
geçmeden durur.

Tek bir dosya yalnız kontrollü onarım için seçilebilir:

```bash
npm run db:migrate -- --only YYYYMMDDHHMMSS_aciklama.sql
```

## Seçici ledger uzlaştırması

Toplu `--baseline` güvenlik nedeniyle kapalıdır. Bir şema objesinin bulunması,
aynı migration'daki backfill, grant, constraint ve politika adımlarının tamamının
uygulandığını tek başına kanıtlamaz. Runner bu nedenle yalnız built-in salt-okunur
kanıt sorgusu başarılı olan tek bir migration satırını, açık operatör onayıyla
uzlaştırır. Yeni DB kurulumunda baseline kullanılmaz.

Her doğrulanmış satır için ayrı ayrı:

1. Restore edilebilir backup/PITR noktası alın.
2. Migration SQL'inin tamamını canlı şema, grant/RLS ve gerekli veri invariantlarıyla
   karşılaştırın.
3. Salt-okunur önizlemeyi çalıştırın:

```bash
npm run db:migrate -- --baseline --only YYYYMMDDHHMMSS_aciklama.sql --confirm-schema-present --dry-run
```

4. Yalnız aynı exact dosya için, onaylı bakım penceresinde ledger satırını yazın:

```bash
npm run db:migrate -- --baseline --only YYYYMMDDHHMMSS_aciklama.sql --confirm-schema-present
```

5. Her satırdan sonra `npm run check:migrations -- --database` çalıştırın.

`--only`, başka bir migration'daki ledger/şema ayrışmasını atlatamaz. Normal migrate
ve kontrollü `--only` onarımları, uzlaştırılması gereken herhangi bir eski satır
varken fail-closed durur. Baseline eksik şemayı düzeltmez; yalnız bağımsız olarak
kanıtlanmış mevcut durumu ledger'a kaydeder.

## Release readiness

Final migration'dan sonra:

```bash
npm run check:migrations -- --release
```

Çıktıdaki `RELEASE_MIGRATION` ve `RELEASE_MIGRATION_CHECKSUM` değerlerini deploy
ortamına girin. `/api/health`, expected ledger satırı yoksa veya checksum farklı
ise production readiness için 503 döndürür.

## Geri dönüş

Uygulanmış migration dosyası değiştirilmez ve otomatik down migration yoktur.
Önce uygulama deploy'u geri alınır; şema sorunu yeni forward-fix migration ile
onarılır. Veri restore'u gerekiyorsa `docs/runbooks/RESTORE.md` izlenir.
