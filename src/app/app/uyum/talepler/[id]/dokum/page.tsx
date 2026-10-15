import Link from "@/components/ui/smart-link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileJson, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { PrintButton } from "@/components/ui/print-button";
import { Alert } from "@/components/ui/alert";
import { buttonClass } from "@/components/ui/button";
import { KVKK_REQUEST_LABELS, isKvkkType } from "@/lib/compliance/kvkk-requests";
import {
  SUBJECT_EXPORT_INTEGRITY_NOTE,
  SUBJECT_FIELD_LABELS,
  SUBJECT_SECTION_LABELS,
  SUBJECT_SECTION_ORDER,
  displayValue,
  type SubjectExport,
} from "@/lib/compliance/subject-export";

export const metadata = { title: "KVKK veri dökümü" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * KVKK veri sahibi dökümü — yazdırılabilir görünüm (tarayıcının "PDF olarak kaydet" akışı; denetim dosyası deseni).
 * Talebe eklenmiş SON anlık görüntü gösterilir; veri yeniden sorgulanmaz (verilen yanıtın kanıtı değişmez).
 * Mobilde bölümler tablo yerine kart listesidir (yatay kaydırma yok).
 */
export default async function SubjectExportPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModulePage("compliance", "/app/uyum");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase
    .from("kvkk_subject_exports")
    .select("id, payload, payload_sha256, generated_at, expires_at")
    .eq("request_id", id)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) notFound();
  const doc = data.payload as SubjectExport;
  const typeLabel = isKvkkType(doc.request.type) ? KVKK_REQUEST_LABELS[doc.request.type] : doc.request.type;
  const subjectEntries = Object.entries(doc.subject ?? {});
  const total = SUBJECT_SECTION_ORDER.reduce((sum, key) => sum + (doc.counts?.[key] ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Link href="/app/uyum/talepler" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
          <ArrowLeft className="h-4 w-4" /> KVKK talepleri
        </Link>
        <div className="flex flex-wrap gap-2">
          <a href={`/app/uyum/talepler/${id}/dokum/json`} download className={buttonClass({ variant: "outline" })}>
            <FileJson className="h-4 w-4" aria-hidden="true" /> JSON olarak indir
          </a>
          <PrintButton tone="brand" />
        </div>
      </div>

      {doc.warnings?.length ? (
        <Alert tone="warning" title="Bazı bölümler eksik olabilir" className="no-print">
          {doc.warnings.join(" ")}
        </Alert>
      ) : null}

      <article className="print-sheet surface-card rounded-[var(--radius-panel)] p-4 sm:p-8">
        <header className="hairline-b flex flex-wrap items-start justify-between gap-4 pb-5">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-600">{doc.controller?.name ?? "Veri sorumlusu"}</p>
            <h1 className="mt-1 font-display text-2xl font-extrabold tracking-[-0.02em] text-ink-950">Kişisel veri dökümü</h1>
            <p className="mt-1 text-sm text-text-muted">
              {typeLabel} başvurusu · {displayValue(doc.generated_at)} tarihinde hazırlandı · {total} kayıt
            </p>
          </div>
          <p className="flex max-w-xs items-start gap-1.5 text-xs text-text-muted">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mint-600" aria-hidden="true" />
            <span>
              SHA-256: <span className="break-all font-mono text-xs text-ink-900">{data.payload_sha256}</span>
            </span>
          </p>
        </header>

        <section className="mt-5">
          <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-ink-900">Kimlik ve iletişim bilgileri</h2>
          <dl className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {subjectEntries.map(([key, value]) => (
              <div key={key} className="flex flex-wrap justify-between gap-2 border-b border-line/60 py-1.5 text-sm">
                <dt className="text-text-muted">{SUBJECT_FIELD_LABELS[key] ?? key}</dt>
                <dd className="min-w-0 break-words text-right font-semibold text-ink-950">{displayValue(value)}</dd>
              </div>
            ))}
          </dl>
        </section>

        {SUBJECT_SECTION_ORDER.map((key) => {
          const rows = doc.sections?.[key] ?? [];
          const columns = rows.length ? Array.from(new Set(rows.flatMap((r) => Object.keys(r)))) : [];
          return (
            <section key={key} className="mt-6 break-inside-avoid-page">
              <h2 className="flex items-baseline justify-between gap-2 text-sm font-bold uppercase tracking-[0.08em] text-ink-900">
                {SUBJECT_SECTION_LABELS[key]}
                <span className="numeric text-xs font-semibold normal-case tracking-normal text-text-muted">{rows.length} kayıt</span>
              </h2>
              {rows.length === 0 ? (
                <p className="mt-1.5 text-sm text-text-muted">Bu başlıkta kayıt yok.</p>
              ) : (
                <ol className="mt-2 space-y-2">
                  {rows.map((row, i) => (
                    <li key={i} className="rounded-[var(--radius-control)] border border-line/70 px-3 py-2 text-sm">
                      <dl className="grid gap-x-4 gap-y-0.5 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]">
                        {columns
                          .filter((c) => row[c] !== null && row[c] !== undefined && row[c] !== "")
                          .map((c) => (
                            <div key={c} className={c === "body" || c === "notes" ? "sm:col-span-full" : undefined}>
                              <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-text-faint">{SUBJECT_FIELD_LABELS[c] ?? c}</dt>
                              <dd className="whitespace-pre-wrap break-words text-ink-950">{displayValue(row[c])}</dd>
                            </div>
                          ))}
                      </dl>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          );
        })}

        <footer className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-text-muted">
          Bu döküm 6698 sayılı KVKK md. 11 kapsamındaki başvuru üzerine, veri sorumlusunun kayıtlarında başvuru sahibine ait
          kişisel verileri içerir. Belgelerin yalnız listesi verilmiştir; kopyaları ayrıca talep edilebilir. {SUBJECT_EXPORT_INTEGRITY_NOTE}
          <span className="no-print"> Döküm {displayValue(data.expires_at)} tarihine kadar saklanır.</span>
        </footer>
      </article>
    </div>
  );
}
