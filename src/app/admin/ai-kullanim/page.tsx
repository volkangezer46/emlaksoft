import Link from "@/components/ui/smart-link";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Progress } from "@/components/ui/progress";
import { StatRow } from "@/components/ui/stat-row";
import { requirePlatformModule } from "@/lib/platform";
import { getPlatformSetting } from "@/lib/platform-settings";
import { getPlatformUsage } from "@/lib/ai/credits/usage";
import { AI_COST_TABLE_SETTING_KEY, DEFAULT_COST_TABLE, parseCostTable } from "@/lib/ai/credits/cost";
import { saveAiCostTable } from "./actions";

export const metadata = { title: "AI kullanımı" };

const fmt = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
const STATE_LABEL = { unlimited: "Sınırsız", ok: "Normal", warn: "%80 üstü", over: "Aşıldı" } as const;
const STATE_TONE = { unlimited: "accent", ok: "success", warn: "warning", over: "danger" } as const;

export default async function AdminAiUsagePage({ searchParams }: { searchParams: Promise<{ hata?: string; kaydedildi?: string }> }) {
  await requirePlatformModule("billing");
  const sp = await searchParams;
  const [usage, rawTable] = await Promise.all([getPlatformUsage(), getPlatformSetting(AI_COST_TABLE_SETTING_KEY)]);
  const table = rawTable ? parseCostTable(rawTable) : DEFAULT_COST_TABLE;
  const total = usage.rows.reduce((s, r) => s + r.aiUsed, 0);
  const warn = usage.rows.filter((r) => r.aiState === "warn" || r.aiState === "over");
  const reports = usage.rows.reduce((s, r) => s + r.valuationReports, 0);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        art="ai"
        icon={Sparkles}
        eyebrow="Faturalama · yapay zeka"
        title="AI kullanımı"
        description={`${usage.monthKey} dönemi (Türkiye saati): ofis bazlı AI kredisi ve değerleme raporu kullanımı.`}
      />

      {!usage.enabled ? (
        <Alert tone="info" title="Kullanım ölçümü henüz etkin değil">
          Kredi defteri migration taslağı (supabase/proposed/20260820000300_ai_credit_metering.sql) uygulanana kadar ölçüm yazılmaz; AI çağrıları aynen çalışır.
        </Alert>
      ) : null}
      {sp.kaydedildi ? <Alert tone="success" title="Maliyet tablosu kaydedildi" /> : null}
      {sp.hata ? (
        <Alert tone="danger" title="Kaydedilemedi">
          {sp.hata === "json" ? "Geçerli bir JSON girin." : "Ayar yazılamadı; tekrar deneyin."}
        </Alert>
      ) : null}

      <StatRow
        label="Platform AI kullanım özeti"
        items={[
          { label: "Toplam kredi", value: fmt(total), href: "#ofisler", hint: "bu ay" },
          { label: "Kullanan ofis", value: usage.rows.length, href: "#ofisler" },
          { label: "Uyarıdaki ofis", value: warn.length, href: "#ofisler", hint: "%80 ve üstü", attention: true },
          { label: "Değerleme raporu", value: reports, href: "#ofisler", hint: "bu ay" },
        ]}
      />

      <Card id="ofisler">
        <CardHeader>
          <div>
            <CardTitle>Ofis bazlı kullanım</CardTitle>
            <CardDescription>Kullanıma göre sıralı. Ofis adı ofis ayrıntısına gider.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {usage.rows.length === 0 ? (
            <p className="text-sm text-text-muted">Bu ay ölçülmüş AI kullanımı yok.</p>
          ) : (
            <ul className="divide-y divide-line">
              {usage.rows.map((r) => (
                <li key={r.tenantId} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_auto] sm:items-center sm:gap-4">
                  <div className="min-w-0">
                    <Link href={`/admin/tenants/${r.tenantId}`} className="focus-ring truncate text-sm font-semibold text-ink-950 hover:underline">
                      {r.name}
                    </Link>
                    <p className="text-xs text-text-muted">
                      Paket: {r.plan ?? "—"} · {r.aiCalls} çağrı · değerleme {r.valuationReports}
                      {r.valuationQuota !== null ? `/${r.valuationQuota}` : ""}
                    </p>
                  </div>
                  <div>
                    <Progress value={r.aiPercent ?? 0} label={`${r.name} kredi kullanımı`} tone={STATE_TONE[r.aiState]} />
                  </div>
                  <p className="numeric text-sm text-text-muted sm:text-right">
                    {fmt(r.aiUsed)}
                    {r.aiQuota !== null ? ` / ${fmt(r.aiQuota)}` : ""} · {STATE_LABEL[r.aiState]}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {usage.truncated ? <p className="mt-3 text-xs text-text-muted">Özet ilk 20.000 kayıtla sınırlıdır.</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Maliyet tablosu</CardTitle>
            <CardDescription>
              Model başına 1.000 jeton için giriş/çıkış kredisi. Boş kaydederseniz varsayılana döner. Kota planlardan ayarlanır (Faturalama / Planlar).
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form action={saveAiCostTable} className="space-y-3">
            <label className="block text-sm font-medium text-ink-950" htmlFor="ai-cost-table">
              Maliyet tablosu (JSON)
            </label>
            <textarea
              id="ai-cost-table"
              name="table"
              rows={12}
              defaultValue={JSON.stringify(table, null, 2)}
              className="focus-ring w-full rounded-[var(--radius-control)] border border-line bg-surface p-3 font-mono text-xs text-ink-950"
            />
            <button type="submit" className="focus-ring press rounded-[var(--radius-control)] bg-ink-950 px-4 py-2 text-sm font-semibold text-white">
              Kaydet
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
