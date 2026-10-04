# Ofis sahipliği devri (ofis sahibi tarafından, iki adımlı)

Durum: TASARIM + TASLAK MİGRATION. Kod YAZILMADI; neden aşağıda. Taslak: `supabase/proposed/20260819020100_ownership_transfers.sql`
(+ `.rollback.sql`). Uygulanmadı, `supabase/migrations`'a taşınmadı.

## Mevcut durum

- Platform tarafı (süper admin) `transferTenantOwnershipByAdmin` ile sahipliği devredebilir. Sıra: önce yeni sahip, sonra
  eski sahip genel müdür; claim eşitleme Auth admin API ile ayrı çağrılar; hata olursa uygulama katmanında geri alma.
- Ofis sahibinin kendi başına devri YOK. Ofis sahibi kendi rolünü değiştiremez (`authorizeMemberManagement` ofis sahibini dışlar).

## Neden kod yazılmadı

Rol iki yerde tutulur: `profiles.role` ve `auth.users.raw_app_meta_data.role` (JWT claim). Uygulama katmanı iki ayrı çağrı
yapar (profil güncelle + `auth.admin.updateUserById`); arada hata/zaman aşımı olursa ofis iki sahipli veya claim'i profilden
farklı kalabilir (proxy bu durumda kullanıcıyı `inactive_or_invalid_identity` ile çıkarır). Sahiplik güvenlik açısından en
hassas rol olduğundan, atomik DB işlemi (RPC) olmadan sahibin kendi başına başlatacağı akış yazılmadı.

## Önerilen akış

1. Başlat (sahip): hedef = aynı ofisteki AKTİF, sahip olmayan üye; eski sahibin devir sonrası rolü (varsayılan `gm`).
   `request_ownership_transfer` (service_role) hedefi/sahibi doğrular, 72 saatlik talep açar (ofis başına tek bekleyen).
2. Bildirim: hedefe uygulama içi bildirim (`notifyTenant`), sahibe bilgi. E-posta altyapısı olmadığı için yalnız uygulama içi.
3. Kabul (hedef): Hesabım > "Bekleyen sahiplik devri" kartı, SATIR İÇİ onay paneli (popup yok), parola yeniden doğrulaması.
   `accept_ownership_transfer` tek işlemde: iki profil satırını kilitler, eski sahibi düşürür, hedefi `owner` yapar, iki
   kullanıcının JWT claim'ini (`auth.users.raw_app_meta_data.role`) eşitler, talebi `accepted` yapar.
4. İptal/ret: `resolve_ownership_transfer` (başlatan iptal, hedef reddeder). Süresi dolan talep `expired`.
5. Denetim: her adım `logActivity` (`team.owner_transfer_requested|accepted|declined|cancelled`) + platform tarafı görünür.
6. Devir sonrası iki kullanıcının eski JWT'si claim uyuşmazlığı nedeniyle yeniden girişe yönlendirilir (beklenen, güvenli).

## Kodun yazılması için ön koşullar

- Taslak migration gözden geçirilip yeni numarayla `supabase/migrations`'a taşınır; `npm run check:migrations -- --database`,
  `npm run db:migrate -- --dry-run`, restore edilebilir yedek doğrulaması, ardından kontrollü `npm run db:migrate`.
- Tablo yokken özellik gizli kalmalı: action'lar `ownership_transfers` yoksa ("schema cache|does not exist") "bu ortamda etkin
  değil" döner ve Hesabım kartı render edilmez (`kvkk-requests.ts` deseni).
- Yeni action'lar: `requirePermission("team", "edit")` + yalnız `role === "owner"`; destek oturumunda (impersonation) reddedilir;
  hız sınırı; `createAdminClient` kullanımı için `npx tsx scripts/audit-admin-client.ts --write`.
- Test: RPC'ler için SQL sözleşme testi (service_role dışı çağrı reddi, kısmi benzersiz indeks, süre dolumu) ve action birim
  testleri (hedef sahip değil/pasif/başka ofis, çift bekleyen talep, süresi dolmuş kabul).

## Bilinen sınırlar

- E-posta ile bildirim yok; hedef uygulamaya girince görür.
- Sahip tek kişidir: `accept` eski sahibi aynı işlemde düşürür; "iki sahip" modu bilerek desteklenmez.
- DB seviyesinde "ofis başına tek owner" benzersiz indeksi mevcut migration'larda bulunamadı; taslak bunu eklemez (mevcut
  verilerde çok sahipli ofis olabilir). Eklemek ayrı, veri temizliği gerektiren bir karardır.
