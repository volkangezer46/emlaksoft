import { PageHeader } from "@/components/ui/page-header";
import { requireModulePage } from "@/lib/require-module-page";
import { allPortalHosts, PORTAL_RULES_VERSION } from "@/lib/listing-control/adapters/html";
import { EXTENSION_LIMITS } from "@/lib/listing-control/worker/extension-pacing";
import { EXTENSION_LEGAL_NOTE } from "@/lib/listing-control/worker/extension-copy";
import { CONTROL_BASE } from "@/components/listing-control/helpers";
import { Panel } from "@/components/listing-control/ui-parts";
import { ExtensionStatus } from "@/components/listing-control/extension-status";

export const metadata = { title: "İlan kontrol tarayıcı eklentisi" };

/**
 * Tarayıcı eklentisi kurulum sayfası (Chrome / Edge, Manifest V3). Eklenti kaynak kodu `extensions/emlaksoft-ilan-kontrol/`,
 * paket `npm run build:extension` → `extensions/emlaksoft-ilan-kontrol/dist/`. İşçi durum satırı eklenti yoksa buraya bağlanır.
 */
export default async function EklentiPage() {
  await requireModulePage("portals", "/app/ilan-kontrol");
  const hosts = allPortalHosts();
  return (
    <>
      <PageHeader
        eyebrow="İlan Kontrol"
        title="Tarayıcı eklentisi: otomatik ilan kontrolü"
        description="EmlakSoft açıkken portal ilanlarınız sizin tarayıcınızdan, sizin bağlantınızla, düşük hızla kontrol edilir. Portaldan kalkan ama CRM'de işlem görmeyen ilan uyarı olarak düşer."
        breadcrumbs={[{ label: "İlan Kontrol", href: CONTROL_BASE }, { label: "Tarayıcı eklentisi" }]}
      />
      <div className="space-y-5">
        <ExtensionStatus />
        <Panel title="Nasıl çalışır?">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-text">
            <li>Herhangi bir EmlakSoft sekmesi açık ve oturumunuz açıkken eklenti kontrol sırasındaki ilanları birer birer alır.</li>
            <li>
              İlan sayfasını yeni sekme açmadan, kendi tarayıcınızda alır; ilan no, başlık, fiyat, yayın durumu ve ilan sahibi adını okur. Sunucu portala hiç bağlanmaz.
            </li>
            <li>
              Hız: iki kontrol arası en az {EXTENSION_LIMITS.minIntervalMs / 1000} sn (rastgele ek bekleme ile), saatte en çok {EXTENSION_LIMITS.maxPerHour}, günde en çok{" "}
              {EXTENSION_LIMITS.maxPerDay} ilan. Birden çok EmlakSoft sekmesi açıksa yalnız biri kontrol eder.
            </li>
            <li>
              Portal doğrulama (CAPTCHA), giriş ya da hız sınırı gösterirse eklenti bunu aşmaya çalışmaz: {EXTENSION_LIMITS.blockCooldownMs / 60_000} dakika durur ve sonuç
              &quot;kontrol edilemedi&quot; olur. Hiçbir engel &quot;ilan yok&quot; sayılmaz; bir ilan ancak portal açıkça &quot;bulunamadı/kaldırıldı&quot; dediğinde ve bağımsız
              kontrollerle teyit edildiğinde kayıp sayılır.
            </li>
            <li>Bütün EmlakSoft sekmelerini kapattığınızda kontroller durur. Eklenti simgesinden istediğiniz an duraklatabilirsiniz.</li>
          </ul>
        </Panel>
        <Panel title="Kurulum (geliştirici modunda yükleme)" description="Chrome Web Store yayını hazırlanana kadar paketlenmemiş eklenti olarak yüklenir.">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-text">
            <li>
              Eklenti paketini edinin: teknik sorumlunuz depoda <code className="font-mono">npm run build:extension</code> komutunu çalıştırır; paket{" "}
              <code className="font-mono">extensions/emlaksoft-ilan-kontrol/dist</code> klasörüne yazılır (ZIP olarak dağıtılabilir; açılmış klasör yüklenir).
            </li>
            <li>
              Chrome&apos;da <code className="font-mono">chrome://extensions</code>, Edge&apos;de <code className="font-mono">edge://extensions</code> adresini açın.
            </li>
            <li>Sağ üstteki &quot;Geliştirici modu&quot;nu açın.</li>
            <li>&quot;Paketlenmemiş öğe yükle&quot; düğmesiyle <code className="font-mono">dist</code> klasörünü seçin.</li>
            <li>EmlakSoft sekmesini yenileyin: bu sayfanın üstündeki durum &quot;Eklenti kurulu&quot; olmalı.</li>
            <li>Araç çubuğundaki eklenti simgesinden durumu, bugünkü kontrol sayısını görebilir, duraklatıp sürdürebilirsiniz.</li>
          </ol>
        </Panel>
        <Panel title="İzinler ve gizlilik">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-text">
            <li>Erişilen portal alanları yalnız: {hosts.join(", ")}. Başka siteye istek atılmaz.</li>
            <li>EmlakSoft ile yalnız açık EmlakSoft sayfası üzerinden konuşur; portal şifrenizi istemez, saklamaz.</li>
            <li>Sunucuya yalnız ilan no ile ilişkili gözlem gider (bulundu/bulunamadı, fiyat, başlık, ilan sahibi adı); sayfanın tamamı gönderilmez.</li>
            <li>Ayrıştırma kuralları sürümü: {PORTAL_RULES_VERSION} (portal sayfa yapısı değişirse sonuç &quot;kontrol edilemedi&quot; olur, yanlış &quot;ilan yok&quot; üretilmez).</li>
          </ul>
        </Panel>
        <Panel title="Chrome Web Store'a hazırlık (ofis/teknik sorumlu)">
          <p className="text-sm text-text">
            <code className="font-mono">dist</code> klasörü mağazaya yüklenebilecek Manifest V3 paketidir. Mağaza başvurusu için gizlilik politikası bağlantısı, izin gerekçeleri (yukarıdaki
            portal alanları ve EmlakSoft alanı) ve ekran görüntüleri hazırlanmalıdır; yayın kararı ve hesabı ofis/şirket sahibindedir.
          </p>
        </Panel>
        <p className="rounded-[var(--radius-control)] border border-line px-3 py-2 text-sm text-text-muted">{EXTENSION_LEGAL_NOTE}</p>
      </div>
    </>
  );
}
