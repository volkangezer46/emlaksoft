import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { asFormAction } from "@/lib/action-outcome";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings/read";
import { ZEKA_KNOWLEDGE_SOURCES, ZEKA_SETTING_KEYS, ZEKA_SURFACE_LABELS, type ZekaKnowledgeSourceId } from "@/lib/settings/registry/zeka";
import { ZEKA_CENTER_GROUPS, ZEKA_SURFACE_SHORT } from "@/lib/ai/zeka/center";
import { knowledgeIndexStatus } from "@/lib/ai/zeka/knowledge/store";
import { zekaKeyStatus } from "@/lib/ai/zeka/settings";
import { ZEKA_SURFACES } from "@/lib/ai/zeka/types";
import { addZekaQa, archiveZekaQa, rebuildZekaIndex, saveZekaSettings } from "../actions";
import { ZekaActionForm, ZekaRebuildButton } from "../_ui";
import { DATE, SettingsHistoryCard, fieldClass, fmtInt, labelClass, surfaceLabel } from "./shared";

type QaRow = { id: string; surface: string; question: string; answer: string; href: string | null; created_at: string };

const SOURCE_LABELS: Record<string, string> = {
  nav: "Menü ve sayfalar",
  action: "Oluşturma eylemleri",
  intent: "Niyet sözcükleri",
  faq: "SSS",
  guide: "Rehber",
  glossary: "Sözlük",
  term: "Terimler",
  plan: "Paketler",
  site: "Site sayfaları",
  setting: "Ayar açıklamaları",
  qa: "Onaylı soru-cevap",
};

/** Bilgi: kaynak aç/kapa, dizin durumu (parça sayıları, son kurulum), yeniden oluştur, onaylı soru-cevaplar. */
export async function KnowledgeView({ canWrite }: { canWrite: boolean }) {
  const supabase = await createClient();
  const [values, status, key, qaRes, lastRunRes, beatRes] = await Promise.all([
    getSettings(ZEKA_CENTER_GROUPS.bilgi).catch(() => ({}) as Record<string, unknown>),
    knowledgeIndexStatus().catch(() => null),
    zekaKeyStatus(),
    supabase.from("zeka_qa").select("id, surface, question, answer, href, created_at").eq("status", "active").order("created_at", { ascending: false }).limit(100),
    supabase.from("platform_audit_logs").select("action, created_at, meta").in("action", ["zeka.index", "zeka.index_run"]).order("created_at", { ascending: false }).limit(1),
    supabase.from("cron_heartbeats").select("last_run_at, last_status, last_detail").eq("job", "olcum-bakim").maybeSingle(),
  ]);
  const qa = (qaRes.data ?? []) as QaRow[];
  const lastRun = (lastRunRes.data ?? [])[0] as { action: string; created_at: string } | undefined;
  const beat = beatRes.data as { last_run_at: string | null; last_status: string | null; last_detail: string | null } | null;
  const zekaBeat = beat?.last_detail?.split("Zeka dizini:")[1]?.trim() ?? null;
  const add = asFormAction(addZekaQa);
  const archive = asFormAction(archiveZekaQa);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Bilgi tabanı ve dizin durumu</CardTitle>
          <CardDescription>
            Parçalar doğrudan koddaki tek kaynaklardan ve yardım merkezinden üretilir. Anahtar varken gömme dizini gece bakımında kurulur; arama sözcüksel + anlamsal birleşir.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {ZEKA_SURFACES.map((s) => (
                <div key={s} className="rounded-[var(--radius-card)] border border-line p-3">
                  <p className="m-0 text-xs font-semibold text-text-muted">{ZEKA_SURFACE_SHORT[s]}</p>
                  <p className="m-0 text-2xl font-extrabold tabular-nums text-ink-950">{fmtInt(status.surfaces[s].chunks)}</p>
                  <p className="m-0 text-xs text-text-muted">
                    {Object.entries(status.surfaces[s].bySource)
                      .sort((a, b) => b[1] - a[1])
                      .map(([k, n]) => `${SOURCE_LABELS[k] ?? k} ${n}`)
                      .join(" · ") || "parça yok"}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="m-0 text-sm text-text-muted">Bilgi tabanı durumu okunamadı.</p>
          )}
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-text-muted">Anlamsal dizin</dt>
              <dd className="m-0 font-semibold text-ink-950">
                {status && status.vectors > 0 ? `${fmtInt(status.vectors)} vektör` : key.configured ? "Henüz kurulmadı" : "Kapalı (anahtar yok: sözcüksel arama)"}
              </dd>
            </div>
            <div>
              <dt className="text-text-muted">Son dizin kurulumu</dt>
              <dd className="m-0 font-semibold text-ink-950">{lastRun ? DATE.format(new Date(lastRun.created_at)) : "—"}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Gece bakımı (olcum-bakim)</dt>
              <dd className="m-0 font-semibold text-ink-950">
                {beat?.last_run_at ? `${DATE.format(new Date(beat.last_run_at))}${zekaBeat ? ` · ${zekaBeat}` : ""}` : "—"}
              </dd>
            </div>
          </dl>
          <ZekaRebuildButton action={rebuildZekaIndex} disabled={!canWrite} />
          <p className="m-0 text-xs text-text-muted">Yeniden oluştur: süreç içi bilgi tabanını boşaltır ve dizin işini hemen çalıştırır (yalnız içeriği değişen parçalar yeniden gömülür; platform AI kotası `zeka.index`).</p>
        </CardContent>
      </Card>

      <ZekaActionForm action={saveZekaSettings} readOnly={!canWrite} submitLabel="Kaynakları kaydet">
        <input type="hidden" name="group" value="bilgi" />
        <Card>
          <CardHeader>
            <CardTitle>Bilgi kaynakları</CardTitle>
            <CardDescription>Kapatılan kaynak hiçbir motorun bağlamına girmez (en geç 5 dk ya da &quot;Yeniden oluştur&quot; ile). Menü, sayfalar ve oluşturma eylemleri gezinmenin çekirdeğidir, kapatılamaz.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {(Object.keys(ZEKA_KNOWLEDGE_SOURCES) as ZekaKnowledgeSourceId[]).map((id) => {
              const k = ZEKA_SETTING_KEYS.source(id);
              return (
                <div key={id} className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line px-3 py-2.5">
                  <span id={`zk-src-${id}`} className="text-sm font-semibold text-ink-950">
                    {ZEKA_KNOWLEDGE_SOURCES[id].label}
                  </span>
                  <Switch name={k} defaultChecked={values[k] !== false} aria-labelledby={`zk-src-${id}`} />
                </div>
              );
            })}
            <div className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line px-3 py-2.5">
              <span id="zk-emb" className="text-sm font-semibold text-ink-950">
                Anlamsal dizin (gömme)
              </span>
              <Switch name={ZEKA_SETTING_KEYS.embeddings} defaultChecked={values[ZEKA_SETTING_KEYS.embeddings] !== false} aria-labelledby="zk-emb" />
            </div>
            <label className={labelClass}>
              <span className="font-semibold">Gömme modeli</span>
              <Input name={ZEKA_SETTING_KEYS.embeddingModel} defaultValue={String(values[ZEKA_SETTING_KEYS.embeddingModel] ?? "")} maxLength={60} />
            </label>
          </CardContent>
        </Card>
      </ZekaActionForm>

      <Card id="soru-cevap">
        <CardHeader>
          <CardTitle>Onaylı soru-cevaplar ({qa.length})</CardTitle>
          <CardDescription>Yerel zeka ve GPT bu çiftleri bilgi parçası olarak kullanır. Cevapsız soruları Kullanım sekmesinden yanıtlayabilirsiniz.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {canWrite ? (
            <form action={add} className="grid gap-2 rounded-[var(--radius-card)] border border-line p-4">
              <label className={labelClass}>
                <span className="font-semibold">Soru</span>
                <Input name="question" maxLength={300} required />
              </label>
              <label className={labelClass}>
                <span className="font-semibold">Yanıt</span>
                <Textarea name="answer" maxLength={2000} rows={3} required />
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className={labelClass}>
                  <span className="font-semibold">Yüzey</span>
                  <select name="surface" defaultValue="all" className={fieldClass}>
                    <option value="all">Tüm yüzeyler</option>
                    {Object.entries(ZEKA_SURFACE_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  <span className="font-semibold">Bağlantı (isteğe bağlı, site içi yol)</span>
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
            <EmptyState variant="compact" bare icon={BookOpen} title="Henüz onaylı soru-cevap yok" description="Cevapsız sorulardan (Kullanım) ya da yukarıdaki formdan ekleyin." />
          ) : (
            <ul className="divide-y divide-line">
              {qa.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="m-0 break-words font-semibold text-ink-950">{r.question}</p>
                    <p className="mt-1 break-words text-sm text-text-muted">{r.answer}</p>
                    <p className="mt-1 text-xs text-text-faint">
                      {surfaceLabel(r.surface)}
                      {r.href ? ` · ${r.href}` : ""} · {DATE.format(new Date(r.created_at))}
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

      <SettingsHistoryCard keys={ZEKA_CENTER_GROUPS.bilgi} />
    </div>
  );
}
