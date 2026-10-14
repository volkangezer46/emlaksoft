import Link from "@/components/ui/smart-link";
import { AlarmClock, Gauge, MailCheck, ShieldAlert, ShieldQuestion, Timer } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { hasOfficeWideDataScope } from "@/lib/team/assignable-roles";
import { now, shiftMonthKey, trMonthKey } from "@/lib/clock";
import { isMonthKey } from "@/lib/month-grid";
import { PageHeader } from "@/components/ui/page-header";
import { KpiGrid } from "@/components/ui/dashboard-grid";
import { KpiCard } from "@/components/ui/premium";
import { EmptyState } from "@/components/ui/empty-state";
import { loadComplianceReport } from "@/lib/eids/compliance";
import { EIDS_LEGAL_NOTE, TAKEDOWN_DUE_DAYS, computeComplianceReport } from "@/lib/eids/actions-core";

export const metadata = { title: "Yetki uyum raporu" };
export const dynamic = "force-dynamic";

const PATH = "/app/raporlar/yetki-uyum";

const fmtHours = (h: number | null) => (h === null ? "—" : h < 24 ? `${h} saat` : `${Math.round((h / 24) * 10) / 10} gün`);
const fmtPct = (p: number | null) => (p === null ? "—" : `%${p}`);
const monthLabel = (key: string) =>
  new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}-15T00:00:00Z`));

/**
 * YETKİ UYUM RAPORU (aylık): EİDS iptal/süre bitimi sonrası ilan kaldırma performansı ve yetki kaydı kalitesi.
 * Kalemler: ortalama kaldırma süresi, 3 günü aşan kaldırmalar, e-posta ile teyitli oran, bilinmeyen oran ve 0-100 puan
 * (ofis karnesine aynı hesapla bileşen olarak girer). Kapsam: yönetim ofis geneli; diğer roller yalnız kendi görevleri.
 */
export default async function YetkiUyumPage({ searchParams }: { searchParams: Promise<{ ay?: string }> }) {
  const [{ tenantId, role, userId }, sp] = await Promise.all([requireModulePage("reports", "/app/raporlar"), searchParams]);
  const nowMs = now();
  const monthKey = isMonthKey(sp.ay) ? sp.ay : trMonthKey(nowMs);
  const prev = shiftMonthKey(monthKey, -1);
  const next = shiftMonthKey(monthKey, 1);
  const officeWide = hasOfficeWideDataScope(role);
  const supabase = await createClient();
  const load = tenantId ? await loadComplianceReport(supabase, tenantId, monthKey, nowMs) : { available: false as const };

  const header = (
    <PageHeader
      eyebrow="Raporlar"
      title="Yetki uyum raporu"
      breadcrumbs={[{ label: "Raporlar", href: "/app/raporlar" }, { label: "Yetki uyum" }]}
      description={`EİDS yetkisi iptal edilen ya da süresi dolan ilanların ${TAKEDOWN_DUE_DAYS} gün içinde kaldırılması ve yetki kayıtlarının kalitesi. ${monthLabel(monthKey)}.`}
      actions={
        <span className="flex items-center gap-3 text-sm font-semibold">
          {prev ? (
            <Link href={`${PATH}?ay=${prev}`} className="focus-ring text-brand-600 hover:underline touch:min-h-11">
              ← Önceki ay
            </Link>
          ) : null}
          {next && next <= trMonthKey(nowMs) ? (
            <Link href={`${PATH}?ay=${next}`} className="focus-ring text-brand-600 hover:underline touch:min-h-11">
              Sonraki ay →
            </Link>
          ) : null}
        </span>
      }
    />
  );

  if (!load.available) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          icon={ShieldQuestion}
          title="Rapor için sistem güncellemesi bekleniyor"
          description="EİDS aksiyon motorunun veritabanı güncellemesi henüz uygulanmadı. Uygulandığında kaldırma görevleri bu raporda görünür."
          action={{ href: "/app/raporlar", label: "Raporlara dön" }}
        />
      </div>
    );
  }

  const tasks = officeWide ? load.tasks : load.tasks.filter((t) => t.assigned_to === userId);
  // Kişisel kapsam: bu ay görevi olmayan danışmana ofis geneli rapor DEĞİL, boş kişisel rapor gösterilir.
  const r = officeWide ? load.report : (load.byAdvisor.get(userId) ?? computeComplianceReport({ tasks: [], portfolio: null, nowMs }));
  const advisorIds = [...load.byAdvisor.keys()].filter(Boolean);
  const { data: profiles } = officeWide && advisorIds.length
    ? await supabase.from("profiles").select("id, full_name").eq("tenant_id", tenantId).in("id", advisorIds)
    : { data: [] as { id: string; full_name: string | null }[] };
  const nameOf = new Map(((profiles ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? "Danışman"]));

  return (
    <div className="space-y-6">
      {header}
      <KpiGrid>
        <KpiCard label="Kaldırma görevi" value={tasks.length} icon={ShieldAlert} tone="brand" href="/app/gorevler?tur=eids_takedown&filter=all" hint={`${r.closedCount} tamamlandı`} dim={tasks.length === 0} />
        <KpiCard label="Ortalama kaldırma süresi" value={fmtHours(r.avgRemovalHours)} icon={Timer} tone="neutral" href="/app/gorevler?tur=eids_takedown&filter=done" hint="İptal/süre bitiminden görevin kapanmasına" />
        <KpiCard
          label={`${TAKEDOWN_DUE_DAYS} günü aşan kaldırma`}
          value={r.lateCount}
          icon={AlarmClock}
          tone={r.lateCount > 0 ? "danger" : "success"}
          attention={r.lateCount > 0}
          href="/app/gorevler?tur=eids_takedown&filter=overdue"
          dim={r.lateCount === 0}
        />
        {officeWide ? (
          <KpiCard label="E-posta ile teyitli" value={fmtPct(r.emailVerifiedPct)} icon={MailCheck} tone="success" href="/app/ilan-kontrol/yetki" hint="Bakanlık e-postasıyla doğrulanan yetki oranı" />
        ) : null}
        {officeWide ? (
          <KpiCard label="Yetkisi bilinmeyen" value={fmtPct(r.unknownPct)} icon={ShieldQuestion} tone={(r.unknownPct ?? 0) > 0 ? "warn" : "success"} href="/app/ilan-kontrol/yetki?kova=bilinmiyor" />
        ) : null}
        <KpiCard label="Uyum puanı" value={r.score === null ? "—" : `${r.score}/100`} icon={Gauge} tone="gold" href="/app/ofis-kontrol/karne" hint="Zamanında kaldırma %60 + bilinen yetki %40" />
      </KpiGrid>

      {officeWide && load.byAdvisor.size > 0 ? (
        <section aria-labelledby="yu-danisman" className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
          <h2 id="yu-danisman" className="font-display text-base font-bold text-ink-950">
            Danışman bazında
          </h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-text-muted">
                  <th className="py-2 font-medium">Danışman</th>
                  <th className="py-2 font-medium">Görev</th>
                  <th className="py-2 font-medium">Ortalama süre</th>
                  <th className="py-2 font-medium">{TAKEDOWN_DUE_DAYS} günü aşan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...load.byAdvisor.entries()].map(([id, a]) => (
                  <tr key={id || "_none"}>
                    <td className="py-2">
                      <Link href={id ? `/app/gorevler?tur=eids_takedown&filter=all&danisman=${id}` : "/app/gorevler?tur=eids_takedown&filter=all"} className="focus-ring font-semibold text-brand-600 hover:underline">
                        {id ? (nameOf.get(id) ?? "Danışman") : "Atanmamış"}
                      </Link>
                    </td>
                    <td className="py-2 tabular-nums">{a.takedownCount}</td>
                    <td className="py-2 tabular-nums">{fmtHours(a.avgRemovalHours)}</td>
                    <td className={`py-2 tabular-nums ${a.lateCount > 0 ? "font-semibold text-danger-600" : ""}`}>{a.lateCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <p className="text-xs text-text-muted">{EIDS_LEGAL_NOTE}</p>
    </div>
  );
}
