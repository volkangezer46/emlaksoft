# Hetzner sunucusuna geçiş — devir belgesi (2026-10-13)

Bu belge, Windows dizüstündeki Claude oturumundan sunucudaki Claude oturumuna devir içindir. **Yeni oturum önce bunu, sonra `docs/HAFIZA.md` en üst notları okur.**

## Sahibin kararları (kesin)
- Vercel + Supabase (bulut) BIRAKILIYOR; her şey Hetzner sunucusunda çalışacak. Taşıma doğrulanıp bir süre sorunsuz çalıştıktan sonra Vercel ve Supabase projeleri **silinecek** (silmeden önce son tam yedek alınır).
- Deneme/staging adresi YOK: doğrudan ana alan adı **emlaksoft.com.tr** ile devam.
- Sahip her şeyin sorulmadan, profesyonelce yapılmasını istiyor; yalnız sahibin hesabıyla yapılabilecek adımlar tarif edilir.

## Sunucu
- Hetzner Cloud **CPX42** (8 vCPU AMD, 16 GB RAM, 320 GB disk), **Nuremberg** (eu-central), Ubuntu **24.04 LTS**, ad `emlaksoft-prod`.
- IPv4 **178.105.169.160**, IPv6 `2a01:4f8:1c1a:2daf::/64`.
- Yapılanlar: güncellemeler + `unattended-upgrades`, `fail2ban` (sshd), `ufw` (22, 80, 443, geçici 8000), 4 GB swap, SSH yalnız anahtar (`/etc/ssh/sshd_config.d/99-emlaksoft.conf`), Node 24, git, build-essential, Claude Code CLI.
- **Coolify v4** kurulu (`/data/coolify`), panel şimdilik `http://178.105.169.160:8000` (yönetici hesabını sahip açıyor). Coolify `.env` yedeği sahibin bilgisayarında: `C:\Users\volka\emlaksoft-sunucu-yedek\coolify-source.env`.
- Hetzner panelinde **Backups** henüz açılmamış olabilir — sahibe hatırlat.

## Depo ve ortam
- Kod: `/root/emlaksoft` (git `main`, origin `https://github.com/volkangezer46/emlaksoft.git`). Sunucunun GitHub'a push yetkisi henüz YOK: `ssh-keygen -t ed25519 -f ~/.ssh/github_deploy` üretip açık anahtarı sahibe "GitHub → repo → Settings → Deploy keys → Add (Allow write access)" olarak ekletin, sonra origin'i `git@github.com:volkangezer46/emlaksoft.git` yapın.
- `/root/emlaksoft/.env.local` (600): canlı Supabase bulut bağlantıları ve sırlar (taşıma kaynağı). `node_modules` kurulmadı → `npm ci`.
- Kontrol zinciri: `RM=<son migration> RC=<checksum> bash scripts/gate/full.sh` (RM/RC: `npm run check:migrations -- --release`). Sonuç `/tmp/emlaksoft-gate/full.log`. Sunucuda Coolify da çalıştığı için zinciri tek başına çalıştır.
- Claude hafızası `/root/.claude/projects/-root-emlaksoft/memory/` (19 not) ve önceki sohbet kaydı aynı klasörde (`d5682b9f-…jsonl`, `claude --resume` ile görülebilir; Windows yolları içerir).

## DNS (TurkTicaret, nameserver TurkTicaret'te)
- `emlaksoft.com.tr` A → 178.105.169.160 ✓, `www` A → 178.105.169.160 ✓.
- `*.emlaksoft.com.tr`: sahip CNAME'i IP'ye yazmıştı (geçersiz); A kaydı olarak düzeltmesi istendi. Doğrula: `dig +short panel.emlaksoft.com.tr`.
- Planlanan alt adresler: `panel.` (Coolify), `api.` (Supabase Kong), gerekirse `studio.` (Supabase Studio — yalnız IP/temel kimlik doğrulamasıyla).

## Hedef mimari
- Coolify (Traefik + Let's Encrypt) → uygulama Next.js 16 `output: "standalone"` Docker imajı (`emlaksoft.com.tr`, `www` → kalıcı yönlendirme).
- **Supabase self-hosted** (Coolify'daki Supabase servisi veya resmi `supabase/docker`): Postgres 17, GoTrue (auth), PostgREST, Realtime, Storage (yerel disk), Kong (`api.emlaksoft.com.tr`), Studio. Kod `@supabase/*` istemcileriyle değişmeden çalışır; yalnız URL/anahtar env'leri değişir.
- 36 cron (`vercel.json`) → sunucuda zamanlanmış çağrılar (Coolify Scheduled Tasks ya da systemd timer) `Authorization: Bearer $CRON_SECRET` ile; `npm run check:cron` sözleşmesi korunur.
- Yedek: her gece `pg_dump` + storage arşivi → Hetzner Storage Box (sahip açacak), WAL arşivi (pgBackRest/WAL-G) ile zaman noktasına dönüş; haftalık geri yükleme provası. Hetzner sunucu yedeği ek katman.
- E-posta (auth e-postaları): şu an Supabase bulut SMTP'si; self-hosted GoTrue için SMTP sağlayıcısı (ör. Brevo/Resend/SES) gerekir — sahibe sor/tarif et.

## Taşıma adımları (sırayla)
1. ✅ Sunucu sertleştirme, Coolify, Node, Claude Code, depo + .env.local + hafıza aktarımı.
2. Sahip: Coolify yönetici hesabı; DNS `*` A kaydı; Hetzner Backups; GitHub deploy key; SMTP sağlayıcısı.
3. Supabase self-hosted kur (`api.emlaksoft.com.tr`), JWT sırları/anon/service anahtarlarını üret, sırları güvenli sakla.
4. Bulut Supabase'den **tam yedek**: `pg_dump` (şema + veri, `auth`, `storage` şemaları dahil; rol/sahiplik farklarına dikkat), Storage nesnelerinin tamamı (kovalar listesi: customer-files, property-media, agent-photos, tenant-logos, expense-receipts, rent-receipts…). Bir kopyası sunucuda, bir kopyası Storage Box'ta.
5. Yeni Postgres'e geri yükle; `npm run check:migrations -- --database` ile ledger/checksum doğrula; RLS denetimi `npm run db:rls-audit`.
6. Uygulama env'lerini (Vercel'deki tüm üretim değişkenleri — sahibin Vercel panelinden ya da `vercel env pull`) Coolify'a taşı; Supabase URL/anahtarlarını yenileriyle değiştir; `NEXT_PUBLIC_APP_URL=https://emlaksoft.com.tr`.
7. Cron'ları kur, iyzico/Nilvera/EVDS/OpenAI dönüş adreslerini (callback/webhook) yeni alan adına çevir; Google OAuth/Supabase redirect allowlist; Chrome eklentisi `NEXT_PUBLIC_*` ve manifest EmlakSoft alanı (`emlaksoft.vercel.app` → `emlaksoft.com.tr`, yeni eklenti sürümü gerekir).
8. Bakım penceresi: bulut tarafında yazmayı durdur → son fark yedeği → geri yükle → DNS zaten sunucuda → smoke (`npm run smoke:live` BASE ile) → açılış.
9. 1-2 hafta izleme; sonra son yedek ve Vercel/Supabase silme.

## Bekleyen ürün işleri (taşıma sonrası)
- Durdurulan "ana beyin" iş akışı (hata avcıları + internet araştırması + karar + uygulama) taşımadan sonra yeniden çalıştırılacak.
- Sahipten beklenenler: destek e-postasının gerçek adresi (`.app` mı `.com.tr` mi), Chrome eklenti kimliği (0.4.0 incelemede, 0.5.0 hazır), EVDS anahtarı, Nilvera test faturası, portal ortaklık başvuruları.
