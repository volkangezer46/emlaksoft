import { Database, Gauge, Plug, ShieldAlert, Table2, Timer } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { KpiCard, KpiGrid } from "@/components/ui/kpi-card";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { formatBytesTr } from "@/lib/ops/backup-status";

type TableRow = { schema: string; name: string; total_bytes: number; table_bytes: number; rows_estimate: number };
type Overview = {
  db_bytes: number;
  max_connections: number;
  connections: number;
  connections_active: number;
  connections_idle_tx: number;
  connections_total: number;
  stat_statements: boolean;
  tables: TableRow[];
};
type SlowRow = { query: string; calls: number; mean_ms: number; total_ms: number; rows_count: number };

const BASE = "/admin/sistem?sekme=veritabani";
const ms = (v: number) => `${v.toLocaleString("tr-TR", { maximumFractionDigits: v < 10 ? 2 : 0 })} ms`;

/**
 * Sistem > Veritabanı: SALT OKUNUR konsol. Boyut, en büyük 10 tablo, bağlantı sayısı ve en yavaş sorgular
 * (pg_stat_statements; sabitler $n ile normalleştirilmiş, 400 karakterde kırpılmış). Yalnız service_role RPC'leri
 * (ops_db_overview, ops_slow_queries); hiçbir şey yazılmaz, serbest SQL çalıştırılmaz.
 */
export async function DatabaseView() {
  await requirePlatformModule("sistem");
  const admin = createAdminClient();
  const [ovRes, slowRes] = await Promise.all([admin.rpc("ops_db_overview"), admin.rpc("ops_slow_queries", { p_limit: 10 })]);

  const header = (
    <AdminPageHeader
      eyebrow="Operasyon"
      icon={Database}
      title="Veritabanı konsolu"
      description="Boyut, en büyük tablolar, bağlantılar ve yavaş sorgular. Salt okunur: bu ekrandan hiçbir şey değiştirilemez."
    />
  );

  if (ovRes.error || !ovRes.data) {
    const pending = ovRes.error?.code === "PGRST202" || ovRes.error?.code === "42883";
    return (
      <div className="space-y-6">
        {header}
        <section className="rounded-[var(--radius-panel)] border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
          <ShieldAlert className="mx-auto h-8 w-8 text-amber-600" />
          <h2 className="mt-3 font-display text-lg font-bold text-ink-950">{pending ? "Kurulum bekliyor" : "Veritabanı bilgisi okunamadı"}</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-text-muted">
            {pending ? "ops_db_overview RPC'si bu ortamda yok (migration 20261013004900_ops_alerts.sql)." : "Bağlantı ya da yetki hatası; birkaç dakika sonra yeniden deneyin."}
          </p>
        </section>
      </div>
    );
  }

  const ov = ovRes.data as Overview;
  const tables = Array.isArray(ov.tables) ? ov.tables : [];
  const slow = (slowRes.error ? [] : (slowRes.data ?? [])) as SlowRow[];
  const connPct = ov.max_connections > 0 ? Math.round((ov.connections_total / ov.max_connections) * 100) : 0;

  return (
    <div className="space-y-6">
      {header}
      <KpiGrid label="Veritabanı göstergeleri" className="lg:grid-cols-4 2xl:grid-cols-4">
        <KpiCard layout="inline" label="Veritabanı boyutu" value={formatBytesTr(ov.db_bytes)} href={`${BASE}#tablolar`} icon={Database} tone="brand" />
        <KpiCard
          layout="inline"
          label="Bağlantı"
          value={`${ov.connections_total}/${ov.max_connections}`}
          href={`${BASE}#baglantilar`}
          icon={Plug}
          tone={connPct >= 80 ? "danger" : connPct >= 60 ? "warn" : "success"}
          attention={connPct >= 80}
          hint={`%${connPct} dolu`}
        />
        <KpiCard layout="inline" label="Etkin sorgu" value={ov.connections_active} href={`${BASE}#baglantilar`} icon={Gauge} tone="brand" hint={`${ov.connections_idle_tx} işlemde boşta`} />
        <KpiCard
          layout="inline"
          label="En yavaş ortalama"
          value={slow[0] ? ms(Number(slow[0].mean_ms)) : "—"}
          href={`${BASE}#yavas`}
          icon={Timer}
          tone={slow[0] && Number(slow[0].mean_ms) > 1000 ? "warn" : "brand"}
          hint={ov.stat_statements ? "pg_stat_statements" : "eklenti yok"}
        />
      </KpiGrid>

      <section id="tablolar" className="scroll-mt-24 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
        <div className="border-b border-line px-5 py-3.5">
          <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
            <Table2 className="h-4 w-4" /> En büyük 10 tablo
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Toplam boyut (indeks ve TOAST dahil)</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="adm-tbl-m w-full md:min-w-[520px] text-sm">
            <thead className="text-left text-xs text-text-muted">
              <tr>
                <th className="px-5 py-2 font-semibold">Tablo</th>
                <th className="px-3 py-2 text-right font-semibold">Toplam</th>
                <th className="px-3 py-2 text-right font-semibold">Veri</th>
                <th className="px-5 py-2 text-right font-semibold">Tahmini satır</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {tables.map((t) => {
                const share = ov.db_bytes > 0 ? Math.min(100, (t.total_bytes / ov.db_bytes) * 100) : 0;
                return (
                  <tr key={`${t.schema}.${t.name}`}>
                    <td className="px-5 py-2">
                      <span className="numeric font-semibold text-ink-950">
                        {t.schema === "public" ? "" : `${t.schema}.`}
                        {t.name}
                      </span>
                      <span className="mt-1 block h-1.5 rounded-full bg-canvas" aria-hidden="true">
                        <span className="block h-1.5 rounded-full bg-brand-500" style={{ width: `${share}%` }} />
                      </span>
                    </td>
                    <td data-label="Toplam" className="px-3 py-2 text-right tabular-nums text-ink-950">{formatBytesTr(t.total_bytes)}</td>
                    <td data-label="Veri" className="px-3 py-2 text-right tabular-nums text-text-muted">{formatBytesTr(t.table_bytes)}</td>
                    <td data-label="Tahmini satır" className="px-5 py-2 text-right tabular-nums text-text-muted">{Number(t.rows_estimate).toLocaleString("tr-TR")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section id="baglantilar" className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
          <Plug className="h-4 w-4" /> Bağlantılar
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <dt className="text-text-muted">İstemci bağlantısı (tüm DB)</dt>
          <dd className="m-0 font-semibold tabular-nums text-ink-950">{ov.connections_total}</dd>
          <dt className="text-text-muted">Bu veritabanı</dt>
          <dd className="m-0 font-semibold tabular-nums text-ink-950">{ov.connections}</dd>
          <dt className="text-text-muted">Etkin</dt>
          <dd className="m-0 font-semibold tabular-nums text-ink-950">{ov.connections_active}</dd>
          <dt className="text-text-muted">İşlemde boşta</dt>
          <dd className={`m-0 font-semibold tabular-nums ${ov.connections_idle_tx > 0 ? "text-amber-700" : "text-ink-950"}`}>{ov.connections_idle_tx}</dd>
        </dl>
      </section>

      <section id="yavas" className="scroll-mt-24 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
        <div className="border-b border-line px-5 py-3.5">
          <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
            <Timer className="h-4 w-4" /> Yavaş sorgular
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Ortalama süreye göre ilk 10 (en az 3 çağrı)</h2>
        </div>
        {!ov.stat_statements ? (
          <p className="px-5 py-4 text-sm text-text-muted">pg_stat_statements eklentisi bu veritabanında yok.</p>
        ) : slow.length === 0 ? (
          <p className="px-5 py-4 text-sm text-text-muted">Henüz yeterli sorgu istatistiği yok.</p>
        ) : (
          <ul className="divide-y divide-line">
            {slow.map((q, i) => (
              <li key={i} className="px-5 py-3">
                <p className="flex flex-wrap gap-x-4 text-xs text-text-muted">
                  <span className="font-semibold text-ink-950">ort. {ms(Number(q.mean_ms))}</span>
                  <span>{Number(q.calls).toLocaleString("tr-TR")} çağrı</span>
                  <span>toplam {ms(Number(q.total_ms))}</span>
                  <span>{Number(q.rows_count).toLocaleString("tr-TR")} satır</span>
                </p>
                <pre className="numeric mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-[var(--radius-control)] bg-canvas p-2 text-xs text-text-muted">{q.query}</pre>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
