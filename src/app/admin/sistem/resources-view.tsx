import Link from "@/components/ui/smart-link";
import { Box, Cpu, HardDrive, MemoryStick, Server, ShieldAlert } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { KpiCard, KpiGrid } from "@/components/ui/kpi-card";
import { RadialGauge } from "@/components/ui/viz";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { relativeTimeTR } from "@/lib/admin-format";
import { msSince } from "@/lib/clock";
import { formatBytesTr } from "@/lib/ops/backup-status";
import { HOST_METRIC_STALE_MINUTES } from "@/lib/alerts/evaluate";
import { mergeRuleConfigs, type AlertRuleRow } from "@/lib/alerts/rules";

type Container = { name: string; state: string; status: string; health: string | null; image: string };
type MetricRow = {
  at: string;
  host: string;
  disk_total_bytes: number | null;
  disk_used_bytes: number | null;
  disk_used_pct: number | string | null;
  mem_total_bytes: number | null;
  mem_used_bytes: number | null;
  mem_used_pct: number | string | null;
  load1: number | string | null;
  load5: number | string | null;
  load15: number | string | null;
  cpu_count: number | null;
  containers: Container[] | null;
};

const BASE = "/admin/sistem?sekme=kaynaklar";
const num = (v: number | string | null | undefined) => (v == null ? null : Number(v));
const pctText = (v: number | null) => (v == null ? "—" : `%${v.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}`);

/**
 * Sistem > Kaynaklar: sunucu betiğinin (scripts/sunucu/host-metrics.sh, dakikada bir) yazdığı son ölçüm.
 * Uygulama konteyneri docker soketine erişmez; ölçüm yoksa sahte değer yerine kurulum adımı gösterilir.
 */
export async function ResourcesView() {
  await requirePlatformModule("sistem");
  const admin = createAdminClient();
  const [lastRes, ruleRes] = await Promise.all([
    admin
      .from("host_metrics")
      .select("at, host, disk_total_bytes, disk_used_bytes, disk_used_pct, mem_total_bytes, mem_used_bytes, mem_used_pct, load1, load5, load15, cpu_count, containers")
      .order("at", { ascending: false })
      .limit(1),
    admin.from("alert_rules").select("key, enabled, threshold, repeat_minutes, muted_until").eq("key", "disk_usage"),
  ]);
  const m = (lastRes.data ?? [])[0] as MetricRow | undefined;
  const diskLimit = mergeRuleConfigs((ruleRes.data ?? []) as AlertRuleRow[]).disk_usage.threshold ?? 85;
  const tablesMissing = Boolean(lastRes.error && (lastRes.error.code === "42P01" || lastRes.error.code === "PGRST205"));

  const header = (
    <AdminPageHeader
      eyebrow="Operasyon"
      icon={Server}
      title="Sunucu kaynakları"
      description="Disk, bellek, yük ortalaması ve docker konteyner durumu. Ölçüm sunucu betiğinden dakikada bir gelir."
    />
  );

  if (!m) {
    return (
      <div className="space-y-6">
        {header}
        <section className="rounded-[var(--radius-panel)] border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
          <ShieldAlert className="mx-auto h-8 w-8 text-amber-600" />
          <h2 className="mt-3 font-display text-lg font-bold text-ink-950">{tablesMissing ? "Kurulum bekliyor" : "Henüz ölçüm yok"}</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-text-muted">
            {tablesMissing ? "host_metrics tablosu bu ortamda yok (migration 20261013004900). " : ""}
            Sunucuda bir kez <code className="rounded bg-canvas px-1">scripts/sunucu/host-metrics.sh --install</code> çalıştırılınca ölçüm dakikada bir yazılır.
          </p>
        </section>
      </div>
    );
  }

  const disk = num(m.disk_used_pct);
  const mem = num(m.mem_used_pct);
  const load1 = num(m.load1);
  const cpus = m.cpu_count ?? null;
  const stale = msSince(m.at) > HOST_METRIC_STALE_MINUTES * 60_000;
  const containers = Array.isArray(m.containers) ? m.containers : [];
  const down = containers.filter((c) => c.state !== "running" || c.health === "unhealthy");

  return (
    <div className="space-y-6">
      {header}
      {stale ? (
        <p className="rounded-[var(--radius-card)] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Son ölçüm {relativeTimeTR(m.at)} — {HOST_METRIC_STALE_MINUTES} dakikadan eski. Sunucudaki <code>/etc/cron.d/emlaksoft-host-metrics</code> satırını ve
          <code> /var/log/emlaksoft-host-metrics.log</code> günlüğünü kontrol edin; bu sürede disk uyarısı değerlendirilmez.
        </p>
      ) : null}
      <KpiGrid label="Kaynak göstergeleri" className="lg:grid-cols-4 2xl:grid-cols-4">
        <KpiCard layout="inline" label="Disk" value={pctText(disk)} href={`${BASE}#disk`} icon={HardDrive} tone={disk != null && disk >= diskLimit ? "danger" : "success"} attention={disk != null && disk >= diskLimit} hint={`uyarı eşiği %${diskLimit}`} />
        <KpiCard layout="inline" label="Bellek" value={pctText(mem)} href={`${BASE}#disk`} icon={MemoryStick} tone={mem != null && mem >= 90 ? "warn" : "brand"} />
        <KpiCard layout="inline" label="Yük (1 dk)" value={load1 == null ? "—" : load1.toLocaleString("tr-TR")} href={`${BASE}#disk`} icon={Cpu} tone={load1 != null && cpus && load1 > cpus ? "warn" : "brand"} hint={cpus ? `${cpus} çekirdek` : undefined} />
        <KpiCard layout="inline" label="Sorunlu konteyner" value={down.length} href={`${BASE}#konteynerler`} icon={Box} tone={down.length > 0 ? "danger" : "success"} attention={down.length > 0} hint={`${containers.length} konteyner`} />
      </KpiGrid>

      <section id="disk" className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
          <HardDrive className="h-4 w-4" /> {m.host} · {relativeTimeTR(m.at)}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-8">
          <div className="flex items-center gap-4">
            <Link href="/admin/sistem?sekme=uyarilar#kural-disk_usage" aria-label="Disk uyarı kuralı">
              <RadialGauge value={disk ?? 0} max={100} size={96} tone={disk != null && disk >= diskLimit ? "danger" : disk != null && disk >= diskLimit - 10 ? "warn" : "success"} ariaLabel="Disk kullanımı">
                <span className="text-lg font-bold tabular-nums text-ink-950">{pctText(disk)}</span>
              </RadialGauge>
            </Link>
            <dl className="m-0 text-sm">
              <dt className="font-semibold text-ink-950">Disk (/)</dt>
              <dd className="m-0 text-text-muted tabular-nums">
                {m.disk_used_bytes != null ? formatBytesTr(m.disk_used_bytes) : "—"} / {m.disk_total_bytes != null ? formatBytesTr(m.disk_total_bytes) : "—"}
              </dd>
            </dl>
          </div>
          <div className="flex items-center gap-4">
            <RadialGauge value={mem ?? 0} max={100} size={96} tone={mem != null && mem >= 90 ? "warn" : "brand"} ariaLabel="Bellek kullanımı">
              <span className="text-lg font-bold tabular-nums text-ink-950">{pctText(mem)}</span>
            </RadialGauge>
            <dl className="m-0 text-sm">
              <dt className="font-semibold text-ink-950">Bellek</dt>
              <dd className="m-0 text-text-muted tabular-nums">
                {m.mem_used_bytes != null ? formatBytesTr(m.mem_used_bytes) : "—"} / {m.mem_total_bytes != null ? formatBytesTr(m.mem_total_bytes) : "—"}
              </dd>
            </dl>
          </div>
          <dl className="m-0 text-sm">
            <dt className="font-semibold text-ink-950">Yük ortalaması</dt>
            <dd className="m-0 text-text-muted tabular-nums">
              {[m.load1, m.load5, m.load15].map((v) => (v == null ? "—" : Number(v).toLocaleString("tr-TR"))).join(" · ")} (1 · 5 · 15 dk)
            </dd>
          </dl>
        </div>
      </section>

      <section id="konteynerler" className="scroll-mt-24 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
        <div className="border-b border-line px-5 py-3.5">
          <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
            <Box className="h-4 w-4" /> Docker konteynerleri
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">{down.length > 0 ? `${down.length} konteyner sorunlu` : "Tüm konteynerler çalışıyor"}</h2>
        </div>
        {containers.length === 0 ? (
          <p className="px-5 py-4 text-sm text-text-muted">Konteyner listesi alınamadı (docker erişimi yok).</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs text-text-muted">
                <tr>
                  <th className="px-5 py-2 font-semibold">Ad</th>
                  <th className="px-3 py-2 font-semibold">Durum</th>
                  <th className="px-3 py-2 font-semibold">Ayrıntı</th>
                  <th className="px-5 py-2 font-semibold">İmaj</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {containers.map((c) => {
                  const bad = c.state !== "running" || c.health === "unhealthy";
                  return (
                    <tr key={c.name}>
                      <td className="px-5 py-2 font-semibold text-ink-950">{c.name}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${bad ? "bg-danger-500/10 text-danger-600" : "bg-mint-500/12 text-mint-700"}`}>
                          {c.state === "running" ? (c.health === "unhealthy" ? "sağlıksız" : "çalışıyor") : c.state || "bilinmiyor"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-text-muted">{c.status}</td>
                      <td className="numeric max-w-[16rem] truncate px-5 py-2 text-xs text-text-faint">{c.image}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
