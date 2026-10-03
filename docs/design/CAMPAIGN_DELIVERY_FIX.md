# Kampanya teslimat claim hatasi (23514)

Belirti: `/api/cron/campaign-delivery` her ~2 dk `campaign_claim_failed:23514` (check_violation).

## Kok neden
`20260810000920_campaign_delivery_compliance.sql` `campaigns_whatsapp_template_contract` kisitini `NOT VALID`
ekledi. NOT VALID yalniz mevcut satirlari taramaz; satira yapilan her UPDATE kisiti yeniden sinar.
`claim_campaign_delivery` (`20260731000135`) kampanyayi `sending` yaparken UPDATE atar. Sablon adi/dili
olmayan (veya mesaji > 612 karakter) eski WhatsApp kampanyasi `scheduled`/`sending` ise UPDATE 23514 verir;
kampanya her zaman sirada ilk oldugu icin tum teslimat bloke olur. (Canli DB'ye erisilmedi; tespit kod ve
migration okumasina dayanir. Dogrulama sorgusu:
`select id,status,channel from campaigns where channel='whatsapp' and status in ('scheduled','sending') and (whatsapp_template_name is null or char_length(message)>612);`)

## Duzeltme
- Migration `20260816001100_campaign_claim_legacy_whatsapp_fix.sql` (+ rollback): kisit `failed`/`done` icin
  gevsetilir; claim, gecersiz WhatsApp kampanyalarini `failed` (last_error `whatsapp_template_invalid`) yapar
  ve secimden dislar. Mevcut dosyalar degismedi.
- Kod (`src/lib/campaign-delivery.ts`): claim 23514 verirse worker bekleyen kampanyalari listeler, bozuklari
  atlar, gecerli ilkini id ile claim eder; `quarantinedCampaigns` + `failureReasons` heartbeat ayrintisinda
  gorunur (heartbeat `error`, HTTP 200). Migration uygulanmadan da diger kampanyalar teslim edilir.
  Bozuk kampanyayi migration oncesi `failed` yapmak mumkun degil (ayni kisit engeller).

## Sahibin adimlari
1. Yedek/PITR dogrula.
2. `npm run check:migrations -- --database` ve `npm run db:migrate -- --dry-run`.
3. `npm run db:migrate`.
4. Cron heartbeat'in `ok`a dondugunu kontrol et; `failed` yapilan eski WhatsApp kampanyalari
   (last_error `whatsapp_template_invalid`) sablonla yeniden olusturulmali.
