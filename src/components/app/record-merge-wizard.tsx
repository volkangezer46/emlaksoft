"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, GitMerge, ShieldAlert, StickyNote } from "lucide-react";
import { InlinePanel, useInlinePanel } from "@/components/ui/inline-panel";
import { Button, ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { overridesFromSelection, type MergeFieldChoice } from "@/lib/merge-plan";
import { cn } from "@/lib/utils";

/**
 * Kayıt birleştirme sihirbazı (müşteri + portföy ortak; sayfa içi panel, popup yok). Dört adım:
 *  1. Ana kayıt — en dolu kayıt önerilir ve önseçilidir.
 *  2. Alan seçimi — kayıtlar arasında FARKLI olan alanlarda hangi değer kalsın (radyo); farklı alan yoksa atlanır.
 *  3. Özet — DB'den sayılan taşınacak bağlı kayıtlar, doldurulacak boş alanlar, nota eklenecekler.
 *  4. Onay (ConfirmDialog) → birleştirme → başarı ekranı + ana kayda bağlantı.
 * Yazma işi sunucuda tek transaction'dadır; önizleme hiçbir şey yazmaz.
 */

export type MergeRecordVM = {
  id: string;
  title: string;
  /** İkinci satır (telefon · e-posta, kod · adres ...). */
  subtitle: string;
  /** Üçüncü satır (hareket sayısı, fotoğraf ...). */
  meta?: string;
  /** Doluluk puanı: en yüksek olan önerilir. */
  score: number;
};

export type MergePreviewVM = {
  error?: string;
  counts?: Array<{ label: string; count: number }>;
  totalMoves?: number;
  filled?: Array<{ label: string; value: string }>;
  choices?: MergeFieldChoice[];
  noteLines?: string[];
};

export type MergeAdapter = {
  /** "müşteri" | "portföy" — metinlerde kullanılır. */
  noun: string;
  preview: (primaryId: string, duplicateIds: string[], overrides?: Record<string, string>) => Promise<MergePreviewVM>;
  merge: (primaryId: string, duplicateIds: string[], overrides: Record<string, string>) => Promise<{ error?: string }>;
  recordHref: (id: string) => string;
};

/** Grup başlığındaki düğme: sayfa içi birleştirme panelini açar/kapatır. */
export function MergeButton({ panelId }: { panelId: string }) {
  const { open, toggle } = useInlinePanel(panelId);
  return (
    <Button variant="primary" size="sm" icon={GitMerge} aria-expanded={open} aria-controls={panelId} onClick={(e) => toggle(e.currentTarget)}>
      Birleştir
    </Button>
  );
}

export function MergePanel({
  panelId,
  title,
  records,
  adapter,
}: {
  panelId: string;
  title: string;
  records: MergeRecordVM[];
  adapter: MergeAdapter;
}) {
  return (
    <InlinePanel id={panelId} title={title} icon={<GitMerge />} className="mt-3">
      {(close) => <MergeBody records={records} adapter={adapter} close={close} />}
    </InlinePanel>
  );
}

type Step = "select" | "fields" | "summary" | "done";
const STEPS: Array<{ key: Exclude<Step, "done">; label: string }> = [
  { key: "select", label: "Ana kayıt" },
  { key: "fields", label: "Alan seçimi" },
  { key: "summary", label: "Özet ve onay" },
];

function Stepper({ step, skippedFields }: { step: Exclude<Step, "done">; skippedFields: boolean }) {
  const idx = STEPS.findIndex((s) => s.key === step);
  return (
    <ol className="flex items-center gap-1.5 px-4 pt-4 text-xs font-semibold" aria-label="Birleştirme adımları">
      {STEPS.map((s, i) => {
        const done = i < idx;
        const current = i === idx;
        return (
          <li key={s.key} className="flex min-w-0 items-center gap-1.5" aria-current={current ? "step" : undefined}>
            <span
              className={cn(
                "grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs",
                current ? "border-brand-600 bg-brand-600 text-white" : done ? "border-mint-500 bg-mint-500/12 text-mint-600" : "border-line text-text-faint",
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span className={cn("truncate", current ? "text-ink-950" : "hidden text-text-muted sm:inline")}>
              {s.label}
              {s.key === "fields" && skippedFields && done ? " (fark yok)" : ""}
            </span>
            {i < STEPS.length - 1 ? <span aria-hidden className="mx-0.5 h-px w-4 shrink-0 bg-line sm:w-6" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function OptionCard({ checked, name, onChange, children }: { checked: boolean; name: string; onChange: () => void; children: ReactNode }) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-card)] border p-3.5 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-400",
        checked ? "border-brand-500 bg-brand-600/[0.05]" : "border-line bg-canvas hover:border-brand-400",
      )}
    >
      <input type="radio" name={name} className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600" checked={checked} onChange={onChange} />
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

function MergeBody({ records, adapter, close }: { records: MergeRecordVM[]; adapter: MergeAdapter; close: () => void }) {
  const router = useRouter();
  const best = Math.max(...records.map((r) => r.score));
  const suggestedId = records.find((r) => r.score === best)?.id ?? records[0]?.id ?? "";

  const [step, setStep] = useState<Step>("select");
  const [primaryId, setPrimaryId] = useState(suggestedId);
  const [choices, setChoices] = useState<MergeFieldChoice[]>([]);
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<MergePreviewVM | null>(null);
  const [error, setError] = useState("");
  const [loading, startLoading] = useTransition();
  const [merging, startMerge] = useTransition();

  const duplicateIds = records.map((r) => r.id).filter((id) => id !== primaryId);
  const primary = records.find((r) => r.id === primaryId);
  const overrides = overridesFromSelection(primaryId, selection);

  function goNextFromSelect() {
    setError("");
    startLoading(async () => {
      const p = await adapter.preview(primaryId, duplicateIds);
      if (p.error) {
        setError(p.error);
        return;
      }
      const cs = p.choices ?? [];
      setChoices(cs);
      setSelection(Object.fromEntries(cs.map((c) => [c.field, c.defaultSourceId])));
      if (cs.length > 0) {
        setStep("fields");
      } else {
        setPreview(p);
        setStep("summary");
      }
    });
  }

  function goSummary() {
    setError("");
    startLoading(async () => {
      const p = await adapter.preview(primaryId, duplicateIds, overrides);
      if (p.error) {
        setError(p.error);
        return;
      }
      setPreview(p);
      setStep("summary");
    });
  }

  async function runMerge() {
    setError("");
    await new Promise<void>((resolve) => {
      startMerge(async () => {
        const r = await adapter.merge(primaryId, duplicateIds, overrides);
        if (r.error) setError(r.error);
        else {
          setStep("done");
          router.refresh();
        }
        resolve();
      });
    });
  }

  if (step === "done") {
    return (
      <>
        <div className="grid place-items-center px-4 py-8 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-[var(--radius-card)] bg-mint-500/12 text-mint-600">
            <CheckCircle2 className="h-7 w-7" />
          </span>
          <p className="mt-4 font-display text-lg font-bold text-ink-950">{primary?.title ?? "Ana kayıt"} artık tek kayıt</p>
          <p className="mt-1 max-w-sm text-sm text-text-muted">
            {duplicateIds.length} kopya kayıt kapatıldı; bağlı tüm kayıtlar ana kayda taşındı.
          </p>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-line p-4 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={close}>
            Kapat
          </Button>
          <ButtonLink href={adapter.recordHref(primaryId)}>Ana kaydı aç</ButtonLink>
        </div>
      </>
    );
  }

  const changedFields = choices.filter((c) => (selection[c.field] ?? c.defaultSourceId) !== primaryId);

  return (
    <div>
      <Stepper step={step} skippedFields={choices.length === 0} />
      <div className="space-y-4 p-4">
        {error ? (
          <p className="rounded-[var(--radius-card)] border border-danger-500/30 bg-danger-500/5 px-3 py-2 text-sm text-danger-600" role="alert">
            {error}
          </p>
        ) : null}

        {step === "select" ? (
          <>
            <p className="text-sm text-text-muted">
              Seçtiğiniz kayıt <strong>kalır</strong>; diğerlerindeki tüm geçmiş bu kayda taşınır ve kopyalar kapatılır.
            </p>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Ana kayıt seçimi">
              {records.map((r) => (
                <OptionCard key={r.id} name="merge-primary" checked={r.id === primaryId} onChange={() => setPrimaryId(r.id)}>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate font-semibold text-ink-950">{r.title}</span>
                    {r.id === suggestedId && best > 0 ? (
                      <span className="rounded-full bg-mint-500/12 px-2 py-0.5 text-xs font-semibold text-mint-600">Önerilen — en dolu</span>
                    ) : null}
                  </span>
                  <span className="numeric mt-0.5 block break-words text-xs text-text-muted">{r.subtitle}</span>
                  {r.meta ? <span className="numeric mt-0.5 block text-xs text-text-faint">{r.meta}</span> : null}
                </OptionCard>
              ))}
            </div>
          </>
        ) : null}

        {step === "fields" ? (
          <>
            <p className="text-sm text-text-muted">
              Kayıtlarda farklı olan alanlar aşağıda. Hangi değerin kalacağını seçin; seçilmeyen telefon ve e-postalar
              kaybolmaz, ana kaydın notuna eklenir.
            </p>
            {choices.map((c) => (
              <fieldset key={c.field} className="space-y-2">
                <legend className="text-sm font-semibold text-ink-950">{c.label}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {c.options.map((o) => (
                    <OptionCard
                      key={o.sourceId}
                      name={`merge-field-${c.field}`}
                      checked={(selection[c.field] ?? c.defaultSourceId) === o.sourceId}
                      onChange={() => setSelection((s) => ({ ...s, [c.field]: o.sourceId }))}
                    >
                      <span className="block break-words font-medium text-ink-950">{o.display}</span>
                      <span className="mt-0.5 block text-xs text-text-faint">
                        {o.sourceId === primaryId ? "Ana kayıttaki değer" : `Kopya: ${records.find((r) => r.id === o.sourceId)?.title ?? "kayıt"}`}
                      </span>
                    </OptionCard>
                  ))}
                </div>
              </fieldset>
            ))}
          </>
        ) : null}

        {step === "summary" && preview ? (
          <>
            <div className="space-y-3 rounded-[var(--radius-card)] border border-line bg-canvas p-4">
              <p className="text-xs font-semibold text-text-muted">
                Ana kayıt: <span className="text-ink-950">{primary?.title ?? "—"}</span> · {duplicateIds.length} kopya kapatılacak
              </p>
              {preview.counts && preview.counts.length > 0 ? (
                <div>
                  <p className="text-sm font-semibold text-ink-950">Taşınacak bağlı kayıtlar ({preview.totalMoves ?? 0})</p>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {preview.counts.map((c) => (
                      <li key={c.label} className="numeric rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-text-muted">
                        {c.count} {c.label}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-text-muted">Kopya kayıtlarda taşınacak bağlı kayıt yok.</p>
              )}
              {changedFields.length > 0 ? (
                <div>
                  <p className="text-sm font-semibold text-ink-950">Seçtiğiniz değerler</p>
                  <ul className="mt-1.5 space-y-1 text-xs text-text-muted">
                    {changedFields.map((c) => (
                      <li key={c.field} className="break-words">
                        <span className="font-semibold">{c.label}:</span>{" "}
                        {c.options.find((o) => o.sourceId === selection[c.field])?.display ?? "—"}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {preview.filled && preview.filled.length > 0 ? (
                <div>
                  <p className="text-sm font-semibold text-ink-950">Ana kayıttaki boş alanlar doldurulacak</p>
                  <ul className="mt-1.5 space-y-1 text-xs text-text-muted">
                    {preview.filled.map((f) => (
                      <li key={f.label} className="break-words">
                        <span className="font-semibold">{f.label}:</span> {f.value}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {preview.noteLines && preview.noteLines.length > 0 ? (
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-950">
                    <StickyNote className="h-4 w-4 text-brand-600" /> Kaybolmasın diye nota eklenecek
                  </p>
                  <ul className="mt-1.5 space-y-1 text-xs text-text-muted">
                    {preview.noteLines.map((l) => (
                      <li key={l} className="line-clamp-2 break-words">
                        {l}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
            <p className="flex items-start gap-2 rounded-[var(--radius-card)] border border-danger-500/30 bg-danger-500/5 px-3 py-2.5 text-xs leading-relaxed text-danger-600">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <strong>Bu işlem geri alınamaz.</strong> Kopya kayıtlar kapatılır ve bağlı tüm kayıtları ana kayda taşınır.
                Farklı {adapter.noun} kayıtlarını birleştirirseniz veriler karışır; emin değilseniz vazgeçin.
              </span>
            </p>
          </>
        ) : null}
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-line p-4 sm:flex-row sm:justify-end">
        {step === "select" ? (
          <>
            <Button variant="secondary" onClick={close}>
              Vazgeç
            </Button>
            <Button onClick={goNextFromSelect} loading={loading} disabled={!primaryId || duplicateIds.length === 0} iconRight={ArrowRight}>
              Devam
            </Button>
          </>
        ) : step === "fields" ? (
          <>
            <Button variant="secondary" icon={ArrowLeft} onClick={() => setStep("select")} disabled={loading}>
              Geri
            </Button>
            <Button onClick={goSummary} loading={loading} iconRight={ArrowRight}>
              Özete geç
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              icon={ArrowLeft}
              onClick={() => setStep(choices.length > 0 ? "fields" : "select")}
              disabled={merging}
            >
              Geri
            </Button>
            <ConfirmDialog
              trigger={
                <Button variant="danger" icon={GitMerge} loading={merging} disabled={!preview}>
                  Birleştir
                </Button>
              }
              title="Kayıtlar birleştirilsin mi?"
              description={`${duplicateIds.length} kopya kayıt kapatılacak ve ${preview?.totalMoves ?? 0} bağlı kayıt "${
                primary?.title ?? "ana kayıt"
              }" üzerine taşınacak. Bu işlem geri alınamaz.`}
              confirmLabel="Evet, birleştir"
              cancelLabel="Vazgeç"
              tone="danger"
              onConfirm={runMerge}
            />
          </>
        )}
      </div>
    </div>
  );
}
