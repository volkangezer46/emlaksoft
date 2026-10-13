# Yönetim paneli erişim kurtarma (AD11)

Yönetim paneli (`/admin`, `/api/admin`) erişim politikası **Personel > Güvenlik politikası** ekranından yönetilir:
IP izin listesi (`platform.admin_ip_allowlist`), boşta kalma süresi (`platform.session_idle_minutes`, varsayılan 60 dk),
oturum ömrü (`platform.session_max_hours`, varsayılan 12 saat) ve kritik işlemlerde TOTP (`platform.step_up_required`,
varsayılan açık). Değişiklikler en geç 30 sn içinde etkinleşir (proxy bellek önbelleği).

## Süper admin IP listesi dışında kaldıysa

Listede olmayan IP `/admin` ve `/api/admin` isteklerinde **403** alır. Sunucuya SSH ile bağlanıp iki yoldan biri:

1. **Listeyi veritabanından silin** (yeniden yayın gerekmez, ≤30 sn):

   ```bash
   docker exec supabase-db-moqbebljyeyprktd19zb1ihn psql -U postgres -d postgres \
     -c "delete from platform_settings where key='platform.admin_ip_allowlist';"
   ```

2. **Ortam değişkeniyle geçici kapatma**: `/root/emlaksoft/.env.production` içine `ADMIN_IP_ALLOWLIST=off` yazıp
   `bash scripts/sunucu/deploy.sh` ile yeniden yayınlayın. Doğru listeyi panelden girdikten sonra değişkeni kaldırıp
   tekrar yayınlayın (değişken kaldı ise liste HİÇ uygulanmaz).

Panel, kaydederken şu anki IP'niz listede değilse açık onay ister; yine de VPN/mobil IP değişimi kilitlenmeye yol açabilir.

## Doğrulayıcı (TOTP) kaybı

Kritik işlemler (iade, kredi, sahiplik devri, ofis kapatma, rol değişikliği) doğrulayıcı kodu ister. Doğrulayıcısını
kaybeden personelin faktörünü başka bir süper admin **Personel > [kişi] > Doğrulayıcıyı sıfırla** ile siler; kişi
**Hesabım > Güvenlik**'ten yeniden kurar. Tüm süper adminler kilitliyse MFA acil kapatması (Güvenlik politikası >
Kilitlenme kurtarması) ve gerekirse geçici olarak:

```bash
docker exec supabase-db-moqbebljyeyprktd19zb1ihn psql -U postgres -d postgres \
  -c "update platform_settings set value='off' where key='platform.step_up_required';"
```

İş bitince ayarı panelden yeniden açın.

## Oturum zaman aşımı döngüsü

Boşta kalma çerezi (`es_admin_seen`) imzalıdır; `/giris/oturum-sonu` oturumu kapatıp çerezi siler. Beklenmeyen
döngüde tarayıcı çerezlerini temizlemek yeter; süreyi panelden 0 (kapalı) yapmak da mümkündür.

## Yedek ve geri yükleme tatbikatı

Şifreleme açık anahtarı (`ops.backup.age_recipient`), uzak kopya türü/hedefi ve tatbikat günü **Sistem Ayarları
Merkezi > Sağlık ve izleme**'den girilir; `scripts/sunucu/backup-db.sh` her gece okur. Tatbikat elle:

```bash
FORCE_DRILL=1 bash scripts/sunucu/backup-db.sh          # tam gece akışı + tatbikat
bash scripts/sunucu/restore-drill.sh /root/backups/gece/db-YYYYMMDD-HHMM.dump   # yalnız tatbikat
```

Şifreli dosyada tatbikat için gizli anahtar geçici olarak `AGE_IDENTITY_FILE=/yol/anahtar.txt` ile verilir ve iş
bitince sunucudan silinir. Ayrıntılı geri yükleme: [`RESTORE.md`](RESTORE.md).
