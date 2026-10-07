import Link from "next/link";
import { CheckCircle2, Square } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { requireModulePage } from "@/lib/require-module-page";
import { planLabel } from "@/lib/billing/plans";
import { loadOnboardingSnapshot } from "@/lib/onboarding-state";
import { PageHeader } from "@/components/ui/page-header";
import { RadialGauge } from "@/components/ui/viz";
import { SETTINGS_TABS, parseSettingsTab, settingsTabHref } from "./_sekmeler/tabs";
import { HashTabRedirect } from "./_sekmeler/hash-tab-redirect";
import { EMPTY_SETTINGS_TENANT, SETTINGS_TENANT_COLUMNS, type SettingsTenant } from "./_sekmeler/types";
import { KimlikTab } from "./_sekmeler/kimlik-tab";
import { EslestirmeTab } from "./_sekmeler/eslestirme-tab";
import { EntegrasyonTab } from "./_sekmeler/entegrasyon-tab";
import { BildirimTab } from "./_sekmeler/bildirim-tab";
import { TumAyarlarTab } from "./_sekmeler/tum-tab";

/**
 * /app/ayarlar — sekme bazlı (`?sekme=kimlik|eslestirme|entegrasyon|bildirim|tum`, varsayılan kimlik). Başlık (kurulum
 * halkası) her sekmede; sekme gövdesi YALNIZ kendi verisini okur ve kendi istemci adasını çizer (önceden tek sayfada
 * 13 okuma + tüm formlar). Eski çapalar (`#marka-kimlik`, `#eslestirme-agirliklari`) `HashTabRedirect` ile sekmeye çevrilir.
 */
export default async function SettingsPage({ searchParams }: { searchParams?: Promise<{ sekme?: string }> }) {
  const { tenantId, role, perms } = await requireModulePage("settings");
  const sp = (await searchParams) ?? {};
  const tab = parseSettingsTab(sp.sekme);
  const canEditSettings = (perms.settings ?? []).includes("edit");
  const supabase = await createClient();
  const [snap, user, { data: tenantRow }] = await Promise.all([
    tenantId ? loadOnboardingSnapshot(tenantId) : Promise.resolve(null),
    getRequestUser(),
    supabase.from("tenants").select(SETTINGS_TENANT_COLUMNS).limit(1).maybeSingle(),
  ]);
  const tenant: SettingsTenant = { ...EMPTY_SETTINGS_TENANT, ...((tenantRow as Partial<SettingsTenant> | null) ?? {}) };

  // Kurulum kontrol listesi — ilk madde her zaman tamam (hesap zaten açık),
  // diğerleri tenant/hesap verisinden hesaplanır; eksikler ilgili forma bağlanır.
  const checklist: { label: string; done: boolean; href?: string }[] = [
    { label: "Hesap oluşturuldu", done: true },
    { label: "Ofis adı", done: !!tenant.name, href: "/app/ayarlar#marka-kimlik" },
    { label: "Vergi dairesi", done: !!tenant.tax_office, href: "/app/ayarlar#marka-kimlik" },
    { label: "Vergi / TC no", done: !!tenant.tax_number, href: "/app/ayarlar#marka-kimlik" },
    { label: "Yetki belgesi no", done: !!tenant.license_no, href: "/app/ayarlar#marka-kimlik" },
    { label: "Marka rengi", done: !!tenant.brand_color, href: "/app/ayarlar#marka-kimlik" },
    { label: "IBAN", done: !!tenant.iban, href: "/app/ayarlar#marka-kimlik" },
    { label: "Telefon", done: !!tenant.phone, href: "/app/ayarlar#marka-kimlik" },
    { label: "Adres", done: !!tenant.address_line, href: "/app/ayarlar#marka-kimlik" },
    { label: "Hesap e-postası", done: !!user?.email },
  ];
  // Kurulum yüzdesi: ana ekran şeridi ve /app/baslangic sihirbazıyla AYNI kaynak (onboarding-state).
  // Okunamazsa (null) eski profil alanı hesabına düşülür.
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
                <RadialGauge
                  value={completion}
                  max={100}
                  size={112}
                  stroke={9}
                  color="var(--mint-400)"
                  trackColor="var(--viz-track-inverse)"
                  format="percent"
                  ariaLabel="Ofis kurulumu tamamlanma"
                  className="absolute inset-0"
                />
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

      <HashTabRedirect active={tab} />
      <nav aria-label="Ayarlar sekmeleri" className="flex flex-wrap gap-1 rounded-[var(--radius-card)] border border-line bg-canvas p-1">
        {SETTINGS_TABS.map((t) => (
          <Link
            key={t.id}
            href={settingsTabHref(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={`focus-ring inline-flex min-h-10 items-center rounded-[var(--radius-control)] px-3.5 py-2 text-sm font-semibold transition ${tab === t.id ? "bg-surface text-ink-950 shadow-[var(--shadow-xs)]" : "text-text-muted hover:text-ink-950"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "kimlik" ? <KimlikTab tenant={tenant} canEdit={canEditSettings} /> : null}
      {tab === "eslestirme" ? <EslestirmeTab canEdit={canEditSettings} /> : null}
      {tab === "entegrasyon" ? <EntegrasyonTab canEdit={canEditSettings} /> : null}
      {tab === "bildirim" ? <BildirimTab tenantId={tenantId} /> : null}
      {tab === "tum" ? <TumAyarlarTab tenantId={tenantId} role={role} sampleSeededAt={tenant.sample_seeded_at} /> : null}
    </div>
  );
}
