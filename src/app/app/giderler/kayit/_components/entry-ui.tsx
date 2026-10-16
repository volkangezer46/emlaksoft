"use client";

import { useRef, useState, type LabelHTMLAttributes, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, Copy, History, Loader2, Paperclip, PiggyBank, Scale, Wallet, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "@/components/ui/smart-link";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import { formatDateTr } from "@/lib/format";
import { BRIDGE_HEADER } from "@/lib/listing-control/worker/bridge-request";
import type { BudgetImpact, DuplicateHit, EntryTotals, RecentEntry } from "@/lib/finance/entry-workspace";
import type { ReceiptExtraction } from "@/lib/finance/receipt/types";
import { cn } from "@/lib/utils";

/**
 * Kayıt çalışma alanının ortak parçaları (yeni kayıt + düzenleme): bölüm kartı, seçim çipi, belge yükleme (OCR önerili)
 * ve sağdaki canlı "Özet" kartı. Popup yok: hepsi sayfa akışındadır.
 */

/** Bölüm kartı: başlık + isteğe bağlı açıklama; mobilde tam genişlik. */
export function Section({ title, icon: Icon, description, children, className, id }: { title: string; icon?: LucideIcon; description?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} aria-label={title} className={cn("rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--elev-1)] sm:p-5", className)}>
      <header className="mb-3">
        <h2 className="flex items-center gap-1.5 font-display text-sm font-semibold text-text">
          {Icon ? <Icon className="h-4 w-4 text-text-faint" aria-hidden="true" /> : null}
          {title}
        </h2>
        {description ? <p className="mt-0.5 text-xs text-text-muted">{description}</p> : null}
      </header>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

export function chipClass(on: boolean) {
  return cn(
    "press inline-flex min-h-9 touch:min-h-11 cursor-pointer items-center gap-1 rounded-full border px-3 text-xs font-semibold transition",
    on ? "border-ink-950 bg-ink-950 text-white" : "border-line bg-surface text-text-muted hover:border-brand-300 hover:text-ink-950",
  );
}

/** Odak halkası gizli yerel radyoya düşer; etiket görünür halkayı taşır (klavye: Tab gruba, oklar seçer). */
const RADIO_FOCUS = "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500 has-[:focus-visible]:ring-offset-1";

/** Seçim çipi: gizli yerel `input[type=radio]` + `label` (klavye ve ekran okuyucu yerel radyo davranışını alır). */
export function RadioChip({
  name,
  checked,
  onSelect,
  className,
  children,
  ...rest
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  className?: string;
  children: ReactNode;
} & Omit<LabelHTMLAttributes<HTMLLabelElement>, "onSelect" | "className" | "children">) {
  return (
    <label className={cn(className ?? chipClass(checked), RADIO_FOCUS)} {...rest}>
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="sr-only" />
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Belge yükleme (FN5 ucu; fiş okuma açıksa öneri döner)
// ---------------------------------------------------------------------------

export const UPLOAD_URL = "/api/app/finans/belge";
export const UPLOAD_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export type OcrResult = { amount?: number; date?: string; vatRate?: number; vendor?: string };
export type UploadState =
  | { status: "idle" }
  | { status: "uploading"; name: string; progress: number }
  | { status: "done"; name: string; id: string }
  | { status: "error"; name: string; error: string };

type UploadResponse = { ok?: boolean; id?: string; error?: string; ocr?: OcrResult; extraction?: ReceiptExtraction };
const XML_ACCEPT = ".xml,application/xml,text/xml";
const isXmlFile = (f: File) => f.type === "application/xml" || f.type === "text/xml" || (/\.xml$/i.test(f.name) && (!f.type || f.type === "application/octet-stream"));

/**
 * Aynı kökene çok parçalı yükleme (ilerleme çubuğu için XHR). Uç, köken denetimi için `x-emlaksoft-bridge: 1` başlığını
 * ister (Belgeler yükleme alanıyla aynı); başlıksız istek reddedilirdi.
 */
function uploadAttachment(file: File, onProgress: (p: number) => void): Promise<UploadResponse> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const body = new FormData();
    body.append("file", file);
    xhr.open("POST", UPLOAD_URL);
    xhr.setRequestHeader(BRIDGE_HEADER, "1");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      const res = (xhr.response ?? null) as UploadResponse | null;
      if (xhr.status >= 200 && xhr.status < 300 && res?.ok && res.id) resolve(res);
      else resolve({ ok: false, error: res?.error ?? "Dosya yüklenemedi." });
    };
    xhr.onerror = () => resolve({ ok: false, error: "Bağlantı kesildi; dosya yüklenemedi." });
    xhr.send(body);
  });
}

/**
 * Fiş/fatura eki: seçilen dosya hemen yüklenir; fiş okuma açıksa dönen değerler `onOcr` ile YALNIZ öneri olarak verilir
 * (çağıran yalnız boş alanları doldurur). Mobilde kamera ile çekim desteklenir (`accept` görsel içerir).
 */
export function AttachmentField({
  id,
  value,
  onChange,
  onOcr,
  onExtraction,
  acceptXml = false,
  label = "Fiş veya fatura ekle (PDF, görsel)",
}: {
  id: string;
  value: UploadState;
  onChange: (next: UploadState) => void;
  onOcr?: (ocr: OcrResult) => void;
  /** Akıllı fiş okuma sonucu (alan + güven + kaynak); dosya önizleme için birlikte verilir. */
  onExtraction?: (extraction: ReceiptExtraction, file: File) => void;
  /** e-Fatura XML (UBL-TR) de kabul edilsin mi (Fatura / Belge sekmesi). */
  acceptXml?: boolean;
  label?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!UPLOAD_ACCEPT.split(",").includes(file.type) && !(acceptXml && isXmlFile(file))) {
      onChange({ status: "error", name: file.name, error: acceptXml ? "JPEG, PNG, WEBP görsel, PDF veya e-Fatura XML seçin." : "JPEG, PNG, WEBP görsel veya PDF seçin." });
      return;
    }
    if (file.size <= 0 || file.size > UPLOAD_MAX_BYTES) {
      onChange({ status: "error", name: file.name, error: "Dosya en fazla 10 MB olabilir." });
      return;
    }
    onChange({ status: "uploading", name: file.name, progress: 0 });
    const res = await uploadAttachment(file, (progress) => onChange({ status: "uploading", name: file.name, progress }));
    if (!res.ok || !res.id) {
      onChange({ status: "error", name: file.name, error: res.error ?? "Dosya yüklenemedi." });
      return;
    }
    onChange({ status: "done", name: file.name, id: res.id });
    if (res.extraction && onExtraction) onExtraction(res.extraction, file);
    else if (res.ocr && onOcr) onOcr(res.ocr);
  }

  return (
    <div>
      <input ref={fileRef} type="file" accept={acceptXml ? `${UPLOAD_ACCEPT},${XML_ACCEPT}` : UPLOAD_ACCEPT} className="sr-only" id={id} onChange={(e) => onFile(e.target.files?.[0])} />
      {value.status === "idle" ? (
        <label
          htmlFor={id}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void onFile(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            "focus-ring press flex min-h-14 cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--radius-control)] border border-dashed px-3 py-3 text-center text-sm font-semibold transition",
            drag ? "border-brand-500 bg-surface-accent-soft text-accent-text" : "border-line-strong text-text-muted hover:border-brand-300 hover:text-accent-text",
          )}
        >
          <span className="inline-flex items-center gap-2">
            <Paperclip className="h-4 w-4" aria-hidden="true" /> {label}
          </span>
          <span className="text-xs font-normal text-text-faint">Sürükleyip bırakın ya da dokunup seçin (en çok 10 MB)</span>
        </label>
      ) : (
        <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-xs" aria-live="polite">
          {value.status === "uploading" ? <Loader2 className="h-4 w-4 animate-spin text-accent-text" aria-hidden="true" /> : <Paperclip className="h-4 w-4 text-text-faint" aria-hidden="true" />}
          <span className="min-w-0 flex-1 truncate font-medium text-text">{value.name}</span>
          {value.status === "uploading" ? <span className="numeric text-text-muted">{value.progress >= 100 ? "Okunuyor…" : `%${value.progress}`}</span> : null}
          {value.status === "done" ? <span className="font-semibold text-success-strong">Eklendi</span> : null}
          {value.status === "error" ? <span className="text-danger-strong">{value.error}</span> : null}
          {value.status !== "uploading" ? (
            <Button
              variant="ghost"
              size="icon"
              icon={X}
              onClick={() => {
                onChange({ status: "idle" });
                if (fileRef.current) fileRef.current.value = "";
              }}
              className="hover:text-danger-600"
              aria-label="Eki kaldır"
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Canlı özet kartı
// ---------------------------------------------------------------------------

function Row({ label, value, strong, tone }: { label: string; value: ReactNode; strong?: boolean; tone?: "in" | "out" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className={cn("numeric text-right text-sm", strong ? "font-bold text-text" : "text-text", tone === "in" && "text-success-strong", tone === "out" && "text-danger-strong")}>{value}</dd>
    </div>
  );
}

export type SummaryAccount = { name: string; currency: string; before: number; after: number };

/**
 * Sağdaki canlı özet: net / KDV / brüt / stopaj / hesaba yansıyan, hesap bakiyesi önce → sonra, bu ayki kategori bütçesine
 * etki, olası mükerrer (engellemez) ve benzer son kayıtlar. Her satır tıklanabilir hedefe gider (kayıt düzenleme sayfası).
 */
export function EntrySummary({
  heading = "Özet",
  direction,
  currency,
  totals,
  showTax,
  categoryLabel,
  account,
  toAccount,
  budget,
  duplicates,
  similar,
  categoryLabelOf,
  hrefOf,
  deferredNote,
}: {
  heading?: string;
  direction: "in" | "out" | "transfer";
  currency: string;
  totals: EntryTotals | null;
  showTax: boolean;
  categoryLabel: string | null;
  account: SummaryAccount | null;
  toAccount?: SummaryAccount | null;
  budget: BudgetImpact | null;
  duplicates: readonly DuplicateHit[];
  similar: readonly RecentEntry[];
  categoryLabelOf: (value: string | null) => string;
  hrefOf: (entryId: string) => string;
  deferredNote?: string | null;
}) {
  const sign = direction === "in" ? "+" : direction === "out" ? "−" : "";
  return (
    <div className="grid gap-3" aria-live="polite">
      <section aria-label={heading} className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--elev-1)]">
        <h2 className="mb-2 flex items-center gap-1.5 font-display text-sm font-semibold text-text">
          <Scale className="h-4 w-4 text-text-faint" aria-hidden="true" /> {heading}
        </h2>
        {totals ? (
          <dl className="divide-y divide-line/60">
            {showTax ? (
              <>
                <Row label="Net (KDV hariç)" value={formatAccountMoney(totals.net, currency)} />
                <Row label="KDV" value={totals.vat != null ? formatAccountMoney(totals.vat, currency) : "—"} />
                <Row label="Brüt (KDV dahil)" value={formatAccountMoney(totals.gross, currency)} />
                {totals.withheld ? <Row label="Stopaj (vergi dairesine)" value={formatAccountMoney(totals.withheld, currency)} /> : null}
              </>
            ) : null}
            <Row
              label={direction === "transfer" ? "Aktarılan" : deferredNote ? "Açılacak kalem" : "Hesaba yansıyan"}
              value={`${sign}${formatAccountMoney(deferredNote ? totals.gross : totals.cash, currency)}`}
              strong
              tone={direction === "transfer" ? undefined : direction}
            />
            {categoryLabel ? <Row label="Kategori" value={categoryLabel} /> : null}
          </dl>
        ) : (
          <p className="text-xs text-text-muted">Tutarı yazdıkça net, KDV, brüt ve hesaba yansıyan tutar burada hesaplanır.</p>
        )}
        {deferredNote ? <p className="mt-2 text-xs text-text-muted">{deferredNote}</p> : null}
      </section>

      {account && !deferredNote ? (
        <section aria-label="Hesap bakiyesi" className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--elev-1)]">
          <h2 className="mb-2 flex items-center gap-1.5 font-display text-sm font-semibold text-text">
            <Wallet className="h-4 w-4 text-text-faint" aria-hidden="true" /> Hesap bakiyesi
          </h2>
          <BalanceLine account={account} />
          {toAccount ? <BalanceLine account={toAccount} /> : null}
        </section>
      ) : null}

      {budget ? (
        <section aria-label="Bütçe etkisi" className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--elev-1)]">
          <h2 className="mb-2 flex items-center gap-1.5 font-display text-sm font-semibold text-text">
            <PiggyBank className="h-4 w-4 text-text-faint" aria-hidden="true" /> Bu ayın bütçesi
          </h2>
          <div className="h-2 overflow-hidden rounded-full bg-line" role="meter" aria-label="Bütçe kullanımı" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, budget.pctAfter)}>
            <div className={cn("h-full rounded-full", budget.over ? "bg-danger-500" : budget.pctAfter >= 80 ? "bg-amber-400" : "bg-brand-600")} style={{ width: `${Math.min(100, budget.pctAfter)}%` }} />
          </div>
          <p className="numeric mt-2 text-xs text-text-muted">
            {formatAccountMoney(budget.before, currency)} → <strong className="text-text">{formatAccountMoney(budget.after, currency)}</strong> / {formatAccountMoney(budget.budget, currency)} (%{budget.pctAfter})
          </p>
          <p className={cn("mt-1 text-xs font-semibold", budget.over ? "text-danger-strong" : "text-text-muted")}>
            {budget.over ? `Bütçe ${formatAccountMoney(-budget.remaining, currency)} aşılır.` : `Kalan ${formatAccountMoney(budget.remaining, currency)}.`}
          </p>
          <Link href="/app/giderler?sekme=butce" className="mt-1 inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-accent-text hover:underline touch:min-h-11">
            Bütçeye git <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </section>
      ) : null}

      {duplicates.length > 0 ? (
        <section aria-label="Olası mükerrer kayıt" className="tone-warning rounded-[var(--radius-card)] p-4">
          <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
            <Copy className="h-4 w-4" aria-hidden="true" /> Olası mükerrer kayıt
          </h2>
          <p className="text-xs">Benzer bir kayıt zaten var. Yine de kaydedebilirsiniz; kontrol etmek için kayda dokunun.</p>
          <ul className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-1">
            {duplicates.map((d) => (
              <li key={d.entry.id}>
                <Link href={hrefOf(d.entry.id)} className="flex min-h-9 items-center justify-between gap-2 rounded-[var(--radius-control)] bg-surface/70 px-2 py-1 text-xs hover:bg-surface touch:min-h-11">
                  <span className="min-w-0 truncate">
                    <span className="font-semibold">{d.entry.title || categoryLabelOf(d.entry.category)}</span>
                    <span className="block truncate opacity-80">{d.reason}</span>
                  </span>
                  <span className="numeric shrink-0 font-semibold">{formatDateTr(d.entry.date)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {similar.length > 0 ? (
        <section aria-label="Benzer son kayıtlar" className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--elev-1)]">
          <h2 className="mb-2 flex items-center gap-1.5 font-display text-sm font-semibold text-text">
            <History className="h-4 w-4 text-text-faint" aria-hidden="true" /> Benzer son kayıtlar
          </h2>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
            {similar.map((e) => (
              <li key={e.id}>
                <Link href={hrefOf(e.id)} className="flex min-h-9 items-center justify-between gap-2 rounded-[var(--radius-control)] px-2 py-1 text-xs hover:bg-surface-hover touch:min-h-11">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-text">{e.title || categoryLabelOf(e.category)}</span>
                    <span className="block truncate text-text-muted">
                      {formatDateTr(e.date)} · {categoryLabelOf(e.category)}
                      {e.counterparty ? ` · ${e.counterparty}` : ""}
                    </span>
                  </span>
                  <span className={cn("numeric shrink-0 font-bold", e.direction === "in" ? "text-success-strong" : "text-danger-strong")}>
                    {e.direction === "in" ? "+" : "−"}
                    {formatAccountMoney(e.amount, currency)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function BalanceLine({ account }: { account: SummaryAccount }) {
  const delta = Math.round((account.after - account.before) * 100) / 100;
  return (
    <div className="py-1">
      <p className="truncate text-xs font-semibold text-text">{account.name}</p>
      <p className="numeric flex flex-wrap items-baseline gap-x-1.5 text-sm">
        <span className="text-text-muted">{formatAccountMoney(account.before, account.currency)}</span>
        <ArrowRight className="h-3 w-3 self-center text-text-faint" aria-hidden="true" />
        <strong className={cn(account.after < 0 ? "text-danger-strong" : "text-text")}>{formatAccountMoney(account.after, account.currency)}</strong>
        {delta !== 0 ? (
          <span className={cn("text-xs font-semibold", delta > 0 ? "text-success-strong" : "text-danger-strong")}>
            ({delta > 0 ? "+" : "−"}
            {formatAccountMoney(Math.abs(delta), account.currency)})
          </span>
        ) : null}
      </p>
      {account.after < 0 ? (
        <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-danger-strong">
          <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Bakiye eksiye düşer.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sade canlı özet (yeni kayıt): mobilde tutarın altında tek şerit, masaüstünde küçük kart
// ---------------------------------------------------------------------------

/**
 * Yalnız gerekeni gösterir: KDV seçiliyse net / KDV / brüt (ve stopaj), hesap bakiyesi sonrası. Bütçe (≥%80 ya da aşım),
 * olası mükerrer ve benzer kayıtlar YALNIZ ilgiliyse satır içi uyarı olarak çıkar (büyük panel yok). `compact`: mobil
 * şerit (benzer kayıtlar listesi çizilmez; boşken hiçbir şey çizilmez).
 */
export function EntryLiveSummary({
  compact,
  direction,
  currency,
  totals,
  showTax,
  account,
  toAccount,
  budget,
  duplicates,
  similar,
  categoryLabelOf,
  hrefOf,
  deferredNote,
  className,
}: {
  compact?: boolean;
  direction: "in" | "out" | "transfer";
  currency: string;
  totals: EntryTotals | null;
  showTax: boolean;
  account: SummaryAccount | null;
  toAccount?: SummaryAccount | null;
  budget: BudgetImpact | null;
  duplicates: readonly DuplicateHit[];
  similar: readonly RecentEntry[];
  categoryLabelOf: (value: string | null) => string;
  hrefOf: (entryId: string) => string;
  deferredNote?: string | null;
  className?: string;
}) {
  const tax = totals && showTax && totals.vat != null && totals.vat > 0;
  const budgetWarn = budget && (budget.over || budget.pctAfter >= 80) ? budget : null;
  const accounts = deferredNote ? [] : [account, toAccount ?? null].filter((a): a is SummaryAccount => a !== null);
  const lines: ReactNode[] = [];
  if (totals && (tax || totals.withheld)) {
    lines.push(
      <p key="tax" className="numeric flex flex-wrap gap-x-3 gap-y-0.5">
        {tax ? (
          <>
            <span>
              <span className="text-text-muted">Net</span> {formatAccountMoney(totals.net, currency)}
            </span>
            <span>
              <span className="text-text-muted">KDV</span> {formatAccountMoney(totals.vat ?? 0, currency)}
            </span>
            <span className="font-semibold text-text">
              <span className="font-normal text-text-muted">Brüt</span> {formatAccountMoney(totals.gross, currency)}
            </span>
          </>
        ) : null}
        {totals.withheld ? (
          <span>
            <span className="text-text-muted">Stopaj</span> {formatAccountMoney(totals.withheld, currency)}
          </span>
        ) : null}
      </p>,
    );
  }
  for (const a of accounts) {
    if (!totals && compact) continue;
    lines.push(
      <p key={`acc-${a.name}`} className="numeric flex min-w-0 flex-wrap items-center gap-x-1.5">
        <span className="min-w-0 truncate text-text-muted">{a.name}:</span>
        {totals ? (
          <>
            <span className="text-text-muted">{formatAccountMoney(a.before, a.currency)}</span>
            <ArrowRight className="h-3 w-3 text-text-faint" aria-hidden="true" />
          </>
        ) : null}
        <strong className={cn(a.after < 0 ? "text-danger-strong" : "text-text")}>{formatAccountMoney(a.after, a.currency)}</strong>
        {totals && a.after < 0 ? <span className="font-semibold text-danger-strong">(eksiye düşer)</span> : null}
      </p>,
    );
  }
  if (deferredNote && totals) lines.push(<p key="def" className="text-text-muted">{deferredNote}</p>);

  const warnings: ReactNode[] = [];
  if (duplicates.length > 0) {
    const d = duplicates[0]!;
    warnings.push(
      <p key="dup" className="tone-warning rounded-[var(--radius-control)] px-2.5 py-1.5 font-semibold">
        <Copy className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />
        <span>Olası mükerrer: {d.reason.toLocaleLowerCase("tr-TR")}.</span>
        {" "}
        <Link href={hrefOf(d.entry.id)} className="underline underline-offset-2">
          Kaydı aç
        </Link>
      </p>,
    );
  }
  if (budgetWarn) {
    warnings.push(
      <p key="budget" className={cn("rounded-[var(--radius-control)] px-2.5 py-1.5 font-semibold", budgetWarn.over ? "tone-danger" : "tone-warning")}>
        <PiggyBank className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />
        <span className="numeric">
          {budgetWarn.over
            ? `Bu ayın bütçesi ${formatAccountMoney(-budgetWarn.remaining, currency)} aşılır (%${budgetWarn.pctAfter}).`
            : `Bu ayın bütçesinin %${budgetWarn.pctAfter}'i kullanılmış olur.`}
        </span>
        {" "}
        <Link href="/app/giderler?sekme=butce" className="underline underline-offset-2">
          Bütçeye bak
        </Link>
      </p>,
    );
  }

  const showSimilar = !compact && similar.length > 0;
  if (compact && lines.length === 0 && warnings.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Canlı özet"
      role="region"
      className={cn(
        "grid gap-1.5 text-xs",
        compact ? "rounded-[var(--radius-control)] bg-canvas px-3 py-2" : "rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--elev-1)]",
        className,
      )}
    >
      {!compact ? (
        <h2 className="flex items-center gap-1.5 font-display text-sm font-semibold text-text">
          <Scale className="h-4 w-4 text-text-faint" aria-hidden="true" /> Özet
        </h2>
      ) : null}
      {totals && !compact ? (
        <p className={cn("numeric text-lg font-bold", direction === "in" ? "text-success-strong" : direction === "out" ? "text-danger-strong" : "text-text")}>
          {direction === "in" ? "+" : direction === "out" ? "−" : ""}
          {formatAccountMoney(deferredNote ? totals.gross : totals.cash, currency)}
        </p>
      ) : null}
      {lines}
      {!totals && !compact ? <p className="text-text-muted">Tutarı yazdıkça hesaba yansıyan tutar ve bakiye burada görünür.</p> : null}
      {warnings}
      {showSimilar ? (
        <div className="mt-1 border-t border-line pt-2">
          <p className="mb-1 flex items-center gap-1 font-semibold text-text-muted">
            <History className="h-3.5 w-3.5" aria-hidden="true" /> Benzer son kayıtlar
          </p>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
            {similar.slice(0, 3).map((e) => (
              <li key={e.id}>
                <Link href={hrefOf(e.id)} className="flex min-h-8 items-center justify-between gap-2 rounded-[var(--radius-control)] px-1.5 hover:bg-surface-hover touch:min-h-11">
                  <span className="min-w-0 truncate">
                    {e.title || categoryLabelOf(e.category)} <span className="text-text-muted">· {formatDateTr(e.date)}</span>
                  </span>
                  <span className={cn("numeric shrink-0 font-semibold", e.direction === "in" ? "text-success-strong" : "text-danger-strong")}>{formatAccountMoney(e.amount, currency)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
