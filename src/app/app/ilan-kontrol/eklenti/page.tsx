import { PageHeader } from "@/components/ui/page-header";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { daysAgoIso } from "@/lib/clock";
import { allPortalHosts, PARSER_VERSION } from "@/lib/listing-control/adapters/html";
import { EXTENSION_LIMITS } from "@/lib/listing-control/worker/extension-pacing";
import { EXTENSION_LEGAL_NOTE } from "@/lib/listing-control/worker/extension-copy";
import { EXTENSION_DOWNLOAD_PATH, EXTENSION_VERSION, extensionStoreEnv } from "@/lib/listing-control/worker/extension-release";
import { summarizeParserTelemetry, type TelemetryRow } from "@/lib/listing-control/worker/extension-telemetry";
import { PORTAL_LABEL } from "@/lib/listing-control/worker/extension-labels";
import { getExtensionPackageInfo } from "@/lib/listing-control/server/extension-package";
import { CONTROL_BASE, kpiHref } from "@/components/listing-control/helpers";
import { Panel, TextLink } from "@/components/listing-control/ui-parts";
import { ExtensionWizard } from "@/components/listing-control/extension-wizard";

export const metadata = { title: "İlan kontrol tarayıcı eklentisi" };

/**
 * Tarayıcı eklentisi kurulum sayfası (Chrome / Edge, Manifest V3). Kullanıcı ekranında teknik komut YOKTUR: üç adımlı
 * sihirbaz (indir → tarayıcıya yükle → bağla) eklentiyi otomatik algılar; paket derleme sırasında üretilir ve
 * `/api/app/ilan-kontrol/eklenti.zip` ucundan inmeye hazırdır. Chrome Web Store / Edge Add-ons adresi ortam değişkeniyle
 * verilirse ("Chrome'a ekle") tek tık düğmesi görünür. Geliştirici notları: `docs/runbooks/ILAN_KONTROL_EKLENTI_YAYIN.md`.
 */

async function loadParserHealth() {
  try {
    const db = await createClient();
    const since = daysAgoIso(7).slice(0, 10);
    const { data, error } = await db
      .from("lc_parser_telemetry")
      .select("portal, parser_version, classification, layer, error_code, partial, n")
      .gte("day", since)
      .limit(2000);
    if (error) return null; // tablo yok (migration uygulanmamış) ya da yetki yok: bölüm gösterilmez
    return summarizeParserTelemetry((data ?? []) as TelemetryRow[]);
  } catch {
    return null;
  }
}

export default async function EklentiPage() {
  await requireModulePage("portals", "/app/ilan-kontrol");
  const hosts = allPortalHosts();
  const [pkg, health] = await Promise.all([getExtensionPackageInfo(), loadParserHealth()]);
  const stores = extensionStoreEnv();
  return (
    <>
      <PageHeader
        eyebrow="İlan Kontrol"
        title="Tarayıcı eklentisi: otomatik ilan kontrolü"
        description="EmlakSoft açıkken portal ilanlarınız sizin tarayıcınızdan, sizin bağlantınızla, düşük hızla kontrol edilir. Portaldan kalkan ama CRM'de işlem görmeyen ilan uyarı olarak düşer."
        breadcrumbs={[{ label: "İlan Kontrol", href: CONTROL_BASE }, { label: "Tarayıcı eklentisi" }]}
      />
      <div className="space-y-5">
        <ExtensionWizard
          latestVersion={EXTENSION_VERSION}
          downloadHref={pkg ? EXTENSION_DOWNLOAD_PATH : null}
          downloadBytes={pkg?.bytes ?? null}
          chromeStoreUrl={stores.chrome}
          edgeStoreUrl={stores.edge}
          hosts={hosts}
        />
        <Panel title="Nasıl çalışır?">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-text">
            <li>Eklentiyi bağladıktan sonra, herhangi bir EmlakSoft sekmesi açık ve oturumunuz açıkken eklenti kontrol sırasındaki ilanları birer birer alır.</li>
            <li>
              İlan sayfasını yeni sekme açmadan, kendi tarayıcınızda alır; ilan no, başlık, fiyat, yayın durumu ve ilan sahibi adını okur. Sunucu portala hiç bağlanmaz.
            </li>
            <li>
              Hız: iki kontrol arası en az {EXTENSION_LIMITS.minIntervalMs / 1000} sn (rastgele ek bekleme ile), saatte en çok {EXTENSION_LIMITS.maxPerHour}, günde en çok{" "}
              {EXTENSION_LIMITS.maxPerDay} ilan. Eklenti ayarlarından yalnız kısabilirsiniz (portal aç/kapa, çalışma saatleri, günlük sınır). Birden çok EmlakSoft sekmesi açıksa
              yalnız biri kontrol eder.
            </li>
            <li>
              Portal doğrulama (CAPTCHA), giriş ya da hız sınırı gösterirse eklenti bunu aşmaya çalışmaz: {EXTENSION_LIMITS.blockCooldownMs / 60_000} dakika durur ve sonuç
              &quot;kontrol edilemedi&quot; olur. Hiçbir engel &quot;ilan yok&quot; sayılmaz; bir ilan ancak portal açıkça &quot;bulunamadı/kaldırıldı&quot; dediğinde ve bağımsız
              kontrollerle teyit edildiğinde kayıp sayılır.
            </li>
            <li>Bütün EmlakSoft sekmelerini kapattığınızda kontroller durur. Eklenti simgesinden istediğiniz an duraklatabilirsiniz.</li>
          </ul>
        </Panel>
        {health && health.length > 0 ? (
          <Panel
            title="Ayrıştırıcı sağlığı (son 7 gün)"
            description="Portal sayfa yapısı değişirse ilan 'kontrol edilemedi' olur, yanlış 'ilan yok' üretilmez. Oran yükseliyorsa ayrıştırıcı güncellenmelidir."
            action={<TextLink href={kpiHref("unverifiable")}>Kontrol edilemeyen ilanlar</TextLink>}
          >
            {/* Telefon: portal + sürüm başına kart; md+ tablo. */}
            <ul className="space-y-2 md:hidden" aria-label="Ayrıştırıcı sağlığı">
              {health.map((r) => (
                <li key={`${r.portal}|${r.parserVersion}`} className="rounded-[var(--radius-control)] border border-line px-3 py-2 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-text">{PORTAL_LABEL[r.portal] ?? r.portal}</span>
                    <span className="font-mono text-xs text-text-muted">{r.parserVersion}</span>
                  </div>
                  <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs tabular-nums">
                    <div className="flex justify-between gap-2"><dt className="text-text-muted">Kontrol</dt><dd>{r.total}</dd></div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-text-muted">Edilemedi</dt>
                      <dd>
                        {r.unreadable} <span className="text-text-muted">(%{Math.round(r.unreadableRate * 100)})</span>
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2"><dt className="text-text-muted">Yapı tanınmadı</dt><dd>{r.drift}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-text-muted">Kısmi okuma</dt><dd>{r.partial}</dd></div>
                  </dl>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[32rem] text-left text-sm">
                <thead className="text-xs text-text-muted">
                  <tr>
                    <th scope="col" className="py-1 pr-3 font-medium">Portal</th>
                    <th scope="col" className="py-1 pr-3 font-medium">Ayrıştırıcı sürümü</th>
                    <th scope="col" className="py-1 pr-3 text-right font-medium">Kontrol</th>
                    <th scope="col" className="py-1 pr-3 text-right font-medium">Kontrol edilemedi</th>
                    <th scope="col" className="py-1 pr-3 text-right font-medium">Yapı tanınmadı</th>
                    <th scope="col" className="py-1 text-right font-medium">Kısmi okuma</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line tabular-nums">
                  {health.map((r) => (
                    <tr key={`${r.portal}|${r.parserVersion}`}>
                      <td className="py-1.5 pr-3 font-medium text-text">{PORTAL_LABEL[r.portal] ?? r.portal}</td>
                      <td className="py-1.5 pr-3 font-mono text-xs text-text">{r.parserVersion}</td>
                      <td className="py-1.5 pr-3 text-right">{r.total}</td>
                      <td className="py-1.5 pr-3 text-right">
                        {r.unreadable} <span className="text-text-muted">(%{Math.round(r.unreadableRate * 100)})</span>
                      </td>
                      <td className="py-1.5 pr-3 text-right">{r.drift}</td>
                      <td className="py-1.5 text-right">{r.partial}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-text-muted">Bu sayfadaki güncel ayrıştırıcı sürümü: {PARSER_VERSION}.</p>
          </Panel>
        ) : null}
        <div id="aktarim">
          <Panel
            title="Portala aktar ve portaldan al"
            description="Sahibinden, Hepsiemlak ve Emlakjet için; her adım sizin tıklamanızla, sizin portal oturumunuzda yapılır."
          >
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-text">
              <li>
                <strong>Portala aktar:</strong> portföy sayfasında “Yayın ve portallar” sekmesinden portalı seçin. Eklenti portalın “İlan ver” formunu portföy bilgileri ve fotoğraflarıyla doldurur; kategori, konum ve harita
                adımlarını siz seçersiniz, bulunamayan alanlar “Elle doldurun” listesinde görünür. <strong>“Yayınla”ya siz basarsınız.</strong> Yayınlanınca ilan numarası portföye bağlanır.
              </li>
              <li>
                <strong>Portaldan al:</strong> portalın “İlanlarım” sayfasındayken eklenti penceresinden “İlanlarımı EmlakSoft’a al”a basın, almak istediklerinizi seçin. Seçilenler taslak portföy olur; aynı ilan numarası
                zaten bağlıysa atlanır, benzer bir portföy varsa yeni kayıt açılmaz ve{" "}
                <TextLink href="/app/ilan-kontrol/eslesme">eşleşme kuyruğuna</TextLink> düşer.
              </li>
              <li>
                Eksik portal ve fiyat/durum farkları <TextLink href={CONTROL_BASE}>İlan Kontrol</TextLink> sayfasında görünür. Portal bir değişiklik yaparsa form doldurma geçici olarak çalışmayabilir; bu durumda eklenti
                dürüstçe “bulunamadı” der, hiçbir alanı tahminle yazmaz.
              </li>
            </ul>
          </Panel>
        </div>
        <Panel title="İzinler ve gizlilik">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-text">
            <li>Erişilen portal alanları yalnız: {hosts.join(", ")}. Başka siteye istek atılmaz.</li>
            <li>
              Eklenti dört izin ister: yerel ayar depolama, dakikalık uyandırma ve — yalnız siz eklenti penceresindeki düğmeye bastığınızda — açık portal sekmesini okuma/doldurma (etkin sekme + betik).
              Arka planda sekme gezmez. Oturum anahtarınızı almaz; EmlakSoft ile yalnız açık EmlakSoft sayfasındaki oturumunuz üzerinden konuşur.
            </li>
            <li>Portal şifrenizi istemez, saklamaz. Siz bağlanmadan eklenti hiçbir ilanı kontrol etmez; &quot;Bağlantıyı kes&quot; ile istediğiniz an durdurabilirsiniz.</li>
            <li>Sunucuya yalnız ilan no ile ilişkili gözlem gider (bulundu/bulunamadı, fiyat, başlık, ilan sahibi adı) ve ayrıştırıcı sayaçları; sayfanın tamamı gönderilmez.</li>
          </ul>
        </Panel>
        <p className="rounded-[var(--radius-control)] border border-line px-3 py-2 text-sm text-text-muted">{EXTENSION_LEGAL_NOTE}</p>
      </div>
    </>
  );
}
