import { Sparkles } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Textarea } from "@/components/ui/input";
import { StatRow } from "@/components/ui/stat-row";
import { requirePlatformModule } from "@/lib/platform";
import { platformCan } from "@/lib/platform-access";
import { createClient } from "@/lib/supabase/server";
import { asFormAction } from "@/lib/action-outcome";
import { ZEKA_INTENT_LABELS, type ZekaIntent } from "@/lib/ai/zeka/types";
import { ZEKA_SURFACE_LABELS } from "@/lib/settings/registry/zeka";
import { isAiConfigured } from "@/lib/ai-advisor";
import { HeroArama } from "@/app/app/_home/kurumsal/hero-arama";
import { addZekaQa, archiveZekaQa } from "./actions";
import "@/app/app/_home/kurumsal/home.css";

export const metadata = { title: "Zeka eğitimi" };

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
type LogRow = { id: string; created_at: string; surface: string; query_redacted: string; intent: string; engine: string; confidence: number; answered: boolean; feedback: number | null };
type QaRow = { id: string; surface: string; question: string; answer: string; href: string | null; created_at: string };

const MISSING = new Set(["42P01", "PGRST205", "PGRST202", "42883"]);
const DATE = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
const surfaceLabel = (s: string) => (s === "all" ? "Tüm yüzeyler" : (ZEKA_SURFACE_LABELS as Record<string, string>)[s] ?? s);
const fieldClass = "w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2.5 text-sm";

/**
 * Zeka eğitimi (platform personeli): son 30 günün kullanım sayaçları (niyet / motor / yüzey), cevapsız ya da düşük
 * güvenli ya da 👎 alan sorgular (kişisel verisi maskelenmiş) ve yöneticinin onayladığı soru-cevap çiftleri. Onaylı
 * çiftler iki motorun da bilgi tabanına girer. Zeka ayarları (kip, model, jeton, yüzey aç/kapa) Sistem Ayarları
 * Merkezi'ndedir (AI ve kota).
 */
export default async function AdminZekaPage() {
  const staff = await requirePlatformModule("advisor");
  const canWrite = platformCan(staff, "sistem", "write");
  const supabase = await createClient();
  const [statsRes, logRes, qaRes, aiOn] = await Promise.all([
    supabase.rpc("zeka_usage_stats", { p_days: 30 }),
    supabase
      .from("zeka_query_log")
      .select("id, created_at, surface, query_redacted, intent, engine, confidence, answered, feedback")
      .or("answered.eq.false,confidence.lt.0.45,feedback.eq.-1")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("zeka_qa").select("id, surface, question, answer, href, created_at").eq("status", "active").order("created_at", { ascending: false }).limit(100),
    isAiConfigured().catch(() => false),
  ]);
  const installed = !(statsRes.error && MISSING.has(String(statsRes.error.code ?? ""))) && !(logRes.error && MISSING.has(String(logRes.error.code ?? "")));
  const stats = (statsRes.data ?? null) as Stats | null;
  const logs = (logRes.data ?? []) as LogRow[];
  const qa = (qaRes.data ?? []) as QaRow[];
  const add = asFormAction(addZekaQa);
  const archive = asFormAction(archiveZekaQa);
  const counts = (o: Record<string, number> | undefined, label: (k: string) => string) =>
    Object.entries(o ?? {})
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${label(k)}: ${n}`)
      .join(" · ") || "—";

  return (
    <div className="space-y-6">
      <AdminPageHeader
        art="pulse"
        icon={Sparkles}
        eyebrow="Yapay zeka · öğrenme"
        title="Zeka eğitimi"
        description="Zeka'nın yanıtlayamadığı soruları görün, onaylı soru-cevap ekleyin; iki motor (yerel zeka ve GPT) da bunları kullanır."
      />

      <Card>
        <CardHeader>
          <CardTitle>Zeka&apos;yı deneyin</CardTitle>
          <CardDescription>
            Yönetim yüzeyi salt okunurdur: ofis sayıları, MRR, deneme ve destek talepleri ile sayfa önerileri. Motor:{" "}
            {aiOn ? "OpenAI anahtarı tanımlı (kip otomatikse GPT)" : "yerel zeka (OpenAI anahtarı yok)"}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="kh-hero-search">
            <HeroArama chips={["kaç aktif ofis var", "MRR ne kadar", "acil destek talebi"]} storageScope={`admin:${staff.id}`} />
          </div>
        </CardContent>
      </Card>

      {!installed ? (
        <Alert tone="info" title="Öğrenme tabloları henüz kurulmadı">
          Zeka çalışıyor (yerel zeka + kod bilgisi). Sorgu günlüğü, geri bildirim ve onaylı soru-cevap için supabase/migrations/20261024010000_zeka_learning.sql uygulanmalı.
        </Alert>
      ) : null}

      {stats ? (
        <StatRow
          label="Zeka kullanımı (son 30 gün)"
          items={[
            { label: "Toplam sorgu", value: stats.total, href: "#cevapsiz", hint: "son 30 gün" },
            { label: "Yanıtlanan", value: stats.answered, href: "#cevapsiz" },
            { label: "Düşük güven", value: stats.low_confidence, href: "#cevapsiz", attention: stats.low_confidence > 0 },
            { label: "Yararlı / değil", value: `${stats.helpful} / ${stats.unhelpful}`, href: "#cevapsiz" },
          ]}
        />
      ) : null}
      {stats ? (
        <Card>
          <CardContent className="space-y-1 pt-5 text-sm text-text-muted">
            <p>
              <strong className="text-ink-950">Niyete göre:</strong> {counts(stats.by_intent, (k) => ZEKA_INTENT_LABELS[k as ZekaIntent] ?? k)}
            </p>
            <p>
              <strong className="text-ink-950">Motora göre:</strong> {counts(stats.by_engine, (k) => (k === "gpt" ? "GPT" : "Yerel zeka"))}
            </p>
            <p>
              <strong className="text-ink-950">Yüzeye göre:</strong> {counts(stats.by_surface, surfaceLabel)}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card id="cevapsiz">
        <CardHeader>
          <CardTitle>Cevapsız, düşük güvenli ya da beğenilmeyen sorgular</CardTitle>
          <CardDescription>Metinler kişisel verisi maskelenmiş olarak saklanır (telefon, e-posta, TC, IBAN ve bilinen adlar).</CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <EmptyState title="Bekleyen sorgu yok" description="Zeka'nın yanıtlayamadığı sorular burada listelenir." />
          ) : (
            <ul className="divide-y divide-line">
              {logs.map((l) => (
                <li key={l.id} className="py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="min-w-0 break-words font-semibold text-ink-950">{l.query_redacted}</p>
                    <span className="text-xs text-text-faint">{DATE.format(new Date(l.created_at))}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {surfaceLabel(l.surface)} · {ZEKA_INTENT_LABELS[l.intent as ZekaIntent] ?? l.intent} · {l.engine === "gpt" ? "GPT" : "Yerel zeka"} · güven %{Math.round(Number(l.confidence) * 100)}
                    {l.feedback === -1 ? " · beğenilmedi" : ""}
                    {!l.answered ? " · yanıtlanamadı" : ""}
                  </p>
                  {canWrite ? (
                    <details className="mt-2">
                      <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-brand-700">Onaylı yanıt ekle</summary>
                      <form action={add} className="mt-2 grid gap-2">
                        <input type="hidden" name="source_log_id" value={l.id} />
                        <input type="hidden" name="surface" value={l.surface} />
                        <label className="grid gap-1 text-sm">
                          <span className="font-semibold">Soru</span>
                          <Input name="question" defaultValue={l.query_redacted} maxLength={300} required />
                        </label>
                        <label className="grid gap-1 text-sm">
                          <span className="font-semibold">Yanıt</span>
                          <Textarea name="answer" maxLength={2000} rows={3} required />
                        </label>
                        <label className="grid gap-1 text-sm">
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

      <Card id="soru-cevap">
        <CardHeader>
          <CardTitle>Onaylı soru-cevaplar ({qa.length})</CardTitle>
          <CardDescription>Yerel zeka ve GPT motoru bu çiftleri bilgi parçası olarak kullanır; gömme dizini gece bakımında güncellenir.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {canWrite ? (
            <form action={add} className="grid gap-2 rounded-[var(--radius-card)] border border-line p-4">
              <label className="grid gap-1 text-sm">
                <span className="font-semibold">Soru</span>
                <Input name="question" maxLength={300} required />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-semibold">Yanıt</span>
                <Textarea name="answer" maxLength={2000} rows={3} required />
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="grid gap-1 text-sm">
                  <span className="font-semibold">Yüzey</span>
                  <select name="surface" defaultValue="all" className={fieldClass}>
                    <option value="all">Tüm yüzeyler</option>
                    {Object.entries(ZEKA_SURFACE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-semibold">Bağlantı (isteğe bağlı)</span>
                  <Input name="href" placeholder="/fiyatlar" maxLength={300} />
                </label>
              </div>
              <div>
                <Button type="submit" size="sm">
                  Soru-cevap ekle
                </Button>
              </div>
            </form>
          ) : null}
          {qa.length === 0 ? (
            <EmptyState title="Henüz onaylı soru-cevap yok" description="Cevapsız sorgulardan ya da yukarıdaki formdan ekleyin." />
          ) : (
            <ul className="divide-y divide-line">
              {qa.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-semibold text-ink-950">{r.question}</p>
                    <p className="mt-1 break-words text-sm text-text-muted">{r.answer}</p>
                    <p className="mt-1 text-xs text-text-faint">
                      {surfaceLabel(r.surface)}
                      {r.href ? ` · ${r.href}` : ""}
                    </p>
                  </div>
                  {canWrite ? (
                    <form action={archive}>
                      <input type="hidden" name="id" value={r.id} />
                      <Button type="submit" size="sm" variant="ghost">
                        Arşivle
                      </Button>
                    </form>
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
