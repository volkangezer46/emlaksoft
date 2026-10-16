"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, CheckCircle2, ExternalLink, FileCode2, FileText, Loader2, ScanLine, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormInput, FormSelect } from "@/components/ui/form-controls";
import Link from "@/components/ui/smart-link";
import { BRIDGE_HEADER } from "@/lib/listing-control/worker/bridge-request";
import { applyFromDraft, draftFromExtraction, formatAmountTr, REVIEW_VAT_RATES, shouldAutoRunAi, type ReviewApply, type ReviewDraft } from "@/lib/finance/receipt/review";
import {
  CONFIDENCE_LABEL,
  confidenceBand,
  DOC_TYPE_LABEL,
  PAYMENT_LABEL,
  SOURCE_LABEL,
  type Field,
  type LayerReport,
  type ReceiptExtraction,
  type ReceiptSource,
} from "@/lib/finance/receipt/types";
import { cn } from "@/lib/utils";

/**
 * Fiş / fatura İNCELEME ekranı (tembel yüklenir). Masaüstünde yan yana (önizleme | okunan alanlar), mobilde alt alta.
 * Her alan: düzenlenebilir değer + güven rozeti + kaynak (Karekod / e-Fatura XML / PDF metni / Görsel okuma / Yapay zekâ)
 * + "kullan" onayı. Uyarılar (VKN sağlaması, toplam tutarsızlığı, olası mükerrer) üstte. "Kayda aktar" YALNIZ formu doldurur;
 * kayıt kullanıcı formu kaydedince açılır. Yapay zekâ açıksa ve yerel sonuç zayıfsa arkadan kendiliğinden istenir.
 */

export type { ReviewApply };

const READ_URL = "/api/app/finans/belge/oku";

const BAND_VARIANT: Record<ReturnType<typeof confidenceBand>, BadgeVariant> = { yuksek: "success", orta: "info", dusuk: "warning" };

function ConfidenceBadge({ field }: { field: Pick<Field<unknown>, "confidence" | "source"> | null | undefined }) {
  if (!field) return <Badge variant="outline" size="sm">Okunamadı</Badge>;
  const band = confidenceBand(field.confidence);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge variant={BAND_VARIANT[band]} size="sm" dot>
        <span title={`Güven %${Math.round(field.confidence * 100)}`}>{CONFIDENCE_LABEL[band]}</span>
      </Badge>
      <Badge variant="outline" size="sm">
        {SOURCE_LABEL[field.source]}
      </Badge>
    </span>
  );
}

const LAYER_ORDER: ReceiptSource[] = ["karekod", "xml", "pdf-text", "ocr", "ai"];

function LayerChips({ layers, aiBusy }: { layers: LayerReport[]; aiBusy: boolean }) {
  const shown = LAYER_ORDER.map((s) => layers.find((l) => l.source === s)).filter((l): l is LayerReport => !!l);
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Okuma katmanları">
      {shown.map((l) => {
        const busy = l.source === "ai" && aiBusy;
        const tone = busy ? "text-accent-text" : l.status === "done" ? "text-success-strong" : l.status === "failed" ? "text-danger-strong" : "text-text-faint";
        const text = busy ? "çalışıyor" : l.status === "done" ? "okundu" : l.status === "empty" ? "bulunamadı" : l.status === "failed" ? "okunamadı" : l.reason === "off" ? "kapalı" : "atlandı";
        return (
          <li key={l.source} className="inline-flex items-center gap-1 rounded-full border border-line bg-canvas px-2 py-0.5 text-xs">
            {busy ? <Loader2 className="h-3 w-3 animate-spin text-accent-text" aria-hidden="true" /> : null}
            <span className="font-semibold text-text">{SOURCE_LABEL[l.source]}</span>
            <span className={tone}>{text}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Dosya başına tek blob adresi (StrictMode'da çift etki adresi geçersiz kılmasın diye dosyaya bağlı önbellek). */
const blobUrls = new WeakMap<File, string>();
function blobUrlOf(file: File | null): string | null {
  if (!file) return null;
  let url = blobUrls.get(file);
  if (!url) {
    url = URL.createObjectURL(file);
    blobUrls.set(file, url);
  }
  return url;
}

function Preview({ file, fileName }: { file: File | null; fileName: string }) {
  const url = useMemo(() => blobUrlOf(file), [file]);
  const isImage = !!file && file.type.startsWith("image/");
  const isXml = /\.xml$/i.test(fileName) || file?.type === "text/xml" || file?.type === "application/xml";
  return (
    <figure className="grid gap-2">
      <div className="flex max-h-[min(70vh,640px)] min-h-48 items-center justify-center overflow-auto rounded-[var(--radius-control)] border border-line bg-canvas">
        {isImage && url ? (
          // eslint-disable-next-line @next/next/no-img-element -- yerel blob önizlemesi (sunucuya gitmez)
          <img src={url} alt="Yüklenen belge önizlemesi" className="h-auto max-w-full object-contain" />
        ) : (
          <div className="grid place-items-center gap-2 p-6 text-center text-text-muted">
            {isXml ? <FileCode2 className="h-10 w-10" aria-hidden="true" /> : <FileText className="h-10 w-10" aria-hidden="true" />}
            <p className="text-xs">{isXml ? "e-Fatura XML: alanlar doğrudan belgeden okundu." : "PDF belge"}</p>
          </div>
        )}
      </div>
      <figcaption className="flex items-center justify-between gap-2 text-xs text-text-muted">
        <span className="min-w-0 truncate">{fileName}</span>
        {url && !isXml ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 font-semibold text-accent-text hover:underline">
            Yeni sekmede aç <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        ) : null}
      </figcaption>
    </figure>
  );
}

function Row({ label, field, children, use, onUse, id }: { label: string; field: Pick<Field<unknown>, "confidence" | "source"> | null | undefined; children: React.ReactNode; use?: boolean; onUse?: (v: boolean) => void; id: string }) {
  return (
    <div className="grid gap-1.5 border-b border-line py-2.5 last:border-b-0 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-start sm:gap-3">
      <div className="flex items-center justify-between gap-2 sm:block">
        {id.endsWith("-cat") ? (
          <span className="text-xs font-semibold text-text">{label}</span>
        ) : (
          <label htmlFor={id} className="text-xs font-semibold text-text">
            {label}
          </label>
        )}
        {onUse ? (
          <label className="inline-flex items-center gap-1.5 text-xs text-text-muted sm:mt-1.5">
            <Checkbox checked={!!use} onChange={(e) => onUse(e.target.checked)} aria-label={`${label}: kayda aktar`} />
            Kullan
          </label>
        ) : null}
      </div>
      <div className="grid gap-1.5">
        {children}
        <ConfidenceBadge field={field} />
      </div>
    </div>
  );
}

async function requestAi(id: string): Promise<{ ok: true; extraction: ReceiptExtraction | null } | { ok: false; error: string }> {
  try {
    const res = await fetch(READ_URL, { method: "POST", headers: { "Content-Type": "application/json", [BRIDGE_HEADER]: "1" }, body: JSON.stringify({ id }) });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; extraction?: ReceiptExtraction | null; error?: string } | null;
    if (!res.ok || !body?.ok) return { ok: false, error: body?.error ?? "Okuma tamamlanamadı." };
    return { ok: true, extraction: body.extraction ?? null };
  } catch {
    return { ok: false, error: "Bağlantı kesildi; yapay zekâ okuması yapılamadı." };
  }
}

export function ReceiptReview({
  attachmentId,
  file,
  fileName,
  extraction: initial,
  onApply,
}: {
  attachmentId: string;
  file: File | null;
  fileName: string;
  extraction: ReceiptExtraction;
  onApply: (values: ReviewApply, direction: "in" | "out") => void;
}) {
  const [x, setX] = useState<ReceiptExtraction>(initial);
  const [draft, setDraft] = useState<ReviewDraft>(() => draftFromExtraction(initial));
  const [touched, setTouched] = useState<Set<keyof ReviewDraft>>(() => new Set());
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const autoRan = useRef(false);
  const f = x.fields;

  function edit<K extends keyof ReviewDraft>(key: K, value: ReviewDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setTouched((t) => new Set(t).add(key));
  }
  function setUse(key: keyof ReviewDraft["use"], value: boolean) {
    setDraft((d) => ({ ...d, use: { ...d.use, [key]: value } }));
  }

  async function runAi() {
    setAiBusy(true);
    setAiError(null);
    const res = await requestAi(attachmentId);
    setAiBusy(false);
    if (!res.ok) {
      setAiError(res.error);
      return;
    }
    if (!res.extraction) return;
    const next = res.extraction;
    setX(next);
    // Kullanıcının elle düzelttiği alanlar korunur; diğerleri yeni (birleşmiş) sonuçla yenilenir.
    const fresh = draftFromExtraction(next);
    setDraft((d) => {
      const merged = { ...fresh, use: { ...fresh.use } } as ReviewDraft;
      for (const k of touched) (merged as Record<string, unknown>)[k] = d[k];
      return merged;
    });
  }

  useEffect(() => {
    if (autoRan.current || !shouldAutoRunAi(initial)) return;
    autoRan.current = true;
    // Etkinin içinde eşzamanlı setState yok: istek bir sonraki görev diliminde başlar.
    const t = setTimeout(() => void runAi(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const vatLines = f.vatLines?.value ?? [];
  const multiRate = vatLines.length > 1;
  const apply = (direction: "in" | "out") => onApply(applyFromDraft(draft, x), direction);
  const anyUse = Object.entries(draft.use).some(([, v]) => v);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start" aria-live="polite">
      <Preview file={file} fileName={fileName} />

      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text">
            <ScanLine className="h-4 w-4 text-text-faint" aria-hidden="true" />
            Okunan bilgiler
            {f.docType ? <Badge size="sm" variant="neutral">{DOC_TYPE_LABEL[f.docType.value]}</Badge> : null}
          </h3>
          {x.ai === "available" || x.ai === "done" || x.ai === "failed" ? (
            <Button variant="ghost" size="sm" icon={Sparkles} onClick={() => void runAi()} loading={aiBusy}>
              {x.ai === "done" ? "Yapay zekâ ile yeniden oku" : "Yapay zekâ ile tamamla"}
            </Button>
          ) : null}
        </div>
        <LayerChips layers={x.layers} aiBusy={aiBusy} />
        {aiError ? <p className="text-xs text-danger-strong">{aiError}</p> : null}

        {x.warnings.length ? (
          <ul className="grid gap-1.5" aria-label="Uyarılar">
            {x.warnings.map((w) => (
              <li key={`${w.code}-${w.field ?? ""}`} className={cn("flex items-start gap-2 rounded-[var(--radius-control)] px-3 py-2 text-xs", w.code === "duplicate" ? "tone-danger" : "tone-warning")}>
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{w.message}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {x.duplicates.length ? (
          <ul className="grid gap-1 text-xs" aria-label="Aynı kayıt iki kez girilmiş olabilir">
            {x.duplicates.map((d) => (
              <li key={`${d.kind}-${d.entryId ?? d.attachmentId ?? d.label}`}>
                <Link href={d.href} className="font-semibold text-accent-text hover:underline">
                  {d.label}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="rounded-[var(--radius-card)] border border-line bg-surface px-3">
          <Row id="rr-amount" label="Toplam (KDV dahil)" field={f.total} use={draft.use.amount} onUse={(v) => setUse("amount", v)}>
            <FormInput id="rr-amount" aria-label="Toplam (KDV dahil)" inputMode="decimal" className="numeric" value={draft.amount} onChange={(e) => edit("amount", e.target.value)} />
            {f.currency && f.currency.value !== "TRY" ? <p className="text-xs text-warning-strong">Para birimi: {f.currency.value}</p> : null}
          </Row>
          <Row id="rr-date" label="Belge tarihi" field={f.date} use={draft.use.date} onUse={(v) => setUse("date", v)}>
            <FormInput id="rr-date" aria-label="Belge tarihi" type="date" min="2000-01-01" value={draft.date} onChange={(e) => edit("date", e.target.value)} />
            {f.time ? <p className="text-xs text-text-muted">Saat {f.time.value}</p> : null}
          </Row>
          <Row id="rr-vat" label="KDV oranı" field={f.vatLines} use={draft.use.vatRate} onUse={(v) => setUse("vatRate", v)}>
            <FormSelect id="rr-vat" aria-label="KDV oranı" value={draft.vatRate == null ? "" : String(draft.vatRate)} onChange={(e) => edit("vatRate", e.target.value === "" ? null : Number(e.target.value))}>
              <option value="">Seçilmedi</option>
              {REVIEW_VAT_RATES.map((r) => (
                <option key={r} value={r}>
                  %{r}
                </option>
              ))}
            </FormSelect>
            {vatLines.length ? (
              <p className="numeric text-xs text-text-muted">
                {vatLines.map((l) => `%${l.rate}${l.amount != null ? `: ${formatAmountTr(l.amount)}` : ""}${l.base != null ? ` (matrah ${formatAmountTr(l.base)})` : ""}`).join(" · ")}
                {f.vatTotal && multiRate ? ` · Toplam KDV ${formatAmountTr(f.vatTotal.value)}` : null}
              </p>
            ) : f.vatTotal ? (
              <p className="numeric text-xs text-text-muted">KDV tutarı {formatAmountTr(f.vatTotal.value)}</p>
            ) : null}
            {multiRate ? <p className="text-xs text-warning-strong">Belgede birden çok KDV oranı var; kayıt tek oran taşır. Gerekirse ayrı kayıtlara bölün.</p> : null}
            {f.vatWithholding || f.incomeTaxWithholding ? (
              <p className="numeric text-xs text-text-muted">
                {f.vatWithholding ? `KDV tevkifatı ${formatAmountTr(f.vatWithholding.value)}` : ""}
                {f.vatWithholding && f.incomeTaxWithholding ? " · " : ""}
                {f.incomeTaxWithholding ? `Stopaj ${formatAmountTr(f.incomeTaxWithholding.value)}` : ""}
              </p>
            ) : null}
          </Row>
          <Row id="rr-vendor" label="Satıcı" field={x.party ? { confidence: x.party.confidence, source: f.sellerName?.source ?? f.sellerTaxId?.source ?? "pdf-text" } : f.sellerName} use={draft.use.vendor} onUse={(v) => setUse("vendor", v)}>
            <FormInput id="rr-vendor" aria-label="Satıcı" value={draft.vendor} maxLength={120} onChange={(e) => edit("vendor", e.target.value)} />
            {x.party ? (
              <label className="inline-flex items-center gap-1.5 text-xs text-text-muted">
                <Checkbox checked={draft.use.party} onChange={(e) => setUse("party", e.target.checked)} />
                <ShieldCheck className="h-3.5 w-3.5 text-success-strong" aria-hidden="true" />
                Kayıtlı cari: <span className="font-semibold text-text">{x.party.name}</span> ({x.party.reason === "vkn" ? "VKN eşleşti" : "ad benzer"})
              </label>
            ) : null}
            {f.sellerTaxId ? (
              <p className="numeric text-xs text-text-muted">
                {f.sellerTaxId.value.length === 10 ? "VKN" : "TCKN"} {f.sellerTaxId.value}
                {f.sellerTaxOffice ? ` · ${f.sellerTaxOffice.value} V.D.` : ""}
              </p>
            ) : null}
          </Row>
          <Row id="rr-no" label="Belge no" field={f.documentNo} use={draft.use.documentNo} onUse={(v) => setUse("documentNo", v)}>
            <FormInput id="rr-no" aria-label="Belge no" value={draft.documentNo} maxLength={30} onChange={(e) => edit("documentNo", e.target.value)} />
            {f.ettn ? <p className="break-all text-xs text-text-muted">ETTN {f.ettn.value}</p> : null}
            {f.zNo ? <p className="text-xs text-text-muted">Z no {f.zNo.value}</p> : null}
          </Row>
          {x.category ? (
            <Row id="rr-cat" label="Kategori önerisi" field={{ confidence: x.category.confidence, source: f.sellerName?.source ?? "pdf-text" }} use={draft.use.category} onUse={(v) => setUse("category", v)}>
              <p id="rr-cat" className="text-sm font-semibold text-text">
                {x.category.label}
                <span className="ml-1 text-xs font-normal text-text-muted">
                  ({x.category.reason === "kural" ? "ofis kuralı" : x.category.reason === "gecmis" ? "bu kişi/firmanın geçmiş kayıtları" : "belgedeki sözcükler"})
                </span>
              </p>
            </Row>
          ) : null}
          {f.paymentMethod || f.items ? (
            <div className="grid gap-1 py-2.5 text-xs text-text-muted">
              {f.paymentMethod ? <p>Ödeme: {PAYMENT_LABEL[f.paymentMethod.value]}</p> : null}
              {f.items?.value.length ? (
                <details>
                  <summary className="cursor-pointer font-semibold text-text">{f.items.value.length} kalem</summary>
                  <ul className="mt-1 grid gap-0.5">
                    {f.items.value.map((it, i) => (
                      <li key={`${it.name}-${i}`} className="numeric flex justify-between gap-2">
                        <span className="min-w-0 truncate">{it.name}</span>
                        <span>
                          {it.vatRate != null ? `%${it.vatRate} ` : ""}
                          {it.total != null ? formatAmountTr(it.total) : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>

        <p className="flex items-start gap-1.5 text-xs text-text-muted">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Seçtiğiniz alanlar kayıt formuna yazılır. Siz formu kaydetmeden kayıt açılmaz.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={ArrowUpCircle} onClick={() => apply("out")} disabled={!anyUse && !draft.amount}>
            Gider olarak kayda aktar
          </Button>
          <Button variant="secondary" icon={ArrowDownCircle} onClick={() => apply("in")}>
            Gelir olarak aktar
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ReceiptReview;
