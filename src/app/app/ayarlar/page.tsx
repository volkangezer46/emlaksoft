import Link from "next/link";
import {
  ArrowUpRight,
  CheckCircle2,
  Crosshair,
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
  ShieldCheck,
  Sliders,
  Sparkles,
  Square,
  Trash2,
  Tags,
  Users2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { requireModulePage } from "@/lib/require-module-page";
import { RealUsePanel } from "@/components/app/real-use-panel";
import { loadSampleStatus } from "@/lib/sample-status";
import { getNotificationPrefs } from "@/app/actions/notification-prefs";
import { isNetgsmConfigured } from "@/lib/messaging/netgsm";
import { platformMessagingFallbackAllowed } from "@/lib/messaging/tenant-providers";
import { sanitizeMatchingWeights, type MatchingWeights } from "@/lib/matching";
import { CompanyForm } from "./company-form";
import { LicenseStatusCard } from "@/components/app/license-status-card";
import { loadTenantLicense, tenantLicenseStatus } from "@/lib/license-server";
import { getProvinceOptions } from "@/lib/geo/reader";
import { MatchingWeightsForm } from "./matching-weights-form";
import { LogoUploadForm } from "./logo-upload-form";
import { IntegrationsForm } from "./integrations-form";
import { ReadOnlyGate } from "./read-only-gate";
import { NotificationPrefsPanel } from "@/components/app/notification-prefs";
import { planLabel } from "@/lib/billing/plans";
import { loadOnboardingSnapshot } from "@/lib/onboarding-state";
import { canManageModules } from "@/lib/modules/permissions";

import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Ayarlar" };
type SettingCard = {
  title: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  badge?: string;
  badgeCls?: string;
  href?: string;
};

const SETUP_RING_C = 2 * Math.PI * 42;

const cards: SettingCard[] = [
  { title: "Şube / ekip", desc: "Şubeler, ekipler ve bölge yetkilendirmeleri.", icon: Users2, tone: "bg-cyan-400/12 text-cyan-500", href: "/app/ekip" },
  { title: "Kullanıcı & roller", desc: "Danışman, yönetici ve broker rol izinleri.", icon: Fingerprint, tone: "bg-mint-500/12 text-mint-600", href: "/app/ayarlar/roller" },
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

export default async function SettingsPage() {
  const { tenantId, role, perms } = await requireModulePage("settings");
  const canEditSettings = (perms.settings ?? []).includes("edit");
  // Modüller kartı yalnız ofis sahibi ve genel müdür içindir.
  const visibleCards = cards.filter((c) => (c.href !== "/app/ayarlar/moduller" && c.href !== "/app/ayarlar/ai-kullanim") || canManageModules(role));
  const supabase = await createClient();
  const provinces = await getProvinceOptions();

  const [user, { data: tenantRow }, notifPrefs, { count: consentCount }, { count: activeConsentCount }, { count: auditCount }, { data: netgsmRow }, { data: whatsappRow }, netgsmPlatformConfigured] = await Promise.all([
    getRequestUser(),
    supabase
      .from("tenants")
      .select("name, plan, tax_office, tax_number, license_no, brand_color, iban, phone, address_line, city, province_id, district_id, logo_url, website, sample_seeded_at, matching_weights")
      .limit(1)
      .maybeSingle(),
    getNotificationPrefs(),
    supabase.from("iys_consents").select("id", { count: "exact", head: true }),
    supabase.from("iys_consents").select("id", { count: "exact", head: true }).eq("status", "granted"),
    supabase.from("audit_logs").select("id", { count: "exact", head: true }),
    // Tablo henüz oluşmadıysa error döner, data null kalır — form boş başlar
    supabase.from("tenant_integrations").select("credentials, external_account_id").eq("provider", "netgsm").limit(1).maybeSingle(),
    supabase
      .from("tenant_integrations")
      .select("credentials, external_account_id, whatsapp_business_account_id, graph_api_version, connection_status")
      .eq("provider", "whatsapp")
      .limit(1)
      .maybeSingle(),
    isNetgsmConfigured(),
  ]);

  const tenant = tenantRow ?? { name: "", plan: "office", tax_office: null, tax_number: null, license_no: null, brand_color: null, iban: null, phone: null, address_line: null, city: null, province_id: null, district_id: null, logo_url: null, website: null, sample_seeded_at: null };
  const tenantLicense = await loadTenantLicense();
  const licenseStatus = tenantLicenseStatus(tenantLicense);
  const sampleSeededAt = (tenant as { sample_seeded_at?: string | null }).sample_seeded_at ?? null;
  const sampleStatus = tenantId
    ? await loadSampleStatus(supabase, tenantId, sampleSeededAt).catch(() => null)
    : null;
  // matching_weights null = varsayılan set kullanılıyor; form başlangıcı için güvenli ayrıştır.
  const rawMatchingWeights = (tenant as { matching_weights?: unknown }).matching_weights ?? null;
  const matchingWeights: MatchingWeights | null = rawMatchingWeights
    ? sanitizeMatchingWeights(rawMatchingWeights)
    : null;

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

  const netgsmCreds = (netgsmRow?.credentials ?? null) as { usercode?: string; password?: string; msgheader?: string } | null;
  // Şifre client'a asla gitmez — yalnızca var/yok bilgisi
  const netgsm = netgsmCreds && (netgsmCreds.usercode || netgsmCreds.msgheader)
    ? {
        usercode: netgsmCreds.usercode ?? "",
        msgheader: netgsmCreds.msgheader ?? "",
        inboundReceiver: String(netgsmRow?.external_account_id ?? ""),
        hasPassword: Boolean(netgsmCreds.password),
      }
    : null;
  const platformFallbackConfigured =
    netgsmPlatformConfigured && platformMessagingFallbackAllowed();
  const whatsappCreds = (whatsappRow?.credentials ?? null) as { configured?: boolean } | null;
  // Erişim anahtarı hiçbir zaman sayfa verisine girmez; yalnız maskeli var/yok bilgisi aktarılır.
  const whatsapp = whatsappRow
    ? {
        phoneNumberId: String(whatsappRow.external_account_id ?? ""),
        wabaId: String(whatsappRow.whatsapp_business_account_id ?? ""),
        graphVersion: String(whatsappRow.graph_api_version ?? ""),
        hasAccessToken: whatsappCreds?.configured === true,
        status: String(whatsappRow.connection_status ?? "configured"),
      }
    : null;

  // Kurulum kontrol listesi — ilk madde her zaman tamam (hesap zaten açık),
  // diğerleri tenant/hesap verisinden hesaplanır; eksikler ilgili forma bağlanır.
  const checklist: { label: string; done: boolean; href?: string }[] = [
    { label: "Hesap oluşturuldu", done: true },
    { label: "Ofis adı", done: !!tenant.name, href: "#marka-kimlik" },
    { label: "Vergi dairesi", done: !!tenant.tax_office, href: "#marka-kimlik" },
    { label: "Vergi / TC no", done: !!tenant.tax_number, href: "#marka-kimlik" },
    { label: "Yetki belgesi no", done: !!tenant.license_no, href: "#marka-kimlik" },
    { label: "Marka rengi", done: !!tenant.brand_color, href: "#marka-kimlik" },
    { label: "IBAN", done: !!tenant.iban, href: "#marka-kimlik" },
    { label: "Telefon", done: !!tenant.phone, href: "#marka-kimlik" },
    { label: "Adres", done: !!tenant.address_line, href: "#marka-kimlik" },
    { label: "Hesap e-postası", done: !!user?.email },
  ];
  // Kurulum yüzdesi: ana ekran şeridi ve /app/baslangic sihirbazıyla AYNI kaynak (onboarding-state).
  // Okunamazsa (null) eski profil alanı hesabına düşülür.
  const snap = tenantId ? await loadOnboardingSnapshot(tenantId) : null;
  const items = snap
    ? snap.state.steps.map((st) => ({ label: st.title, done: st.done, href: `/app/baslangic?adim=${st.id}` }))
    : checklist;
  const doneCount = items.filter((c) => c.done).length;
  const completion = snap ? snap.state.percent : Math.round((doneCount / checklist.length) * 100);
  return (
    <div className="space-y-6">
      {/* premium header */}
      <PageHeader title={tenant.name || "Ayarlar"} eyebrow="Ofis yapılandırması" description={`${planLabel(tenant.plan)} planı · ofis, ekip, uyum ve entegrasyonları tek merkezden yönetin.`} actions={
<div className="theme-dark flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] bg-[image:var(--grad-ink)] p-2"><details className="group/ring text-left">
            <summary
              className="focus-ring block cursor-pointer list-none rounded-full [&::-webkit-details-marker]:hidden"
              title="Eksik kurulum alanlarını görmek için tıklayın"
            >
              <div className="relative grid h-28 w-28 place-items-center">
                <div className="conic-spin pointer-events-none absolute inset-2 rounded-full opacity-30 blur-md" style={{ background: "conic-gradient(from 0deg, var(--mint-500), var(--brand-500), var(--mint-500))" }} />
                <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="8" />
                  <circle
                    cx="50"
                    cy="50"
                    r="42"
                    fill="none"
                    stroke="var(--mint-400)"
                    strokeWidth="8"
                    strokeLinecap="round"
                    className="ring-sweep"
                    style={{ "--circ": SETUP_RING_C, "--dash": SETUP_RING_C * (1 - completion / 100) } as React.CSSProperties}
                  />
                </svg>
                <div className="absolute text-center">
                  <p className="font-display text-xl font-extrabold text-white">%{completion}</p>
                  <p className="text-xs text-white/55">Kurulum</p>
                  <p className="text-xs text-mint-400/80 opacity-0 transition group-hover/ring:opacity-100">detay için tıkla</p>
                </div>
              </div>
            </summary>
            <div className="mt-3 w-72 rounded-[var(--radius-card)] border border-white/12 bg-white/8 p-4 backdrop-blur">
              <p className="text-xs font-bold uppercase tracking-[0.08em] text-white/55">
                Kurulum kontrol listesi ({doneCount}/{items.length})
              </p>
              <ul className="mt-2.5 space-y-2">
                {items.map((item) => (
                  <li key={item.label} className="flex items-center justify-between gap-3 text-xs">
                    <span className="flex min-w-0 items-center gap-2">
                      {item.done ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-mint-400" />
                      ) : (
                        <Square className="h-3.5 w-3.5 shrink-0 text-white/30" />
                      )}
                      <span className={`truncate ${item.done ? "text-white/55" : "text-white/85"}`}>{item.label}</span>
                    </span>
                    {!item.done && item.href ? (
                      <Link href={item.href} className="shrink-0 text-xs font-semibold text-mint-400 hover:text-mint-300">
                        Tamamla →
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
              {doneCount === items.length ? (
                <p className="mt-3 border-t border-white/10 pt-3 text-xs font-semibold text-mint-400">Kurulum tamam 🎉</p>
              ) : null}
            </div>
          </details></div>
} />

      <LicenseStatusCard />

      {/* Logo + company form */}
      <section id="marka-kimlik" className="dashboard-panel scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:p-6">
        <div className="flex items-center gap-3 border-b border-line pb-4">
          <div>
            <h2 className="font-display font-bold text-ink-950">Marka & kimlik</h2>
            <p className="text-xs text-text-muted">Logo, ofis adı ve iletişim bilgileri</p>
          </div>
        </div>
        <ReadOnlyGate canEdit={canEditSettings}>
        <div className="mt-5 border-b border-line pb-5">
          <LogoUploadForm currentUrl={tenant.logo_url ?? null} officeName={tenant.name || "Ofis"} />
        </div>
        <CompanyForm tenant={{ ...tenant, license_title: tenantLicense.licenseTitle, license_valid_until: tenantLicense.validUntil }} provinces={provinces} licenseBadge={{ label: licenseStatus.label, tone: licenseStatus.tone }} licenseColumnsReady={tenantLicense.extendedColumns} />
        </ReadOnlyGate>
      </section>

      {/* Eşleştirme ağırlıkları */}
      <section id="eslestirme-agirliklari" className="dashboard-panel scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-cyan-400/12 text-cyan-500"><Crosshair className="h-5 w-5" /></span>
            <div>
              <h2 className="font-display font-bold text-ink-950">Eşleştirme ağırlıkları</h2>
              <p className="text-xs text-text-muted">
                Talep × portföy skorunda hangi kriterin ne kadar önemli olduğunu ofisinize göre ayarlayın.
                {matchingWeights ? " Özel ağırlık seti aktif." : " Varsayılan set kullanılıyor."}
              </p>
            </div>
          </div>
          <Link href="/app/talepler?sekme=eslesme" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600">
            Eşleştirme sayfası <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <ReadOnlyGate canEdit={canEditSettings}>
          <MatchingWeightsForm initial={matchingWeights} />
        </ReadOnlyGate>
      </section>

      {/* Entegrasyonlar */}
      <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:p-6">
        <div className="flex items-center gap-3 border-b border-line pb-4">
          <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-cyan-400/12 text-cyan-500"><Plug className="h-5 w-5" /></span>
          <div>
            <h2 className="font-display font-bold text-ink-950">Entegrasyonlar</h2>
            <p className="text-xs text-text-muted">Ofise özel Netgsm SMS ve WhatsApp Cloud API bağlantıları</p>
          </div>
        </div>
        <div className="mt-5">
          <ReadOnlyGate canEdit={canEditSettings}>
          <IntegrationsForm
            netgsm={netgsm}
            platformConfigured={platformFallbackConfigured}
            whatsapp={whatsapp}
          />
          </ReadOnlyGate>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <NotificationPrefsPanel initial={notifPrefs} />
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="font-display font-bold text-ink-950">Hızlı bağlantılar</h2>
          <p className="mt-1 text-xs text-text-muted">Operasyon ve uyum kısayolları</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              { href: "/app/anlasmalar", label: "Anlaşma tahtası" },
              { href: "/app/denetim", label: "Denetim" },
              { href: "/app/uyum", label: "İYS / yetki kalkanı" },
              { href: "/app/degerleme", label: "Değerleme" },
            ].map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-xs font-semibold text-brand-600 transition hover:border-brand-300"
              >
                {l.label}
              </Link>
            ))}
          </div>
        </section>
      </div>

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

      {/* Örnek veriler — onboarding seti durumu + kalıcı temizleme */}
      <section className="dashboard-panel flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-amber-400/15 text-amber-500">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display font-bold text-ink-950">Örnek veriler</h2>
            <p className="text-xs text-text-muted">
              {sampleSeededAt
                ? `Keşif için yüklenen örnek kayıtlar aktif (${new Date(sampleSeededAt).toLocaleDateString("tr-TR")}). Temizleme gerçek kayıtlara dokunmaz.`
                : "Yüklü örnek kayıt yok. Boş ofiste panelden tek tıkla yükleyebilirsiniz."}
            </p>
          </div>
        </div>
        {sampleStatus && sampleStatus.total > 0 ? (
          <div className="flex w-full flex-col gap-3">
            <span className="w-fit rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-bold text-amber-600">Yüklü · {sampleStatus.total} kayıt</span>
            <RealUsePanel rows={sampleStatus.rows} total={sampleStatus.total} canClear={canEditSettings} />
          </div>
        ) : (
          <span className="rounded-full bg-ink-950/8 px-2.5 py-1 text-xs font-bold text-text-muted">Yüklü değil</span>
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
    </div>
  );
}
