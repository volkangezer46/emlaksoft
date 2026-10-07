import Link from "@/components/ui/smart-link";
import { redirect } from "next/navigation";
import { Info, UsersRound } from "lucide-react";
import { ROLE_LABELS } from "@/lib/role-labels";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { hasOfficeWideDataScope } from "@/lib/team/assignable-roles";
import { DAY_MS, now, trDayKey } from "@/lib/clock";
import { currentMonthPeriod, loadAdvisorMetrics } from "@/lib/team/advisor-metrics";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { loadAlerts } from "@/lib/oversight/load";
import { loadOversightSettings } from "@/lib/oversight/store";
import { OversightNav } from "../_components/oversight-nav";
import { PrivacyNote } from "../_components/privacy-note";

const PATH = "/app/ofis-kontrol/karne";

type Cert = { label: string; tone: "ok" | "warn" | "danger" | "none" };

/** Yetki belgesi durumu (advisor_profiles.authority_cert_expires_on). */
function certStatus(expiresOn: string | null | undefined, todayKey: string): Cert {
  if (!expiresOn) return { label: "Kayıt yok", tone: "none" };
  const days = Math.round((Date.parse(expiresOn) - Date.parse(todayKey)) / DAY_MS);
  if (days < 0) return { label: `Süresi doldu (${expiresOn})`, tone: "danger" };
  if (days <= 30) return { label: `${days} gün kaldı`, tone: "warn" };
  return { label: "Geçerli", tone: "ok" };
}

const CERT_CLS: Record<Cert["tone"], string> = {
  ok: "bg-mint-500/12 text-mint-700",
  warn: "bg-amber-400/15 text-amber-700",
  danger: "bg-danger-500/10 text-danger-600",
  none: "bg-ink-950/[0.06] text-text-muted",
};

function Metric({ label, value, href, attention }: { label: string; value: number | string; href: string; attention?: boolean }) {
  const zero = value === 0 || value === "0";
  return (
    <Link
      href={href}
      className={`focus-ring surface-interactive flex min-w-0 flex-col rounded-[var(--radius-control)] border px-3 py-2 transition hover:border-brand-400 ${
        attention && !zero ? "border-amber-400/50 bg-amber-400/10" : "border-line bg-surface"
      } ${zero ? "opacity-70 hover:opacity-100" : ""}`}
    >
      <span className="text-xs font-medium text-text-muted">{label}</span>
      <span className="numeric font-display text-lg font-extrabold tabular-nums text-ink-950">{value}</span>
    </Link>
  );
}

export default async function KarnePage() {
  const { tenantId, userId, role, perms } = await requireModulePage("dashboard", PATH);
  if (!tenantId || !hasOfficeWideDataScope(role)) redirect("/app/ofis-kontrol/benim");

  const supabase = await createClient();
  const nowMs = now();
  const todayKey = trDayKey(nowMs);
  const settings = await loadOversightSettings(supabase, tenantId);

  // TEK HESAP KAYNAĞI: loadAdvisorMetrics (Kıyas, KPI, Lig ve Performansım ile aynı sayılar). Yeni formül yok.
  const [metrics, alerts, certRes] = await Promise.all([
    loadAdvisorMetrics(supabase, {
      viewer: { userId, role, perms },
      tenantId,
      period: currentMonthPeriod(nowMs),
      nowMs,
      withLeadSignals: true,
    }),
    loadAlerts(supabase, tenantId, settings.thresholds, nowMs),
    supabase.from("advisor_profiles").select("profile_id, authority_cert_expires_on").eq("tenant_id", tenantId).limit(300),
  ]);

  const certBy = new Map(
    ((certRes.data ?? []) as { profile_id: string; authority_cert_expires_on: string | null }[]).map((c) => [c.profile_id, c.authority_cert_expires_on]),
  );
  const alertsBy = new Map<string, number>();
  for (const a of alerts.open) if (a.advisorId) alertsBy.set(a.advisorId, (alertsBy.get(a.advisorId) ?? 0) + 1);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Ofis Kontrol Merkezi"
        title="Danışman karnesi"
        description="Her danışman için tek bakışta iş yükü ve düzen göstergeleri. Sayılar Kıyas ve Performans ekranlarıyla aynı kaynaktan gelir; her sayı ilgili listeye götürür."
      />
      <OversightNav active="karne" office openAlerts={alerts.open.length} />

      {metrics.failed ? (
        <EmptyState
          icon={Info}
          tone="danger"
          illustration="error"
          title="Karne yüklenemedi"
          description="Danışman verileri şu an okunamadı. Sayfayı yenileyin; sorun sürerse destek ile iletişime geçin."
          action={{ href: "/app/destek", label: "Destek" }}
        />
      ) : metrics.rows.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          illustration="ekip"
          title="Karnesi gösterilecek danışman yok"
          description="Ofise danışman eklediğinizde iş yükü ve düzen göstergeleri burada görünür."
          action={{ href: "/app/ekip", label: "Ekibe git" }}
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {metrics.rows.map((m) => {
            const cert = certStatus(certBy.get(m.id), todayKey);
            const alertCount = alertsBy.get(m.id) ?? 0;
            return (
              <li key={m.id} className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/app/ekip/${m.id}`} className="focus-ring block truncate font-display font-bold text-ink-950 hover:text-brand-600 hover:underline">
                      {m.fullName}
                    </Link>
                    <p className="text-xs text-text-muted">{ROLE_LABELS[m.role] ?? m.role}</p>
                  </div>
                  <Link
                    href={`/app/ofis-kontrol/uyarilar?aktor=${m.id}`}
                    className={`focus-ring shrink-0 rounded-full px-2.5 py-1 text-xs font-bold transition hover:ring-1 hover:ring-brand-300 ${
                      alertCount > 0 ? "bg-amber-400/15 text-amber-700" : "bg-mint-500/12 text-mint-700"
                    }`}
                  >
                    {alertCount > 0 ? `${alertCount} açık uyarı` : "Uyarı yok"}
                  </Link>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Metric label="Yayındaki ilan" value={m.activePropertyCount} href={`/app/portfoyler?danisman=${m.id}`} />
                  <Metric label="Müşteri" value={m.customerCount} href={`/app/musteriler?assigned=${m.id}`} />
                  <Metric
                    label="Gecikmiş görev"
                    value={m.overdueTaskCount ?? "—"}
                    href={`/app/gorevler?danisman=${m.id}`}
                    attention={(m.overdueTaskCount ?? 0) > 0}
                  />
                  <Metric
                    label="Takipsiz talep"
                    value={m.untrackedDemandCount ?? "—"}
                    href={`/app/ekip/${m.id}`}
                    attention={(m.untrackedDemandCount ?? 0) > 0}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <Link href={`/app/ekip/${m.id}`} className="focus-ring inline-flex items-center gap-1.5 text-text-muted hover:text-brand-600">
                    Yetki belgesi:
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${CERT_CLS[cert.tone]}`}>{cert.label}</span>
                  </Link>
                  <Link href={`/app/ofis-kontrol?aktor=${m.id}`} className="focus-ring font-semibold text-brand-600 hover:underline">
                    İşlem akışı →
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-text-muted">
        Yanıt süresi gibi henüz sistemde ölçülmeyen göstergeler bilerek eklenmedi; ölçüm kaynağı oluştuğunda karneye eklenir.
      </p>
      <PrivacyNote audience="office" />
    </div>
  );
}
