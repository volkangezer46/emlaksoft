import Link from "@/components/ui/smart-link";
import { MessageCircleQuestion, Sparkles } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Textarea } from "@/components/ui/input";
import { StatRow } from "@/components/ui/stat-row";
import { asFormAction } from "@/lib/action-outcome";
import { createClient } from "@/lib/supabase/server";
import { daysAgoIso } from "@/lib/clock";
import { getPlatformUsage } from "@/lib/ai/credits/usage";
import { readAllPaged } from "@/lib/supabase/read-all-paged";
import { readPlatformAiQuota } from "@/lib/ai/platform-quota";
import { ZEKA_INTENT_LABELS, type ZekaIntent } from "@/lib/ai/zeka/types";
import { addZekaQa } from "../actions";
import { MISSING, fmtInt, labelClass, surfaceLabel } from "./shared";

type Stats = {
  total: number;
  answered: number;
  low_confidence: number;
  helpful: number;
  unhelpful: number;
  by_intent: Record<string, number>;
  by_engine: Record<string, number>;
  by_surface: Record<string, number>;
};

const DAY_OPTIONS = [7, 30, 90] as const;
const engineLabel = (k: string) => (k === "gpt" ? "GPT" : "Yerel zeka");

/** Liste (Kayıtlar) bağlantısı: görünen her sayı o kümeyi veren süzgeçle açılır. */
const logsHref = (days: number, extra: Record<string, string> = {}) => `/admin/zeka?${new URLSearchParams({ sekme: "kayitlar", gun: String(days), ...extra }).toString()}`;

/** Kullanım: yüzey/motor/niyet/ofis dağılımı, harcanan kredi, platform kotası, en çok sorulan cevapsız sorular. */
export async function UsageView({ canWrite, days: rawDays }: { canWrite: boolean; days?: string }) {
  const days = DAY_OPTIONS.find((d) => String(d) === rawDays) ?? 30;
  const since = daysAgoIso(days);
  const supabase = await createClient();
  const [statsRes, officeRes, missRes, credits, qPublic, qAdmin, qIndex] = await Promise.all([
    supabase.rpc("zeka_usage_stats", { p_days: days }),
    readAllPaged<{ tenant_id: string; engine: string }>((from, to) =>
      supabase.from("zeka_query_log").select("tenant_id, engine").eq("surface", "app").gte("created_at", since).not("tenant_id", "is", null).order("created_at", { ascending: false }).range(from, to),
      { maxRows: 20_000 },
    ),
    supabase
      .from("zeka_query_log")
      .select("id, surface, query_redacted, answered, confidence, feedback")
      .gte("created_at", since)
      .or("answered.eq.false,confidence.lt.0.45,feedback.eq.-1")
      .order("created_at", { ascending: false })
      .limit(400),
    getPlatformUsage({ featurePrefix: "zeka_" }),
    readPlatformAiQuota("zeka.public"),
    readPlatformAiQuota("zeka.admin"),
    readPlatformAiQuota("zeka.index"),
  ]);
  const installed = !(statsRes.error && MISSING.has(String(statsRes.error.code ?? "")));
  const stats = (statsRes.data ?? null) as Stats | null;

  // Ofis bazında (ofis paneli yüzeyi): sorgu ve GPT sayısı.
  const byOffice = new Map<string, { n: number; gpt: number }>();
  for (const r of officeRes.rows) {
    const cur = byOffice.get(r.tenant_id) ?? { n: 0, gpt: 0 };
    cur.n += 1;
    if (r.engine === "gpt") cur.gpt += 1;
    byOffice.set(r.tenant_id, cur);
  }
  const topOffices = [...byOffice.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 12);
  const names = new Map<string, string>();
  if (topOffices.length > 0) {
    const { data } = await supabase.from("tenants").select("id, name").in("id", topOffices.map(([id]) => id));
    for (const t of (data ?? []) as { id: string; name: string | null }[]) names.set(t.id, t.name || "Ofis");
  }

  // En çok sorulan cevapsız / düşük güvenli / beğenilmeyen sorular (aynı maskelenmiş metin birleşir).
  const misses = new Map<string, { q: string; surface: string; n: number; id: string }>();
  for (const r of (missRes.data ?? []) as { id: string; surface: string; query_redacted: string }[]) {
    const k = `${r.surface}|${r.query_redacted.toLocaleLowerCase("tr-TR").trim()}`;
    const cur = misses.get(k);
    if (cur) cur.n += 1;
    else misses.set(k, { q: r.query_redacted, surface: r.surface, n: 1, id: r.id });
  }
  const topMisses = [...misses.values()].sort((a, b) => b.n - a.n).slice(0, 25);
  const creditTotal = credits.rows.reduce((s, r) => s + r.aiUsed, 0);
  const creditCalls = credits.rows.reduce((s, r) => s + r.aiCalls, 0);
  const add = asFormAction(addZekaQa);

  const breakdown = (o: Record<string, number> | undefined, label: (k: string) => string, param: string) =>
    Object.entries(o ?? {})
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => (
        <Link key={k} href={logsHref(days, { [param]: k })} className="inline-flex min-h-9 touch:min-h-11 items-center gap-1 rounded-full border border-line px-3 text-sm hover:border-brand-300">
          <span className="text-text-muted">{label(k)}</span> <strong className="tabular-nums text-ink-950">{fmtInt(n)}</strong>
        </Link>
      ));

  return (
    <div className="space-y-6">
      <nav aria-label="Dönem" className="flex flex-wrap gap-2">
        {DAY_OPTIONS.map((d) => (
          <Link
            key={d}
            href={`/admin/zeka?sekme=kullanim&gun=${d}`}
            aria-current={d === days ? "page" : undefined}
            className={`inline-flex min-h-9 touch:min-h-11 items-center rounded-full border px-3 text-sm font-semibold ${d === days ? "border-brand-500 bg-brand-600/10 text-brand-700" : "border-line text-text-muted hover:border-brand-300"}`}
          >
            Son {d} gün
          </Link>
        ))}
      </nav>

      {!installed ? (
        <Alert tone="info" title="Öğrenme tabloları henüz kurulmadı">
          Zeka çalışıyor; sorgu günlüğü ve sayaçlar için supabase/migrations/20261024010000_zeka_learning.sql uygulanmalı.
        </Alert>
      ) : null}

      {stats ? (
        <StatRow
          label={`Zeka kullanımı (son ${days} gün)`}
          items={[
            { label: "Toplam sorgu", value: fmtInt(stats.total), href: logsHref(days) },
            { label: "Yanıtlanan", value: fmtInt(stats.answered), href: logsHref(days, { durum: "yanitlandi" }) },
            { label: "Düşük güven", value: fmtInt(stats.low_confidence), href: logsHref(days, { durum: "dusuk" }), attention: stats.low_confidence > 0 },
            { label: "Yararlı / değil", value: `${fmtInt(stats.helpful)} / ${fmtInt(stats.unhelpful)}`, href: logsHref(days, { durum: "begenilmedi" }) },
          ]}
        />
      ) : null}

      {stats ? (
        <Card>
          <CardHeader>
            <CardTitle>Dağılım</CardTitle>
            <CardDescription>Her değer o kümenin sorgu kaydını açar.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-24 text-sm font-semibold text-ink-950">Yüzey</span>
              {breakdown(stats.by_surface, surfaceLabel, "yuzey")}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-24 text-sm font-semibold text-ink-950">Motor</span>
              {breakdown(stats.by_engine, engineLabel, "motor")}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-24 text-sm font-semibold text-ink-950">Niyet</span>
              {breakdown(stats.by_intent, (k) => ZEKA_INTENT_LABELS[k as ZekaIntent] ?? k, "niyet")}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Ofis bazında (ofis paneli)</CardTitle>
            <CardDescription>Son {days} günde en çok soru soran ofisler; GPT sayısı ofis kredisinden düşen yanıtlardır.</CardDescription>
          </CardHeader>
          <CardContent>
            {topOffices.length === 0 ? (
              <EmptyState variant="compact" bare icon={MessageCircleQuestion} title="Ofis sorgusu yok" description="Ofisler Zeka'yı kullandıkça burada görünür." />
            ) : (
              <ul className="divide-y divide-line">
                {topOffices.map(([id, c]) => (
                  <li key={id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <Link href={`/admin/tenants/${id}`} className="min-w-0 truncate font-semibold text-ink-950 hover:underline">
                      {names.get(id) ?? "Ofis"}
                    </Link>
                    <Link href={logsHref(days, { ofis: id })} className="tabular-nums text-text-muted hover:underline">
                      {fmtInt(c.n)} soru · {fmtInt(c.gpt)} GPT
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Harcanan kredi ve kota (bu ay)</CardTitle>
            <CardDescription>Ofis paneli ve vitrin GPT yanıtları ofisin AI kredisinden düşer; platform yüzeyleri (site, yönetim, dizin) platform kotasından.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {credits.enabled ? (
              <p className="m-0">
                <Link href="/admin/ai-kullanim" className="font-semibold text-ink-950 hover:underline">
                  Ofis kredisi: {creditTotal.toLocaleString("tr-TR", { maximumFractionDigits: 2 })} kredi · {fmtInt(creditCalls)} çağrı · {fmtInt(credits.rows.length)} ofis
                </Link>
              </p>
            ) : (
              <p className="m-0 text-text-muted">Kredi defteri etkin değil; ölçüm yazılmıyor.</p>
            )}
            {credits.rows.slice(0, 6).map((r) => (
              <p key={r.tenantId} className="m-0 flex justify-between gap-2">
                <Link href={`/admin/tenants/${r.tenantId}`} className="min-w-0 truncate hover:underline">
                  {r.name}
                </Link>
                <span className="tabular-nums text-text-muted">{r.aiUsed.toLocaleString("tr-TR", { maximumFractionDigits: 2 })} kredi</span>
              </p>
            ))}
            <ul className="m-0 grid gap-1 border-t border-line p-0 pt-3">
              {[
                { k: "zeka.public", label: "Site (zeka.public)", q: qPublic },
                { k: "zeka.admin", label: "Yönetim (zeka.admin)", q: qAdmin },
                { k: "zeka.index", label: "Dizin (zeka.index)", q: qIndex },
              ].map((row) => (
                <li key={row.k} className="flex justify-between gap-2">
                  <span className="text-text-muted">{row.label}</span>
                  <span className="tabular-nums text-ink-950">{row.q ? `${fmtInt(row.q.used)} çağrı (${row.q.period})` : "—"}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card id="cevapsiz">
        <CardHeader>
          <CardTitle>En çok sorulan cevapsız sorular</CardTitle>
          <CardDescription>Yanıtlanamayan, düşük güvenli ya da beğenilmeyen sorular (kişisel verisi maskelenmiş). Onaylı yanıt ekleyince iki motor da kullanır.</CardDescription>
        </CardHeader>
        <CardContent>
          {topMisses.length === 0 ? (
            <EmptyState variant="compact" bare icon={Sparkles} title="Bekleyen soru yok" description="Zeka'nın yanıtlayamadığı sorular burada toplanır." />
          ) : (
            <ul className="divide-y divide-line">
              {topMisses.map((m) => (
                <li key={`${m.surface}-${m.id}`} className="py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="m-0 min-w-0 break-words font-semibold text-ink-950">{m.q}</p>
                    <Link href={logsHref(days, { yuzey: m.surface, q: m.q.slice(0, 60) })} className="text-xs text-text-muted hover:underline">
                      {surfaceLabel(m.surface)} · {fmtInt(m.n)} kez
                    </Link>
                  </div>
                  {canWrite ? (
                    <details className="mt-2">
                      <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-brand-700">Onaylı yanıt ekle</summary>
                      <form action={add} className="mt-2 grid gap-2">
                        <input type="hidden" name="source_log_id" value={m.id} />
                        <input type="hidden" name="surface" value={m.surface} />
                        <label className={labelClass}>
                          <span className="font-semibold">Soru</span>
                          <Input name="question" defaultValue={m.q} maxLength={300} required />
                        </label>
                        <label className={labelClass}>
                          <span className="font-semibold">Yanıt</span>
                          <Textarea name="answer" maxLength={2000} rows={3} required />
                        </label>
                        <label className={labelClass}>
                          <span className="font-semibold">Bağlantı (isteğe bağlı, site içi yol)</span>
                          <Input name="href" placeholder="/app/yardim" maxLength={300} />
                        </label>
                        <div>
                          <Button type="submit" size="sm">
                            Kaydet
                          </Button>
                        </div>
                      </form>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
