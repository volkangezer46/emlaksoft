import type { Metadata } from "next";
import { BrainCircuit } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Alert } from "@/components/ui/alert";
import { requirePlatformModule } from "@/lib/platform";
import { ZEKA_CENTER_TABS, zekaCenterTabOf } from "@/lib/ai/zeka/center";
import { ConnectionView } from "./_views/connection";
import { SurfacesView } from "./_views/surfaces";
import { BehaviorView } from "./_views/behavior";
import { KnowledgeView } from "./_views/knowledge";
import { UsageView } from "./_views/usage";
import { LogsView, type LogFilters } from "./_views/logs";

type Sp = { sekme?: string; gun?: string } & Partial<Record<keyof LogFilters, string>>;

export async function generateMetadata({ searchParams }: { searchParams?: Promise<Sp> }): Promise<Metadata> {
  const sp = (await searchParams) ?? {};
  return { title: `Yapay zeka merkezi · ${ZEKA_CENTER_TABS[zekaCenterTabOf(sp.sekme)]}` };
}

const DESCRIPTIONS: Record<keyof typeof ZEKA_CENTER_TABS, string> = {
  baglanti: "OpenAI anahtarının durumu, kullanılacak model ve tek tıkla bağlantı testi. Anahtar eklenince Zeka kod değişmeden GPT ile çalışır.",
  yuzeyler: "Zeka'nın her yüzeyde açık olup olmadığı, hangi motorla yanıtlayacağı, günlük soru sınırları ve yanıt uzunluğu.",
  davranis: "Asistanın kişiliği ve tonu, yüzeye özel ek talimatlar, yasaklı konular ve yanıt dili. Güvenlik ve yetki kuralları her zaman önce gelir.",
  bilgi: "Zeka'nın bilgi kaynakları, bilgi tabanı ve anlamsal dizin durumu, onaylı soru-cevaplar.",
  kullanim: "Yüzey, motor ve ofis bazında kullanım, ofis kredisinden düşen GPT harcaması ve en çok sorulan cevapsız sorular.",
  kayitlar: "Kişisel verisi maskelenmiş sorgu günlüğü. Süzgeçler adres çubuğunda kalır; paylaşılan bağlantı aynı listeyi açar.",
};

/**
 * Yapay zeka merkezi (EmlakSoft Zeka yönetimi). Sekme şeridi TEK kaynaktan (src/lib/admin/nav.ts "Yapay zeka merkezi"
 * tabs; kabuktaki AdminSectionTabs); bu sayfa ikinci şerit çizmez. Kapı: `advisor` modülü (proxy-gates satırı
 * `/admin/zeka`). Yazma yalnız süper admin (eylemlerde zorunlu); diğer personel her sekmeyi salt okunur görür.
 * Ayarlar registry'de (`zeka.*`): her yazım geçmişe ve platform denetimine işlenir.
 */
export default async function AdminZekaCenterPage({ searchParams }: { searchParams?: Promise<Sp> }) {
  const staff = await requirePlatformModule("advisor");
  const canWrite = staff.role === "super_admin";
  const sp = (await searchParams) ?? {};
  const tab = zekaCenterTabOf(sp.sekme);

  return (
    <div className="space-y-6">
      <AdminPageHeader art="ai" icon={BrainCircuit} eyebrow="AI & entegrasyon · EmlakSoft Zeka" title={`Yapay zeka merkezi · ${ZEKA_CENTER_TABS[tab]}`} description={DESCRIPTIONS[tab]} />
      {!canWrite ? (
        <Alert tone="info" title="Salt okunur görünüm">
          Bu ekrandaki ayarları yalnız süper admin değiştirebilir. Değerleri ve kullanımı görebilirsiniz.
        </Alert>
      ) : null}
      {tab === "baglanti" ? <ConnectionView canWrite={canWrite} /> : null}
      {tab === "yuzeyler" ? <SurfacesView canWrite={canWrite} /> : null}
      {tab === "davranis" ? <BehaviorView canWrite={canWrite} /> : null}
      {tab === "bilgi" ? <KnowledgeView canWrite={canWrite} /> : null}
      {tab === "kullanim" ? <UsageView canWrite={canWrite} days={sp.gun} /> : null}
      {tab === "kayitlar" ? <LogsView filters={sp} /> : null}
    </div>
  );
}
