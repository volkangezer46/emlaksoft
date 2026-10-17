"use client";

import { formatDateTimeTr } from "@/lib/format";
import { financePath } from "@/lib/finance/routes";
import { PRIMARY_IMPORT_TARGETS } from "@/lib/import-start";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileWarning,
  History,
  KeyRound,
  ListChecks,
  Receipt,
  RefreshCw,
  Search,
  Sparkles,
  Undo2,
  UploadCloud,
  Users2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import {
  importChunk,
  type ImportOptions,
  type PlannedRowView,
} from "@/app/actions/import-data";
import { rollbackImport, type ImportBatch } from "@/app/actions/import-rollback";
// Görünüm yardımcıları bağımlılıksız modülden: doğrulama çekirdeği (telefon kuralları, talep ölçütleri) istemci paketine girmez.
import { buildIssueCsv, countPlanned, emptyCounters } from "@/lib/import-rows-view";
import type { DuplicatePolicy, ImportCounters, ImportRow, RowStatus } from "@/lib/import-rows";
import {
  buildTemplateCsv,
  detectPreset,
  FIELD_GROUPS,
  fieldsFor,
  googleContactsToTable,
  IMPORT_PRESETS,
  promoteHeaderRow,
  type ImportPreset,
  guessMapping,
  IMPORT_CHUNK_SIZE,
  IMPORT_MAX_FILE_BYTES,
  IMPORT_ROW_LIMIT,
  MAX_ERRORS_SHOWN,
  PREVIEW_ROWS,
  TARGET_LABEL,
  type ImportTarget,
  type ParsedCsv,
} from "./import-config";
import { isLegacyXls, isXlsxFile } from "@/lib/xlsx-import";
import { batches, crossChunkSeen, PREVIEW_BATCH_MAX } from "./preview-parallel";
import { previewImportChunks } from "./preview-actions";
import type { PickedContact } from "@/lib/vcard-import";
// Dosya/rehber ayrıştırıcıları (CSV, vCard, .xlsx) yalnız dosya seçilince yüklenir: ilk yük paketine girmez.
const loadFileReader = () => import("./file-read");
// Önizleme/sonuç tabloları ve fotoğraf indirici yalnız ilgili adımda yüklenir (ilk ekran 1. adımdır).
const SampleRowsTable = dynamic(() => import("./preview-tables").then((m) => m.SampleRowsTable), { loading: () => <TableSkeleton /> });
const IssueRowsTable = dynamic(() => import("./preview-tables").then((m) => m.IssueRowsTable), { loading: () => <TableSkeleton /> });
// 2. adımın açılır seçicileri (Radix + konumlandırma) dosya okununca önceden yüklenir (`preloadMappingControls`).
const loadMappingControls = () => import("./mapping-controls");
const loadCombobox = () => import("@/components/ui/combobox");
const ColumnSelect = dynamic(() => loadMappingControls().then((m) => m.ColumnSelect), { loading: () => <div className="h-10 rounded-[var(--radius-control)] border border-line bg-canvas" aria-hidden /> });
const Combobox = dynamic(() => loadCombobox().then((m) => m.Combobox), { loading: () => <div className="h-10 rounded-[var(--radius-control)] border border-line bg-canvas" aria-hidden /> });
function preloadMappingControls() {
  void loadMappingControls().catch(() => undefined);
  void loadCombobox().catch(() => undefined);
}
const PhotoImporter = dynamic(() => import("./photo-importer").then((m) => m.PhotoImporter));

function TableSkeleton() {
  return <div className="h-24 animate-pulse bg-canvas" aria-hidden />;
}
import { ContactPickButton } from "@/components/app/contact-pick-button";

/**
 * Dört adımlı içe aktarma sihirbazı (müşteri / portföy / talep ortak altyapı).
 *  1. Hedef + CSV dosyası — çözümleme tamamen istemcide.
 *  2. Kolon eşleme (otomatik tahmin + elle düzeltme) + mükerrer politikası + danışman.
 *  3. ÖNİZLEME: sunucuda yazmadan doğrulama (parça parça), sayaçlar, ilk 20 satır, sorunlu satırlar.
 *  4. Sonuç özeti, hatalı satırları CSV indirme, "bu içe aktarmayı geri al".
 *
 * .xlsx: `src/lib/xlsx-import.ts` (read-excel-file, yalnız dosya seçilince dinamik yüklenir; ilk sayfa, CSV ile aynı
 * çıktı biçimi). Eski .xls (BIFF) desteklenmez; hata mesajı .xlsx/CSV'ye yönlendirir.
 */

const NONE = "__none__";
const ME = "__me__";
const UNASSIGNED = "__unassigned__";

const TARGETS: { key: ImportTarget; desc: string; icon: typeof Users2 }[] = [
  { key: "customers", desc: "Ad soyad, telefon, e-posta, etiket, il, danışman. Telefon rehberi (.vcf) ve Google Kişiler dosyası da olur.", icon: Users2 },
  { key: "properties", desc: "Başlık, fiyat, il/ilçe/mahalle, m², kat, bina yaşı, açıklama, malik, ilan no, fotoğraf bağlantıları", icon: Building2 },
  { key: "demands", desc: "Müşteri telefonu/e-postası ile eşlenen alıcı/kiracı talepleri (bölge dahil)", icon: Search },
  { key: "tasks", desc: "Görev, son tarih, tür, öncelik; müşteri telefonu ile isteğe bağlı bağ", icon: ListChecks },
  { key: "appointments", desc: "Tarih-saat, randevu türü, konum; müşteri telefonu ile isteğe bağlı bağ", icon: CalendarDays },
  { key: "expenses", desc: "Gider başlığı, tutar, kategori, tarih", icon: Receipt },
  {
    key: "rentals",
    desc: "Aktif kira: portföy kodu, kiracı/malik (telefonla eşleşir, yoksa oluşturulur), kira, başlangıç. Kiralık anlaşma + komisyon birlikte kurulur; geri alınamaz.",
    icon: KeyRound,
  },
];

/** Bu türlerde "güncelle" politikası yoktur (kimlik anahtarı yok): yalnız atla / yeni oluştur. */
const NO_UPDATE_TARGETS: readonly ImportTarget[] = ["demands", "tasks", "appointments", "expenses", "rentals"];
/** Danışman ataması anlamsız olan türler. */
const NO_ASSIGNEE_TARGETS: readonly ImportTarget[] = ["demands", "expenses"];
const TARGET_LIST_HREF: Record<ImportTarget, string> = {
  customers: "/app/musteriler",
  properties: "/app/portfoyler",
  demands: "/app/talepler",
  tasks: "/app/gorevler",
  appointments: "/app/randevular",
  expenses: financePath(),
  rentals: "/app/kiralama",
};
const DUPLICATE_RULE: Record<ImportTarget, string> = {
  rentals: "Portföy kodu ile eşleşir; portföyde aktif kira varsa satır atlanır. Kiracı/malik telefonla aranır, yoksa oluşturulur.",
  customers: "Telefon, yoksa e-posta ile mevcut müşteri aranır.",
  properties: "Aynı portal ilan no, yoksa aynı başlık + adres mevcut portföy sayılır.",
  demands: "Aynı müşteri için aynı işlem/tür/oda/bütçeli aktif talep aynı kayıt sayılır.",
  tasks: "Aynı başlık + son tarih + müşteri mevcut görev sayılır.",
  appointments: "Aynı tarih-saat + tür + müşteri mevcut randevu sayılır.",
  expenses: "Aynı başlık + tutar + tarih mevcut gider sayılır.",
};

const POLICIES: { key: DuplicatePolicy; label: string; desc: string }[] = [
  { key: "skip", label: "Atla", desc: "Mevcut kayıtlara dokunma; zaten kayıtlı satırlar eklenmez." },
  { key: "update", label: "Güncelle", desc: "Mevcut kaydı dosyadaki dolu alanlarla güncelle (geri alınabilir)." },
  { key: "create", label: "Yeni oluştur", desc: "Zaten kayıtlı olsa da her satır için yeni kayıt aç." },
];


const nf = new Intl.NumberFormat("tr-TR");
const STEP_LABELS = ["Dosya ve tür", "Sütunları eşle", "Önizleme", "Sonuç"] as const;
/** Üstte büyük kart olarak gösterilen türler (C28); kalanlar "Diğer türler" altında katlı. */
const PRIMARY_TARGETS: readonly ImportTarget[] = PRIMARY_IMPORT_TARGETS;

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

/** Hedefin bu kullanıcıya açık olup olmadığı (kart ve `?hedef=` aynı kuralı kullanır). */
function targetAllowedFor(
  key: ImportTarget,
  p: { canImportProperties: boolean; canImportDemands: boolean; canImportActivity: { tasks: boolean; appointments: boolean; expenses: boolean; rentals?: boolean } },
): boolean {
  if (key === "properties") return p.canImportProperties;
  if (key === "demands") return p.canImportDemands;
  if (key === "tasks" || key === "appointments" || key === "expenses") return p.canImportActivity[key];
  if (key === "rentals") return p.canImportActivity.rentals === true;
  return true;
}

export type ImportWizardProps = {
  /** Adresten gelen hedef (`?hedef=`); yetki yoksa varsayılan (Müşteriler) kalır. */
  initialTarget?: ImportTarget;
  canImportProperties: boolean;
  canImportDemands: boolean;
  /** Görev / randevu / gider aktarımı: ilgili modülde oluşturma yetkisi. */
  canImportActivity?: { tasks: boolean; appointments: boolean; expenses: boolean; rentals?: boolean };
  /** Hedef bazında: mevcut kaydı güncelleme (edit) yetkisi. */
  updateAllowed: Record<ImportTarget, boolean>;
  /** Hedef bazında: geri alma (delete) yetkisi. */
  rollbackAllowed: Record<ImportTarget, boolean>;
  team: { id: string; name: string }[];
  recent: ImportBatch[];
  /** Fotoğraf bağlantısı indirilmeyi bekleyen portföyler (yarıda kalan önceki aktarma). */
  pendingPhotos?: { ids: string[]; urls: number };
};

export function ImportWizard({
  initialTarget,
  canImportProperties,
  canImportDemands,
  canImportActivity = { tasks: false, appointments: false, expenses: false },
  updateAllowed,
  rollbackAllowed,
  team,
  recent,
  pendingPhotos,
}: ImportWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [target, setTarget] = useState<ImportTarget>(() =>
    initialTarget && targetAllowedFor(initialTarget, { canImportProperties, canImportDemands, canImportActivity }) ? initialTarget : "customers",
  );
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
  const [preset, setPreset] = useState<ImportPreset | null>(null);
  const [photoQueue, setPhotoQueue] = useState<string[]>([]);
  const [ownersCreated, setOwnersCreated] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const targetAllowed = (t: { key: ImportTarget }) => targetAllowedFor(t.key, { canImportProperties, canImportDemands, canImportActivity });

  /** Okunan tablo: başlık satırı düzeltilir, hazır biçim (Google Kişiler, sahibinden) tanınır, hedef ona göre seçilir. */
  const acceptTable = (table: ParsedCsv, forced?: ImportPreset) => {
    let t = forced ? table : promoteHeaderRow(table);
    const p = forced ?? detectPreset(t.headers);
    if (p?.id === "google-contacts") t = googleContactsToTable(t);
    if (!t.headers.length || !t.rows.length) {
      setFileError(forced ? "Seçilen kişilerde ad ya da telefon/e-posta bulunamadı." : "Dosyada başlık satırı veya veri satırı bulunamadı.");
      return;
    }
    if (t.rows.length > IMPORT_ROW_LIMIT) {
      setFileError(
        `Dosyada ${nf.format(t.rows.length)} satır var; tek seferde en fazla ${nf.format(IMPORT_ROW_LIMIT)} satır aktarılabilir. Dosyayı bölerek yükleyin.`,
      );
      return;
    }
    setPreset(p);
    if (p && targetAllowed({ key: p.target })) setTarget(p.target);
    setParsed(t);
    preloadMappingControls();
  };

  const handlePicked = async (contacts: PickedContact[]) => {
    setFileError("");
    setParsed(null);
    setFileName(`Rehberden ${nf.format(contacts.length)} kişi`);
    try {
      const { pickedToTable } = await loadFileReader();
      acceptTable(pickedToTable(contacts), IMPORT_PRESETS["contact-picker"]);
    } catch {
      setFileError("Rehber okunamadı. Lütfen tekrar deneyin.");
    }
  };

  const fields = fieldsFor(target);
  const effectivePolicy: DuplicatePolicy =
    policy === "update" && (!updateAllowed[target] || NO_UPDATE_TARGETS.includes(target)) ? "skip" : policy;

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
    setPreset(null);
    setPhotoQueue([]);
    setOwnersCreated(0);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFile = (file: File) => {
    setFileError("");
    setParsed(null);
    setFileName(file.name);
    if (isLegacyXls(file)) {
      setFileError(
        "Eski Excel biçimi (.xls) desteklenmiyor. Excel'de \"Farklı Kaydet → Excel Çalışma Kitabı (.xlsx)\" ya da CSV olarak kaydedip yükleyin.",
      );
      return;
    }
    if (file.size > IMPORT_MAX_FILE_BYTES) {
      setFileError(`Dosya çok büyük (en fazla ${Math.round(IMPORT_MAX_FILE_BYTES / 1024 / 1024)} MB). Dosyayı bölüp ayrı ayrı yükleyin.`);
      return;
    }
    const excel = isXlsxFile(file);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        // Okuyucu (CSV / rehber / .xlsx) dinamik: kütüphaneler sayfa paketine girmez; çıktı aynı tablo biçimi.
        const { readImportBuffer } = await loadFileReader();
        const res = await readImportBuffer(reader.result as ArrayBuffer, { name: file.name, type: file.type, excel });
        if (res.kind === "error") {
          setFileError(res.message);
          return;
        }
        acceptTable(res.table, res.kind === "vcard" ? IMPORT_PRESETS.vcard : undefined);
      } catch {
        setFileError("Dosya okunamadı. Geçerli bir CSV, Excel (.xlsx) ya da rehber (.vcf) dosyası yükleyin.");
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
    // B049: parçalar 10'luk demetlerle gider, demet içinde SUNUCUDA 4 eşzamanlı önizlenir (Next.js istemcisi sunucu
    // eylemlerini sıraya koyduğundan paralellik sunucuda kurulur) ve dosya içi mükerrer durumu parçalar arasında TAŞINMAZ;
    // önceki parçalarla ortak anahtarı olan (nadir) parçalar küçük bir `seen` kümesiyle bir kez daha önizlenir (sonuç
    // sıralı akışla aynı).
    const parts = chunkRows(mappedRows, IMPORT_CHUNK_SIZE);
    const base = options();
    let done = 0;
    let total = parts.length;
    const run = async (indices: number[], seenFor: (i: number) => string[]) => {
      const out: Awaited<ReturnType<typeof previewImportChunks>> = [];
      for (const group of batches(indices, PREVIEW_BATCH_MAX)) {
        const res = await previewImportChunks(target, group.map((i) => parts[i]!), base, group.map(seenFor));
        out.push(...res);
        if (res.length !== group.length || res.some((r) => r.error || !r.rows)) break;
        done += group.length;
        setProgress(Math.min(100, Math.round((done / total) * 100)));
      }
      return out;
    };
    const failed = (res: { error?: string } | undefined) => {
      setStepError(res?.error ?? "Önizleme oluşturulamadı.");
      setBusy(null);
    };
    let all: PlannedRowView[];
    try {
      const first = await run(parts.map((_, i) => i), () => []);
      const bad = first.length !== parts.length ? first.find((r) => r.error) ?? first[0] : first.find((r) => r.error || !r.rows);
      if (bad) return failed(bad);
      const carry = crossChunkSeen(first.map((r) => r.seen ?? []));
      const rerun = carry.flatMap((keys, i) => (keys.length > 0 ? [i] : []));
      total += rerun.length;
      const second = await run(rerun, (i) => carry[i] ?? []);
      const badAgain = second.length !== rerun.length ? second.find((r) => r.error) ?? second[0] : second.find((r) => r.error || !r.rows);
      if (badAgain) return failed(badAgain);
      const byChunk = first.map((r) => r.rows ?? []);
      rerun.forEach((chunkIndex, j) => {
        byChunk[chunkIndex] = second[j]!.rows ?? [];
      });
      all = byChunk.flat();
    } catch {
      setStepError("Önizleme sırasında bağlantı hatası oluştu. Lütfen tekrar deneyin.");
      setBusy(null);
      return;
    }
    setProgress(100);
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
    const photos: string[] = [];
    let owners = 0;
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
        if (res.photoQueue?.length) photos.push(...res.photoQueue);
        owners += res.ownersCreated ?? 0;
        setProgress(Math.round(((i + 1) / parts.length) * 100));
      }
    } catch {
      setStepError("İçe aktarma sırasında bağlantı hatası oluştu. İşlenen kısım günlükte görünür; geri alabilirsiniz.");
    }
    setPlanned(all);
    setPhotoQueue(photos);
    setOwnersCreated(owners);
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
      {/* adım göstergesi: ilk adımda yok (hedef kartları ekranın en üstünde, C28) */}
      {step > 1 ? (
      <nav aria-label="İçe aktarma adımları" className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3">
        {/* Mobil: tek satır "Adım 2/4 · Kolon eşleme" + ilerleme çubuğu; geniş ekran: dört rozet. */}
        <div className="sm:hidden">
          <p className="text-xs font-semibold text-ink-950">
            Adım {step}/4 · {STEP_LABELS[step - 1]}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-canvas">
            <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${(step / 4) * 100}%` }} />
          </div>
        </div>
        <div className="hidden flex-wrap items-center gap-4 sm:flex">
          {stepBadge(1, STEP_LABELS[0])}
          <span className="h-px w-8 bg-line" />
          {stepBadge(2, STEP_LABELS[1])}
          <span className="h-px w-8 bg-line" />
          {stepBadge(3, STEP_LABELS[2])}
          <span className="h-px w-8 bg-line" />
          {stepBadge(4, STEP_LABELS[3])}
        </div>
      </nav>
      ) : null}

      {step === 1 && pendingPhotos && pendingPhotos.ids.length > 0 ? (
        <PhotoImporter ids={pendingPhotos.ids} totalUrls={pendingPhotos.urls} autoStart={false} resume />
      ) : null}

      {/* ADIM 1 — dosya + hedef */}
      {step === 1 && (
        <section className="dashboard-panel space-y-5 rounded-[var(--radius-panel)] border border-line bg-surface p-4 sm:p-6">
          <div>
            <h2 className="font-display text-lg font-bold text-ink-950">Ne taşıyorsunuz?</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-3" data-testid="ice-aktarma-hedefler">
              {TARGETS.filter((t) => PRIMARY_TARGETS.includes(t.key)).map((t) => (
                <TargetCard key={t.key} t={t} active={target === t.key} allowed={targetAllowed(t)} big onPick={() => setTarget(t.key)} />
              ))}
            </div>
            <details className="mt-3" open={!PRIMARY_TARGETS.includes(target) || undefined}>
              <summary className="focus-ring inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-brand-600">
                Diğer türler (görev, randevu, gider, kira)
              </summary>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {TARGETS.filter((t) => !PRIMARY_TARGETS.includes(t.key)).map((t) => (
                  <TargetCard key={t.key} t={t} active={target === t.key} allowed={targetAllowed(t)} onPick={() => setTarget(t.key)} />
                ))}
              </div>
            </details>
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
            <h2 className="font-display font-bold text-ink-950">Dosyanızı seçin</h2>
            <p className="text-sm text-text-muted">
              Excel (.xlsx), CSV ya da telefon rehberi (.vcf). Türkçe karakterler kendiliğinden tanınır. En fazla {nf.format(IMPORT_ROW_LIMIT)} satır;
              büyük dosyalar {IMPORT_CHUNK_SIZE}&apos;lik parçalarla işlenir.
            </p>
            <div className="mt-3 rounded-[var(--radius-card)] border border-brand-300/50 bg-brand-50/60 px-4 py-3 text-xs text-text-muted" data-testid="excel-csv-guide">
              <p className="font-semibold text-ink-950">Excel&apos;den CSV olarak kaydedip yükleyin</p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                <li>Excel&apos;de dosyanızı açın: Dosya, Farklı Kaydet.</li>
                <li>Türü &quot;CSV UTF-8 (virgülle ayrılmış)&quot; seçip kaydedin.</li>
                <li>Oluşan .csv dosyasını aşağıdan yükleyin. Excel çalışma kitabı (.xlsx) doğrudan da yüklenebilir (ilk sayfa okunur); eski .xls yüklenemez.</li>
              </ol>
              <p className="mt-1.5">Sütunları nasıl düzenleyeceğinizi görmek için aşağıdaki örnek şablonlardan birini indirin.</p>
              <p className="mt-1.5">
                <span className="font-semibold text-ink-950">Hazır biçimler:</span> sahibinden.com mağaza Excel&apos;i, Google Kişiler
                CSV&apos;si ve telefon rehberi (.vcf) dosyası doğrudan tanınır; sütunlar otomatik eşlenir.
              </p>
            </div>
            <label className="mt-3 block cursor-pointer rounded-[var(--radius-card)] border border-dashed border-line-strong bg-canvas px-6 py-10 text-center transition hover:border-brand-400">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.vcf,.vcard,text/vcard,text/x-vcard"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
              <UploadCloud className="mx-auto h-8 w-8 text-brand-600" />
              <p className="mt-2 text-sm font-semibold text-ink-950">{fileName || "Dosya seçmek için dokunun"}</p>
              <p className="mt-1 text-xs text-text-faint">.csv, .xlsx (ilk sayfa) veya telefon rehberi .vcf</p>
            </label>
            <ContactPickButton
              multiple
              onPick={handlePicked}
              label="Telefon rehberinden kişi seç"
              className="mt-3"
            />
            {fileError ? (
              <p className="mt-2 flex items-start gap-2 rounded-[var(--radius-card)] border border-danger-500/30 bg-danger-500/5 px-3 py-2.5 text-xs text-danger-600" role="alert">
                <FileWarning className="mt-0.5 h-4 w-4 shrink-0" /> {fileError}
              </p>
            ) : null}
            {parsed ? (
              <p className="mt-2 flex items-center gap-2 rounded-[var(--radius-card)] border border-mint-500/25 bg-mint-500/5 px-3 py-2.5 text-xs font-semibold text-mint-600">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                {preset?.target === "customers" && (preset.id === "vcard" || preset.id === "contact-picker")
                  ? `${nf.format(parsed.rows.length)} kişi okundu.`
                  : `${nf.format(parsed.rows.length)} veri satırı, ${parsed.headers.length} kolon okundu${parsed.delimiter === ";" ? " (ayraç: noktalı virgül)" : ""}.`}
              </p>
            ) : null}
            {parsed && preset ? <PresetNote preset={preset} target={target} /> : null}
          </div>

          {/* şablonlar */}
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <span className="text-xs font-semibold text-text-muted">Örnek şablon:</span>
            {(["customers", "properties", "demands", "tasks", "appointments", "expenses"] as const).map((k) => (
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
              Devam et
            </Button>
          </div>
        </section>
      )}

      {/* ADIM 2 — eşleme + politika */}
      {step === 2 && parsed && (
        <section className="dashboard-panel space-y-5 rounded-[var(--radius-panel)] border border-line bg-surface p-6">
          <div>
            <h2 className="font-display font-bold text-ink-950">Sütunları eşleyin</h2>
            <p className="text-xs text-text-muted">
              Dosyadaki sütunları {TARGET_LABEL[target].toLocaleLowerCase("tr-TR")} alanlarına eşleyin. Başlıklar Türkçe
              eşanlamlılarla otomatik tahmin edildi ({Object.keys(mapping).length}/{fields.length} alan); yanlışsa değiştirin.
            </p>
          </div>

          {(FIELD_GROUPS[target] ?? [{ label: "", keys: fields.map((f) => f.key) }]).map((group) => (
          <div key={group.label || "all"} className="space-y-2">
          {group.label ? (
            <h3 className="text-xs font-bold uppercase tracking-wide text-text-muted">
              {group.label}
              <span className="ml-2 font-semibold normal-case tracking-normal text-text-faint">
                {group.keys.filter((k) => mapping[k] !== undefined).length}/{group.keys.length} eşlendi
              </span>
            </h3>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {fields.filter((f) => group.keys.includes(f.key)).map((f) => (
              <FormField
                key={f.key}
                label={f.label}
                required={f.required}
                error={f.required && mapping[f.key] === undefined ? "Zorunlu alan — bir kolon seçin." : undefined}
              >
                <ColumnSelect
                  value={mapping[f.key] !== undefined ? String(mapping[f.key]) : NONE}
                  none={NONE}
                  headers={parsed.headers}
                  label={f.label}
                  onChange={(v) =>
                    setMapping((m) => {
                      const next = { ...m };
                      if (v === NONE) delete next[f.key];
                      else next[f.key] = Number(v);
                      return next;
                    })
                  }
                />
              </FormField>
            ))}
          </div>
          </div>
          ))}
          {target === "properties" && (mapping.photo_urls !== undefined || mapping.owner_phone !== undefined) ? (
            <p className="rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2.5 text-xs text-text-muted">
              {mapping.owner_phone !== undefined ? "Malik telefonu kayıtlı bir müşteriyle eşleşirse ona bağlanır; yoksa adıyla \"Mülk sahibi\" müşteri açılır. " : ""}
              {mapping.photo_urls !== undefined ? "Fotoğraf bağlantıları (yalnız https) aktarımdan sonra galeriye indirilir; bu sırada sayfayı açık tutun." : ""}
            </p>
          ) : null}
          {demandKeyMissing ? (
            <p className="flex items-start gap-2 rounded-[var(--radius-card)] border border-danger-500/30 bg-danger-500/5 px-3 py-2.5 text-xs text-danger-600" role="alert">
              <FileWarning className="mt-0.5 h-4 w-4 shrink-0" />
              Talepleri müşteriyle eşlemek için &quot;Müşteri telefonu&quot; veya &quot;Müşteri e-postası&quot; kolonlarından en az biri eşlenmeli.
            </p>
          ) : null}

          <div className="grid gap-5 border-t border-line pt-5 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-bold text-ink-950">Zaten kayıtlı satırlar ne olsun?</h3>
              <p className="text-xs text-text-muted">
                {DUPLICATE_RULE[target]}
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Zaten kayıtlı satırlar">
                {POLICIES.map((p) => {
                  const disabled = p.key === "update" && (!updateAllowed[target] || NO_UPDATE_TARGETS.includes(target));
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
                          {NO_UPDATE_TARGETS.includes(target) ? "Bu türde desteklenmez." : "Düzenleme yetkisi gerekir."}
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

            {!NO_ASSIGNEE_TARGETS.includes(target) ? (
              <FormField label="Danışman ataması" hint="Yeni oluşan kayıtların sorumlusu.">
                <Combobox
                  value={assignee}
                  onValueChange={setAssignee}
                  aria-label="Danışman ataması"
                  clearable={false}
                  placeholder="Danışman seçin"
                  searchPlaceholder="Danışman ara…"
                  emptyText="Eşleşen danışman yok"
                  options={[
                    { value: ME, label: "Ben (içe aktaran kullanıcı)" },
                    { value: UNASSIGNED, label: "Danışmansız bırak" },
                    ...team.map((m) => ({ value: m.id, label: m.name })),
                  ]}
                />
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
              {fileName} · {TARGET_LABEL[target]} · {nf.format(counters.total)} satır · kayıtlı olanlar:{" "}
              {POLICIES.find((p) => p.key === effectivePolicy)?.label}
            </p>
          </div>

          <CounterCards c={counters} labels={["Yeni", "Güncellenecek", "Atlanacak (zaten kayıtlı)", "Hatalı"]} />

          <div>
            <h3 className="text-sm font-bold text-ink-950">İlk {PREVIEW_ROWS} satır (doğrulanmış haliyle)</h3>
            <div className="relative mt-2 overflow-x-auto rounded-[var(--radius-card)] border border-line">
              <SampleRowsTable rows={planned.slice(0, PREVIEW_ROWS)} />
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
                    className={`focus-ring rounded-full border px-3 py-1 text-xs font-semibold transition touch:min-h-11 ${
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
                <IssueRowsTable rows={shownRows.slice(0, MAX_ERRORS_SHOWN)} />
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
              {ownersCreated > 0 ? (
                <p className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2.5 text-xs text-text-muted">
                  <Users2 className="h-4 w-4 shrink-0 text-brand-600" />
                  Dosyadaki malikler için {nf.format(ownersCreated)} yeni &quot;Mülk sahibi&quot; müşteri açıldı ve portföylere bağlandı.
                </p>
              ) : null}
              {photoQueue.length > 0 && !rolledBack ? <PhotoImporter ids={photoQueue} autoStart /> : null}

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
                    <IssueRowsTable rows={planned.filter((r) => r.status === "error" || r.status === "skip").slice(0, MAX_ERRORS_SHOWN)} />
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
                    window.location.href = TARGET_LIST_HREF[target];
                  }}
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  {`${TARGET_LABEL[target]} listesine git`}
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
        <div className="relative overflow-x-auto rounded-[var(--radius-card)] border border-line">
          <Table className="w-full min-w-[640px] text-left text-xs">
            <THead className="bg-canvas text-text-muted">
              <TR>
                <TH className="px-3 py-2 font-semibold">Tarih</TH>
                <TH className="px-3 py-2 font-semibold">Hedef / dosya</TH>
                <TH className="px-3 py-2 font-semibold">Eklenen</TH>
                <TH className="px-3 py-2 font-semibold">Güncellenen</TH>
                <TH className="px-3 py-2 font-semibold">Atlanan / hatalı</TH>
                <TH className="px-3 py-2 font-semibold">İşlem</TH>
              </TR>
            </THead>
            <TBody>
              {batches.map((b) => (
                <TR key={b.batchId} className="border-t border-line align-top">
                  <TD className="px-3 py-2 text-text-muted">{formatDateTimeTr(b.createdAt)}</TD>
                  <TD className="px-3 py-2 text-ink-950">
                    {TARGET_LABEL[b.target]}
                    <span className="block text-text-faint">{b.fileName || "—"}{b.actorName ? ` · ${b.actorName}` : ""}</span>
                  </TD>
                  <TD className="numeric px-3 py-2">{nf.format(b.inserted)}</TD>
                  <TD className="numeric px-3 py-2">{nf.format(b.updated)}</TD>
                  <TD className="numeric px-3 py-2">{nf.format(b.skipped)} / {nf.format(b.failed)}</TD>
                  <TD className="px-3 py-2">
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
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
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

/** Tanınan hazır biçim bildirimi (+ rehber aktarımında KVKK aydınlatma hatırlatması). */
/** İçe aktarma türü kartı: üstteki üç tür büyük (`big`), diğerleri katlı listede. Yetkisiz tür açıklamayla pasif görünür. */
function TargetCard({
  t,
  active,
  allowed,
  big = false,
  onPick,
}: {
  t: { key: ImportTarget; desc: string; icon: typeof Users2 };
  active: boolean;
  allowed: boolean;
  big?: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!allowed}
      aria-pressed={active}
      aria-describedby={!allowed ? `${t.key}-import-permission-note` : undefined}
      data-import-target={t.key}
      onClick={() => {
        if (allowed) onPick();
      }}
      className={`focus-ring press flex items-start gap-3 rounded-[var(--radius-card)] border text-left transition ${big ? "min-h-24 p-4 sm:flex-col" : "min-h-11 p-3"} ${
        active ? "border-brand-400 bg-brand-600/[0.06]" : "border-line bg-canvas hover:border-brand-300"
      } disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:border-line`}
    >
      <span className={`grid shrink-0 place-items-center rounded-[var(--radius-card)] ${big ? "h-11 w-11" : "h-9 w-9"} ${active ? "bg-brand-600 text-white" : "bg-brand-600/10 text-brand-600"}`}>
        <t.icon className="h-5 w-5" aria-hidden />
      </span>
      <span>
        <span className={`block font-bold text-ink-950 ${big ? "text-base" : "text-sm"}`}>{TARGET_LABEL[t.key]}</span>
        <span className="mt-0.5 block text-sm text-text-muted">
          {allowed
            ? t.desc
            : t.key === "properties"
              ? "Portföy ekleme yetkisi gerekir."
              : t.key === "demands"
                ? "Talep ekleme yetkisi gerekir."
                : `${TARGET_LABEL[t.key]} için ekleme yetkisi gerekir.`}
        </span>
      </span>
    </button>
  );
}

function PresetNote({ preset, target }: { preset: ImportPreset; target: ImportTarget }) {
  const contacts = preset.id === "vcard" || preset.id === "contact-picker" || preset.id === "google-contacts";
  return (
    <div className="mt-2 space-y-1.5 rounded-[var(--radius-card)] border border-brand-300/50 bg-brand-600/[0.04] px-3 py-2.5 text-xs text-text-muted">
      <p className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
        <span>
          <span className="font-semibold text-ink-950">{preset.label} tanındı.</span> {preset.note}
          {preset.target !== target ? ` Hedef olarak "${TARGET_LABEL[preset.target]}" seçmeniz önerilir.` : ""}
        </span>
      </p>
      {contacts ? (
        <p className="pl-6">
          KVKK: Rehberdeki kişileri müşteri olarak kaydetmeden önce kişilerin aydınlatıldığından emin olun. Kayıtların kaynağı
          &quot;İçe aktarma&quot; olarak işaretlenir; telefonu kayıtlı kişiler varsayılan olarak atlanır.
        </p>
      ) : null}
    </div>
  );
}
