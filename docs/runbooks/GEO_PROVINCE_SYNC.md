# İl Bazlı Coğrafya Tarama ve Eksik Tamamlama

Son güncelleme: 11 Ağustos 2026

## Amaç

Platform yöneticisi `/admin/geo` ekranında herhangi bir ili tek tıkla seçer. Seçilen il yüksek öncelikle kuyruğa alınır, diğer bekleyen coğrafya işleri `paused` durumuna geçer ve arka plan çalışanı yalnız bir ili işler. Tarayıcının kapanması işi yarıda bırakmaz.

## Kahramanmaraş ilk denetim sonucu

11 Ağustos 2026 tarihinde plaka kodu `46` için mevcut canlı kayıtlar ile TurkiyeAPI v2 kaynağı salt okunur karşılaştırıldı:

- İlçe: veritabanı `11`, kaynak `11`
- Mahalle: veritabanı `721`, kaynak `721`
- Eksik kaynak kimliği: `0`
- Fazladan kaynak kimliği: `0`
- Adı veya ilçesi değişmiş kayıt: `0`
- Sonuç: Kahramanmaraş zaten tam; veri yazımı gerekmedi.

İlçe bazında mahalle sayıları: Afşin 66, Andırın 57, Çağlayancerit 19, Dulkadiroğlu 105, Ekinözü 21, Elbistan 93, Göksun 75, Nurhak 16, Onikişubat 141, Pazarcık 84, Türkoğlu 44.

## Veri kaynağı ve Bright durumu

- Kaynak sabit ve izinli HTTPS origin üzerinden TurkiyeAPI v2'dir: `https://api.turkiyeapi.dev`.
- Projede Bright veya Bright Data entegrasyonu, anahtarı, kuyruğu ya da çalışanı bulunmamaktadır. Bu nedenle durdurulabilecek bir Bright işi yoktur ve arayüzde varmış gibi gösterilmez.
- Ödeme, mesajlaşma, dosya temizliği ve diğer ürün cron'ları coğrafya taraması değildir; bu işler durdurulmaz.
- Eski `scripts/geo-sync.ts` toplu ve manuel bir araçtır. Normal operasyon için kullanılmamalı; il bazlı yönetim ekranı ve kiralamalı çalışan tercih edilmelidir.

## Güvenlik ve bütünlük sözleşmesi

- Tarayıcı dış kaynağı çağırmaz ve geo tablolarına yazmaz.
- Server action yalnız UUID'yi alır, il kaydını tekrar veritabanından okur ve `geo` modül yetkisini doğrular.
- Kuyruk tablosu ve RPC'ler yalnız `service_role` erişimine açıktır; istemci RLS politikası yoktur.
- Çalışan `FOR UPDATE SKIP LOCKED`, global advisory lock ve lease token CAS kullanır.
- Kaynak yanıtı boyut, süre, şema, plaka/ilçe ebeveyni, sayfalama toplamı, sürüm ve beklenen il/ilçe mahalle sayılarıyla doğrulanır.
- Bir il tek transaction içinde uygulanır. Kaynakta olmayan yerel kayıt silinmez veya pasifleştirilmez; pasif yerel kayıt yeniden aktifleştirilmez.
- Kaynak kimliği önce, yalnız eski `source_id IS NULL` kayıtlarında normalize ad eşleşmesi ikinci tercih olarak kullanılır.
- Kaynakta aynı ilçe/ad için birden fazla kimlik varsa deterministik canonical satır işlenir, diğerleri çakışma olarak korunur ve iş `partial` olur. Böylece mevcut `(district_id, name)` benzersizlik sözleşmesi sessizce bozulmaz.
- Hatalar yalnız sınırlı makine kodu olarak saklanır; sağlayıcı gövdesi veya hassas veri loglanmaz.

## Durumlar

- `queued`: Seçildi, çalışmayı bekliyor.
- `running`: Lease alınmış, kaynak doğrulanıyor ve uygulanıyor.
- `paused`: Başka bir il seçildiği için bekletiliyor; satırdaki butonla tekrar öne alınabilir.
- `retry`: Geçici hata sonrası sınırlı geri çekilme ile yeniden denenecek.
- `succeeded`: Kaynak tam doğrulandı ve çakışmasız uygulandı.
- `partial`: Güvenli kayıtlar işlendi, kimlik/ad çakışmaları manuel incelemeye bırakıldı.
- `dead_letter`: Şema, kaynak veya kalıcı uygulama sorunu nedeniyle otomatik çalışma durdu.

## Operasyon

1. `/admin/geo` sayfasını açın.
2. İlin satırındaki **Tara ve tamamla** düğmesine basın.
3. Seçilen il `queued` olur; diğer bekleyen il işleri `paused` olur.
4. `geo-province-sync` cron'u en geç beş dakika içinde işi alır. Sayfa aktif iş varken durumu otomatik yeniler.
5. `partial` veya `dead_letter` sonucunda platform bildirimi ve satır durumu incelenir. Aynı ile tekrar basmak yeni paralel iş üretmez; seçili işi güvenli biçimde yeniden kuyruğa alır.

## Kod yüzeyi

- Migration: `supabase/migrations/20260811000010_geo_province_sync_jobs.sql`
- Sağlayıcı doğrulaması: `src/lib/geo-provider.ts`
- Çalışan: `src/lib/geo-province-sync.ts`
- Cron: `src/app/api/cron/geo-province-sync/route.ts`
- Server action: `src/app/actions/geo-admin.ts`
- Yönetim arayüzü: `src/app/admin/geo/page.tsx`, `province-row.tsx`
- Sözleşme testleri: `src/lib/geo-provider.test.ts`, `geo-province-sync-core.test.ts`, `geo-province-sync-contract.test.ts`

## Canlıya geçiş notu

Bu çalışma yerelde hazırlanmıştır. Yeni migration canlı veritabanına uygulanmadan düğme güvenli biçimde devre dışı görünür. Önce mevcut migration checksum/ledger sapması uzlaştırılmalı ve önceki credential olayı için rotasyon doğrulanmalıdır. Bu iki kapı kapanmadan migration uygulamayın, servis anahtarıyla yazma yapan tetikleme çalıştırmayın veya üretime dağıtmayın.
