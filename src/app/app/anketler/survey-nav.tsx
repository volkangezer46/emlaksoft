import { BarChart3, Headphones, HeartPulse, Settings2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { PageViewSwitch } from "@/components/app/page-tabs";

const TABS = [
  { id: "sonuclar", label: "Sonuçlar", icon: BarChart3 },
  { id: "kuyruk", label: "Anketör kuyruğu", icon: Headphones },
  { id: "ic-anket", label: "Ekip nabzı", icon: HeartPulse },
  { id: "ayarlar", label: "Tetikleyiciler ve şablonlar", icon: Settings2 },
] as const;
const HREFS: Record<(typeof TABS)[number]["id"], string> = {
  sonuclar: "/app/anketler",
  kuyruk: "/app/anketler/kuyruk",
  "ic-anket": "/app/anketler/ic-anket",
  ayarlar: "/app/anketler/ayarlar",
};

/**
 * Anketler bölümleri (sunucu bileşeni; dört sayfa ortak kullanır). Raporlar şeridinin "Anketler" sekmesinin altında
 * İKİNCİ bir şerit çizilmez: bölümler sağdaki küçük "Bölüm" anahtarıdır (telefonda menüye katlanır).
 */
export function SurveyNav({ current }: { current: (typeof TABS)[number]["id"] }) {
  return (
    <div className="mb-5">
      <PageViewSwitch base="/app/anketler" label="Bölüm" tabs={TABS} active={current} hrefs={HREFS} />
    </div>
  );
}

/** Tablolar yokken (migration uygulanmadı) tüm sayfalarda gösterilen açık uyarı. */
export function SurveyNotReady() {
  return (
    <Alert tone="warning" title="Anket modülü bu ortamda henüz etkin değil">
      Anketör kuyruğu için gereken veritabanı tabloları bu ortamda oluşturulmamış. Veritabanı güncellemesi uygulanana kadar
      bu bölüm kullanılamaz; mevcut müşteri memnuniyet anketi (Anketler &gt; Sonuçlar) ve bağlı anket linkleri aynen çalışmaya devam eder.
    </Alert>
  );
}
