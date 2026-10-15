# Admin canlı veri ve operasyon uyarıları (SK4) — uygulama adımları

Kod tarafı (admin kabuğu, `AdminRealtime` adacığı, sayaç etiketleri, hazırlık sinyalleri) migration'dan BAĞIMSIZ yayınlanabilir:
kanala katılamayan istemci zilin 60 sn yedek yoklamasına, `admin_search_members` yoksa ada göre üye aramasına düşer; kod
`reply_support_ticket_v2`'yi çağırır, migration sonrası v2 aynı imzayla v3'e devreder. Aşağıdaki adımlar sahibin / yayın oturumunun işidir (canlı DB yazımı ve sunucu ayarı).

## 1. Migration (grup `SK4-admin-canli-veri`, sıra 204)

Restore edilebilir yedek doğrulandıktan sonra olağan yayın zinciri (`bash scripts/sunucu/release.sh` ya da `npm run db:migrate`):

- `20261016040000_admin_staff_broadcast.sql` — `admin:staff` (support_tickets, support_ticket_messages, invoices, subscriptions,
  alert_events; deyim düzeyi) ve `staff:<uid>` (platform_notifications; satır düzeyi) Broadcast tetikleyicileri + `realtime.messages`
  personel politikaları.
- `20261016040100_reply_support_ticket_v3.sql` — ofisin ek mesajı açık talebi açık bırakır; tek seferlik `in_progress → open`
  düzeltmesi (ilk yanıtı ve sorumlusu olmayanlar; 2026-10-15 itibarıyla 1 satır).
- `20261016040200_admin_search_members.sql` — üye adı + e-posta araması (yalnız service_role).

Geri alma: `supabase/rollbacks/20261016040{0,1,2}00_*.rollback.sql` (ters sırayla).

Doğrulama (salt okunur):

```sql
select tgrelid::regclass, tgname from pg_trigger where tgname like 'rt_staff_%' order by 1, 2;   -- 15 + 1 satır
select policyname from pg_policies where schemaname = 'realtime' and tablename = 'messages';      -- rt_admin_staff_read, rt_staff_self_read
select proname from pg_proc where proname in ('reply_support_ticket_v3', 'admin_search_members');
-- Katılım kapısı authenticated'a açık olmalı (politika growth_flag_on'u doğrudan çağırmaz; o fonksiyon authenticated'a kapalı):
select has_function_privilege('authenticated', 'public.rt_staff_can_listen()', 'execute');           -- t
```

Elle kabul: /admin açıkken tarayıcı geliştirici araçlarında en az bir `wss://…/realtime/v1/websocket` bağlantısı; ofis
hesabından talep açılınca /admin/tickets, /admin panosu ve zil <1 sn'de güncellenir. Personel olmayan bir oturumla
`admin:staff` kanalına katılım `CHANNEL_ERROR` döner.

## 2. Geri yükleme tatbikatı (bir kez, B115)

```bash
FORCE_DRILL=1 bash scripts/sunucu/backup-db.sh
```

Sonra (salt okunur): `select value from platform_settings where key = 'ops.restore_drill.last';` satırı yazılmış olmalı;
üst çubuk sistem çipindeki "Geri yükleme tatbikatı yapılmadı" uyarısı en geç 60 sn'de kalkar.

## 3. Panelden yapılacak ayarlar (dış hesap / sahip kararı)

Sistem çipi ve Kontrol paneli > Dikkat kuyruğu bunlar yapılana dek uyarı gösterir (bilinçli):

- **Uyarı kanalı** (Sistem durumu > Uyarılar): en az bir Telegram / e-posta / webhook kanalı. Kanal olmasa da kritik
  olaylar aktif süper admin + operasyon personelinin ziline düşer.
- **E-posta kanalı** (Sistem durumu > Entegrasyonlar > Resend): anahtar + doğrulanmış gönderen alan adı. Kapalıyken KVKK
  başvurusu kayıt açmaz, KEP/posta yolunu gösterir ve personele bildirim düşer.
- **Yedek şifreleme ve uzak kopya** (Ayar merkezi > Sağlık ve izleme): `ops.backup.age_recipient`, `ops.backup.remote_kind`
  / `remote_target`.

## 4. Sunucu betiği

`scripts/sunucu/alert-send.py` (kritik host olayı → personel zili; `health_down` düzelince "Kesinti HH:MM-HH:MM oldu")
repo yolundan çalışır; kod ana dala alınınca etkindir, ayrı kurulum gerekmez. `/durum` dinamik çizilir ve veri en çok
60 sn yaşındadır; `health_down` için ayrıca tazeleme çağrısı gerekmez.
