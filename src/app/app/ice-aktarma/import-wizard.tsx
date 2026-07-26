"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileWarning,
  RefreshCw,
  UploadCloud,
  Users2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { EmptyState } from "@/components/app/empty-state";
import {
  importCustomers,
  importProperties,
  type CustomerImportRow,
  type ImportSummary,
  type PropertyImportRow,
} from "@/app/actions/import-data";
import {
  buildTemplateCsv,
  decodeCsvBuffer,
  fieldsFor,
  guessMapping,
  IMPORT_ROW_LIMIT,
  MAX_ERRORS_SHOWN,
  parseCsv,
  type ImportTarget,
  type ParsedCsv,
} from "./import-config";

/**
 * Üç adımlı CSV içe aktarma sihirbazı.
 *  1. Dosya + hedef (Müşteriler / Portföyler) — parse tamamen client'ta.
 *  2. Kolon eşleme (otomatik tahmin + elle düzeltme) + ilk 10 satır önizleme.
 *  3. Sunucuda doğrulama/yazma (importCustomers / importProperties) + rapor.
 *
 * .xlsx bilinçli olarak DESTEKLENMEZ (bağımlılık istemiyoruz) — kullanıcı
 * Excel'den "CSV olarak kaydet" ile geçirir; hata mesajı bunu söyler.
 */

const NONE = "__none__";

const TARGETS: { key: ImportTarget; label: string; desc: string; icon: typeof Users2 }[] = [
  { key: "customers", label: "Müşteriler", desc: "Ad soyad, telefon, e-posta, tip, kaynak, not", icon: Users2 },
  { key: "properties", label: "Portföyler", desc: "Başlık, işlem/portföy türü, fiyat, oda, m², adres", icon: Building2 },
];

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportWizard() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [target, setTarget] = useState<ImportTarget>("customers");
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState("");
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const fields = fieldsFor(target);

  const reset = () => {
    setStep(1);
    setFileName("");
    setFileError("");
    setParsed(null);
    setMapping({});
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFile = (file: File) => {
    setFileError("");
    setParsed(null);
    setFileName(file.name);
    if (/\.xlsx?$/i.test(file.name)) {
      setFileError(
        "Excel dosyaları (.xlsx/.xls) doğrudan desteklenmiyor. Excel'de \"Dosya → Farklı Kaydet → CSV (Virgülle ayrılmış)\" ile kaydedip CSV'yi yükleyin.",
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = decodeCsvBuffer(reader.result as ArrayBuffer);
        const p = parseCsv(text);
        if (!p.headers.length || !p.rows.length) {
          setFileError("Dosyada başlık satırı veya veri satırı bulunamadı.");
          return;
        }
        if (p.rows.length > IMPORT_ROW_LIMIT) {
          setFileError(
            `Dosyada ${p.rows.length} satır var; tek seferde en fazla ${IMPORT_ROW_LIMIT} satır aktarılabilir. Dosyayı bölerek yükleyin.`,
          );
          return;
        }
        setParsed(p);
      } catch {
        setFileError("Dosya okunamadı. Geçerli bir CSV dosyası yükleyin.");
      }
    };
    reader.onerror = () => setFileError("Dosya okunamadı. Lütfen tekrar deneyin.");
    reader.readAsArrayBuffer(file);
  };

  const goToMapping = () => {
    if (!parsed) return;
    setMapping(guessMapping(parsed.headers, fields));
    setStep(2);
  };

  const requiredMissing = fields.filter((f) => f.required && mapping[f.key] === undefined);

  const previewRows = useMemo(() => {
    if (!parsed) return [];
    return parsed.rows.slice(0, 10).map((r) =>
      fields.map((f) => (mapping[f.key] !== undefined ? (r[mapping[f.key]] ?? "").trim() : "")),
    );
  }, [parsed, mapping, fields]);

  const runImport = () => {
    if (!parsed || requiredMissing.length) return;
    const pick = (r: string[], key: string) =>
      mapping[key] !== undefined ? (r[mapping[key]] ?? "").trim() : "";
    startTransition(async () => {
      let summary: ImportSummary;
      if (target === "customers") {
        const rows: CustomerImportRow[] = parsed.rows.map((r, i) => ({
          row: i + 2, // 1 = başlık satırı
          full_name: pick(r, "full_name"),
          phone: pick(r, "phone"),
          email: pick(r, "email"),
          customer_type: pick(r, "customer_type"),
          source: pick(r, "source"),
          notes: pick(r, "notes"),
        }));
        summary = await importCustomers(rows);
      } else {
        const rows: PropertyImportRow[] = parsed.rows.map((r, i) => ({
          row: i + 2,
          title: pick(r, "title"),
          transaction_type: pick(r, "transaction_type"),
          property_type: pick(r, "property_type"),
          list_price: pick(r, "list_price"),
          rooms: pick(r, "rooms"),
          sqm: pick(r, "sqm"),
          address_line: pick(r, "address_line"),
        }));
        summary = await importProperties(rows);
      }
      setResult(summary);
      setStep(3);
    });
  };

  const downloadErrorReport = () => {
    if (!result?.errors?.length) return;
    const lines = [
      `EmlakSoft içe aktarma hata raporu — ${fileName}`,
      `Eklendi: ${result.inserted ?? 0} · Atlandı: ${result.skipped ?? 0} · Hatalı/atlanan satır: ${result.errors.length}`,
      "",
      ...result.errors.map((e) => `Satır ${e.row}: ${e.reason}`),
    ];
    downloadBlob(lines.join("\n"), "ice-aktarma-hatalari.txt", "text/plain;charset=utf-8");
  };

  const stepBadge = (n: 1 | 2 | 3, label: string) => (
    <div className="flex items-center gap-2">
      <span
        className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${
          step === n
            ? "bg-brand-600 text-white"
            : step > n
              ? "bg-mint-500/15 text-mint-600"
              : "border border-line bg-surface text-text-faint"
        }`}
      >
        {step > n ? <CheckCircle2 className="h-4 w-4" /> : n}
      </span>
      <span className={`text-xs font-semibold ${step === n ? "text-ink-950" : "text-text-muted"}`}>{label}</span>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* adım göstergesi */}
      <div className="flex flex-wrap items-center gap-4 rounded-[16px] border border-line bg-surface px-4 py-3">
        {stepBadge(1, "Dosya & hedef")}
        <span className="h-px w-8 bg-line" />
        {stepBadge(2, "Kolon eşleme & önizleme")}
        <span className="h-px w-8 bg-line" />
        {stepBadge(3, "Sonuç raporu")}
      </div>

      {/* ADIM 1 — dosya + hedef */}
      {step === 1 && (
        <section className="dashboard-panel space-y-5 rounded-[20px] border border-line bg-surface p-6">
          <div>
            <h2 className="font-display font-bold text-ink-950">1. Hedef seçin</h2>
            <p className="text-xs text-text-muted">İçe aktarılan satırlar hangi listeye eklenecek?</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {TARGETS.map((t) => {
                const active = target === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTarget(t.key)}
                    className={`focus-ring press flex items-start gap-3 rounded-[16px] border p-4 text-left transition ${
                      active ? "border-brand-400 bg-brand-600/[0.06]" : "border-line bg-canvas hover:border-brand-300"
                    }`}
                  >
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[12px] ${active ? "bg-brand-600 text-white" : "bg-brand-600/10 text-brand-600"}`}>
                      <t.icon className="h-5 w-5" />
                    </span>
                    <span>
                      <span className="block text-sm font-bold text-ink-950">{t.label}</span>
                      <span className="mt-0.5 block text-xs text-text-muted">{t.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <h2 className="font-display font-bold text-ink-950">2. CSV dosyası yükleyin</h2>
            <p className="text-xs text-text-muted">
              Virgül veya noktalı virgül ayraçlı CSV desteklenir; ayraç ve Türkçe karakter kodlaması
              (UTF-8 / Windows-1254) otomatik algılanır. En fazla {IMPORT_ROW_LIMIT} satır.
            </p>
            <label className="mt-3 block cursor-pointer rounded-[16px] border border-dashed border-line-strong bg-canvas px-6 py-10 text-center transition hover:border-brand-400">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
              <UploadCloud className="mx-auto h-8 w-8 text-brand-600" />
              <p className="mt-2 text-sm font-semibold text-ink-950">
                {fileName || "CSV dosyası seçmek için tıklayın"}
              </p>
              <p className="mt-1 text-xs text-text-faint">.csv — Excel dosyanızı önce &quot;CSV olarak kaydedin&quot;</p>
            </label>
            {fileError ? (
              <p className="mt-2 flex items-start gap-2 rounded-[12px] border border-danger-500/30 bg-danger-500/5 px-3 py-2.5 text-xs text-danger-600" role="alert">
                <FileWarning className="mt-0.5 h-4 w-4 shrink-0" /> {fileError}
              </p>
            ) : null}
            {parsed ? (
              <p className="mt-2 flex items-center gap-2 rounded-[12px] border border-mint-500/25 bg-mint-500/5 px-3 py-2.5 text-xs font-semibold text-mint-600">
                <CheckCircle2 className="h-4 w-4" />
                {parsed.rows.length} veri satırı, {parsed.headers.length} kolon okundu
                (ayraç: {parsed.delimiter === ";" ? "noktalı virgül" : "virgül"}).
              </p>
            ) : null}
          </div>

          {/* şablonlar */}
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <span className="text-xs font-semibold text-text-muted">Örnek şablon:</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => downloadBlob(buildTemplateCsv("customers"), "musteri-sablonu.csv", "text/csv;charset=utf-8")}
            >
              <Download className="h-3.5 w-3.5" /> Müşteri CSV şablonu
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => downloadBlob(buildTemplateCsv("properties"), "portfoy-sablonu.csv", "text/csv;charset=utf-8")}
            >
              <Download className="h-3.5 w-3.5" /> Portföy CSV şablonu
            </Button>
          </div>

          <div className="flex justify-end border-t border-line pt-4">
            <Button onClick={goToMapping} disabled={!parsed}>
              Devam et — kolon eşleme
            </Button>
          </div>
        </section>
      )}

      {/* ADIM 2 — eşleme + önizleme */}
      {step === 2 && parsed && (
        <section className="dashboard-panel space-y-5 rounded-[20px] border border-line bg-surface p-6">
          <div>
            <h2 className="font-display font-bold text-ink-950">Kolon eşleme</h2>
            <p className="text-xs text-text-muted">
              Dosyadaki kolonları {target === "customers" ? "müşteri" : "portföy"} alanlarına eşleyin.
              Benzer başlıklar otomatik tahmin edildi; yanlışsa değiştirin.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {fields.map((f) => (
              <FormField
                key={f.key}
                label={f.label}
                required={f.required}
                error={f.required && mapping[f.key] === undefined ? "Zorunlu alan — bir kolon seçin." : undefined}
              >
                <Select
                  value={mapping[f.key] !== undefined ? String(mapping[f.key]) : NONE}
                  onValueChange={(v) =>
                    setMapping((m) => {
                      const next = { ...m };
                      if (v === NONE) delete next[f.key];
                      else next[f.key] = Number(v);
                      return next;
                    })
                  }
                >
                  <SelectTrigger placeholder="Eşleme yok" />
                  <SelectContent>
                    <SelectItem value={NONE}>— Eşleme yok —</SelectItem>
                    {parsed.headers.map((h, i) => (
                      <SelectItem key={`${h}-${i}`} value={String(i)}>
                        {h || `Kolon ${i + 1}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            ))}
          </div>

          <div>
            <h3 className="text-sm font-bold text-ink-950">Önizleme (ilk 10 satır, eşlenmiş haliyle)</h3>
            <div className="mt-2 overflow-x-auto rounded-[14px] border border-line">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="bg-canvas text-text-muted">
                  <tr>
                    <th className="px-3 py-2 font-semibold">#</th>
                    {fields.map((f) => (
                      <th key={f.key} className="px-3 py-2 font-semibold">
                        {f.label}
                        {f.required ? <span className="ml-0.5 text-danger-500">*</span> : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((cells, ri) => (
                    <tr key={ri} className="border-t border-line">
                      <td className="px-3 py-2 text-text-faint">{ri + 2}</td>
                      {cells.map((c, ci) => (
                        <td key={ci} className="max-w-56 truncate px-3 py-2 text-ink-950">
                          {c || <span className="text-text-faint">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-[11px] text-text-faint">
              Toplam {parsed.rows.length} satır aktarılacak. Satır numaraları dosyadaki sırayı izler (1 = başlık).
            </p>
          </div>

          {target === "customers" ? (
            <p className="flex items-start gap-2 rounded-[12px] border border-line bg-canvas px-3 py-2.5 text-xs text-text-muted">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              Mükerrer koruması: telefonu zaten kayıtlı olan satırlar eklenmez, raporda &quot;atlandı
              (mevcut)&quot; olarak listelenir.
            </p>
          ) : null}

          <div className="flex items-center justify-between border-t border-line pt-4">
            <Button variant="secondary" onClick={() => setStep(1)}>
              Geri
            </Button>
            <Button onClick={runImport} disabled={requiredMissing.length > 0} loading={pending}>
              {pending ? "Aktarılıyor…" : `${parsed.rows.length} satırı içe aktar`}
            </Button>
          </div>
        </section>
      )}

      {/* ADIM 3 — sonuç raporu */}
      {step === 3 && (
        <section className="dashboard-panel space-y-5 rounded-[20px] border border-line bg-surface p-6">
          {!result || result.error ? (
            <EmptyState
              icon={XCircle}
              tone="danger"
              title="İçe aktarma başarısız"
              description={result?.error ?? "Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin."}
              action={{ node: <Button onClick={reset}><RefreshCw className="h-4 w-4" /> Baştan başla</Button> }}
            />
          ) : (
            <>
              <div>
                <h2 className="font-display font-bold text-ink-950">Sonuç raporu</h2>
                <p className="text-xs text-text-muted">{fileName} · {target === "customers" ? "Müşteriler" : "Portföyler"}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-[14px] border border-mint-500/25 bg-mint-500/5 p-4">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-mint-600"><CheckCircle2 className="h-4 w-4" /> Eklendi</p>
                  <p className="numeric mt-1 font-display text-2xl font-extrabold text-ink-950">{result.inserted ?? 0}</p>
                </div>
                <div className="rounded-[14px] border border-amber-400/30 bg-amber-400/5 p-4">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-600"><AlertTriangle className="h-4 w-4" /> Atlandı (mevcut)</p>
                  <p className="numeric mt-1 font-display text-2xl font-extrabold text-ink-950">{result.skipped ?? 0}</p>
                </div>
                <div className="rounded-[14px] border border-danger-500/25 bg-danger-500/5 p-4">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-danger-600"><XCircle className="h-4 w-4" /> Hatalı</p>
                  <p className="numeric mt-1 font-display text-2xl font-extrabold text-ink-950">
                    {(result.errors?.length ?? 0) - (result.skipped ?? 0)}
                  </p>
                </div>
              </div>

              {result.errors && result.errors.length > 0 ? (
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-ink-950">
                      Satır detayları
                      {result.errors.length > MAX_ERRORS_SHOWN
                        ? ` (ilk ${MAX_ERRORS_SHOWN} gösteriliyor · toplam ${result.errors.length})`
                        : ` (${result.errors.length})`}
                    </h3>
                    <Button variant="secondary" size="sm" onClick={downloadErrorReport}>
                      <Download className="h-3.5 w-3.5" /> Tam raporu indir (.txt)
                    </Button>
                  </div>
                  <div className="mt-2 max-h-80 overflow-auto rounded-[14px] border border-line">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-canvas text-text-muted">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Satır</th>
                          <th className="px-3 py-2 font-semibold">Neden</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.errors.slice(0, MAX_ERRORS_SHOWN).map((e, i) => (
                          <tr key={i} className="border-t border-line">
                            <td className="numeric px-3 py-2 text-text-muted">{e.row}</td>
                            <td className="px-3 py-2 text-ink-950">{e.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <p className="flex items-center gap-2 rounded-[12px] border border-mint-500/25 bg-mint-500/5 px-3 py-2.5 text-xs font-semibold text-mint-600">
                  <CheckCircle2 className="h-4 w-4" /> Tüm satırlar sorunsuz aktarıldı.
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <Button variant="secondary" onClick={reset}>
                  <RefreshCw className="h-4 w-4" /> Yeni dosya aktar
                </Button>
                <Button
                  onClick={() => {
                    window.location.href = target === "customers" ? "/app/musteriler" : "/app/portfoyler";
                  }}
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  {target === "customers" ? "Müşteri listesine git" : "Portföy listesine git"}
                </Button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
