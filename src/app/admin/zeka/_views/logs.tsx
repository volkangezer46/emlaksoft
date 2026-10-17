import Link from "@/components/ui/smart-link";
import { ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/server";
import { daysAgoIso } from "@/lib/clock";
import { ZEKA_INTENTS, ZEKA_INTENT_LABELS, ZEKA_SURFACES, type ZekaIntent } from "@/lib/ai/zeka/types";
import { ZEKA_SURFACE_SHORT } from "@/lib/ai/zeka/center";
import { DATE, MISSING, fieldClass, fmtInt, labelClass, surfaceLabel } from "./shared";

export type LogFilters = { yuzey?: string; motor?: string; niyet?: string; durum?: string; q?: string; gun?: string; ofis?: string; sayfa?: string };

const STATUS = {
  yanitlandi: "Yanıtlanan",
  cevapsiz: "Yanıtlanamayan",
  dusuk: "Düşük güven",
  begenilmedi: "Beğenilmeyen",
  begenildi: "Beğenilen",
  yasakli: "Yasaklı konu",
} as const;
const DAYS = ["1", "7", "30", "90"] as const;
const PAGE = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = { id: string; created_at: string; surface: string; tenant_id: string | null; query_redacted: string; intent: string; engine: string; confidence: number; answered: boolean; fallback_reason: string | null; feedback: number | null };

/** Süzgeçleri doğrular (bilinmeyen değer yok sayılır); URL ↔ sunucu sorgusu iki yönlü (filtre kontratı). */
export function normalizeLogFilters(f: LogFilters) {
  const pick = <T extends string>(v: string | undefined, list: readonly T[]) => (v && (list as readonly string[]).includes(v) ? (v as T) : undefined);
  return {
    yuzey: pick(f.yuzey, ZEKA_SURFACES),
    motor: pick(f.motor, ["local", "gpt"] as const),
    niyet: pick(f.niyet, ZEKA_INTENTS),
    durum: pick(f.durum, Object.keys(STATUS) as (keyof typeof STATUS)[]),
    q: (f.q ?? "").trim().slice(0, 60) || undefined,
    gun: pick(f.gun, DAYS) ?? "30",
    ofis: f.ofis && UUID_RE.test(f.ofis) ? f.ofis : undefined,
    sayfa: Math.max(1, Math.min(200, Number.parseInt(f.sayfa ?? "1", 10) || 1)),
  };
}

/** Kayıtlar: kişisel verisi maskelenmiş sorgu günlüğü (salt okunur; RLS: advisor modülü). */
export async function LogsView({ filters }: { filters: LogFilters }) {
  const f = normalizeLogFilters(filters);
  const supabase = await createClient();
  let query = supabase
    .from("zeka_query_log")
    .select("id, created_at, surface, tenant_id, query_redacted, intent, engine, confidence, answered, fallback_reason, feedback", { count: "exact" })
    .gte("created_at", daysAgoIso(Number(f.gun)));
  if (f.yuzey) query = query.eq("surface", f.yuzey);
  if (f.motor) query = query.eq("engine", f.motor);
  if (f.niyet) query = query.eq("intent", f.niyet);
  if (f.ofis) query = query.eq("tenant_id", f.ofis);
  if (f.q) query = query.ilike("query_redacted", `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  if (f.durum === "yanitlandi") query = query.eq("answered", true);
  else if (f.durum === "cevapsiz") query = query.eq("answered", false);
  else if (f.durum === "dusuk") query = query.lt("confidence", 0.45);
  else if (f.durum === "begenilmedi") query = query.eq("feedback", -1);
  else if (f.durum === "begenildi") query = query.eq("feedback", 1);
  else if (f.durum === "yasakli") query = query.eq("fallback_reason", "yasakli_konu");
  const from = (f.sayfa - 1) * PAGE;
  const { data, count, error } = await query.order("created_at", { ascending: false }).range(from, from + PAGE - 1);
  const installed = !(error && MISSING.has(String(error.code ?? "")));
  const rows = (data ?? []) as Row[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const hrefFor = (sayfa: number, ofis: string | undefined = f.ofis) => {
    const p = new URLSearchParams({ sekme: "kayitlar", gun: f.gun });
    for (const [k, v] of Object.entries({ yuzey: f.yuzey, motor: f.motor, niyet: f.niyet, durum: f.durum, q: f.q, ofis })) if (v) p.set(k, v);
    if (sayfa > 1) p.set("sayfa", String(sayfa));
    return `/admin/zeka?${p.toString()}`;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Süzgeçler</CardTitle>
          <CardDescription>Metinler maskelenmiş saklanır (telefon, e-posta, TC, IBAN, kart ve bilinen adlar); 300 karakterle sınırlıdır.</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="get" action="/admin/zeka" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <input type="hidden" name="sekme" value="kayitlar" />
            {f.ofis ? <input type="hidden" name="ofis" value={f.ofis} /> : null}
            <label className={`${labelClass} lg:col-span-2`}>
              <span className="font-semibold">Metin</span>
              <Input name="q" defaultValue={f.q ?? ""} maxLength={60} placeholder="Soruda geçen" />
            </label>
            <label className={labelClass}>
              <span className="font-semibold">Yüzey</span>
              <select name="yuzey" defaultValue={f.yuzey ?? ""} className={fieldClass}>
                <option value="">Tümü</option>
                {ZEKA_SURFACES.map((s) => (
                  <option key={s} value={s}>
                    {ZEKA_SURFACE_SHORT[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              <span className="font-semibold">Motor</span>
              <select name="motor" defaultValue={f.motor ?? ""} className={fieldClass}>
                <option value="">Tümü</option>
                <option value="local">Yerel zeka</option>
                <option value="gpt">GPT</option>
              </select>
            </label>
            <label className={labelClass}>
              <span className="font-semibold">Niyet</span>
              <select name="niyet" defaultValue={f.niyet ?? ""} className={fieldClass}>
                <option value="">Tümü</option>
                {ZEKA_INTENTS.map((i) => (
                  <option key={i} value={i}>
                    {ZEKA_INTENT_LABELS[i]}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              <span className="font-semibold">Durum</span>
              <select name="durum" defaultValue={f.durum ?? ""} className={fieldClass}>
                <option value="">Tümü</option>
                {Object.entries(STATUS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              <span className="font-semibold">Dönem</span>
              <select name="gun" defaultValue={f.gun} className={fieldClass}>
                {DAYS.map((d) => (
                  <option key={d} value={d}>
                    Son {d} gün
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end gap-2 lg:col-span-5">
              <Button type="submit" size="sm">
                Uygula
              </Button>
              <Link href="/admin/zeka?sekme=kayitlar" className="inline-flex min-h-9 touch:min-h-11 items-center text-sm font-semibold text-text-muted hover:underline">
                Temizle
              </Link>
              {f.ofis ? <span className="text-xs text-text-muted">Tek ofis süzgeci açık</span> : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sorgular ({fmtInt(total)})</CardTitle>
          <CardDescription>En yeni önce. Sayfa {f.sayfa} / {pages}.</CardDescription>
        </CardHeader>
        <CardContent>
          {!installed ? (
            <EmptyState variant="compact" bare icon={ScrollText} title="Sorgu günlüğü kurulmadı" description="supabase/migrations/20261024010000_zeka_learning.sql uygulanınca kayıtlar burada görünür." />
          ) : rows.length === 0 ? (
            <EmptyState variant="compact" bare icon={ScrollText} title="Bu süzgeçte kayıt yok" description="Dönemi genişletin ya da süzgeçleri temizleyin." />
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((r) => (
                <li key={r.id} className="py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="m-0 min-w-0 break-words font-semibold text-ink-950">{r.query_redacted}</p>
                    <span className="text-xs text-text-faint">{DATE.format(new Date(r.created_at))}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {surfaceLabel(r.surface)} · {ZEKA_INTENT_LABELS[r.intent as ZekaIntent] ?? r.intent} · {r.engine === "gpt" ? "GPT" : "Yerel zeka"} · güven %{Math.round(Number(r.confidence) * 100)}
                    {r.answered ? "" : " · yanıtlanamadı"}
                    {r.feedback === 1 ? " · beğenildi" : r.feedback === -1 ? " · beğenilmedi" : ""}
                    {r.fallback_reason === "yasakli_konu" ? " · yasaklı konu" : r.fallback_reason ? ` · GPT yerine yerel (${r.fallback_reason})` : ""}
                    {r.tenant_id ? (
                      <>
                        {" · "}
                        <Link href={hrefFor(1, r.tenant_id)} className="hover:underline">
                          bu ofis
                        </Link>
                      </>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {pages > 1 ? (
            <nav aria-label="Sayfalar" className="mt-4 flex items-center justify-between gap-2 text-sm">
              {f.sayfa > 1 ? (
                <Link href={hrefFor(f.sayfa - 1)} className="font-semibold text-brand-700 hover:underline">
                  ← Önceki
                </Link>
              ) : (
                <span />
              )}
              {f.sayfa < pages ? (
                <Link href={hrefFor(f.sayfa + 1)} className="font-semibold text-brand-700 hover:underline">
                  Sonraki →
                </Link>
              ) : null}
            </nav>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
