import Link from "@/components/ui/smart-link";
import { ArrowUpRight, FlaskConical, Gauge, Info, Zap } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { toTrLocalInput } from "@/lib/clock";
import { requirePlatformModule } from "@/lib/platform";
import { STATIC_HTML_BUDGET, checkStaticHtmlBudget } from "@/lib/perf/budgets";
import { COMPRESSION_RUNBOOK } from "@/lib/perf/compression";
import { formatMetric } from "@/lib/perf/cwv";
import { listLabRuns, readStaticToggles, type LabRun } from "@/lib/perf/store";
import { STATIC_ROUTES } from "@/lib/static-home/registry";
import { staticSnapshots } from "@/lib/static-home/render";
import { staticRouteMode, type StaticRouteMode, type StaticRouteToggles } from "@/lib/static-home/settings";
import { CompressionTestButton, PurgeWarmButton, SelfTestPanel, StaticRouteSwitch } from "./speed-controls";

export const metadata = { title: "Hız" };

const fmt = (ms: number) => toTrLocalInput(ms).replace("T", " ");
const kb = (b: number | null | undefined) => (b == null ? "—" : `${(b / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} KB`);

const Chip = ({ tone, children }: { tone: string; children: React.ReactNode }) => (
  <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}>{children}</span>
);

function StatusChip({ mode, lastStatic }: { mode: StaticRouteMode; lastStatic: boolean | null }) {
  if (mode === "disabled") return <Chip tone="bg-ink-950/8 text-text-muted">Kapalı (ertelendi)</Chip>;
  if (mode === "env_off") return <Chip tone="bg-amber-100 text-amber-900">Env ile kapatıldı</Chip>;
  if (mode === "off") return <Chip tone="bg-ink-950/8 text-text-muted">Kapalı</Chip>;
  if (lastStatic === false) return <Chip tone="bg-danger-500/10 text-danger-700">Yedek (normal HTML)</Chip>;
  return <Chip tone="bg-mint-500/15 text-mint-700">Statik</Chip>;
}

/**
 * HIZ MERKEZİ: kayıt defterindeki herkese açık sayfaların statik (JS'siz) sunum anahtarları, bellek önbelleği durumu,
 * temizle ve ısıt, X-Static ve sıkıştırma öz testleri, hız bütçesi ve son iki laboratuvar koşusu. Bellek durumu bu
 * sunucu sürecinindir (yeniden başlatmadan sonra ilk ziyarette dolar). Render sırasında dış çağrı yapılmaz.
 */
export default async function AdminSpeedPage() {
  const staff = await requirePlatformModule("sitecontent");
  const isSuper = staff.role === "super_admin";
  const [toggles, lab] = await Promise.all([
    readStaticToggles().catch((): StaticRouteToggles | null => null),
    listLabRuns({ path: "/", limit: 20 }).catch(() => ({ rows: [] as LabRun[], tableMissing: false, failed: true as const })),
  ]);
  const snaps = new Map(staticSnapshots().map((s) => [s.id, s]));
  const rows = STATIC_ROUTES.map((r) => {
    const snap = snaps.get(r.id);
    return { r, mode: staticRouteMode(r, toggles ?? {}), stats: snap?.stats ?? null };
  });
  const home = snaps.get("home")?.stats ?? null;
  const homeMeasured = home?.lastStatic === true && home.rawBytes !== null && home.gzipBytes !== null;
  const violations = homeMeasured ? checkStaticHtmlBudget({ rawBytes: home!.rawBytes!, gzipBytes: home!.gzipBytes! }) : [];
  const mobileRuns = lab.rows.filter((x) => x.device === "mobile" && x.source === "psi").slice(0, 2);
  const [latest, previous] = mobileRuns;
  const labels = Object.fromEntries(STATIC_ROUTES.map((r) => [r.id, r.label]));

  return (
    <div className="space-y-6">
      <AdminPageHeader
        art="pulse"
        eyebrow="Herkese açık site"
        icon={Zap}
        title="Hız"
        description="Herkese açık sayfaların hafif (JavaScript'siz) sürümü, önbellek tazeleme, öz testler ve PageSpeed ölçümleri. Statik sunum anahtarı yeniden başlatma gerektirmez; değişiklik en geç 60 sn içinde etkin olur."
        glow="brand"
      />

      {toggles === null ? (
        <p className="flex gap-3 rounded-[var(--radius-panel)] border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Anahtar ayarları okunamadı; tablo kayıt varsayılanlarını gösteriyor. Sayfayı yenileyin.
        </p>
      ) : null}

      <section aria-labelledby="rotalar" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="rotalar" className="font-display text-lg font-extrabold text-ink-950">Sayfalar</h2>
          <PurgeWarmButton labels={labels} />
        </div>
        <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface">
          <table className="adm-tbl-m w-full md:min-w-[52rem] text-left text-sm">
            <thead className="border-b border-line text-xs text-text-faint">
              <tr>
                <th className="p-3 font-bold">Sayfa</th>
                <th className="p-3 font-bold">Statik / Normal</th>
                <th className="p-3 font-bold">Durum</th>
                <th className="p-3 font-bold">Son çizim</th>
                <th className="p-3 font-bold">gzip / ham</th>
                <th className="p-3 font-bold">Son yedeğe düşme</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(({ r, mode, stats }) => (
                <tr key={r.id} className="align-top">
                  <td className="p-3">
                    <a href={r.path} target="_blank" rel="noopener" className="focus-ring inline-flex items-center gap-1 font-semibold text-ink-950 hover:text-brand-700">
                      {r.label} <ArrowUpRight className="h-3.5 w-3.5 text-text-faint" aria-hidden="true" />
                    </a>
                    <span className="block font-mono text-xs text-text-faint">{r.path}</span>
                    {r.disabled ? <span className="mt-1 block text-xs text-text-muted">{r.disabled}</span> : null}
                  </td>
                  <td data-label="Statik / Normal" className="p-3">
                    {mode === "disabled" || mode === "env_off" ? (
                      <span className="text-xs text-text-muted">{mode === "env_off" ? "STATIC_HOME / STATIC_PAGES=off" : "—"}</span>
                    ) : (
                      <StaticRouteSwitch id={r.id} label={r.label} enabled={mode === "on"} canToggle={isSuper} />
                    )}
                  </td>
                  <td data-label="Durum" className="p-3">
                    <StatusChip mode={mode} lastStatic={stats?.lastStatic ?? null} />
                  </td>
                  <td data-label="Son çizim" className="p-3 text-xs text-text-muted">
                    {stats?.lastRenderAt ? (
                      <>
                        {fmt(stats.lastRenderAt)}
                        {stats.lastRenderMs !== null ? <span className="block text-text-faint">{stats.lastRenderMs} ms</span> : null}
                      </>
                    ) : mode === "on" ? (
                      "Bu süreçte henüz çizilmedi (ilk ziyarette)"
                    ) : (
                      "—"
                    )}
                    {stats?.lastError ? <span className="block text-danger-700">Son hata: {stats.lastError}</span> : null}
                  </td>
                  <td data-label="gzip / ham" className="p-3 text-xs text-text-muted">{stats?.gzipBytes != null ? `${kb(stats.gzipBytes)} / ${kb(stats.rawBytes)}` : "—"}</td>
                  <td data-label="Son yedeğe düşme" className="p-3 text-xs text-text-muted">
                    {stats?.lastFallbackAt ? (
                      <>
                        {fmt(stats.lastFallbackAt)}
                        <span className="block text-danger-700">{stats.lastFallbackReason}</span>
                      </>
                    ) : (
                      "Yok"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!isSuper ? <p className="text-xs text-text-faint">Statik/Normal anahtarını yalnız süper admin değiştirebilir; temizleme, ısıtma ve öz testler operasyon yetkisiyle açıktır.</p> : null}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section aria-labelledby="butce" className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4">
          <h2 id="butce" className="flex items-center gap-2 text-sm font-extrabold text-ink-950">
            <Gauge className="h-4 w-4 text-brand-600" aria-hidden="true" /> Hız bütçesi · ana sayfa HTML
          </h2>
          <p className="text-sm text-text-muted">
            Sınır: gzip ≤ {STATIC_HTML_BUDGET.gzipKb} KB, ham ≤ {STATIC_HTML_BUDGET.rawKb} KB (satır içi CSS ve JS dahil; adacıklar ayrı). Aynı eşik derleme kapısında
            (<code className="text-xs">npm run check:bundle -- --gate</code>) uygulanır.
          </p>
          {homeMeasured ? (
            <p className={`text-sm font-bold ${violations.length ? "text-danger-700" : "text-mint-700"}`}>
              Şu an {kb(home!.gzipBytes)} gzip · {kb(home!.rawBytes)} ham — {violations.length ? `bütçe aşıldı (${violations.map((v) => v.message).join("; ")})` : "bütçe içinde"}
            </p>
          ) : (
            <p className="text-sm text-text-muted">Bu süreçte statik ana sayfa henüz çizilmedi; &quot;Tümünü temizle ve ısıt&quot; ile hemen ölçebilirsiniz.</p>
          )}
        </section>

        <section aria-labelledby="once-sonra" className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4">
          <h2 id="once-sonra" className="flex items-center gap-2 text-sm font-extrabold text-ink-950">
            <FlaskConical className="h-4 w-4 text-brand-600" aria-hidden="true" /> Önce / sonra · ana sayfa mobil
          </h2>
          {lab.tableMissing ? (
            <p className="text-sm text-text-muted">Laboratuvar tablosu henüz kurulmadı (migration bekliyor).</p>
          ) : latest && previous ? (
            <Link href="/admin/site/hiz/lab" className="focus-ring group grid grid-cols-2 gap-3 rounded-[var(--radius-card)] border border-line p-3 transition hover:border-brand-400">
              {[previous, latest].map((run, i) => (
                <span key={run.id} className="space-y-1 text-sm">
                  <span className="block text-xs font-bold text-text-faint">
                    {i === 0 ? "Önce" : "Sonra"} · {run.day}
                  </span>
                  <span className="block font-display text-2xl font-extrabold text-ink-950">{run.score ?? "—"}</span>
                  <span className="block text-xs text-text-muted">
                    LCP {formatMetric("lcp_ms", run.lcp_ms)} · CLS {formatMetric("cls", run.cls)} · TBT {formatMetric("tbt_ms", run.tbt_ms)}
                  </span>
                </span>
              ))}
            </Link>
          ) : (
            <p className="text-sm text-text-muted">
              Veri birikiyor: karşılaştırma için en az iki laboratuvar koşusu gerekir.{" "}
              <Link href="/admin/site/hiz/lab" className="font-semibold text-brand-700 hover:underline">
                Laboratuvarı aç
              </Link>
            </p>
          )}
        </section>

        <section aria-labelledby="oz-test" className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4">
          <h2 id="oz-test" className="text-sm font-extrabold text-ink-950">X-Static öz testi</h2>
          <p className="text-sm text-text-muted">Her sayfa sunucunun kendisinden belge isteği olarak çekilir: statik sayfada X-Static: 1 ve 0 Next betiği beklenir.</p>
          <SelfTestPanel />
        </section>

        <section aria-labelledby="sikistirma" className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4">
          <h2 id="sikistirma" className="text-sm font-extrabold text-ink-950">Sıkıştırma</h2>
          <p className="text-sm text-text-muted">
            Herkese açık adrese <code className="text-xs">accept-encoding: br</code> ile istek atılır. Brotli/zstd açmak sunucu (Traefik) ayarıdır; adımlar ve geri dönüş:{" "}
            <code className="text-xs">{COMPRESSION_RUNBOOK}</code>.
          </p>
          <CompressionTestButton />
        </section>
      </div>
    </div>
  );
}
