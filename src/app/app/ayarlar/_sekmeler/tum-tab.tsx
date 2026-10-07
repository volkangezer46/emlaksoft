import Link from "@/components/ui/smart-link";
import {
  ArrowUpRight,
  Droplets,
  MapPin,
  Globe,
  Fingerprint,
  Layers,
  FileText,
  Megaphone,
  MessageSquareText,
  Plug,
  Radio,
  Rocket,
  ShieldCheck,
  Sliders,
  Sparkles,
  Trash2,
  Tags,
  Users2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { REAL_USE_HREF, canSwitchToRealUse } from "@/lib/sample-data/real-use";
import { loadSampleStatus } from "@/lib/sample-status";
import { canManageModules } from "@/lib/modules/permissions";

/** Sekme: Tüm ayarlar (alt sayfa kartları + örnek veri durumu + KVKK/uyum özeti). */
type SettingCard = {
  title: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  badge?: string;
  badgeCls?: string;
  href?: string;
};

const cards: SettingCard[] = [
  { title: "Ofis kurulumu", desc: "Adım adım kurulum sihirbazı: ofis bilgileri, ekip, ilk kayıtlar ve örnek veri.", icon: Rocket, tone: "bg-brand-600/10 text-brand-600", href: "/app/baslangic" },
  { title: "Şube / ekip", desc: "Şubeler, ekipler ve bölge yetkilendirmeleri.", icon: Users2, tone: "bg-cyan-400/12 text-cyan-500", href: "/app/ekip" },
  { title: "Kullanıcı & roller", desc: "Danışman, yönetici ve broker rol izinleri.", icon: Fingerprint, tone: "bg-mint-500/12 text-mint-600", href: "/app/ayarlar/roller" },
  { title: "Yetkilendirme", desc: "Kim hangi kayıtları görür: kullanıcı kapsamları, geçici istisnalar, kişiye özel izinler ve denetim günlüğü.", icon: ShieldCheck, tone: "bg-amber-400/12 text-amber-600", badge: "Yeni", badgeCls: "bg-mint-500/12 text-mint-600", href: "/app/ayarlar/yetkilendirme" },
  { title: "Entegrasyonlar", desc: "Hazır, yapılandırma bekleyen ve planlanan dış servis bağlantıları.", icon: Plug, tone: "bg-cyan-400/12 text-cyan-500", badge: "Yeni", badgeCls: "bg-mint-500/12 text-mint-600", href: "/app/ayarlar/entegrasyonlar" },
  { title: "Duyuru panosu", desc: "Ekibe duyuru yayınlayın, kim okudu takip edin.", icon: Megaphone, tone: "bg-brand-600/10 text-brand-600", badge: "Yeni", badgeCls: "bg-mint-500/12 text-mint-600", href: "/app/bildirimler?sekme=duyurular" },
  { title: "Mesaj şablonları", desc: "WhatsApp için hazır metinler — değişkenler tek tıkla dolar.", icon: MessageSquareText, tone: "bg-mint-500/12 text-mint-600", badge: "Yeni", badgeCls: "bg-mint-500/12 text-mint-600", href: "/app/ayarlar/mesaj-sablonlari" },
  { title: "Sözleşme şablonları", desc: "Hazır sözleşme metinlerini ekleyin, düzenleyin, pasife alın.", icon: FileText, tone: "bg-brand-600/10 text-brand-600", badge: "Yeni", badgeCls: "bg-mint-500/12 text-mint-600", href: "/app/ayarlar/sozlesme-sablonlari" },
  { title: "Güvenlik", desc: "SMS ile iki adımlı doğrulama ve giriş geçmişi.", icon: ShieldCheck, tone: "bg-mint-500/12 text-mint-600", badge: "Yeni", badgeCls: "bg-mint-500/12 text-mint-600", href: "/app/ayarlar/guvenlik" },
  { title: "Müşteri etiketleri", desc: "Etiketleri yeniden adlandırın, birleştirin ya da kaldırın.", icon: Tags, tone: "bg-brand-600/10 text-brand-600", href: "/app/ayarlar/etiketler" },
  { title: "Çöp kutusu", desc: "Silinen müşteri ve portföyleri 90 gün içinde geri alın.", icon: Trash2, tone: "bg-danger-500/10 text-danger-500", href: "/app/ayarlar/cop-kutusu" },
  { title: "Tanımlar & seçim listeleri", desc: "Müşteri tipi, kaynak, portföy tipi gibi tüm dropdown seçeneklerini yönetin.", icon: Sliders, tone: "bg-brand-600/10 text-brand-600", badge: "Yeni", badgeCls: "bg-mint-500/12 text-mint-600", href: "/app/ayarlar/tanimlar" },
  { title: "Tanımlar merkezi", desc: "SLA süreleri, uyarı eşikleri, komisyon ve bildirim varsayılanları; geçmiş ve varsayılana dön.", icon: Sliders, tone: "bg-brand-600/10 text-brand-600", badge: "Yeni", badgeCls: "bg-mint-500/12 text-mint-600", href: "/app/ayarlar/merkez" },
  { title: "Aday yakalama", desc: "Web formu/bağlantı, sırayla atama ve hızlı yanıt.", icon: Radio, tone: "bg-mint-500/12 text-mint-600", badge: "Yeni", badgeCls: "bg-mint-500/12 text-mint-600", href: "/app/ayarlar/lead" },
  { title: "Modüller", desc: "Kullanmadığınız alanları kapatın, menü sadeleşsin. Verileriniz silinmez.", icon: Layers, tone: "bg-brand-600/10 text-brand-600", badge: "Yeni", badgeCls: "bg-mint-500/12 text-mint-600", href: "/app/ayarlar/moduller" },
  { title: "Ofis vitrini", desc: "Vitrinde görünecek bölümler, tanıtım metni ve arama motorlarında görünme onayı.", icon: Globe, tone: "bg-cyan-400/12 text-cyan-500", badge: "Yeni", badgeCls: "bg-mint-500/12 text-mint-600", href: "/app/ayarlar/vitrin" },
  { title: "AI kullanımı", desc: "Aylık AI kredisi, kalan hak ve kimin ne kadar kullandığı.", icon: Sparkles, tone: "bg-brand-600/10 text-brand-600", badge: "Yeni", badgeCls: "bg-mint-500/12 text-mint-600", href: "/app/ayarlar/ai-kullanim" },
  { title: "Fotoğraf filigranı", desc: "İlan fotoğraflarına ofis logosu/adı otomatik basılsın — ilan çalınmasına karşı.", icon: Droplets, tone: "bg-cyan-400/12 text-cyan-500", badge: "Yeni", badgeCls: "bg-mint-500/12 text-mint-600", href: "/app/ayarlar/filigran" },
  { title: "Bölge bildirimi", desc: "Eksik ya da yanlış mahalleyi platform ekibine bildirin.", icon: MapPin, tone: "bg-cyan-400/12 text-cyan-500", href: "/app/ayarlar/cografya-bildir" },
];

export async function TumAyarlarTab({ tenantId, role, sampleSeededAt }: { tenantId: string | null; role: string; sampleSeededAt: string | null }) {
  // Modüller ve AI kullanımı kartları yalnız ofis sahibi ve genel müdür içindir.
  const visibleCards = cards.filter((c) => (c.href !== "/app/ayarlar/moduller" && c.href !== "/app/ayarlar/ai-kullanim") || canManageModules(role));
  const supabase = await createClient();
  const [sampleStatus, { count: consentCount }, { count: activeConsentCount }, { count: auditCount }] = await Promise.all([
    tenantId ? loadSampleStatus(supabase, tenantId, sampleSeededAt).catch(() => null) : Promise.resolve(null),
    supabase.from("iys_consents").select("id", { count: "exact", head: true }),
    supabase.from("iys_consents").select("id", { count: "exact", head: true }).eq("status", "granted"),
    supabase.from("audit_logs").select("id", { count: "exact", head: true }),
  ]);
  const complianceStrip = [
    {
      label: "İYS izinleri",
      value: (consentCount ?? 0) > 0 ? `${activeConsentCount ?? 0}/${consentCount} onaylı` : "Kayıt yok",
      ok: (consentCount ?? 0) > 0,
      href: "/app/uyum",
    },
    { label: "Yetki belgesi kalkanı", value: "Manuel", ok: false, href: "/app/uyum" },
    {
      label: "Denetim kaydı",
      value: (auditCount ?? 0) > 0 ? `${auditCount} olay` : "Boş",
      ok: (auditCount ?? 0) > 0,
      href: "/app/denetim",
    },
  ];
  return (
    <>
      {/* settings grid */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visibleCards.map((card) => {
          const inner = (
            <>
              <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-card)] ${card.tone}`}>
                <card.icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-display font-bold text-ink-950">{card.title}</h2>
                  {card.badge ? (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${card.badgeCls}`}>{card.badge}</span>
                  ) : (
                    <ArrowUpRight className="h-4 w-4 text-text-faint transition group-hover:text-brand-600" />
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-text-muted">{card.desc}</p>
              </div>
            </>
          );
          const cls = "lift group flex items-start gap-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5 text-left transition hover:border-brand-300";
          return card.href ? (
            <Link key={card.title} href={card.href} className={cls}>{inner}</Link>
          ) : (
            <button key={card.title} className={cls}>{inner}</button>
          );
        })}
      </div>

      {/* Örnek veriler — durum + tek tuş geçiş sayfasına bağlantı (silme işlemi o sayfada, onaylı) */}
      <section className="dashboard-panel flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-amber-400/15 text-amber-500">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display font-bold text-ink-950">Örnek veriler ve gerçek kullanım</h2>
            <p className="text-xs text-text-muted">
              {sampleStatus && sampleStatus.total > 0
                ? `${sampleStatus.total} örnek kayıt yüklü${sampleSeededAt ? ` (${new Date(sampleSeededAt).toLocaleDateString("tr-TR")})` : ""}. Tek tuşla temizle; gerçek kayıtlarına dokunulmaz.`
                : "Ofis gerçek kullanımda: yüklü örnek kayıt yok."}
            </p>
          </div>
        </div>
        {sampleStatus && sampleStatus.total > 0 ? (
          <Link
            href={REAL_USE_HREF}
            className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-ink-950 px-4 py-2.5 text-xs font-semibold text-white hover:bg-ink-800"
            title={canSwitchToRealUse(role) ? undefined : "Yalnız ofis sahibi veya genel müdür geçiş yapabilir"}
          >
            Gerçek kullanıma geç <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        ) : (
          <span className="rounded-full bg-mint-500/12 px-2.5 py-1 text-xs font-bold text-mint-600">Gerçek kullanım</span>
        )}
      </section>

      {/* compliance strip */}
      <section className="dashboard-panel flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-mint-500/12 text-mint-600"><ShieldCheck className="h-5 w-5" /></span>
          <div>
            <h2 className="font-display font-bold text-ink-950">KVKK & uyum durumu</h2>
            <p className="text-xs text-text-muted">İYS izinleri ve denetim kayıtları canlı verilerden hesaplanır.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {complianceStrip.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="focus-ring press lift group block rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-2.5 text-center transition hover:border-brand-300"
            >
              <p className="flex items-center justify-center gap-1 text-xs text-text-faint">
                {item.label}
                <ArrowUpRight className="hover-action h-3 w-3 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
              </p>
              <p className={`text-sm font-bold ${item.ok ? "text-mint-600" : "text-amber-600"}`}>{item.value}</p>
            </Link>
          ))}
          <Link href="/app/uyum" className="rounded-[var(--radius-control)] bg-ink-950 px-4 py-2.5 text-xs font-semibold text-white hover:bg-ink-800">
            Uyum merkezine git
          </Link>
        </div>
      </section>
    </>
  );
}
