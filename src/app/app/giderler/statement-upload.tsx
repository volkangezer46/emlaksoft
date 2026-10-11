"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Upload } from "lucide-react";
import type { StageResult, StatementPreview } from "@/lib/finance/statement/service";
import { BRIDGE_HEADER } from "@/lib/listing-control/worker/bridge-request";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { FileInput } from "@/components/ui/file-input";
import { FormError, FormField, FormSelect } from "@/components/ui/form-controls";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import { formatDateTr } from "@/lib/format";
import type { ColumnMapping } from "@/lib/finance/statement/parse";

type CsvPreview = Extract<StatementPreview, { ok: true; format: "csv" | "xlsx" }>;
type OfxPreview = Extract<StatementPreview, { ok: true; format: "ofx" }>;

const NONE = "";

/** İkili dosya server action yerine route handler'a gider (bkz. /api/app/finans/ekstre); hata gövdesi `{ error }` taşır. */
async function postStatement<T>(fd: FormData): Promise<T | { error: string }> {
  try {
    const res = await fetch("/api/app/finans/ekstre", { method: "POST", body: fd, headers: { [BRIDGE_HEADER]: "1" } });
    return (await res.json()) as T;
  } catch {
    return { error: "Bağlantı kurulamadı. İnternetinizi kontrol edip tekrar deneyin." };
  }
}

/** Hesap kartındaki "Ekstre yükle": dosya seç -> (CSV/Excel için) sütun eşleme sihirbazı -> taslak -> onay ekranı. */
export function StatementUploadButton({ accountId, accountName, reviewHref, currency }: { accountId: string; accountName: string; reviewHref: string; currency: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="xs" icon={Upload} onClick={() => setOpen(true)} aria-label={`${accountName} için banka ekstresi yükle`}>
        Ekstre yükle
      </Button>
      {open ? <UploadDialog accountId={accountId} accountName={accountName} reviewHref={reviewHref} currency={currency} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function UploadDialog({ accountId, accountName, reviewHref, currency, onClose }: { accountId: string; accountName: string; reviewHref: string; currency: string; onClose: () => void }) {
  const router = useRouter();
  const { push } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CsvPreview | OfxPreview | null>(null);
  const [mode, setMode] = useState<"single" | "split">("single");
  const [map, setMap] = useState<Partial<ColumnMapping>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function readFile(f: File | null) {
    setFile(f);
    setPreview(null);
    setError(null);
    if (!f) return;
    setBusy(true);
    const fd = new FormData();
    fd.set("file", f);
    fd.set("op", "preview");
    fd.set("accountId", accountId);
    const res = await postStatement<StatementPreview>(fd);
    setBusy(false);
    if (!("ok" in res) || !res.ok) return setError("error" in res && res.error ? res.error : "Dosya okunamadı.");
    setPreview(res);
    if (res.format !== "ofx") {
      setMap(res.mapping);
      setMode(res.mapping.debit !== undefined && res.mapping.credit !== undefined ? "split" : "single");
    }
  }

  async function submit() {
    if (!file || !preview) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("op", "stage");
    fd.set("accountId", accountId);
    if (preview.format !== "ofx") {
      const m: Partial<ColumnMapping> = mode === "single" ? { ...map, debit: undefined, credit: undefined } : { ...map, amount: undefined };
      fd.set("mapping", JSON.stringify(m));
    }
    const res = await postStatement<StageResult>(fd);
    setBusy(false);
    if (!("ok" in res) || !res.ok) return setError(res.error ?? "Ekstre yüklenemedi.");
    const dup = res.duplicates ? `, ${res.duplicates} satır daha önce yüklenmişti` : "";
    const bad = res.invalid ? `, ${res.invalid} satır okunamadı` : "";
    push(`${res.inserted} satır taslağa alındı${dup}${bad}`, "ok");
    onClose();
    router.push(reviewHref);
    router.refresh();
  }

  const setCol = (key: keyof ColumnMapping) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    setMap((prev) => ({ ...prev, [key]: v === NONE ? undefined : Number(v) }));
  };
  const complete =
    preview?.format === "ofx" ||
    (map.date !== undefined && map.description !== undefined && (mode === "single" ? map.amount !== undefined : map.debit !== undefined && map.credit !== undefined));

  return (
    <Dialog open onOpenChange={(v) => (v ? undefined : onClose())}>
      <DialogContent size="xl">
        <DialogHeader title="Banka ekstresi yükle" description={`${accountName} · CSV, Excel (.xlsx) veya OFX. Satırlar önce taslak olur; siz onaylamadan hareket oluşmaz.`} icon={<FileSpreadsheet />} />
        <DialogBody className="grid gap-4">
          <FormField label="Ekstre dosyası" htmlFor="st-file" hint="Bankanızın internet bankacılığından indirdiğiniz hesap hareketleri dosyası. En çok 2 MB.">
            <FileInput id="st-file" accept=".csv,.txt,.xlsx,.ofx,.qfx" onChange={(e) => void readFile(e.target.files?.[0] ?? null)} disabled={busy} />
          </FormField>

          {preview?.format === "ofx" ? <OfxSummary preview={preview} currency={currency} /> : null}

          {preview && preview.format !== "ofx" ? (
            <>
              <p className="text-sm text-text-muted">
                {preview.totalRows} satır bulundu. {preview.mappingSource === "saved" ? "Bu hesap için kayıtlı sütun eşlemesi kullanıldı." : "Sütunlar başlıklardan tahmin edildi; kontrol edin."}
              </p>
              <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line">
                <table className="w-full min-w-[32rem] text-left text-xs">
                  <thead className="bg-canvas text-text-muted">
                    <tr>{preview.headers.map((h, i) => <th key={i} className="whitespace-nowrap px-2.5 py-1.5 font-semibold">{h || `Sütun ${i + 1}`}</th>)}</tr>
                  </thead>
                  <tbody>
                    {preview.preview.map((row, r) => (
                      <tr key={r} className="border-t border-line">
                        {preview.headers.map((_, c) => <td key={c} className="max-w-[16rem] truncate px-2.5 py-1.5 text-text">{row[c] ?? ""}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <ColumnSelect id="st-date" label="Tarih sütunu" value={map.date} headers={preview.headers} onChange={setCol("date")} required />
                <ColumnSelect id="st-desc" label="Açıklama sütunu" value={map.description} headers={preview.headers} onChange={setCol("description")} required />
              </div>
              <fieldset className="grid gap-3 rounded-[var(--radius-card)] border border-line p-3">
                <legend className="px-1 text-xs font-semibold text-text-muted">Tutar nasıl yazılmış?</legend>
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-2"><input type="radio" name="st-mode" checked={mode === "single"} onChange={() => setMode("single")} className="accent-[var(--accent)]" /> Tek tutar sütunu (eksi = para çıkışı)</label>
                  <label className="flex items-center gap-2"><input type="radio" name="st-mode" checked={mode === "split"} onChange={() => setMode("split")} className="accent-[var(--accent)]" /> Ayrı Borç / Alacak sütunları</label>
                </div>
                {mode === "single" ? (
                  <ColumnSelect id="st-amount" label="Tutar sütunu" value={map.amount} headers={preview.headers} onChange={setCol("amount")} required />
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ColumnSelect id="st-debit" label="Borç (çıkış) sütunu" value={map.debit} headers={preview.headers} onChange={setCol("debit")} required />
                    <ColumnSelect id="st-credit" label="Alacak (giriş) sütunu" value={map.credit} headers={preview.headers} onChange={setCol("credit")} required />
                  </div>
                )}
              </fieldset>
              <ColumnSelect id="st-balance" label="Bakiye sütunu (isteğe bağlı)" value={map.balance} headers={preview.headers} onChange={setCol("balance")} />
            </>
          ) : null}
          <FormError error={error} nextStep={null} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={!preview || !complete}>Taslağa al</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ColumnSelect({ id, label, value, headers, onChange, required }: { id: string; label: string; value: number | undefined; headers: readonly string[]; onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void; required?: boolean }) {
  return (
    <FormField label={label} htmlFor={id} required={required}>
      <FormSelect id={id} value={value === undefined ? NONE : String(value)} onChange={onChange}>
        <option value={NONE}>{required ? "Seçin…" : "Yok"}</option>
        {headers.map((h, i) => <option key={i} value={i}>{h || `Sütun ${i + 1}`}</option>)}
      </FormSelect>
    </FormField>
  );
}

function OfxSummary({ preview, currency }: { preview: OfxPreview; currency: string }) {
  return (
    <div className="grid gap-2">
      <p className="text-sm text-text-muted">OFX dosyasında {preview.lineCount} hareket bulundu{preview.invalid ? `, ${preview.invalid} satır okunamadı` : ""}. Sütun eşlemesi gerekmez.</p>
      <ul className="grid gap-1 rounded-[var(--radius-card)] border border-line p-2 text-xs">
        {preview.preview.map((l, i) => (
          <li key={i} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-text">{formatDateTr(l.date)} · {l.description || "Açıklama yok"}</span>
            <span className={`numeric shrink-0 font-semibold ${l.dir === "in" ? "text-success-strong" : "text-danger-strong"}`}>{l.dir === "in" ? "+" : "−"}{formatAccountMoney(l.amount, currency)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
