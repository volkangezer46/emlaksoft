# Yol haritası (özet)

Hedef: ticari beta ~22–24 hafta (S0–S11). Tam ürün 14–18 ay.

| Sprint | Odak |
|--------|------|
| S0 | İskelet, tema, şema, docs, landing |
| S1 | Auth + tenant + RLS canlı |
| S2 | Müşteri + talep CRUD |
| S3 | Portföy + portal kayıt (URL/no) |
| S4 | Zorunlu kapanış + kayıp-kaçak |
| S5 | Komisyon simülatör / defter |
| S6 | Akıllı Arama OS (MVP) |
| S7 | Değerleme çok kaynaklı |
| S8 | İYS / EİDS / yetki kalkanı |
| S9 | iyzico abonelik |
| S10 | Ofis sağlık + raporlar |
| S11 | Beta sertleştirme |

## Bilinçli kısıtlar

- Portal **scrape yok** — ilan no/URL + periyodik teyit + kapanış formu
- Kendi foundation model yok — API + RAG + insan onayı
- Geo: `geo_*` tablolar + çeyreklik sync; chat’te mahalle hardcode yok
