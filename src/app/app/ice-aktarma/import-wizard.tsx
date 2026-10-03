"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileWarning,
  History,
  RefreshCw,
  Search,
  Undo2,
  UploadCloud,
  Users2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { EmptyState } from "@/components/app/empty-state";
import {
  importChunk,
  previewImportChunk,
  type ImportOptions,
  type PlannedRowView,
} from "@/app/actions/import-data";
import { rollbackImport, type ImportBatch } from "@/app/actions/import-rollback";
import {
  buildIssueCsv,
  countPlanned,
  emptyCounters,
  statusLabel,
  type DuplicatePolicy,
  type ImportCounters,
  type ImportRow,
  type RowStatus,
} from "@/lib/import-rows";
import {
  buildTemplateCsv,
  decodeCsvBuffer,
  fieldsFor,
  guessMapping,
  IMPORT_CHUNK_SIZE,
  IMPORT_MAX_FILE_BYTES,
  IMPORT_ROW_LIMIT,
  MAX_ERRORS_SHOWN,
  parseCsv,
  PREVIEW_ROWS,
  TARGET_LABEL,
  type ImportTarget,
  type ParsedCsv,
} from "./import-config";

/**
 * Dört adımlı içe aktarma sihirbazı (müşteri / portföy / talep ortak altyapı).
 *  1. Hedef + CSV dosyası — çözümleme tamamen istemcide.
 *  2. Kolon eşleme (otomatik tahmin + elle düzeltme) + mükerrer politikası + danışman.
 *  3. ÖNİZLEME: sunucuda yazmadan doğrulama (parça parça), sayaçlar, ilk 20 satır, sorunlu satırlar.
 *  4. Sonuç özeti, hatalı satırları CSV indirme, "bu içe aktarmayı geri al".
 *
 * .xlsx bilinçli olarak DESTEKLENMEZ (bağımlılık istemiyoruz) — kullanıcı
 * Excel'den "CSV olarak kaydet" ile geçirir; hata mesajı bunu söyler.
 */

const NONE = "__none__";
const ME = "__me__";
const UNASSIGNED = "__unassigned__";

const TARGETS: { key: ImportTarget; desc: string; icon: typeof Users2 }[] = [
  { key: "customers", desc: "Ad soyad, telefon, e-posta, tip, kaynak, not", icon: Users2 },
  { key: "properties", desc: "Başlık, işlem/portföy türü, fiyat, oda, m², adres", icon: Building2 },
  { key: "demands", desc: "Müşteri telefonu/e-postası ile eşlenen alıcı/kiracı talepleri", icon: Search },
];

const POLICIES: { key: DuplicatePolicy; label: string; desc: string }[] = [
  { key: "skip", label: "Atla", desc: "Mevcut kayıtlara dokunma; mükerrer satırlar eklenmez." },
  { key: "update", label: "Güncelle", desc: "Mevcut kaydı dosyadaki dolu alanlarla güncelle (geri alınabilir)." },
  { key: "create", label: "Yeni oluştur", desc: "Mükerrer olsa da her satır için yeni kayıt aç." },
];

const STATUS_STYLE: Record<RowStatus, string> = {
  new: "bg-mint-500/12 text-mint-600",
  update: "bg-brand-600/10 text-brand-600",
  skip: "bg-amber-400/15 text-amber-700",
  error: "bg-danger-500/10 text-danger-600",
};

const nf = new Intl.NumberFormat("tr-TR");

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function chunkRows<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function StatusBadge({ status }: { status: RowStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>
      {statusLabel(status)}
    </span>
  );
}

function CounterCards({ c, labels }: { c: ImportCounters; labels: [string, string, string, string] }) {
  const cards: { label: string; value: number; cls: string }[] = [
    { label: labels[0], value: c.new, cls: "border-mint-500/25 bg-mint-500/5 text-mint-600" },
    { label: labels[1], value: c.update, cls: "border-brand-400/30 bg-brand-600/5 text-brand-600" },
    { label: labels[2], value: c.skip, cls: "border-amber-400/30 bg-amber-400/5 text-amber-600" },
    { label: labels[3], value: c.error, cls: "border-danger-500/25 bg-danger-500/5 text-danger-600" },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((k) => (
        <div key={k.label} className={`rounded-[var(--radius-card)] border p-4 ${k.cls}`}>
          <p className="text-xs font-semibold">{k.label}</p>
          <p className="numeric mt-1 font-display text-2xl font-extrabold text-ink-950">{nf.format(k.value)}</p>
        </div>
      ))}
      <div className="rounded-[var(--radius-card)] border border-line bg-canvas p-4 text-text-muted">
        <p className="text-xs font-semibold">Uyarılı satır</p>
        <p className="numeric mt-1 font-display text-2xl font-extrabold text-ink-950">{nf.format(c.warning)}</p>
      </div>
    </div>
  );
}

export type ImportWizardProps = {
  canImportProperties: boolean;
  canImportDemands: boolean;
  /** Hedef bazında: mevcut kaydı güncelleme (edit) yetkisi. */
  updateAllowed: Record<ImportTarget, boolean>;
  /** Hedef bazında: geri alma (delete) yetkisi. */
  rollbackAllowed: Record<ImportTarget, boolean>;
  team: { id: string; name: string }[];
  recent: ImportBatch[];
};

export function ImportWizard({
  canImportProperties,
  canImportDemands,
  updateAllowed,
  rollbackAllowed,
  team,
  recent,
}: ImportWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [target, setTarget] = useState<ImportTarget>("customers");
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState("");
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [policy, setPolicy] = useState<DuplicatePolicy>("skip");
  const [assignee, setAssignee] = useState<string>(ME);
  const [busy, setBusy] = useState<null | "preview" | "import" | "rollback">(null);
  const [progress, setProgress] = useState(0);
  const [stepError, setStepError] = useState("");
  const [planned, setPlanned] = useState<PlannedRowView[]>([]);
  const [filter, setFilter] = useState<"issues" | RowStatus>("issues");
  const [batchId, setBatchId] = useState("");
  const [rolledBack, setRolledBack] = useState<string>("");
  const [confirmRollback, setConfirmRollback] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fields = fieldsFor(target);
  const effectivePolicy: DuplicatePolicy = policy === "update" && !updateAllowed[target] ? "skip" : policy;

  const reset = () => {
    setStep(1);
    setFileName("");
    setFileError("");
    setParsed(null);
    setMapping({});
    setPlanned([]);
    setStepError("");
    setBatchId("");
    setRolledBack("");
    setConfirmRollback(false);
    setBusy(null);
    setProgress(0);
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
    if (file.size > IMPORT_MAX_FILE_BYTES) {
      setFileError(`Dosya çok büyük (en fazla ${Math.round(IMPORT_MAX_FILE_BYTES / 1024 / 1024)} MB). Dosyayı bölüp ayrı ayrı yükleyin.`);
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
            `Dosyada ${nf.format(p.rows.length)} satır var; tek seferde en fazla ${nf.format(IMPORT_ROW_LIMIT)} satır aktarılabilir. Dosyayı bölerek yükleyin.`,
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
    setPolicy("skip");
    setStep(2);
  };

  const requiredMissing = fields.filter((f) => f.required && mapping[f.key] === undefined);
  const demandKeyMissing =
    target === "demands" && mapping.customer_phone === undefined && mapping.customer_email === undefined;

  /** Eşlenmiş satırlar (dosya satır no: başlık = 1). */
  const mappedRows = useMemo<ImportRow[]>(() => {
    if (!parsed) return [];
    return parsed.rows.map((r, i) => {
      const out: ImportRow = { row: i + 2 };
      for (const f of fields) out[f.key] = mapping[f.key] !== undefined ? (r[mapping[f.key]] ?? "").trim() : "";
      return out;
    });
  }, [parsed, mapping, fields]);

  const options = (): ImportOptions => ({
    duplicatePolicy: effectivePolicy,
    assignTo: assignee === ME ? undefined : assignee === UNASSIGNED ? "" : assignee,
    fileName,
  });

  const runPreview = async () => {
    if (!parsed || requiredMissing.length || demandKeyMissing) return;
    setBusy("preview");
    setStepError("");
    setProgress(0);
    const all: PlannedRowView[] = [];
    let seen: string[] = [];
    const parts = chunkRows(mappedRows, IMPORT_CHUNK_SIZE);
    try {
      for (let i = 0; i < parts.length; i++) {
        const res = await previewImportChunk(target, parts[i], { ...options(), seen });
        if (res.error || !res.rows) {
          setStepError(res.error ?? "Önizleme oluşturulamadı.");
          setBusy(null);
          return;
        }
        all.push(...res.rows);
        seen = res.seen ?? seen;
        setProgress(Math.round(((i + 1) / parts.length) * 100));
      }
    } catch {
      setStepError("Önizleme sırasında bağlantı hatası oluştu. Lütfen tekrar deneyin.");
      setBusy(null);
      return;
    }
    setPlanned(all);
    setFilter(all.some((r) => r.status === "error" || r.issues.length) ? "issues" : "new");
    setBusy(null);
    setStep(3);
  };

  const runImport = async () => {
    if (!parsed) return;
    const id = crypto.randomUUID();
    setBatchId(id);
    setBusy("import");
    setStepError("");
    setProgress(0);
    const all: PlannedRowView[] = [];
    const parts = chunkRows(mappedRows, IMPORT_CHUNK_SIZE);
    try {
      for (let i = 0; i < parts.length; i++) {
        const res = await importChunk(target, parts[i], { ...options(), batchId: id });
        if (res.error || !res.rows) {
          setStepError(
            `${res.error ?? "İçe aktarma durdu."} ${all.length ? `İlk ${nf.format(all.length)} satır işlendi; aşağıdaki günlükten geri alabilirsiniz.` : ""}`.trim(),
          );
          break;
        }
        all.push(...res.rows);
        setProgress(Math.round(((i + 1) / parts.length) * 100));
      }
    } catch {
      setStepError("İçe aktarma sırasında bağlantı hatası oluştu. İşlenen kısım günlükte görünür; geri alabilirsiniz.");
    }
    setPlanned(all);
    setBusy(null);
    setStep(4);
    router.refresh();
  };

  const doRollback = async () => {
    if (!batchId) return;
    setBusy("rollback");
    const res = await rollbackImport(batchId);
    setBusy(null);
    setConfirmRollback(false);
    if (res.error) {
      setStepError(res.error);
      return;
    }
    setStepError("");
    setRolledBack(
      `Geri alındı: ${nf.format(res.removed ?? 0)} kayıt kaldırıldı${res.restored ? `, ${nf.format(res.restored)} kayıt eski haline döndü` : ""}.${res.warning ? ` ${res.warning}` : ""}`,
    );
    router.refresh();
  };

  const counters = useMemo(() => (planned.length ? countPlanned(planned) : emptyCounters()), [planned]);
  const importable = counters.new + counters.update;

  const shownRows = useMemo(() => {
    if (filter === "issues") return planned.filter((r) => r.status === "error" || r.issues.length > 0);
    return planned.filter((r) => r.status === filter);
  }, [planned, filter]);

  const downloadIssues = (include: RowStatus[], name: string) => {
    if (!parsed) return;
    downloadBlob(buildIssueCsv(parsed.headers, parsed.rows, planned, include), name, "text/csv;charset=utf-8");
  };

  const stepBadge = (n: 1 | 2 | 3 | 4, label: string) => (
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

  const policyHelp = POLICIES.find((p) => p.key === effectivePolicy)?.desc;
  const progressBar = busy ? (
    <div className="space-y-1.5" role="status" aria-live="polite">
      <div className="h-2 overflow-hidden rounded-full bg-canvas">
        <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} />
      </div>
      <p className="text-xs text-text-muted">
        {busy === "preview" ? "Satırlar doğrulanıyor" : "Kayıtlar aktarılıyor"}… %{progress} (sayfayı kapatmayın)
      </p>
    </div>
  ) : null;

  return (
    <div className="space-y-5">
      {/* adım göstergesi */}
      <div className="flex flex-wrap items-center gap-4 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3">
        {stepBadge(1, "Dosya & hedef")}
        <span className="h-px w-8 bg-line" />
        {stepBadge(2, "Kolon eşleme & politika")}
        <span className="h-px w-8 bg-line" />
        {stepBadge(3, "Önizleme")}
        <span className="h-px w-8 bg-line" />
        {stepBadge(4, "Sonuç")}
      </div>

      {/* ADIM 1 — dosya + hedef */}
      {step === 1 && (
        <section className="dashboard-panel space-y-5 rounded-[var(--radius-panel)] border border-line bg-surface p-6">
          <div>
            <h2 className="font-display font-bold text-ink-950">1. Hedef seçin</h2>
            <p className="text-xs text-text-muted">İçe aktarılan satırlar hangi listeye eklenecek?</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {TARGETS.map((t) => {
                const active = target === t.key;
                const allowed = t.key === "properties" ? canImportProperties : t.key === "demands" ? canImportDemands : true;
                return (
                  <button
                    key={t.key}
                    type="button"
                    disabled={!allowed}
                    aria-describedby={!allowed ? `${t.key}-import-permission-note` : undefined}
                    onClick={() => {
                      if (allowed) setTarget(t.key);
                    }}
                    className={`focus-ring press flex items-start gap-3 rounded-[var(--radius-card)] border p-4 text-left transition ${
                      active ? "border-brand-400 bg-brand-600/[0.06]" : "border-line bg-canvas hover:border-brand-300"
                    } disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:border-line`}
                  >
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-card)] ${active ? "bg-brand-600 text-white" : "bg-brand-600/10 text-brand-600"}`}>
                      <t.icon className="h-5 w-5" />
                    </span>
                    <span>
                      <span className="block text-sm font-bold text-ink-950">{TARGET_LABEL[t.key]}</span>
                      <span className="mt-0.5 block text-xs text-text-muted">
                        {allowed
                          ? t.desc
                          : t.key === "properties"
                            ? "Portföy ekleme yetkisi gerekir."
                            : "Talep ekleme yetkisi gerekir."}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            {!canImportProperties ? (
              <p
                id="properties-import-permission-note"
                className="mt-2 rounded-[var(--radius-card)] border border-amber-400/30 bg-amber-400/5 px-3 py-2.5 text-xs text-amber-700"
              >
                Müşteri aktarımına devam edebilirsiniz. Portföy aktarımı için portföy oluşturma yetkisi gerekir.
              </p>
            ) : null}
            {!canImportDemands ? (
              <p
                id="demands-import-permission-note"
                className="mt-2 rounded-[var(--radius-card)] border border-amber-400/30 bg-amber-400/5 px-3 py-2.5 text-xs text-amber-700"
              >
                Talep aktarımı için talep oluşturma yetkisi gerekir.
              </p>
            ) : null}
            {target === "demands" ? (
              <p className="mt-2 rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2.5 text-xs text-text-muted">
                Talepler müşteriyle telefon veya e-posta üzerinden eşlenir; eşleşen müşteri yoksa satır hatalı sayılır.
                Müşterileriniz henüz yoksa önce &quot;Müşteriler&quot; hedefiyle aktarın.
              </p>
            ) : null}
          </div>

          <div>
            <h2 className="font-display font-bold text-ink-950">2. CSV dosyası yükleyin</h2>
            <p className="text-xs text-text-muted">
              Virgül veya noktalı virgül ayraçlı CSV desteklenir; ayraç ve Türkçe karakter kodlaması
              (UTF-8 / Windows-1254) otomatik algılanır. En fazla {nf.format(IMPORT_ROW_LIMIT)} satır; büyük dosyalar
              {" "}{IMPORT_CHUNK_SIZE}&apos;lik parçalarla işlenir.
            </p>
            <label className="mt-3 block cursor-pointer rounded-[var(--radius-card)] border border-dashed border-line-strong bg-canvas px-6 py-10 text-center transition hover:border-brand-400">
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
              <p className="mt-2 text-sm font-semibold text-ink-950">{fileName || "CSV dosyası seçmek için tıklayın"}</p>
              <p className="mt-1 text-xs text-text-faint">.csv — Excel dosyanızı önce &quot;CSV olarak kaydedin&quot;</p>
            </label>
            {fileError ? (
              <p className="mt-2 flex items-start gap-2 rounded-[var(--radius-card)] border border-danger-500/30 bg-danger-500/5 px-3 py-2.5 text-xs text-danger-600" role="alert">
                <FileWarning className="mt-0.5 h-4 w-4 shrink-0" /> {fileError}
              </p>
            ) : null}
            {parsed ? (
              <p className="mt-2 flex items-center gap-2 rounded-[var(--radius-card)] border border-mint-500/25 bg-mint-500/5 px-3 py-2.5 text-xs font-semibold text-mint-600">
                <CheckCircle2 className="h-4 w-4" />
                {nf.format(parsed.rows.length)} veri satırı, {parsed.headers.length} kolon okundu
                (ayraç: {parsed.delimiter === ";" ? "noktalı virgül" : "virgül"}).
              </p>
            ) : null}
          </div>

          {/* şablonlar */}
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <span className="text-xs font-semibold text-text-muted">Örnek şablon:</span>
            {(["customers", "properties", "demands"] as const).map((k) => (
              <Button
                key={k}
                variant="secondary"
                size="sm"
                onClick={() => downloadBlob(buildTemplateCsv(k), `${k}-sablonu.csv`, "text/csv;charset=utf-8")}
              >
                <Download className="h-3.5 w-3.5" /> {TARGET_LABEL[k]} şablonu
              </Button>
            ))}
          </div>

          <div className="flex justify-end border-t border-line pt-4">
            <Button onClick={goToMapping} disabled={!parsed}>
              Devam et — kolon eşleme
            </Button>
          </div>
        </section>
      )}

      {/* ADIM 2 — eşleme + politika */}
      {step === 2 && parsed && (
        <section className="dashboard-panel space-y-5 rounded-[var(--radius-panel)] border border-line bg-surface p-6">
          <div>
            <h2 className="font-display font-bold text-ink-950">Kolon eşleme</h2>
            <p className="text-xs text-text-muted">
              Dosyadaki kolonları {TARGET_LABEL[target].toLocaleLowerCase("tr-TR")} alanlarına eşleyin. Başlıklar Türkçe
              eşanlamlılarla otomatik tahmin edildi ({Object.keys(mapping).length}/{fields.length} alan); yanlışsa değiştirin.
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
          {demandKeyMissing ? (
            <p className="flex items-start gap-2 rounded-[var(--radius-card)] border border-danger-500/30 bg-danger-500/5 px-3 py-2.5 text-xs text-danger-600" role="alert">
              <FileWarning className="mt-0.5 h-4 w-4 shrink-0" />
              Talepleri müşteriyle eşlemek için &quot;Müşteri telefonu&quot; veya &quot;Müşteri e-postası&quot; kolonlarından en az biri eşlenmeli.
            </p>
          ) : null}

          <div className="grid gap-5 border-t border-line pt-5 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-bold text-ink-950">Mükerrer kayıt politikası</h3>
              <p className="text-xs text-text-muted">
                {target === "customers"
                  ? "Telefon, yoksa e-posta ile mevcut müşteri aranır."
                  : target === "properties"
                    ? "Aynı başlık + adres mevcut portföy sayılır."
                    : "Aynı müşteri için aynı işlem/tür/oda/bütçeli aktif talep mükerrer sayılır."}
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Mükerrer politikası">
                {POLICIES.map((p) => {
                  const disabled = p.key === "update" && (!updateAllowed[target] || target === "demands");
                  const active = effectivePolicy === p.key;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={disabled}
                      onClick={() => setPolicy(p.key)}
                      className={`focus-ring press rounded-[var(--radius-card)] border px-3 py-2.5 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        active ? "border-brand-400 bg-brand-600/[0.06]" : "border-line bg-canvas hover:border-brand-300"
                      }`}
                    >
                      <span className="block font-bold text-ink-950">{p.label}</span>
                      {disabled ? (
                        <span className="mt-0.5 block text-text-faint">
                          {target === "demands" ? "Talepte desteklenmez." : "Düzenleme yetkisi gerekir."}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-text-muted">{policyHelp}</p>
              <p className="mt-1 text-xs text-text-faint">
                Aynı dosyada tekrar eden satırlarda ilk satır kazanır (&quot;Yeni oluştur&quot; hariç).
              </p>
            </div>

            {target !== "demands" ? (
              <FormField label="Danışman ataması" hint="Yeni oluşan kayıtların sorumlusu.">
                <Select value={assignee} onValueChange={setAssignee}>
                  <SelectTrigger placeholder="Danışman seçin" />
                  <SelectContent>
                    <SelectItem value={ME}>Ben (içe aktaran kullanıcı)</SelectItem>
                    <SelectItem value={UNASSIGNED}>Danışmansız bırak</SelectItem>
                    {team.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            ) : null}
          </div>

          {stepError ? (
            <p className="flex items-start gap-2 rounded-[var(--radius-card)] border border-danger-500/30 bg-danger-500/5 px-3 py-2.5 text-xs text-danger-600" role="alert">
              <FileWarning className="mt-0.5 h-4 w-4 shrink-0" /> {stepError}
            </p>
          ) : null}
          {progressBar}

          <div className="flex items-center justify-between border-t border-line pt-4">
            <Button variant="secondary" onClick={() => setStep(1)} disabled={busy !== null}>
              Geri
            </Button>
            <Button
              onClick={runPreview}
              disabled={requiredMissing.length > 0 || demandKeyMissing}
              loading={busy === "preview"}
            >
              {busy === "preview" ? "Doğrulanıyor…" : "Önizle ve doğrula"}
            </Button>
          </div>
        </section>
      )}

      {/* ADIM 3 — önizleme */}
      {step === 3 && parsed && (
        <section className="dashboard-panel space-y-5 rounded-[var(--radius-panel)] border border-line bg-surface p-6">
          <div>
            <h2 className="font-display font-bold text-ink-950">Önizleme — henüz hiçbir şey kaydedilmedi</h2>
            <p className="text-xs text-text-muted">
              {fileName} · {TARGET_LABEL[target]} · {nf.format(counters.total)} satır · politika:{" "}
              {POLICIES.find((p) => p.key === effectivePolicy)?.label}
            </p>
          </div>

          <CounterCards c={counters} labels={["Yeni", "Güncellenecek", "Atlanacak (mükerrer)", "Hatalı"]} />

          <div>
            <h3 className="text-sm font-bold text-ink-950">İlk {PREVIEW_ROWS} satır (doğrulanmış haliyle)</h3>
            <div className="mt-2 overflow-x-auto rounded-[var(--radius-card)] border border-line">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="bg-canvas text-text-muted">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Satır</th>
                    <th className="px-3 py-2 font-semibold">Durum</th>
                    <th className="px-3 py-2 font-semibold">Kayıt</th>
                    <th className="px-3 py-2 font-semibold">Not</th>
                  </tr>
                </thead>
                <tbody>
                  {planned.slice(0, PREVIEW_ROWS).map((r) => (
                    <tr key={r.row} className="border-t border-line align-top">
                      <td className="numeric px-3 py-2 text-text-muted">{r.row}</td>
                      <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                      <td className="max-w-56 truncate px-3 py-2 text-ink-950">
                        {r.label || <span className="text-text-faint">—</span>}
                        {r.existingName ? <span className="block text-text-faint">eşleşen: {r.existingName} ({r.matchedBy})</span> : null}
                      </td>
                      <td className="px-3 py-2 text-text-muted">
                        {r.issues.length ? r.issues.map((i) => i.message).join(" · ") : <span className="text-text-faint">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Satır filtresi">
                {(
                  [
                    ["issues", "Sorunlu / uyarılı"],
                    ["error", "Hatalı"],
                    ["skip", "Atlanacak"],
                    ["update", "Güncellenecek"],
                    ["new", "Yeni"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={filter === k}
                    onClick={() => setFilter(k)}
                    className={`focus-ring rounded-full border px-3 py-1 text-xs font-semibold transition ${
                      filter === k ? "border-brand-400 bg-brand-600/[0.08] text-brand-600" : "border-line bg-canvas text-text-muted hover:border-brand-300"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {counters.error + counters.skip > 0 ? (
                <Button variant="secondary" size="sm" onClick={() => downloadIssues(["error", "skip"], "ice-aktarma-onizleme-sorunlar.csv")}>
                  <Download className="h-3.5 w-3.5" /> Sorunlu satırlar (CSV)
                </Button>
              ) : null}
            </div>
            {shownRows.length ? (
              <div className="mt-2 max-h-72 overflow-auto rounded-[var(--radius-card)] border border-line">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-canvas text-text-muted">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Satır</th>
                      <th className="px-3 py-2 font-semibold">Durum</th>
                      <th className="px-3 py-2 font-semibold">Neden</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownRows.slice(0, MAX_ERRORS_SHOWN).map((r) => (
                      <tr key={r.row} className="border-t border-line align-top">
                        <td className="numeric px-3 py-2 text-text-muted">{r.row}</td>
                        <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                        <td className="px-3 py-2 text-ink-950">{r.issues.map((i) => i.message).join(" · ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-2 rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2.5 text-xs text-text-muted">
                Bu filtreye uyan satır yok.
              </p>
            )}
            {shownRows.length > MAX_ERRORS_SHOWN ? (
              <p className="mt-1.5 text-xs text-text-faint">
                İlk {MAX_ERRORS_SHOWN} satır gösteriliyor (toplam {nf.format(shownRows.length)}); tamamı için CSV indirin.
              </p>
            ) : null}
          </div>

          {stepError ? (
            <p className="flex items-start gap-2 rounded-[var(--radius-card)] border border-danger-500/30 bg-danger-500/5 px-3 py-2.5 text-xs text-danger-600" role="alert">
              <FileWarning className="mt-0.5 h-4 w-4 shrink-0" /> {stepError}
            </p>
          ) : null}
          {progressBar}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <Button variant="secondary" onClick={() => setStep(2)} disabled={busy !== null}>
              Eşlemeyi / politikayı değiştir
            </Button>
            <Button onClick={runImport} disabled={importable === 0} loading={busy === "import"}>
              {importable === 0
                ? "Aktarılacak satır yok"
                : `${nf.format(importable)} kaydı içe aktar`}
            </Button>
          </div>
        </section>
      )}

      {/* ADIM 4 — sonuç */}
      {step === 4 && (
        <section className="dashboard-panel space-y-5 rounded-[var(--radius-panel)] border border-line bg-surface p-6">
          {!planned.length ? (
            <EmptyState illustration="belge"
              icon={XCircle}
              tone="danger"
              title="İçe aktarma başarısız"
              description={stepError || "Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin."}
              action={{ node: <Button onClick={reset}><RefreshCw className="h-4 w-4" /> Baştan başla</Button> }}
            />
          ) : (
            <>
              <div>
                <h2 className="font-display font-bold text-ink-950">Sonuç özeti</h2>
                <p className="text-xs text-text-muted">{fileName} · {TARGET_LABEL[target]}</p>
              </div>
              <CounterCards c={counters} labels={["Eklendi", "Güncellendi", "Atlandı", "Hatalı"]} />

              {rolledBack ? (
                <p className="flex items-center gap-2 rounded-[var(--radius-card)] border border-mint-500/25 bg-mint-500/5 px-3 py-2.5 text-xs font-semibold text-mint-600">
                  <CheckCircle2 className="h-4 w-4" /> {rolledBack}
                </p>
              ) : null}
              {stepError ? (
                <p className="flex items-start gap-2 rounded-[var(--radius-card)] border border-danger-500/30 bg-danger-500/5 px-3 py-2.5 text-xs text-danger-600" role="alert">
                  <FileWarning className="mt-0.5 h-4 w-4 shrink-0" /> {stepError}
                </p>
              ) : null}

              {counters.error + counters.skip > 0 ? (
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-ink-950">
                      Satır detayları
                      {counters.error + counters.skip > MAX_ERRORS_SHOWN
                        ? ` (ilk ${MAX_ERRORS_SHOWN} gösteriliyor · toplam ${nf.format(counters.error + counters.skip)})`
                        : ` (${counters.error + counters.skip})`}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {counters.error > 0 ? (
                        <Button variant="secondary" size="sm" onClick={() => downloadIssues(["error"], "ice-aktarma-hatali-satirlar.csv")}>
                          <Download className="h-3.5 w-3.5" /> Hatalı satırlar (CSV)
                        </Button>
                      ) : null}
                      <Button variant="secondary" size="sm" onClick={() => downloadIssues(["error", "skip"], "ice-aktarma-sorunlu-satirlar.csv")}>
                        <Download className="h-3.5 w-3.5" /> Hatalı + atlanan (CSV)
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 max-h-80 overflow-auto rounded-[var(--radius-card)] border border-line">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-canvas text-text-muted">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Satır</th>
                          <th className="px-3 py-2 font-semibold">Durum</th>
                          <th className="px-3 py-2 font-semibold">Neden</th>
                        </tr>
                      </thead>
                      <tbody>
                        {planned
                          .filter((r) => r.status === "error" || r.status === "skip")
                          .slice(0, MAX_ERRORS_SHOWN)
                          .map((r) => (
                            <tr key={r.row} className="border-t border-line align-top">
                              <td className="numeric px-3 py-2 text-text-muted">{r.row}</td>
                              <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                              <td className="px-3 py-2 text-ink-950">{r.issues.map((i) => i.message).join(" · ")}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-1.5 text-xs text-text-faint">
                    CSV, orijinal kolonlarınızı da içerir: satırları düzeltip aynı dosyayı yeniden yükleyebilirsiniz.
                  </p>
                </div>
              ) : (
                <p className="flex items-center gap-2 rounded-[var(--radius-card)] border border-mint-500/25 bg-mint-500/5 px-3 py-2.5 text-xs font-semibold text-mint-600">
                  <CheckCircle2 className="h-4 w-4" /> Tüm satırlar sorunsuz aktarıldı.
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={reset} disabled={busy !== null}>
                    <RefreshCw className="h-4 w-4" /> Yeni dosya aktar
                  </Button>
                  {rollbackAllowed[target] && !rolledBack && counters.new + counters.update > 0 ? (
                    confirmRollback ? (
                      <span className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-danger-500/30 bg-danger-500/5 px-3 py-1.5 text-xs text-danger-600">
                        Bu içe aktarmada oluşan {nf.format(counters.new)} kayıt kaldırılır
                        {counters.update ? `, ${nf.format(counters.update)} güncelleme geri alınır` : ""}. Emin misiniz?
                        <Button size="sm" variant="secondary" onClick={doRollback} loading={busy === "rollback"}>Evet, geri al</Button>
                        <Button size="sm" variant="secondary" onClick={() => setConfirmRollback(false)} disabled={busy !== null}>Vazgeç</Button>
                      </span>
                    ) : (
                      <Button variant="secondary" onClick={() => setConfirmRollback(true)} disabled={busy !== null}>
                        <Undo2 className="h-4 w-4" /> Bu içe aktarmayı geri al
                      </Button>
                    )
                  ) : null}
                </div>
                <Button
                  onClick={() => {
                    window.location.href =
                      target === "customers" ? "/app/musteriler" : target === "properties" ? "/app/portfoyler" : "/app/talepler";
                  }}
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  {target === "customers" ? "Müşteri listesine git" : target === "properties" ? "Portföy listesine git" : "Talep listesine git"}
                </Button>
              </div>
            </>
          )}
        </section>
      )}

      <ImportJournal batches={recent} rollbackAllowed={rollbackAllowed} />
    </div>
  );
}

/** Son içe aktarmalar — günlük + (yetkiliye) geri alma. Veriler audit kayıtlarından gelir. */
function ImportJournal({
  batches,
  rollbackAllowed,
}: {
  batches: ImportBatch[];
  rollbackAllowed: Record<ImportTarget, boolean>;
}) {
  const router = useRouter();
  const [confirmId, setConfirmId] = useState("");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const run = async (id: string) => {
    setBusyId(id);
    setError("");
    const res = await rollbackImport(id);
    setBusyId("");
    setConfirmId("");
    if (res.error) setError(res.error);
    else {
      setMessage(`Geri alındı: ${nf.format(res.removed ?? 0)} kayıt kaldırıldı${res.restored ? `, ${nf.format(res.restored)} kayıt eski haline döndü` : ""}.${res.warning ? ` ${res.warning}` : ""}`);
      router.refresh();
    }
  };

  return (
    <section className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-6">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-brand-600" />
        <h2 className="font-display font-bold text-ink-950">Son içe aktarmalar</h2>
      </div>
      {message ? <p className="text-xs font-semibold text-mint-600">{message}</p> : null}
      {error ? <p className="text-xs text-danger-600" role="alert">{error}</p> : null}
      {batches.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-3 text-xs text-text-muted">
          Henüz içe aktarma yapılmadı. Yaptığınız her aktarma burada listelenir ve yetkiliyseniz geri alınabilir.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="bg-canvas text-text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">Tarih</th>
                <th className="px-3 py-2 font-semibold">Hedef / dosya</th>
                <th className="px-3 py-2 font-semibold">Eklenen</th>
                <th className="px-3 py-2 font-semibold">Güncellenen</th>
                <th className="px-3 py-2 font-semibold">Atlanan / hatalı</th>
                <th className="px-3 py-2 font-semibold">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.batchId} className="border-t border-line align-top">
                  <td className="px-3 py-2 text-text-muted">{new Date(b.createdAt).toLocaleString("tr-TR")}</td>
                  <td className="px-3 py-2 text-ink-950">
                    {TARGET_LABEL[b.target]}
                    <span className="block text-text-faint">{b.fileName || "—"}{b.actorName ? ` · ${b.actorName}` : ""}</span>
                  </td>
                  <td className="numeric px-3 py-2">{nf.format(b.inserted)}</td>
                  <td className="numeric px-3 py-2">{nf.format(b.updated)}</td>
                  <td className="numeric px-3 py-2">{nf.format(b.skipped)} / {nf.format(b.failed)}</td>
                  <td className="px-3 py-2">
                    {b.rolledBack ? (
                      <span className="text-text-faint">Geri alındı</span>
                    ) : !rollbackAllowed[b.target] ? (
                      <span className="text-text-faint">Silme yetkisi gerekir</span>
                    ) : b.inserted + b.updated === 0 ? (
                      <span className="text-text-faint">—</span>
                    ) : confirmId === b.batchId ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => run(b.batchId)} loading={busyId === b.batchId}>Onayla</Button>
                        <Button size="sm" variant="secondary" onClick={() => setConfirmId("")} disabled={busyId !== ""}>Vazgeç</Button>
                      </span>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={() => setConfirmId(b.batchId)} disabled={busyId !== ""}>
                        <Undo2 className="h-3.5 w-3.5" /> Geri al
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="flex items-start gap-2 text-xs text-text-faint">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
        Geri alma yalnız o içe aktarmada OLUŞAN kayıtları kaldırır (müşteri/portföy yumuşak silinir, talep silinir) ve
        &quot;güncelle&quot; ile değişenleri eski değerine döndürür. Sonradan elle yapılan değişiklikler de kaybolur.
      </p>
    </section>
  );
}
