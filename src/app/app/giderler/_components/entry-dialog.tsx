"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownCircle,
  ArrowLeftRight,
  ArrowUpCircle,
  CalendarClock,
  Check,
  ChevronDown,
  Loader2,
  Paperclip,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { recordCashEntry, transferBetweenAccounts } from "@/app/actions/finance-accounts";
import { createOpenItem, linkAttachment, recordEntryV2 } from "@/app/actions/finance-ledger";
import { createRecurringRule } from "@/app/actions/recurring-rules";
import { searchProperties } from "@/app/actions/lookup";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { FormError, FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import Link from "@/components/ui/smart-link";
import { Switch } from "@/components/ui/switch";
import { CASH_CATEGORIES, SALARY_CATEGORY } from "@/lib/finance/cash/categories";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import { formatAmountInput, parseAmountShorthand } from "@/lib/finance/amount-shorthand";
import { LEDGER_VAT_RATES, RENT_WITHHOLDING_RATE, entryAmounts, splitVat } from "@/lib/finance/ledger/vat";
import { nextMonthStartKey } from "@/lib/finance/recurring/rules";
import { hasSmartSignal, parseSmartEntry, shiftDayKey, type SmartEntry } from "@/lib/finance/smart-entry";
import { cn } from "@/lib/utils";
import { PartyPicker } from "../cari/party-picker";
import type { AccountOption, EntryCategoryOption, EntryDirection, NewEntryDetail, RuleSuggestFn, RuleSuggestion } from "../quick-entry";

/**
 * "Yeni kayıt" penceresi (quick-entry v2). Yalnız açılınca iner (`next/dynamic`, quick-entry.tsx).
 *
 * Akış: Gelir / Gider / Transfer → (isteğe bağlı) tek satır akıllı giriş → tutar → "Ne için?" çipleri → hesap.
 * Ofis kipinde ek olarak: cari (PartyPicker), Ödendi / Vadeli (vadeli = açık kalem; hareket OLUŞMAZ), KDV dahil/hariç ve oran,
 * kira için %20 stopaj önerisi, portföy, dosya eki (FN5 ucu) ve kurala dayalı kategori önerisi. Kişisel hesap (Kasam) eski
 * `recordCashEntry` yolunu kullanır; davranışı değişmez.
 */

const LAST_ACCOUNT_KEY = "emlaksoft:finance:last-account";
const UPLOAD_URL = "/api/app/finans/belge";
const UPLOAD_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

type ActionResult = { ok?: boolean; error?: string; id?: string; info?: string } | null | undefined;

function errorOf(res: ActionResult): string | null {
  if (!res) return "İşlem tamamlanamadı.";
  if (typeof res.error === "string" && res.error) return res.error;
  if (res.ok === false) return "İşlem tamamlanamadı.";
  return null;
}

function readLastAccount(): string {
  try {
    return window.localStorage.getItem(LAST_ACCOUNT_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberAccount(id: string) {
  try {
    window.localStorage.setItem(LAST_ACCOUNT_KEY, id);
  } catch {
    /* tercih saklanamadı: sorun değil */
  }
}

function initialAccount(accounts: readonly AccountOption[]): string {
  const saved = readLastAccount();
  if (accounts.some((a) => a.id === saved)) return saved;
  return (accounts.find((a) => a.scope === "office" && a.kind === "cash") ?? accounts[0])?.id ?? "";
}

type UploadState =
  | { status: "idle" }
  | { status: "uploading"; name: string; progress: number }
  | { status: "done"; name: string; id: string }
  | { status: "error"; name: string; error: string };

type UploadResponse = { ok?: boolean; id?: string; error?: string; ocr?: { amount?: number; date?: string; vatRate?: number; vendor?: string } };

/** Aynı kökene çok parçalı yükleme (ilerleme çubuğu için XHR). Dönüş FN5 ucunun sözleşmesidir. */
function uploadAttachment(file: File, onProgress: (p: number) => void): Promise<UploadResponse> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const body = new FormData();
    body.append("file", file);
    xhr.open("POST", UPLOAD_URL);
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

const DIRECTIONS: { id: EntryDirection; label: string; icon: typeof ArrowDownCircle; tone: string }[] = [
  { id: "in", label: "Gelir", icon: ArrowDownCircle, tone: "data-[on=true]:bg-mint-600 data-[on=true]:text-white" },
  { id: "out", label: "Gider", icon: ArrowUpCircle, tone: "data-[on=true]:bg-ink-950 data-[on=true]:text-white" },
  { id: "transfer", label: "Transfer", icon: ArrowLeftRight, tone: "data-[on=true]:bg-brand-600 data-[on=true]:text-white" },
];

function chipClass(on: boolean) {
  return cn(
    "focus-ring press inline-flex min-h-9 touch:min-h-11 items-center gap-1 rounded-full border px-3 text-xs font-semibold transition",
    on ? "border-ink-950 bg-ink-950 text-white" : "border-line bg-surface text-text-muted hover:border-brand-300 hover:text-ink-950",
  );
}

export function EntryDialog({
  initial,
  accounts,
  defaultDate,
  canSalary,
  office,
  categories: categoriesProp,
  suggestRule,
  onClose,
}: {
  initial: NewEntryDetail;
  accounts: readonly AccountOption[];
  defaultDate: string;
  canSalary: boolean;
  office: boolean;
  categories?: readonly EntryCategoryOption[];
  suggestRule?: RuleSuggestFn;
  onClose: () => void;
}) {
  const router = useRouter();
  const { push } = useToast();

  const allCategories = useMemo<readonly EntryCategoryOption[]>(
    () =>
      (categoriesProp && categoriesProp.length > 0
        ? categoriesProp
        : CASH_CATEGORIES.map((c) => ({ value: c.value, label: c.label, direction: c.direction }))
      ).filter((c) => canSalary || c.value !== SALARY_CATEGORY),
    [categoriesProp, canSalary],
  );

  // Başlangıç değerleri: olay ayrıntısı + (komut çubuğundan gelen) tek satır metin bir kez ayrıştırılır.
  const [seed] = useState(() => {
    const parsed = initial.text ? parseSmartEntry(initial.text, allCategories.map((c) => ({ value: c.value, label: c.label, direction: c.direction }))) : null;
    return { parsed: parsed && hasSmartSignal(parsed) ? parsed : null };
  });
  const sp = seed.parsed;
  const [direction, setDirection] = useState<EntryDirection>(sp?.direction ?? initial.direction ?? (initial.openItemId ? "in" : "out"));
  const [amountText, setAmountText] = useState(() => {
    const a = sp?.amount ?? initial.amount;
    return a ? formatAmountInput(a) : "";
  });
  const [category, setCategory] = useState(sp?.category ?? "");
  const [title, setTitle] = useState(sp?.title ?? "");
  const [accountId, setAccountId] = useState(() => initialAccount(accounts));
  const [toAccountId, setToAccountId] = useState("");
  const [date, setDate] = useState(sp?.dayOffset != null ? shiftDayKey(defaultDate, sp.dayOffset) : defaultDate);
  const [showDate, setShowDate] = useState(sp?.dayOffset != null && sp.dayOffset !== 0);
  const [deferred, setDeferred] = useState(sp?.deferred ?? false);
  const [dueDate, setDueDate] = useState(() => shiftDayKey(defaultDate, sp?.dueInDays ?? 30));
  const [partyName, setPartyName] = useState<string | null>(sp?.partyName ?? null);
  const [pickedParty, setPickedParty] = useState<string | null>(null);
  const [vatRate, setVatRate] = useState<number | null>(sp?.vatRate ?? null);
  const [vatIncluded, setVatIncluded] = useState(sp?.vatIncluded ?? true);
  const [withholdingRate, setWithholdingRate] = useState<number | null>(null);
  const [repeat, setRepeat] = useState(false);
  const [repeatMode, setRepeatMode] = useState<"auto" | "approve">("auto");
  const [smartText, setSmartText] = useState(initial.text ?? "");
  const [smart, setSmart] = useState<SmartEntry | null>(sp);
  const [suggestion, setSuggestion] = useState<RuleSuggestion | null>(null);
  const [upload, setUpload] = useState<UploadState>(initial.attachmentId ? { status: "done", name: "Seçilen belge", id: initial.attachmentId } : { status: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const categoryTouched = useRef(Boolean(sp?.category));

  const chosen = accounts.find((a) => a.id === accountId);
  const personal = chosen?.scope === "user";
  const officeMode = office && !personal;
  const isTransfer = direction === "transfer";
  const amount = parseAmountShorthand(amountText);
  const currency = chosen?.currency ?? "TRY";
  const cats = isTransfer ? [] : allCategories.filter((c) => c.direction === direction);
  const catMeta = allCategories.find((c) => c.value === category && c.direction === direction) ?? null;
  const isRent = direction === "out" && (category === "kira" || catMeta?.label.toLocaleLowerCase("tr-TR").includes("kira") === true);
  // Stopaj ÖNERİSİ (otomatik uygulanmaz): kategorinin varsayılan oranı, yoksa kira için %20.
  const suggestedWh = direction === "out" ? (catMeta?.withholdingRate ?? (isRent ? RENT_WITHHOLDING_RATE : null)) : null;
  const partyKind = direction === "in" ? (category === "kira_tahsilat" ? "kiraci" : "musteri") : "tedarikci";
  const officeAccounts = accounts.filter((a) => a.scope === "office");
  const personalAccounts = accounts.filter((a) => a.scope === "user");
  const accountOptions = [
    ...officeAccounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})`, hint: "Ofis hesabı" })),
    ...personalAccounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})`, hint: "Kişisel hesabım" })),
  ];
  const vatPreview = officeMode && !isTransfer && amount != null && vatRate != null && vatRate > 0 ? splitVat(amount, vatRate, vatIncluded) : null;
  // Stopaj KDV hariç net üzerinden kesilir; hesaptan çıkan nakit = brüt − stopaj (DB `finance_entry_amounts` ile aynı hesap).
  const whPreview = officeMode && !isTransfer && amount != null && withholdingRate ? entryAmounts(amount, vatRate, vatIncluded, withholdingRate) : null;

  // Kategori varsayılan KDV/stopaj oranı (ofis kategorisi tanımından); kullanıcı oranı elle seçtiyse dokunulmaz.
  function pickCategory(value: string) {
    categoryTouched.current = true;
    setCategory(value);
    setSuggestion(null);
    const meta = allCategories.find((c) => c.value === value && c.direction === direction);
    if (meta?.vatRate != null && vatRate == null) setVatRate(meta.vatRate);
  }

  function changeDirection(next: EntryDirection) {
    setDirection(next);
    if (!allCategories.some((c) => c.value === category && c.direction === next)) setCategory("");
    if (next === "transfer") {
      setDeferred(false);
      setRepeat(false);
    }
    setSuggestion(null);
  }

  function applySmart(text: string) {
    setSmartText(text);
    const parsed = parseSmartEntry(
      text,
      allCategories.map((c) => ({ value: c.value, label: c.label, direction: c.direction })),
    );
    setSmart(hasSmartSignal(parsed) ? parsed : null);
    if (parsed.direction) setDirection(parsed.direction);
    if (parsed.amount != null) setAmountText(formatAmountInput(parsed.amount));
    if (parsed.category) {
      categoryTouched.current = true;
      setCategory(parsed.category);
    }
    if (parsed.title) setTitle(parsed.title);
    if (parsed.partyName) {
      setPartyName(parsed.partyName);
    }
    if (parsed.vatRate != null) setVatRate(parsed.vatRate);
    if (parsed.vatIncluded != null) setVatIncluded(parsed.vatIncluded);
    if (parsed.deferred) {
      setDeferred(true);
      if (parsed.dueInDays != null) setDueDate(shiftDayKey(defaultDate, parsed.dueInDays));
    }
    if (parsed.dayOffset != null) {
      setDate(shiftDayKey(defaultDate, parsed.dayOffset));
      setShowDate(parsed.dayOffset !== 0);
    }
  }

  // Kurala dayalı kategori önerisi (finance_rule_suggest): açıklama/cari yazıldıkça, kategori elle seçilmemişse.
  const suggestKey = `${direction}|${title}|${pickedParty ?? partyName ?? ""}|${amount ?? ""}`;
  useEffect(() => {
    if (!suggestRule || !officeMode || isTransfer || categoryTouched.current) return;
    const text = [title, pickedParty ?? partyName].filter(Boolean).join(" ").trim();
    if (text.length < 3) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      suggestRule({ text, amount, direction: direction === "in" ? "in" : "out" })
        .then((s) => {
          if (cancelled || !s || categoryTouched.current) return;
          if (!allCategories.some((c) => c.value === s.category && c.direction === direction)) return;
          if (s.mode === "auto") {
            setCategory(s.category);
            setSuggestion({ ...s, mode: "auto" });
          } else setSuggestion(s);
        })
        .catch(() => undefined);
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestKey, suggestRule, officeMode]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!UPLOAD_ACCEPT.split(",").includes(file.type)) {
      setUpload({ status: "error", name: file.name, error: "JPEG, PNG, WEBP görsel veya PDF seçin." });
      return;
    }
    if (file.size <= 0 || file.size > UPLOAD_MAX_BYTES) {
      setUpload({ status: "error", name: file.name, error: "Dosya en fazla 10 MB olabilir." });
      return;
    }
    setUpload({ status: "uploading", name: file.name, progress: 0 });
    const res = await uploadAttachment(file, (progress) => setUpload({ status: "uploading", name: file.name, progress }));
    if (!res.ok || !res.id) {
      setUpload({ status: "error", name: file.name, error: res.error ?? "Dosya yüklenemedi." });
      return;
    }
    setUpload({ status: "done", name: file.name, id: res.id });
    // Fiş okuma açıksa (varsayılan kapalı) boş alanlar önerilen değerlerle dolar; dolu alana dokunulmaz.
    const ocr = res.ocr;
    if (ocr) {
      if (ocr.amount && !amountText) setAmountText(formatAmountInput(ocr.amount));
      if (ocr.date && /^\d{4}-\d{2}-\d{2}$/.test(ocr.date) && ocr.date <= defaultDate) {
        setDate(ocr.date);
        setShowDate(true);
      }
      if (ocr.vatRate != null && vatRate == null) setVatRate(ocr.vatRate);
      if (ocr.vendor && !partyName) {
        setPartyName(ocr.vendor);
      }
      push("Fişten okunan bilgiler boş alanlara yazıldı; kontrol edin.", "ok");
    }
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    // Aynı karede görsel tepki: düğme hemen "kaydediliyor" durumuna geçer.
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const note = String(fd.get("note") ?? "").trim();
    const propertyId = String(fd.get("property_id") ?? "").trim() || null;
    const partyRaw = String(fd.get("party") ?? "").trim();
    const isUuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(partyRaw);
    const partyId = isUuidLike ? partyRaw : initial.partyId && !partyRaw ? initial.partyId : null;
    const newPartyName = !partyId ? (partyRaw || partyName || "").trim() || null : null;
    const attachmentId = upload.status === "done" ? upload.id : null;
    const catLabel = catMeta?.label ?? "";
    const entryTitle = title.trim() || catLabel;

    try {
      if (amount == null) {
        setError("Geçerli bir tutar girin (ör. 1.250,50 · 48k · 1,2m).");
        return;
      }

      // Transfer: iki hesap arası (eski RPC; bakiyeler aynı kalır).
      if (isTransfer) {
        if (!accountId || !toAccountId) {
          setError("Kaynak ve hedef hesabı seçin.");
          return;
        }
        const res = await transferBetweenAccounts({ fromAccountId: accountId, toAccountId, amount, date, note });
        const err = errorOf(res);
        if (err) {
          setError(err);
          return;
        }
        rememberAccount(accountId);
        push("Transfer kaydedildi", "ok");
        onClose();
        router.refresh();
        return;
      }

      if (!category) {
        setError("Ne için olduğunu seçin.");
        return;
      }

      // Kişisel hesap (Kasam) ya da ofis kipi kapalı: eski yol aynen.
      if (!officeMode) {
        if (!accountId) {
          setError("Hesap seçin.");
          return;
        }
        const res = await recordCashEntry(direction, {
          accountId,
          amount: String(amount),
          category,
          title: title.trim(),
          date,
          counterparty: partyName ?? "",
          documentUrl: String(fd.get("documentUrl") ?? ""),
          note,
          repeatMonthly: repeat,
          repeatDay: String(fd.get("repeatDay") ?? ""),
          repeatMode,
        });
        const err = errorOf(res);
        if (err) {
          setError(err);
          return;
        }
        rememberAccount(accountId);
        push(direction === "in" ? "Gelir kaydedildi" : "Gider kaydedildi", "ok");
        if (res?.info) push(res.info, "err");
        else if (repeat) push("Gelecek aydan itibaren her ay tekrarlanacak", "ok");
        onClose();
        router.refresh();
        return;
      }

      // Vadeli: hareket OLUŞMAZ; açık kalem (alacak/borç) açılır, Genel bakışta "Tahsil edilecek / Ödenecek"e yansır.
      if (deferred) {
        if (!partyId && !newPartyName) {
          setError("Vadeli kayıt için cari (kişi ya da firma) seçin.");
          return;
        }
        if (!dueDate || dueDate < date) {
          setError("Vade tarihi kayıt tarihinden önce olamaz.");
          return;
        }
        const res = (await createOpenItem({
          direction: direction === "in" ? "receivable" : "payable",
          partyId,
          partyName: newPartyName,
          partyKind,
          title: entryTitle,
          category,
          currency: currency === "USD" || currency === "EUR" ? currency : "TRY",
          amount: vatPreview ? vatPreview.gross : amount,
          vatRate,
          withholdingRate,
          issueDate: date,
          dueDate,
          propertyId,
          note: note || null,
        })) as ActionResult;
        const err = errorOf(res);
        if (err) {
          setError(err);
          return;
        }
        if (attachmentId && res?.id) await linkAttachment(attachmentId, { openItemId: res.id });
        push(direction === "in" ? "Alacak kaydedildi (vadeli)" : "Borç kaydedildi (vadeli)", "ok");
        onClose();
        router.refresh();
        return;
      }

      if (!accountId) {
        setError("Hesap seçin.");
        return;
      }
      const res = (await recordEntryV2({
        accountId,
        direction,
        amount,
        entryDate: date,
        category,
        title: title.trim() || null,
        partyId,
        partyName: newPartyName,
        partyKind,
        counterparty: partyId ? null : newPartyName,
        vatRate,
        vatIncluded,
        withholdingRate,
        propertyId,
        openItemId: initial.openItemId ?? null,
        note: note || null,
        attachmentIds: attachmentId ? [attachmentId] : [],
        ruleId: suggestion && suggestion.category === category ? suggestion.ruleId : null,
      })) as ActionResult;
      const err = errorOf(res);
      if (err) {
        setError(err);
        return;
      }
      rememberAccount(accountId);
      push(direction === "in" ? "Gelir kaydedildi" : "Gider kaydedildi", "ok");
      if (repeat) {
        const rule = await createRecurringRule({
          accountId,
          direction,
          category,
          title: entryTitle,
          amount,
          payDay: Number(fd.get("repeatDay")) || Number(date.slice(8, 10)),
          mode: repeatMode,
          startDate: nextMonthStartKey(defaultDate),
        });
        if (rule.error) push(`Kayıt yapıldı ama her ay tekrarı kurulamadı: ${rule.error}`, "err");
        else push("Gelecek aydan itibaren her ay tekrarlanacak", "ok");
      }
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const headerTitle = isTransfer ? "Transfer" : direction === "in" ? "Yeni gelir" : "Yeni gider";
  const saveLabel = isTransfer ? "Transferi kaydet" : deferred && officeMode ? (direction === "in" ? "Alacağı kaydet" : "Borcu kaydet") : direction === "in" ? "Geliri kaydet" : "Gideri kaydet";
  const needsAccount = isTransfer || !(deferred && officeMode);

  return (
    <Dialog open onOpenChange={(v) => (v ? undefined : onClose())}>
      <DialogContent
        size="lg"
        overlayClassName="p-0 sm:p-4"
        className="self-end rounded-b-none sm:self-auto sm:rounded-[var(--radius-panel)]"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          amountRef.current?.focus();
        }}
      >
        <DialogHeader
          title={headerTitle}
          description={office ? "Tek satır yazın ya da alanları doldurun. Ctrl K komutlar, Esc kapatır." : "Tutar, ne için ve hangi hesap; gerisi isteğe bağlı."}
          icon={isTransfer ? <ArrowLeftRight /> : direction === "in" ? <ArrowDownCircle /> : <ArrowUpCircle />}
        />
        {accounts.length === 0 && !office ? (
          <DialogBody>
            <p className="text-sm text-text-muted">Önce bir hesap açın (örneğin kasa); hareketler hesaba yazılır.</p>
          </DialogBody>
        ) : (
          <form onSubmit={submit} noValidate>
            <DialogBody className="grid max-h-[70dvh] gap-4 overflow-y-auto overscroll-contain sm:max-h-[65vh]">
              {/* Yön seçimi */}
              <div className="grid grid-cols-3 gap-1 rounded-full border border-line bg-canvas p-1" role="radiogroup" aria-label="Kayıt türü">
                {DIRECTIONS.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    role="radio"
                    aria-checked={direction === d.id}
                    data-on={direction === d.id}
                    onClick={() => changeDirection(d.id)}
                    className={cn("focus-ring press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full text-sm font-semibold text-text-muted transition", d.tone)}
                  >
                    <d.icon className="h-4 w-4" aria-hidden="true" />
                    {d.label}
                    {office ? <kbd className="ml-1 hidden rounded border border-current/30 px-1 text-xs opacity-60 sm:inline">{d.id === "in" ? "G" : d.id === "out" ? "E" : "T"}</kbd> : null}
                  </button>
                ))}
              </div>

              {/* Tek satır akıllı giriş */}
              {!isTransfer ? (
                <div>
                  <label htmlFor="qe-smart" className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-text-muted">
                    <Sparkles className="h-3.5 w-3.5 text-accent-text" aria-hidden="true" /> Tek satırda yazın
                  </label>
                  <FormInput
                    id="qe-smart"
                    value={smartText}
                    onChange={(e) => applySmart(e.target.value)}
                    autoComplete="off"
                    maxLength={300}
                    placeholder="ör. gider 4.500 portal sahibinden · + 48k komisyon Ahmet Yılmaz"
                  />
                  {smart ? (
                    <ul className="mt-1.5 flex flex-wrap gap-1 text-xs" aria-label="Anlaşılanlar">
                      {smart.direction ? <li className="rounded-full bg-surface-accent-soft px-2 py-0.5 font-semibold text-accent-text">{smart.direction === "in" ? "Gelir" : smart.direction === "out" ? "Gider" : "Transfer"}</li> : null}
                      {smart.amount != null ? <li className="numeric rounded-full bg-surface-accent-soft px-2 py-0.5 font-semibold text-accent-text">{formatAccountMoney(smart.amount, currency)}</li> : null}
                      {smart.category ? <li className="rounded-full bg-surface-accent-soft px-2 py-0.5 font-semibold text-accent-text">{allCategories.find((c) => c.value === smart.category)?.label ?? smart.category}</li> : null}
                      {smart.partyName ? <li className="rounded-full bg-surface-accent-soft px-2 py-0.5 font-semibold text-accent-text">Cari: {smart.partyName}</li> : null}
                      {smart.vatRate != null ? <li className="rounded-full bg-surface-accent-soft px-2 py-0.5 font-semibold text-accent-text">KDV %{smart.vatRate}</li> : null}
                      {smart.deferred ? <li className="rounded-full bg-surface-accent-soft px-2 py-0.5 font-semibold text-accent-text">Vadeli</li> : null}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              <FormField label="Tutar" htmlFor="qe-amount" required hint={amount != null && amountText && formatAmountInput(amount) !== amountText ? `= ${formatAccountMoney(amount, currency)}` : "1.234,56 · 48k · 1,2m yazabilirsiniz"}>
                <FormInput
                  ref={amountRef}
                  id="qe-amount"
                  name="amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0,00"
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value)}
                  onBlur={() => (amount != null ? setAmountText(formatAmountInput(amount)) : undefined)}
                  className="numeric text-lg font-bold"
                />
              </FormField>

              {!isTransfer ? (
                <div>
                  <p className="mb-1.5 text-sm font-medium text-ink-950">
                    Ne için? <span aria-hidden="true" className="text-danger-500">*</span>
                  </p>
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Ne için">
                    {cats.map((c) => (
                      <button key={c.value} type="button" role="radio" aria-checked={category === c.value} onClick={() => pickCategory(c.value)} className={chipClass(category === c.value)}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                  {suggestion && suggestion.category !== category ? (
                    <button
                      type="button"
                      onClick={() => pickCategory(suggestion.category)}
                      className="focus-ring mt-2 inline-flex min-h-9 touch:min-h-11 items-center gap-1.5 rounded-full border border-dashed border-brand-300 px-3 text-xs font-semibold text-accent-text hover:bg-surface-accent-soft"
                    >
                      <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Kurala göre öneri: {allCategories.find((c) => c.value === suggestion.category)?.label ?? suggestion.category}
                    </button>
                  ) : suggestion?.mode === "auto" && suggestion.category === category ? (
                    <p className="mt-1.5 flex items-center gap-1 text-xs text-text-muted">
                      <Wand2 className="h-3.5 w-3.5" aria-hidden="true" /> Kategori kurala göre otomatik seçildi.
                    </p>
                  ) : null}
                  <FormInput value={title} onChange={(e) => setTitle(e.target.value)} name="title" maxLength={160} placeholder="Açıklama (isteğe bağlı)" aria-label="Açıklama" className="mt-2" />
                </div>
              ) : null}

              {officeMode && !isTransfer ? (
                <FormField label={direction === "in" ? "Kimden? (cari)" : "Kime? (cari)"} htmlFor="qe-party" hint={partyName && !pickedParty && !initial.partyId ? `Yazılan: ${partyName}. Seçmezseniz bu adla yeni cari açılır.` : undefined}>
                  <PartyPicker
                    id="qe-party"
                    name="party"
                    defaultValue={initial.partyId ?? null}
                    kindHint={partyKind}
                    allowCreate
                    onValueChange={(p) => setPickedParty(p?.name ?? null)}
                  />
                </FormField>
              ) : null}

              {/* Ödendi / Vadeli */}
              {officeMode && !isTransfer ? (
                <div className="grid gap-2">
                  <div className="grid grid-cols-2 gap-1 rounded-[var(--radius-control)] border border-line bg-canvas p-1" role="radiogroup" aria-label="Ödeme durumu">
                    {[
                      { on: !deferred, label: direction === "in" ? "Tahsil edildi" : "Ödendi", icon: Check, set: false },
                      { on: deferred, label: "Vadeli", icon: CalendarClock, set: true },
                    ].map((o) => (
                      <button
                        key={o.label}
                        type="button"
                        role="radio"
                        aria-checked={o.on}
                        onClick={() => {
                          setDeferred(o.set);
                          if (o.set) setRepeat(false);
                        }}
                        className={cn(
                          "focus-ring press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-control)] text-sm font-semibold transition",
                          o.on ? "bg-surface text-ink-950 shadow-[var(--shadow-xs)]" : "text-text-muted hover:text-ink-950",
                        )}
                      >
                        <o.icon className="h-4 w-4" aria-hidden="true" />
                        {o.label}
                      </button>
                    ))}
                  </div>
                  {deferred ? (
                    <FormField label="Vade tarihi" htmlFor="qe-due" hint={direction === "in" ? "Alacak olarak açılır; tahsil edince Cari'den kapatılır. Hareket şimdi oluşmaz." : "Borç olarak açılır; ödeyince Cari'den kapatılır. Hareket şimdi oluşmaz."}>
                      <FormInput id="qe-due" type="date" value={dueDate} min={date} onChange={(e) => setDueDate(e.target.value)} />
                    </FormField>
                  ) : null}
                </div>
              ) : null}

              {needsAccount ? (
                <div className={cn("grid gap-3", isTransfer && "sm:grid-cols-2")}>
                  <FormField
                    label={isTransfer ? "Hangi hesaptan?" : "Hangi hesap?"}
                    htmlFor="qe-account"
                    required
                    hint={personal ? "Kişisel hesap: yalnız siz görürsünüz, ofis kâr-zararına girmez." : undefined}
                  >
                    <Combobox
                      id="qe-account"
                      value={accountId}
                      onValueChange={setAccountId}
                      required
                      options={accountOptions}
                      placeholder="Hesap seçin"
                      searchPlaceholder="Hesap ara…"
                      emptyText="Eşleşen hesap yok"
                    />
                  </FormField>
                  {isTransfer ? (
                    <FormField label="Hangi hesaba?" htmlFor="qe-to-account" required>
                      <Combobox
                        id="qe-to-account"
                        value={toAccountId}
                        onValueChange={setToAccountId}
                        required
                        options={accountOptions.filter((o) => o.value !== accountId)}
                        placeholder="Hedef hesap"
                        searchPlaceholder="Hesap ara…"
                        emptyText="Eşleşen hesap yok"
                      />
                    </FormField>
                  ) : null}
                  {accounts.length === 0 ? (
                    <Link href="/app/giderler?sekme=kasa-banka" onClick={onClose} className="text-xs font-semibold text-accent-text hover:underline">
                      Henüz hesap yok: Kasa ve banka sekmesinden açın
                    </Link>
                  ) : null}
                </div>
              ) : null}

              {showDate ? (
                <FormField label="Tarih" htmlFor="qe-date">
                  <FormInput id="qe-date" name="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} max={defaultDate} min="2000-01-01" />
                </FormField>
              ) : (
                <p className="text-xs text-text-muted">
                  Tarih: bugün.{" "}
                  <button type="button" onClick={() => setShowDate(true)} className="focus-ring inline-flex min-h-9 touch:min-h-11 items-center font-semibold text-accent-text hover:underline">
                    Tarihi değiştir
                  </button>
                </p>
              )}

              {/* KDV ve stopaj */}
              {officeMode && !isTransfer ? (
                <div className="rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="KDV oranı">
                    <span className="mr-1 text-xs font-semibold text-text-muted">KDV</span>
                    <button type="button" role="radio" aria-checked={vatRate == null} onClick={() => setVatRate(null)} className={chipClass(vatRate == null)}>
                      Yok
                    </button>
                    {LEDGER_VAT_RATES.filter((r) => r > 0).map((r) => (
                      <button key={r} type="button" role="radio" aria-checked={vatRate === r} onClick={() => setVatRate(r)} className={chipClass(vatRate === r)}>
                        %{r}
                      </button>
                    ))}
                    {vatRate != null && vatRate > 0 ? (
                      <span className="ml-auto inline-flex items-center gap-2 text-xs">
                        <label htmlFor="qe-vat-incl" className="font-semibold text-text-muted">
                          {vatIncluded ? "Tutara dahil" : "Tutara ek"}
                        </label>
                        <Switch id="qe-vat-incl" checked={vatIncluded} onCheckedChange={setVatIncluded} aria-label="KDV tutara dahil" />
                      </span>
                    ) : null}
                  </div>
                  {vatPreview ? (
                    <p className="numeric mt-2 text-xs text-text-muted">
                      Net {formatAccountMoney(vatPreview.net, currency)} · KDV {formatAccountMoney(vatPreview.vat, currency)} · Toplam <strong className="text-text">{formatAccountMoney(vatPreview.gross, currency)}</strong>
                    </p>
                  ) : null}
                  {suggestedWh && withholdingRate == null ? (
                    <button
                      type="button"
                      onClick={() => setWithholdingRate(suggestedWh)}
                      className="focus-ring mt-2 inline-flex min-h-9 touch:min-h-11 items-center gap-1.5 rounded-full border border-dashed border-amber-400 px-3 text-xs font-semibold text-warning-strong hover:bg-warning-soft"
                    >
                      {isRent ? `İşyeri kirasında %${suggestedWh} stopaj kesilir. Uygula` : `Bu kategoride %${suggestedWh} stopaj önerilir. Uygula`}
                    </button>
                  ) : null}
                  {withholdingRate ? (
                    <p className="numeric mt-2 flex flex-wrap items-center gap-1 text-xs text-text-muted">
                      Stopaj %{withholdingRate}
                      {whPreview ? <>: {formatAccountMoney(whPreview.withheld ?? 0, currency)} vergi dairesine; hesaptan çıkan {formatAccountMoney(whPreview.cash, currency)}.</> : null}
                      <button type="button" onClick={() => setWithholdingRate(null)} className="focus-ring inline-flex min-h-9 touch:min-h-11 items-center rounded px-1 font-semibold text-text-faint hover:text-danger-600" aria-label="Stopajı kaldır">
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </p>
                  ) : null}
                </div>
              ) : null}

              {/* Her ay tekrarla (ödenen kayıtlarda) */}
              {!isTransfer && !(deferred && officeMode) ? (
                <div className="rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor="qe-repeat" className="text-sm font-semibold text-text">
                      Her ay tekrarla
                      <span className="block text-xs font-normal text-text-muted">Gelecek aydan itibaren aynı tutar kendiliğinden işlenir.</span>
                    </label>
                    <Switch id="qe-repeat" checked={repeat} onCheckedChange={setRepeat} aria-label="Her ay tekrarla" />
                  </div>
                  {repeat ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <FormField label="Ayın kaçıncı günü?" htmlFor="qe-repeat-day" hint="31 = ayın son günü">
                        <FormInput id="qe-repeat-day" name="repeatDay" type="number" min={1} max={31} defaultValue={Number(date.slice(8, 10))} />
                      </FormField>
                      <FormField label="Nasıl işlensin?" htmlFor="qe-repeat-mode">
                        <FormSelect id="qe-repeat-mode" value={repeatMode} onChange={(e) => setRepeatMode(e.target.value as "auto" | "approve")}>
                          <option value="auto">Otomatik kaydet</option>
                          <option value="approve">Bana sor</option>
                        </FormSelect>
                      </FormField>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Ek, portföy, not */}
              <details className="group rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2" open={upload.status !== "idle" || undefined}>
                <summary className="flex min-h-9 touch:min-h-11 cursor-pointer list-none items-center justify-between text-sm font-semibold text-text-muted [&::-webkit-details-marker]:hidden">
                  {officeMode ? "Belge, portföy ve not" : "Ayrıntı ekle"}
                  <ChevronDown className="h-4 w-4 transition group-open:rotate-180" aria-hidden="true" />
                </summary>
                <div className="mt-3 grid gap-3">
                  {officeMode && !isTransfer ? (
                    <div>
                      <input ref={fileRef} type="file" accept={UPLOAD_ACCEPT} className="sr-only" id="qe-file" onChange={(e) => onFile(e.target.files?.[0])} />
                      {upload.status === "idle" ? (
                        <label htmlFor="qe-file" className="focus-ring press flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-control)] border border-dashed border-line-strong px-3 text-sm font-semibold text-text-muted hover:border-brand-300 hover:text-accent-text">
                          <Paperclip className="h-4 w-4" aria-hidden="true" /> Fiş veya fatura ekle (PDF, görsel)
                        </label>
                      ) : (
                        <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-xs" aria-live="polite">
                          {upload.status === "uploading" ? <Loader2 className="h-4 w-4 animate-spin text-accent-text" aria-hidden="true" /> : <Paperclip className="h-4 w-4 text-text-faint" aria-hidden="true" />}
                          <span className="min-w-0 flex-1 truncate font-medium text-text">{upload.name}</span>
                          {upload.status === "uploading" ? <span className="numeric text-text-muted">%{upload.progress}</span> : null}
                          {upload.status === "done" ? <span className="font-semibold text-success-strong">Eklendi</span> : null}
                          {upload.status === "error" ? <span className="text-danger-strong">{upload.error}</span> : null}
                          {upload.status !== "uploading" ? (
                            <button
                              type="button"
                              onClick={() => {
                                setUpload({ status: "idle" });
                                if (fileRef.current) fileRef.current.value = "";
                              }}
                              className="focus-ring grid h-9 w-9 touch:h-11 touch:w-11 place-items-center rounded text-text-faint hover:text-danger-600"
                              aria-label="Eki kaldır"
                            >
                              <X className="h-4 w-4" aria-hidden="true" />
                            </button>
                          ) : null}
                        </div>
                      )}
                    </div>
                  ) : null}
                  {officeMode && !isTransfer ? (
                    <Combobox
                      name="property_id"
                      aria-label="İlgili portföy (isteğe bağlı)"
                      placeholder="Portföy (isteğe bağlı)"
                      searchPlaceholder="Portföy kodu veya başlığı…"
                      emptyText="Eşleşen portföy yok"
                      onSearch={searchProperties}
                      options={[]}
                    />
                  ) : null}
                  {!officeMode && !isTransfer ? (
                    <>
                      <FormField label={direction === "in" ? "Kimden?" : "Kime?"} htmlFor="qe-counterparty">
                        <FormInput id="qe-counterparty" maxLength={120} value={partyName ?? ""} onChange={(e) => setPartyName(e.target.value || null)} placeholder={direction === "in" ? "Müşteri / kurum" : "Firma / kişi"} />
                      </FormField>
                      <FormField label="Belge bağlantısı" htmlFor="qe-doc" hint="Fiş, makbuz veya fatura (https://…)">
                        <FormInput id="qe-doc" name="documentUrl" type="url" inputMode="url" maxLength={500} placeholder="https://" />
                      </FormField>
                    </>
                  ) : null}
                  <FormField label="Not" htmlFor="qe-note">
                    <FormTextarea id="qe-note" name="note" rows={2} maxLength={1000} />
                  </FormField>
                </div>
              </details>

              <FormError error={error} nextStep={null} />
            </DialogBody>
            <DialogFooter className="sticky bottom-0 bg-surface">
              <Button variant="ghost" onClick={onClose}>
                Vazgeç
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={busy}
                disabled={amount == null || (!isTransfer && !category) || (needsAccount && !accountId) || (isTransfer && !toAccountId) || upload.status === "uploading"}
              >
                {busy ? "Kaydediliyor…" : saveLabel}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
