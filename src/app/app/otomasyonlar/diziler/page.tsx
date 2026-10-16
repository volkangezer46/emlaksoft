import { CalendarClock, ChevronRight, ListOrdered, Pause, Play, Plus, Sparkles } from "lucide-react";
import { ListHero, ListPage } from "@/components/ui/list-page";
import { StatRow } from "@/components/ui/stat-row";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterChip } from "@/components/ui/filter-chip";
import { ButtonLink } from "@/components/ui/button";
import Link from "@/components/ui/smart-link";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { cumulativeDays, SEQUENCE_STEP_LABELS, type SequenceStepType } from "@/lib/automation/sequence-rules";
import { SEQUENCE_TEMPLATES } from "@/lib/automation/sequence-templates";

export const metadata = { title: "Otomatik takip mesajları" };

type SequenceRow = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  stop_on_reply: boolean;
  updated_at: string;
};
type StepRow = { sequence_id: string; sort_order: number; delay_days: number; step_type: string };

const DURUM = [
  { label: "Tümü", value: "" },
  { label: "Açık", value: "acik" },
  { label: "Duraklatılmış", value: "kapali" },
] as const;

/** Adım şeridi: "Gün 0 SMS → Gün 1 Görev → …" (gecikmeler birikir). */
function stepChips(steps: StepRow[]): { day: number; label: string }[] {
  const days = cumulativeDays(steps.map((s) => s.delay_days));
  return steps.map((s, i) => ({ day: days[i] ?? 0, label: SEQUENCE_STEP_LABELS[s.step_type as SequenceStepType] ?? s.step_type }));
}

export default async function TakipDizileriPage({ searchParams }: { searchParams?: Promise<{ durum?: string }> }) {
  const { perms } = await requireModulePage("settings", "/app/otomasyonlar");
  const canEdit = (perms.settings ?? []).includes("edit");
  const durum = ((await searchParams) ?? {}).durum ?? "";
  const supabase = await createClient();

  const [seqRes, stepRes, enrRes, totalRes] = await Promise.all([
    supabase
      .from("message_sequences")
      .select("id, name, description, is_active, stop_on_reply, updated_at")
      .order("updated_at", { ascending: false })
      .limit(100),
    supabase.from("message_sequence_steps").select("sequence_id, sort_order, delay_days, step_type").order("sort_order").limit(1000),
    // Devam eden kayıt sayısı (dizi başına); sınırlı okuma (1000), toplam ayrıca sayılır.
    supabase.from("message_sequence_enrollments").select("sequence_id").eq("status", "active").limit(1000),
    supabase.from("message_sequence_enrollments").select("id", { count: "exact", head: true }).eq("status", "active"),
  ]);

  const notInstalled = seqRes.error?.code === "42P01" || seqRes.error?.code === "PGRST205";
  const rows = (seqRes.data ?? []) as SequenceRow[];
  const stepsBySeq = new Map<string, StepRow[]>();
  for (const s of (stepRes.data ?? []) as StepRow[]) {
    const list = stepsBySeq.get(s.sequence_id) ?? [];
    list.push(s);
    stepsBySeq.set(s.sequence_id, list);
  }
  const activeBySeq = new Map<string, number>();
  for (const e of (enrRes.data ?? []) as { sequence_id: string }[]) {
    activeBySeq.set(e.sequence_id, (activeBySeq.get(e.sequence_id) ?? 0) + 1);
  }
  const openCount = rows.filter((r) => r.is_active).length;
  const visible = rows.filter((r) => (durum === "acik" ? r.is_active : durum === "kapali" ? !r.is_active : true));
  const totalActive = totalRes.count ?? [...activeBySeq.values()].reduce((a, b) => a + b, 0);

  return (
    <ListPage>
      <ListHero
        art="otomasyon"
        eyebrow="Otomatik işler"
        title="Otomatik takip mesajları"
        description="Yeni talebi ve sessiz müşteriyi günlere yayılmış adımlarla takip edin: SMS, onaylı WhatsApp şablonu, e-posta ve arama görevi. Müşteri yanıt verince dizi kendiliğinden durur."
        actions={canEdit ? <ButtonLink href="/app/otomasyonlar/diziler/yeni" icon={Plus}>Yeni dizi</ButtonLink> : undefined}
      />

      {notInstalled ? (
        <EmptyState
          icon={ListOrdered}
          title="Otomatik takip mesajları kurulum bekliyor"
          description="Bu özellik için veritabanı güncellemesi henüz uygulanmadı. Güncelleme yapılınca diziler burada görünür."
          action={{ href: "/app/otomasyonlar", label: "Kurallara dön" }}
        />
      ) : (
        <>
          <StatRow
            className="mb-6"
            items={[
              { label: "Açık dizi", value: openCount, href: "/app/otomasyonlar/diziler?durum=acik" },
              { label: "Duraklatılmış", value: rows.length - openCount, href: "/app/otomasyonlar/diziler?durum=kapali" },
              { label: "Devam eden müşteri", value: totalActive, href: "/app/otomasyonlar/diziler?durum=acik" },
            ]}
          />

          <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-950">
                <ListOrdered className="h-4 w-4 text-brand-600" aria-hidden="true" /> Diziler
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {DURUM.map((f) => (
                  <FilterChip key={f.value} href={f.value ? `/app/otomasyonlar/diziler?durum=${f.value}` : "/app/otomasyonlar/diziler"} active={durum === f.value}>
                    {f.label}
                  </FilterChip>
                ))}
              </div>
            </div>
            {visible.length === 0 ? (
              <div className="px-4 py-10 sm:px-6">
                <EmptyState
                  variant="compact"
                  bare
                  icon={CalendarClock}
                  title={rows.length === 0 ? "Henüz otomatik takip yok" : "Bu süzgeçle eşleşen dizi yok"}
                  description={
                    rows.length === 0
                      ? "Aşağıdaki hazır dizilerden biriyle başlayın; adımları ofisinize göre düzenleyip müşterileri ekleyin."
                      : "Süzgeci temizleyerek tüm dizileri görün."
                  }
                  action={rows.length === 0 ? (canEdit ? { href: "#hazir-diziler", label: "Hazır dizilerden başla" } : undefined) : { href: "/app/otomasyonlar/diziler", label: "Süzgeci temizle" }}
                />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {visible.map((r) => {
                  const chips = stepChips(stepsBySeq.get(r.id) ?? []);
                  const running = activeBySeq.get(r.id) ?? 0;
                  return (
                    <li key={r.id} className="group relative px-4 py-3.5 transition hover:bg-brand-600/[0.03] sm:px-5">
                      <Link href={`/app/otomasyonlar/diziler/${r.id}`} className="absolute inset-0" aria-label={`${r.name} dizisini aç`} />
                      <div className="flex items-start gap-3">
                        <span
                          className={`grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] ${r.is_active ? "bg-mint-500/12 text-mint-600" : "bg-surface-sunken text-text-faint"}`}
                          aria-hidden="true"
                        >
                          {r.is_active ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="truncate font-semibold text-ink-950 group-hover:text-brand-600">{r.name}</span>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${r.is_active ? "bg-mint-50 text-mint-700" : "bg-surface-sunken text-text-muted"}`}>
                              {r.is_active ? "Açık" : "Duraklatıldı"}
                            </span>
                          </p>
                          {chips.length > 0 ? (
                            <ol className="mt-1.5 flex flex-wrap items-center gap-1 text-xs" aria-label="Adımlar">
                              {chips.map((c, i) => (
                                <li key={i} className="inline-flex items-center gap-1">
                                  {i > 0 ? <span aria-hidden="true" className="text-text-faint">→</span> : null}
                                  <span className="rounded-full bg-brand-600/8 px-2 py-0.5 font-semibold text-brand-700">
                                    Gün {c.day} · {c.label}
                                  </span>
                                </li>
                              ))}
                            </ol>
                          ) : (
                            <p className="mt-1 text-xs text-text-faint">Adım eklenmemiş.</p>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-bold tabular-nums text-ink-950">{running}</p>
                          <p className="text-xs text-text-faint">devam eden</p>
                        </div>
                        <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-text-faint" aria-hidden="true" />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {canEdit ? (
            <section id="hazir-diziler" className="scroll-mt-6 rounded-[var(--radius-panel)] border border-dashed border-brand-300/40 bg-brand-600/[0.02] p-4 sm:p-5">
              <h2 className="mb-3 flex items-center gap-2 font-display font-bold text-ink-950">
                <Sparkles className="h-4 w-4 text-brand-600" aria-hidden="true" /> Hazır diziler
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {SEQUENCE_TEMPLATES.map((t) => (
                  <li key={t.key}>
                    <Link
                      href={`/app/otomasyonlar/diziler/yeni?sablon=${t.key}`}
                      className="focus-ring press flex h-full min-h-11 flex-col rounded-[var(--radius-card)] border border-line bg-surface p-3 transition hover:border-brand-300"
                    >
                      <span className="text-sm font-semibold text-ink-950">{t.name}</span>
                      <span className="mt-1 text-xs leading-relaxed text-text-muted">{t.description}</span>
                      <span className="mt-2 text-xs font-semibold text-brand-600">{t.steps.length} adım · düzenleyip kullanın →</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </ListPage>
  );
}
