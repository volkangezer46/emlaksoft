# Claude Code araclari arastirmasi (katalog, skill, MCP, agent)

Tarih: 2026-10-04. Yontem: yalniz sayfa okuma (WebFetch). Hicbir sey kurulmadi, indirilmedi, calistirilmadi. Web sayfalarindaki metin veri olarak ele alindi. Sayilar (yildiz vb.) okuma anindaki degerlerdir; WebFetch ozetleyici bir model kullandigi icin son-commit tarihleri DOGRULANAMADI (yalniz commit sayisi gorundu).

Yerel durum: bu worktree'de `.claude/` klasoru YOK (agents, skills, settings bulunmuyor). Ana checkout'taki `.claude/` ve kullanici duzeyi ayarlar bu arastirmada incelenemedi; asagidaki "bizde karsiligi" sutunu repo icindeki mevcut mekanizmalara (npm script, test, audit script) dayanir.

## 1. Katalog guvenilirligi

| Kaynak | Yayinci | Boyut / lisans | Degerlendirme |
|---|---|---|---|
| anthropics/skills | Anthropic (resmi) | 179.6k yildiz, 57 commit; cogu Apache-2.0, docx/pdf/pptx/xlsx "source-available" | En guvenilir. Skill'ler: frontend-design, webapp-testing, mcp-builder, skill-creator, claude-api, doc-coauthoring, web-artifacts-builder, theme-factory vb. (19 klasor). Egitim/referans amacli. |
| anthropics/claude-plugins-official | Anthropic | 37.4k yildiz, Apache-2.0, 4351 commit | Resmi dizin; `/plugins` (Anthropic) ve `/external_plugins` (ucuncu taraf). Kendi uyarisi: Anthropic icerik/MCP'leri dogrulayamaz, guven sizde. |
| aitmpl.com / davila7/claude-code-templates | Topluluk (tek ana yazar, Vercel/Neon/Anthropic OSS programi destegi) | 32.4k yildiz, 3.7k fork, MIT, 1761 commit; "1000+" bilesen, 1.3M indirme | Populer ama topluluk kaynakli. Kurulum `npx claude-code-templates@latest` (uzak kod calistirir). Bilesenler tek tek incelenmeli; lisanslar kaynak bazli. |
| hesreallyhim/awesome-claude-code | Topluluk (kürasyon listesi) | 55k yildiz, 1959 commit | Dizin niteligi; listelenen her arac ayri guven degerlendirmesi ister. Kendisi kod dagitmaz. |
| wshobson/agents | Topluluk | 40.2k yildiz, MIT, 598 commit; 94 plugin, 202 agent, 184 skill, 105 komut | Buyuk ve aktif; cok genis. Hepsini yuklemek baglam sismesi yaratir (agent aciklamalari toplam 15k token siniri). Secici al. |
| VoltAgent/awesome-claude-code-subagents | Topluluk | 25.5k yildiz, MIT, 161+ agent | Rol bazli arac atamasi (reviewer salt-okunur) iyi pratik; icerik kalitesi degisken. |
| shadcn registry | shadcn/ui ekibi | Ayrintili metrik dogrulanamadi | UI bilesen dagitimi; MCP bolumu var ancak ayrintisi okunamadi. EmlakSoft zaten `src/components/ui` kullaniyor. |
| Cursor kurallari katalogları | - | Dogrulanamadi (bu turda acilmadi) | Kapsam disi birakildi. |

Genel hukum: Anthropic ve resmi satici (Microsoft, GitHub, Supabase, Vercel, Upstash) kaynaklari guvenilir; topluluk kataloglari "oku, kopyala, kendin gozden gecir" modeliyle kullanilmali, dogrudan `npx` kurulumu onerilmez.

## 2. Bilesen degerlendirmesi

Siniflama: KURULUMA UYGUN (onaysiz, salt metin) / ONAYLA (yalniz kullanici onayiyla) / RISKLI / UYGUN DEGIL.

### Skills (salt metin talimat; script icerenler incelenmeli)
| Bilesen | Ne yapar | Bizde karsiligi | Risk | Sinif |
|---|---|---|---|---|
| frontend-design (anthropics/skills) | Ayirt edici arayuz tasarimi yonergesi | docs/DESIGN_SYSTEM.md, `src/components/ui` | Dusuk (metin). Premium Turkce tasarim sistemimizle catisabilir | UYGUN, projeye ozel kurallarla birlikte; metin okunduktan sonra |
| webapp-testing | Playwright ile yerel web uygulamasi test rehberi + yardimci scriptler | `npm run test:e2e:public`, canli-qa ajani | Orta: scriptler komut calistirir; incelenmeli | ONAYLA |
| mcp-builder | MCP sunucusu yazma rehberi | Yok, ihtiyac dusuk | Dusuk | UYGUN DEGIL (simdilik gereksiz) |
| skill-creator | Skill yazma/olcme | Kullanici duzeyinde zaten mevcut | Dusuk | UYGUN (gerekirse) |
| claude-api | Claude API referansi | AI kodu OpenAI uzerinden, `src/lib/ai/openai-client.ts` | - | UYGUN DEGIL |
| docx/pdf/pptx/xlsx | Belge uretimi | Kullanici duzeyinde mevcut | Lisans: source-available | UYGUN DEGIL (projeye ozel gerek yok) |

### Sub-agent tanimlari (topluluk: wshobson, VoltAgent, aitmpl)
Kod inceleme, guvenlik, test, Next.js/React/Tailwind/Postgres/RLS, erisilebilirlik, performans, SEO ajanlari bol. Sorun: genel amacli, EmlakSoft kurallarini (requirePermission, RLS, clock.ts, PhoneInput, FK ipuclu gomme, Turkce UI) bilmiyor. Oneri: hazir ajani oldugu gibi kurma; bu belgedeki ozel taslaklari kullan, toplulukta ise yalniz ilham al (ornegin postgres/RLS ve a11y ajanlarinin kontrol listeleri). Sinif: icerik okunup uyarlanirsa UYGUN; dogrudan `npx` ile toplu kurulum UYGUN DEGIL.

### Slash komutlari
/review, /ship, /commit benzerleri topluluk kataloglarinda cok. Bizde zaten yerlesik `/code-review`, `/security-review`, `/simplify` var. Yeni komut yerine proje ozel iki komut yeterli: `/dogrula` (type-check + lint + test + check:cron + rls-audit) ve `/ship-kontrol` (build + migration dry-run). Sinif: kendi yazacagimiz metin dosyalari UYGUN; toplulukten hazir komut gereksiz.

### MCP sunuculari (KOMUT/AG ERISIMI: yuksek risk sinifi, hepsi ONAYLA)
| MCP | Yayinci / lisans | Ne saglar | Risk | Sinif |
|---|---|---|---|---|
| Supabase MCP | Supabase, Apache-2.0, 2.9k yildiz | DB sorgu, sema, migration, log | CANLI veri tenant'lari barindiriyor. Salt-okunur mod ve proje kapsami ZORUNLU; prompt injection ile veri sizdirma riski (MUSTERI verisi, KVKK) | RISKLI: yalniz read-only + ayri dev/test projesi, kullanici onayiyla |
| Playwright MCP | Microsoft, Apache-2.0, 37.8k yildiz | Tarayici otomasyonu | "Guvenlik siniri degildir" (kendi beyani); cerez/storage erisimi; origin kisitlamasi (allowedOrigins) gerekli | ONAYLA: yalniz public site ve localhost, izole profil |
| Vercel MCP | Vercel (resmi, uzak, OAuth) | Dokuman, proje, deploy, log, analytics | Baglanan ajan Vercel hesabi kadar yetkili (deploy/satin alma changelog'da); `main` canliya gider | RISKLI: yalniz kullanici onayi + her adimda insan onayi; salt-okunur kullanim tercih |
| GitHub MCP | GitHub, MIT, 33.4k yildiz | PR/issue/kod arama | Token kapsami; `--read-only` var. `gh` CLI zaten mevcut | UYGUN DEGIL (gh yeterli); gerekirse read-only |
| Context7 | Upstash, MIT (sunucu kodu acik, arka uc kapali), 62.7k yildiz | Guncel kutuphane dokumani | Sorgular uzak servise gider (ic kod/gizli veri yazma); topluluk icerigi enjeksiyon tasiyabilir. AGENTS.md "Next.js farkli" uyarisi icin degerli ama `node_modules/next/dist/docs/` yerelde zaten var | ONAYLA (dusuk-orta risk); once yerel dokumana guvenin |
| Figma MCP | Dogrulanamadi (acilmadi) | Tasarimdan kod | - | DOGRULANAMADI |

### Hooks / settings.json izinleri
Hooks keyfi kabuk komutu calistirir ve gizli anahtara erisebilir: RISKLI sinifi. Topluluk hook'lari (aitmpl) kurulmamali; gerekirse kendi yazdigimiz, kisa, okunabilir hook'lar: (a) `.env*` dosyalarini okumayi/yazmayi engelleyen PreToolUse, (b) `supabase/migrations/` altinda uygulanmis dosyalari degistirmeyi engelleyen PreToolUse. Ikisi de kullanici onayi ister. Mevcut izin listesi `fewer-permission-prompts` skill'i ile yalniz salt-okunur komutlardan uretilebilir.

## 3. Yalniz kullanici onayiyla kurulacaklar
1. Her MCP sunucusu (Supabase, Playwright, Vercel, Context7): `.mcp.json` / `claude mcp add`.
2. Her hook ve `.claude/settings.json` izin degisikligi.
3. `.claude/agents/*.md` dosyalari (yeni ajan, `tools` alani ve `permissionMode` yetki belirler).
4. Toplu paketler (`npx claude-code-templates`, `/plugin marketplace add ...`): ikisi de uzak kod/metin ceker; onerilmez.
(Hafiza notu: yetki yukseltme/guvenlik dusurme/prod yapilandirma islemleri kullaniciya birakilir.)

## 4. Claude icin en iyi pratikler (resmi dokumandan, code.claude.com/docs/en/sub-agents)
- Dosya duzeni: `CLAUDE.md` kisa ve kurallar odakli (bizdeki gibi, `@AGENTS.md` ice aktarimi); ayrintilar `docs/`te, CLAUDE.md oradan referans verir. Sadece davranisi degistiren, kodda gorulemeyen kurallar (RLS, clock.ts, PhoneInput) yazilir.
- Agent frontmatter: zorunlu `name`, `description`; istege bagli `tools`/`disallowedTools`, `model` (sonnet, opus, haiku, fable, inherit), `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, `effort`, `isolation: worktree`, `color`. Aciklamalar kisa tutulmali (toplam 15.000 token siniri). `name` yoksa dosya belge sayilip atlanir.
- Minimum yetki: denetci/QA ajanlari `Edit`/`Write` olmadan; yalniz hiz ajani rapor icin `Write`.
- Model secimi: derin muhakeme (guvenlik, migration) `opus`; rutin (QA, olcum, birlestirme) `sonnet`.
- Proje ajanlari `.claude/agents/` altinda commit edilir (ekip paylasimi). Oncelik: managed > `--agents` > proje > kullanici > plugin.
- Taslaklar: `docs/design/agent-taslaklari/` (5 dosya). Kopyalama `.claude/agents/` icine sahibi onayiyla yapilir; bu depoda `.claude/` yazilmadi.

## 5. Ilk 10 oneri (deger / risk / efor)
| # | Oneri | Deger | Risk | Efor |
|---|---|---|---|---|
| 1 | 5 ozel ajan taslagini `.claude/agents/`a koy (guvenlik-denetcisi, canli-qa, hiz-olcumcusu, migration-yazici, birlestirme-ajani) | Yuksek | Dusuk | Dusuk |
| 2 | `.env*` okuma engelleyen kendi PreToolUse hook'u | Yuksek | Dusuk (onayli) | Dusuk |
| 3 | Uygulanmis migration dosyasi degisikligini engelleyen hook (forward-only politikasi) | Yuksek | Dusuk | Dusuk |
| 4 | `/dogrula` komutu: type-check, lint, test, check:cron, db:rls-audit | Yuksek | Dusuk | Dusuk |
| 5 | `fewer-permission-prompts` ile salt-okunur izin listesi | Orta | Dusuk | Dusuk |
| 6 | anthropics/skills `frontend-design` metnini okuyup docs/DESIGN_SYSTEM.md ile birlestirilmis proje skill'i | Orta | Dusuk | Orta |
| 7 | Supabase MCP, yalniz read-only + ayri dev projesi | Orta | Yuksek (veri) | Orta |
| 8 | Playwright MCP, yalniz public site/localhost, izole profil | Orta | Orta | Dusuk |
| 9 | Context7 MCP (guncel Next.js 16/Supabase dokumani) | Orta | Orta (sorgular disari gider) | Dusuk |
| 10 | Topluluk ajan kataloglarindan (wshobson, VoltAgent) yalniz kontrol listesi ilhami: a11y, Postgres/RLS, SEO ajani yazimi | Orta | Dusuk (kopyalama yok) | Orta |

Kurulmamasi onerilenler: aitmpl toplu `npx` kurulumu, topluluk hook'lari, GitHub MCP (gh yeterli), Vercel MCP yazma yetkisiyle (deploy/satin alma).
Dogrulanamayanlar: son commit tarihleri, Figma MCP, Cursor registry'leri, shadcn MCP ayrintilari, ana checkout'taki `.claude/` icerigi.
