"use client";

import { earningsPath, financePath } from "@/lib/finance/routes";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, ChevronDown, RotateCcw, SlidersHorizontal, Sparkles, Trash2, Wand2 } from "lucide-react";
import { recordCashEntry, transferBetweenAccounts } from "@/app/actions/finance-accounts";
import { createOpenItem, linkAttachment, recordEntryV2 } from "@/app/actions/finance-ledger";
import { createRecurringRule } from "@/app/actions/recurring-rules";
import { searchProperties } from "@/app/actions/lookup";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { FormActionBar, useFormDirty } from "@/components/ui/form-action-bar";
import { FormError, FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { Switch } from "@/components/ui/switch";
import { now as nowMs } from "@/lib/clock";
import { formatAmountEdit, formatAmountInput, parseAmountShorthand } from "@/lib/finance/amount-shorthand";
import { BUDGET_GROUP_LABEL, SALARY_CATEGORY, budgetCategoryFor, expenseCategoryFor } from "@/lib/finance/cash/categories";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import {
  balanceAfter,
  budgetImpact,
  categoryFromHistory,
  computeEntryTotals,
  detailsOpenKey,
  directionTab,
  draftKey,
  entryEditHref,
  findDuplicates,
  similarEntries,
  topCategories,
  type RecentEntry,
} from "@/lib/finance/entry-workspace";
import { LEDGER_VAT_RATES, RENT_WITHHOLDING_RATE } from "@/lib/finance/ledger/vat";
import { nextMonthStartKey } from "@/lib/finance/recurring/rules";
import { hasSmartSignal, parseSmartEntry, shiftDayKey, type SmartEntry } from "@/lib/finance/smart-entry";
import { takeSubmitIntent } from "@/lib/form-submit-intent";
import { cn } from "@/lib/utils";
import { PartyPicker } from "../../(merkez)/cari/party-picker";
import type { EntryCategoryOption, EntryDirection, RuleSuggestFn, RuleSuggestion } from "../../(merkez)/quick-entry";
import type { WorkspaceAccount, WorkspaceBudget } from "../_data";
import { AttachmentField, EntryLiveSummary, RadioChip, chipClass, type OcrResult, type UploadState } from "./entry-ui";

/**
 * Tek kayıt formu (Gider / Gelir / Transfer sekmeleri; popup yok). SADE: tek kartta yalnız temel alanlar — Tutar (büyük),
 * Kategori (en sık 6 + "Tümü"), Tarih (Bugün/Dün + tarih), Hesap (tek hesapsa gizli), Açıklama. Geri kalan her şey (cari,
 * ödeme durumu/vade, KDV ve stopaj, portföy, belge/fiş, not, tekrar) TEK katlanır "Ayrıntılar (isteğe bağlı)" bölümünde;
 * önceden doldurma / fiş okuma / tek satır giriş bu alanlardan birini doldurursa kendiliğinden açılır, açık/kapalı tercihi
 * kullanıcı başına saklanır. Transfer: kaynak, hedef, tutar, tarih, not. Canlı özet mobilde tutarın altında tek şerit,
 * masaüstünde küçük kart (net/KDV/brüt yalnız KDV seçiliyse, bakiye sonrası; bütçe/mükerrer/benzer yalnız ilgiliyse).
 *
 * Akıllı: tek satır giriş (smart-entry), tutar kısaltmaları (48k, 1,2m), kurala dayalı kategori önerisi
 * (finance_rule_suggest), cariye geçmişte en sık kullanılan kategori, fiş okuma (OCR) ile boş alanları doldurma.
 * Kaydet / Kaydet ve yenisini ekle (sekme, hesap ve tarih korunur) / taslak (sekme başına, yerel; otomatik).
 * Yollar değişmedi: ofis hesabı → `recordEntryV2` (vadeli → `createOpenItem`), kişisel hesap (Kasam) → `recordCashEntry`,
 * transfer → `transferBetweenAccounts`, her ay tekrar → `createRecurringRule`.
 */

export type EntrySeed = {
  amount: number | null;
  partyId: string | null;
  partyName: string | null;
  accountId: string | null;
  openItemId: string | null;
  attachmentId: string | null;
  attachmentName?: string | null;
  text: string | null;
  date: string | null;
  vatRate: number | null;
  category: string | null;
  title: string | null;
  propertyId?: string | null;
  propertyLabel?: string | null;
};

export type EntryFormContext = {
  userId: string;
  personal: boolean;
  /** Ofis kaydı yazabilir mi (expenses:create, kişisel kip değil). */
  office: boolean;
  today: string;
  accounts: readonly WorkspaceAccount[];
  categories: readonly EntryCategoryOption[];
  recent: readonly RecentEntry[];
  budgets: readonly WorkspaceBudget[];
  vatIncludedDefault: boolean;
  canSalary: boolean;
  suggestRule?: RuleSuggestFn;
  returnHref: string;
};

type ActionResult = { ok?: boolean; error?: string; id?: string; info?: string } | null | undefined;

function errorOf(res: ActionResult): string | null {
  if (!res) return "İşlem tamamlanamadı.";
  if (typeof res.error === "string" && res.error) return res.error;
  if (res.ok === false) return "İşlem tamamlanamadı.";
  return null;
}

const LAST_ACCOUNT_KEY = "emlaksoft:finance:last-account";

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* tercih saklanamadı: sorun değil */
  }
}

function subscribeStorage(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}

/** Varsayılan hesap: ofis kasası, yoksa ilk hesap. Son kullanılan hesap (yerel tercih) bunun önüne geçer. */
function defaultAccount(accounts: readonly WorkspaceAccount[]): string {
  return (accounts.find((a) => a.scope === "office" && a.kind === "cash") ?? accounts[0])?.id ?? "";
}

const noopSubscribe = () => () => undefined;

/** Akıllı girişin doldurabildiği alanlar (silinen sözcüğün alanı varsayılana döner; elle değişen alana dokunulmaz). */
type SmartField = "amount" | "category" | "title" | "party" | "vat" | "vatIncluded" | "deferred" | "date";

function smartFieldsOf(p: SmartEntry): Set<SmartField> {
  const out = new Set<SmartField>();
  if (p.amount != null) out.add("amount");
  if (p.category != null) out.add("category");
  if (p.title != null) out.add("title");
  if (p.partyName != null) out.add("party");
  if (p.vatRate != null) out.add("vat");
  if (p.vatIncluded != null) out.add("vatIncluded");
  if (p.deferred) out.add("deferred");
  if (p.dayOffset != null) out.add("date");
  return out;
}

/** Vadeli (açık kalem) yalnız ofis kipinde vardır; Kasam'da "vadeli" sözcüğü yok sayılır. */
function smartFor(p: SmartEntry, office: boolean): SmartEntry {
  return office ? p : { ...p, deferred: false, dueInDays: null };
}

/** Taslak (yerel, sekme başına): dosya değil yalnız alan değerleri; belge kimliği yüklenmişse taşınır. */
type Draft = {
  v: 1;
  amountText: string;
  category: string;
  title: string;
  accountId: string;
  toAccountId: string;
  date: string;
  deferred: boolean;
  dueDate: string;
  openCurrency: "TRY" | "USD" | "EUR";
  partyId: string | null;
  partyLabel: string | null;
  partyName: string | null;
  vatRate: number | null;
  vatIncluded: boolean;
  withholdingRate: number | null;
  propertyId: string;
  note: string;
  documentUrl: string;
  repeat: boolean;
  repeatDay: string;
  repeatMode: "auto" | "approve";
  attachment: { id: string; name: string } | null;
  savedAt: number;
};

function parseDraft(raw: string | null): Draft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Draft;
    return d && d.v === 1 && typeof d.amountText === "string" ? d : null;
  } catch {
    return null;
  }
}

const WITHHOLDING_CHOICES = [15, 20] as const;

export function EntryForm({
  direction,
  onDirectionChange,
  seed,
  ctx,
  onSavedNew,
  hidden,
}: {
  direction: EntryDirection;
  onDirectionChange: (next: EntryDirection) => void;
  seed: EntrySeed;
  ctx: EntryFormContext;
  onSavedNew: (keep: { direction: EntryDirection; accountId: string; date: string }) => void;
  hidden?: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const { accounts, today, office, personal: personalScope } = ctx;

  const allCategories = useMemo<readonly EntryCategoryOption[]>(
    () => ctx.categories.filter((c) => ctx.canSalary || c.value !== SALARY_CATEGORY),
    [ctx.categories, ctx.canSalary],
  );
  const smartCats = useMemo(() => allCategories.map((c) => ({ value: c.value, label: c.label, direction: c.direction })), [allCategories]);

  // Başlangıç: URL/olay önceden doldurma + (varsa) tek satır metin bir kez ayrıştırılır.
  const [seedParsed] = useState(() => {
    const parsed = seed.text ? smartFor(parseSmartEntry(seed.text, smartCats), office) : null;
    return parsed && hasSmartSignal(parsed) ? parsed : null;
  });
  const sp = seedParsed;
  const [amountText, setAmountText] = useState(() => {
    const a = sp?.amount ?? seed.amount;
    return a ? formatAmountInput(a) : "";
  });
  const [category, setCategory] = useState(() => {
    const c = sp?.category ?? seed.category ?? "";
    return allCategories.some((x) => x.value === c && x.direction === direction) ? c : "";
  });
  const [title, setTitle] = useState(sp?.title ?? seed.title ?? "");
  // Hesap: önceden doldurulan > elle seçilen > son kullanılan (yerel; sunucu çiziminde yok → hidrasyon uyumsuzluğu olmaz) > kasa.
  const [accountPick, setAccountId] = useState(() => (seed.accountId && accounts.some((a) => a.id === seed.accountId) ? seed.accountId : ""));
  const savedAccount = useSyncExternalStore(noopSubscribe, () => readStorage(LAST_ACCOUNT_KEY), () => null);
  const accountId = accountPick || (savedAccount && accounts.some((a) => a.id === savedAccount) ? savedAccount : defaultAccount(accounts));
  const [toAccountId, setToAccountId] = useState("");
  const [date, setDate] = useState(() => (sp?.dayOffset != null ? shiftDayKey(today, sp.dayOffset) : seed.date && seed.date <= today ? seed.date : today));
  const [deferred, setDeferred] = useState(sp?.deferred ?? false);
  const [dueDate, setDueDate] = useState(() => shiftDayKey(today, sp?.dueInDays ?? 30));
  const [partyName, setPartyName] = useState<string | null>(sp?.partyName ?? (seed.partyId ? null : seed.partyName));
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(seed.partyId ? { id: seed.partyId, name: seed.partyName ?? "Seçili kişi/firma" } : null);
  const [pickerKey, setPickerKey] = useState(0);
  const [openCurrency, setOpenCurrency] = useState<"TRY" | "USD" | "EUR">("TRY");
  const [vatRate, setVatRate] = useState<number | null>(sp?.vatRate ?? seed.vatRate ?? null);
  const [vatIncluded, setVatIncluded] = useState(sp?.vatIncluded ?? ctx.vatIncludedDefault);
  const [withholdingRate, setWithholdingRate] = useState<number | null>(null);
  const [propertyId, setPropertyId] = useState(seed.propertyId ?? "");
  const [note, setNote] = useState("");
  const [documentUrl, setDocumentUrl] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [repeatDay, setRepeatDay] = useState(() => String(Number(today.slice(8, 10))));
  const [repeatMode, setRepeatMode] = useState<"auto" | "approve">("auto");
  const [smartText, setSmartText] = useState(seed.text ?? "");
  const [smart, setSmart] = useState<SmartEntry | null>(sp);
  const [suggestion, setSuggestion] = useState<RuleSuggestion | null>(null);
  const [upload, setUpload] = useState<UploadState>(seed.attachmentId ? { status: "done", name: seed.attachmentName ?? "Seçilen belge", id: seed.attachmentId } : { status: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [missingShown, setMissingShown] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [draftHandled, setDraftHandled] = useState(false);
  const [everDirty, setEverDirty] = useState(false);
  const [showAllCats, setShowAllCats] = useState(false);
  const [showSmart, setShowSmart] = useState(Boolean(seed.text));
  // "Ayrıntılar": önceden doldurma bir ayrıntı alanını doldurduysa açık başlar; yoksa kullanıcının son tercihi (yerel).
  const detailsKey = detailsOpenKey(ctx.userId);
  const storedDetails = useSyncExternalStore(noopSubscribe, () => readStorage(detailsKey), () => null);
  const [detailsPick, setDetailsPick] = useState<boolean | null>(() =>
    seed.partyId || seed.partyName || seed.vatRate != null || seed.attachmentId || seed.propertyId || seed.openItemId || sp?.partyName || sp?.vatRate != null || sp?.deferred ? true : null,
  );
  const detailsOpen = detailsPick ?? storedDetails === "1";
  const openDetails = () => setDetailsPick(true);
  function toggleDetails() {
    const next = !detailsOpen;
    setDetailsPick(next);
    writeStorage(detailsKey, next ? "1" : "0");
  }
  const formRef = useRef<HTMLFormElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const smartOwned = useRef<Set<SmartField>>(sp ? smartFieldsOf(sp) : new Set());
  const manualFields = useRef<Set<SmartField>>(new Set());
  const ruleTouched = useRef(Boolean(sp?.category ?? seed.category));
  const release = (field: SmartField) => {
    smartOwned.current.delete(field);
    manualFields.current.add(field);
  };

  // Sekme (yön) değişince yönle uyuşmayan kategori ve transferde anlamsız seçenekler temizlenir (render sırasında eşitleme).
  const [prevDirection, setPrevDirection] = useState(direction);
  if (prevDirection !== direction) {
    setPrevDirection(direction);
    if (!allCategories.some((c) => c.value === category && c.direction === direction)) setCategory("");
    if (direction === "transfer") {
      setDeferred(false);
      setRepeat(false);
    }
    setSuggestion(null);
  }

  const chosen = accounts.find((a) => a.id === accountId);
  const toChosen = accounts.find((a) => a.id === toAccountId);
  const personal = chosen?.scope === "user" || (personalScope && !chosen);
  const officeMode = office && !personal;
  const isTransfer = direction === "transfer";
  const amount = parseAmountShorthand(amountText);
  const deferredMode = officeMode && deferred && !isTransfer;
  const currency = deferredMode ? openCurrency : (chosen?.currency ?? "TRY");
  const cats = useMemo(() => (isTransfer ? [] : allCategories.filter((c) => c.direction === direction)), [isTransfer, allCategories, direction]);
  const partyLabel = officeMode ? (picked?.name ?? partyName ?? "") : (partyName ?? "");
  const allowed = useMemo(() => new Set(cats.map((c) => c.value)), [cats]);
  // Cariden kategori: kategori seçilmemişse bu cariye geçmişte en sık kullanılan kategori (türetilmiş; elle seçim üstündür).
  const historyPick = !category && !isTransfer ? categoryFromHistory(partyLabel, direction, ctx.recent, allowed) : null;
  const effCategory = category || historyPick?.category || "";
  const catMeta = allCategories.find((c) => c.value === effCategory && c.direction === direction) ?? null;
  const isRent = direction === "out" && (effCategory === "kira" || catMeta?.label.toLocaleLowerCase("tr-TR").includes("kira") === true);
  const suggestedWh = direction === "out" ? (catMeta?.withholdingRate ?? (isRent ? RENT_WITHHOLDING_RATE : null)) : null;
  const partyKind = direction === "in" ? (effCategory === "kira_tahsilat" ? "kiraci" : "musteri") : "tedarikci";
  const accountOptions = [
    ...accounts.filter((a) => a.scope === "office").map((a) => ({ value: a.id, label: `${a.name} (${a.currency})`, hint: `Ofis · ${formatAccountMoney(a.balance, a.currency)}` })),
    ...accounts.filter((a) => a.scope === "user").map((a) => ({ value: a.id, label: `${a.name} (${a.currency})`, hint: `Kişisel · ${formatAccountMoney(a.balance, a.currency)}` })),
  ];
  const totals = computeEntryTotals({ amount, direction, vatRate, vatIncluded, withholdingRate, office: officeMode });

  // ---- Akıllı tek satır --------------------------------------------------------------------------------------------
  function applySmart(text: string) {
    setSmartText(text);
    const parsed = smartFor(parseSmartEntry(text, smartCats), office);
    setSmart(hasSmartSignal(parsed) ? parsed : null);
    if (parsed.direction && parsed.direction !== direction) onDirectionChange(parsed.direction);
    const owned = smartOwned.current;
    const next = new Set<SmartField>();
    const take = (field: SmartField, present: boolean, apply: () => void, reset: () => void) => {
      if (present) {
        if (owned.has(field) || !manualFields.current.has(field)) {
          apply();
          next.add(field);
        }
      } else if (owned.has(field)) reset();
    };
    take("amount", parsed.amount != null, () => setAmountText(formatAmountInput(parsed.amount!)), () => setAmountText(""));
    take(
      "category",
      parsed.category != null,
      () => {
        ruleTouched.current = true;
        setCategory(parsed.category!);
      },
      () => {
        ruleTouched.current = false;
        setCategory("");
      },
    );
    take("title", parsed.title != null, () => setTitle(parsed.title!), () => setTitle(""));
    take("party", parsed.partyName != null, () => setPartyName(parsed.partyName), () => setPartyName(null));
    take("vat", parsed.vatRate != null, () => setVatRate(parsed.vatRate), () => setVatRate(null));
    take("vatIncluded", parsed.vatIncluded != null, () => setVatIncluded(parsed.vatIncluded!), () => setVatIncluded(ctx.vatIncludedDefault));
    take(
      "deferred",
      parsed.deferred,
      () => {
        setDeferred(true);
        setRepeat(false);
        setDueDate(shiftDayKey(today, parsed.dueInDays ?? 30));
      },
      () => {
        setDeferred(false);
        setDueDate(shiftDayKey(today, 30));
      },
    );
    take("date", parsed.dayOffset != null, () => setDate(shiftDayKey(today, parsed.dayOffset!)), () => setDate(today));
    smartOwned.current = next;
    if (next.has("party") || next.has("vat") || next.has("deferred")) openDetails();
  }

  function pickCategory(value: string) {
    release("category");
    ruleTouched.current = true;
    setCategory(value);
    setSuggestion(null);
    const meta = allCategories.find((c) => c.value === value && c.direction === direction);
    if (meta?.vatRate != null && vatRate == null) setVatRate(meta.vatRate);
  }

  // Kurala dayalı kategori önerisi: açıklama/cari yazıldıkça, kategori elle seçilmemişse (350 ms bekleme).
  const suggestKey = `${direction}|${title}|${partyLabel}|${amount ?? ""}`;
  useEffect(() => {
    const suggest = ctx.suggestRule;
    if (!suggest || !officeMode || isTransfer || ruleTouched.current) return;
    const text = [title, partyLabel].filter(Boolean).join(" ").trim();
    if (text.length < 3) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      suggest({ text, amount, direction: direction === "in" ? "in" : "out" })
        .then((s) => {
          if (cancelled || !s || ruleTouched.current) return;
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
  }, [suggestKey, ctx.suggestRule, officeMode]);

  // Fiş okuma: yalnız BOŞ alanlar önerilen değerlerle dolar.
  function onOcr(ocr: OcrResult) {
    if (ocr.amount && !amountText) setAmountText(formatAmountInput(ocr.amount));
    if (ocr.date && /^\d{4}-\d{2}-\d{2}$/.test(ocr.date) && ocr.date <= today) setDate(ocr.date);
    if (ocr.vatRate != null && vatRate == null) setVatRate(ocr.vatRate);
    if (ocr.vendor && !partyLabel) setPartyName(ocr.vendor);
    if ((ocr.vatRate != null && vatRate == null) || (ocr.vendor && !partyLabel)) openDetails();
    push("Fişten okunan bilgiler boş alanlara yazıldı; kontrol edin.", "ok");
  }

  // ---- Taslak (yerel, sekme başına) -----------------------------------------------------------------------------------
  const dKey = draftKey(ctx.userId, personalScope, directionTab(direction));
  const storedDraftRaw = useSyncExternalStore(subscribeStorage, () => readStorage(dKey), () => null);
  const draftData: Omit<Draft, "savedAt"> = {
    v: 1,
    amountText,
    category,
    title,
    accountId,
    toAccountId,
    date,
    deferred,
    dueDate,
    openCurrency,
    partyId: picked?.id ?? null,
    partyLabel: picked?.name ?? null,
    partyName,
    vatRate,
    vatIncluded,
    withholdingRate,
    propertyId,
    note,
    documentUrl,
    repeat,
    repeatDay,
    repeatMode,
    attachment: upload.status === "done" ? { id: upload.id, name: upload.name } : null,
  };
  const draftJson = JSON.stringify(draftData);
  const [pristineJson] = useState(draftJson);
  const hasContent = Boolean(amountText || title || note || partyLabel || category);
  const draftDirty = draftJson !== pristineJson && hasContent;

  useEffect(() => {
    if (!draftDirty || busy) return;
    const timer = window.setTimeout(() => {
      const savedAt = nowMs();
      writeStorage(dKey, JSON.stringify({ ...JSON.parse(draftJson), savedAt }));
      setDraftSavedAt(savedAt);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [draftJson, draftDirty, dKey, busy]);

  // Bu oturumda yazmaya başlandıysa banner bir daha çıkmaz (alan silinince kişinin KENDİ otomatik taslağı "geri yükle"
  // diye önüne gelmesin).
  if (draftDirty && !everDirty) setEverDirty(true);
  const storedDraft = draftHandled || draftDirty || everDirty ? null : parseDraft(storedDraftRaw);

  function restoreDraft(d: Draft) {
    setAmountText(d.amountText);
    setCategory(allCategories.some((c) => c.value === d.category && c.direction === direction) ? d.category : "");
    ruleTouched.current = Boolean(d.category);
    setTitle(d.title);
    if (accounts.some((a) => a.id === d.accountId)) setAccountId(d.accountId);
    if (accounts.some((a) => a.id === d.toAccountId)) setToAccountId(d.toAccountId);
    setDate(d.date && d.date <= today ? d.date : today);
    setDeferred(Boolean(d.deferred) && office);
    setDueDate(d.dueDate || shiftDayKey(today, 30));
    setOpenCurrency(d.openCurrency);
    setPicked(d.partyId ? { id: d.partyId, name: d.partyLabel ?? "Seçili kişi/firma" } : null);
    setPickerKey((k) => k + 1);
    setPartyName(d.partyName);
    setVatRate(d.vatRate);
    setVatIncluded(d.vatIncluded);
    setWithholdingRate(d.withholdingRate);
    setPropertyId(d.propertyId);
    setNote(d.note);
    setDocumentUrl(d.documentUrl);
    setRepeat(d.repeat);
    setRepeatDay(d.repeatDay);
    setRepeatMode(d.repeatMode);
    if (d.attachment) setUpload({ status: "done", id: d.attachment.id, name: d.attachment.name });
    if (d.partyId || d.partyName || d.vatRate != null || d.withholdingRate != null || d.propertyId || d.note || d.documentUrl || d.repeat || d.deferred || d.attachment) openDetails();
    setDraftHandled(true);
    setDraftSavedAt(d.savedAt);
  }

  function discardDraft() {
    writeStorage(dKey, null);
    setDraftHandled(true);
    setDraftSavedAt(null);
  }

  // ---- Özet: bakiye, bütçe, mükerrer, benzer --------------------------------------------------------------------------
  const candidate = { direction, cash: totals?.cash ?? null, date, counterparty: partyLabel || null, category: effCategory || null, title };
  const duplicates = isTransfer ? [] : findDuplicates(candidate, ctx.recent);
  const similar = isTransfer ? [] : similarEntries(candidate, ctx.recent, 4, new Set(duplicates.map((d) => d.entry.id)));
  const budgetKey = effCategory ? budgetCategoryFor(effCategory, direction === "in" ? "in" : "out") : "";
  const budgetRow = officeMode && !isTransfer && budgetKey ? ctx.budgets.find((b) => b.direction === direction && b.category === budgetKey) : undefined;
  const budget = budgetRow && currency === "TRY" ? budgetImpact(budgetRow.budget, budgetRow.actual, date.slice(0, 7) === today.slice(0, 7) ? (totals?.cash ?? 0) : 0) : null;
  const catLabelOf = (v: string | null) => allCategories.find((c) => c.value === v)?.label ?? (v ? (BUDGET_GROUP_LABEL[v] ?? v) : "—");

  // ---- Eksik alanlar ------------------------------------------------------------------------------------------------
  const needsAccount = !deferredMode;
  const missing: { key: string; label: string; selector: string }[] = [];
  if (amount == null) missing.push({ key: "amount", label: "Tutar", selector: "#ew-amount" });
  if (!isTransfer && !effCategory) missing.push({ key: "category", label: "Kategori", selector: 'input[name="ew-category"]' });
  if (needsAccount && !accountId) missing.push({ key: "account", label: isTransfer ? "Kaynak hesap" : "Hesap", selector: "#ew-account" });
  if (isTransfer && !toAccountId) missing.push({ key: "to-account", label: "Hedef hesap", selector: "#ew-to-account" });
  const requiredTotal = isTransfer ? 3 : needsAccount ? 3 : 2;
  const focusMissing = (selector: string) => document.querySelector<HTMLElement>(selector)?.focus();

  const dirty = useFormDirty(formRef, busy);

  function rememberAccount(id: string) {
    writeStorage(LAST_ACCOUNT_KEY, id);
  }

  function finish(intent: "new" | null) {
    writeStorage(dKey, null);
    if (intent === "new") {
      onSavedNew({ direction, accountId, date });
      return;
    }
    router.push(ctx.returnHref);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const intent = takeSubmitIntent();
    if (busy) return;
    if (missing.length > 0) {
      setMissingShown(true);
      setError(null);
      focusMissing(missing[0]!.selector);
      return;
    }
    setBusy(true);
    setError(null);
    const attachmentId = upload.status === "done" ? upload.id : null;
    const entryTitle = title.trim() || catMeta?.label || "";
    const partyId = officeMode ? (picked?.id ?? null) : null;
    const newPartyName = officeMode && !partyId ? (partyName ?? "").trim() || null : null;

    try {
      if (amount == null) {
        setError("Geçerli bir tutar girin (ör. 1.250,50 · 48k · 1,2m).");
        return;
      }
      if (isTransfer) {
        const res = await transferBetweenAccounts({ fromAccountId: accountId, toAccountId, amount, date, note });
        const err = errorOf(res);
        if (err) return setError(err);
        rememberAccount(accountId);
        push("Transfer kaydedildi", "ok");
        finish(intent);
        return;
      }

      if (!officeMode) {
        const res = await recordCashEntry(direction, {
          accountId,
          amount: String(amount),
          category: effCategory,
          title: title.trim(),
          date,
          counterparty: partyName ?? "",
          documentUrl,
          note,
          repeatMonthly: repeat,
          repeatDay,
          repeatMode,
        });
        const err = errorOf(res);
        if (err) return setError(err);
        rememberAccount(accountId);
        push(direction === "in" ? "Gelir kaydedildi" : "Gider kaydedildi", "ok");
        if (res?.info) push(res.info, "err");
        else if (repeat) push("Gelecek aydan itibaren her ay tekrarlanacak", "ok");
        finish(intent);
        return;
      }

      // Vadeli: hareket OLUŞMAZ; açık kalem (alacak/borç) açılır.
      if (deferredMode) {
        if (!partyId && !newPartyName) {
          focusMissing("#ew-party");
          return setError("Vadeli kayıt için kişi ya da firma seçin.");
        }
        if (!dueDate || dueDate < date) return setError("Vade tarihi kayıt tarihinden önce olamaz.");
        const res = (await createOpenItem({
          direction: direction === "in" ? "receivable" : "payable",
          partyId,
          partyName: newPartyName,
          partyKind,
          title: entryTitle,
          category: effCategory,
          currency: openCurrency,
          amount: totals ? totals.gross : amount,
          vatRate,
          withholdingRate,
          issueDate: date,
          dueDate,
          propertyId: propertyId || null,
          note: note.trim() || null,
        })) as ActionResult;
        const err = errorOf(res);
        if (err) return setError(err);
        if (attachmentId && res?.id) await linkAttachment(attachmentId, { openItemId: res.id });
        push(direction === "in" ? "Alacak kaydedildi (vadeli)" : "Borç kaydedildi (vadeli)", "ok");
        finish(intent);
        return;
      }

      // Ofis gideri eski `expenses` satırını da açar (portföy giderleri, bütçe, kategori grafikleri); maaş hariç.
      const expenseCategory = direction === "out" && effCategory !== SALARY_CATEGORY ? (catMeta?.expenseCategory ?? expenseCategoryFor(effCategory)) : null;
      const res = (await recordEntryV2({
        accountId,
        direction,
        amount,
        entryDate: date,
        category: effCategory,
        title: title.trim() || null,
        partyId,
        partyName: newPartyName,
        partyKind,
        counterparty: partyId ? null : newPartyName,
        vatRate,
        vatIncluded,
        withholdingRate,
        propertyId: propertyId || null,
        openItemId: seed.openItemId,
        note: note.trim() || null,
        attachmentIds: attachmentId ? [attachmentId] : [],
        ruleId: suggestion && suggestion.category === effCategory ? suggestion.ruleId : null,
        createExpense: expenseCategory !== null,
        expenseCategory,
      })) as ActionResult;
      const err = errorOf(res);
      if (err) return setError(err);
      rememberAccount(accountId);
      push(direction === "in" ? "Gelir kaydedildi" : "Gider kaydedildi", "ok");
      if (repeat) {
        const rule = await createRecurringRule({
          accountId,
          direction,
          category: effCategory,
          title: entryTitle,
          amount,
          payDay: Number(repeatDay) || Number(date.slice(8, 10)),
          mode: repeatMode,
          startDate: nextMonthStartKey(today),
        });
        if (rule.error) push(`Kayıt yapıldı ama her ay tekrarı kurulamadı: ${rule.error}`, "err");
        else push("Gelecek aydan itibaren her ay tekrarlanacak", "ok");
      }
      finish(intent);
    } finally {
      setBusy(false);
    }
  }

  const saveLabel = deferredMode ? (direction === "in" ? "Alacağı kaydet" : "Borcu kaydet") : "Kaydet";
  const formLabel = isTransfer ? "Transfer kaydı" : direction === "in" ? "Gelir kaydı" : "Gider kaydı";
  const yesterday = shiftDayKey(today, -1);
  const showAccount = isTransfer || accounts.length !== 1;
  const visibleCats = showAllCats ? cats : topCategories(cats, ctx.recent, direction, 6, effCategory);
  const hiddenCatCount = cats.length - visibleCats.length;
  const amountInvalid = amountText.trim() !== "" && amount == null;

  // Ayrıntılar kapalıyken doldurulmuş olanlar başlıkta özetlenir (gizli değer kalmasın).
  const filledDetails = [
    partyLabel ? `Kişi/firma: ${partyLabel}` : null,
    deferredMode ? "Vadeli" : null,
    officeMode && vatRate != null ? `KDV %${vatRate}` : null,
    officeMode && withholdingRate ? `Stopaj %${withholdingRate}` : null,
    officeMode && propertyId ? "Portföy" : null,
    upload.status === "done" || documentUrl ? "Belge" : null,
    note.trim() ? "Not" : null,
    repeat ? "Her ay" : null,
  ].filter((x): x is string => Boolean(x));

  const summaryProps = {
    direction,
    currency,
    totals,
    showTax: officeMode && !isTransfer,
    account: chosen && needsAccount ? { name: chosen.name, currency: chosen.currency, before: chosen.balance, after: balanceAfter(chosen.balance, totals) } : null,
    toAccount:
      isTransfer && toChosen
        ? { name: toChosen.name, currency: toChosen.currency, before: toChosen.balance, after: Math.round((toChosen.balance + (totals?.cash ?? 0)) * 100) / 100 }
        : null,
    budget,
    duplicates,
    similar,
    categoryLabelOf: catLabelOf,
    hrefOf: (id: string) => entryEditHref(id, { personal: personalScope }),
    deferredNote: deferredMode ? (direction === "in" ? "Vadeli: alacak açılır, hesap bakiyesi şimdi değişmez." : "Vadeli: borç açılır, hesap bakiyesi şimdi değişmez.") : null,
  };

  if (accounts.length === 0 && !office) {
    return (
      <div hidden={hidden} className="rounded-[var(--radius-card)] border border-line bg-surface p-5 text-sm text-text-muted">
        Önce bir hesap açın (örneğin kasa); hareketler hesaba yazılır.
      </div>
    );
  }

  const accountPicker = (
    <div className={cn("grid gap-3", isTransfer && "sm:grid-cols-2")}>
      <FormField
        label={isTransfer ? "Hangi hesaptan?" : "Hesap"}
        htmlFor="ew-account"
        required
        hint={personal ? "Kişisel hesap: yalnız siz görürsünüz, ofis kâr-zararına girmez." : undefined}
      >
        <Combobox
          id="ew-account"
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
        <FormField label="Hangi hesaba?" htmlFor="ew-to-account" required>
          <Combobox
            id="ew-to-account"
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
      {isTransfer && chosen && toChosen && chosen.currency !== toChosen.currency ? (
        <p className="tone-warning rounded-[var(--radius-control)] px-3 py-2 text-xs font-semibold sm:col-span-2">Farklı para birimli hesaplar arasında transfer yapılamaz.</p>
      ) : null}
      {accounts.length === 0 ? (
        <a href={personalScope ? earningsPath("kasam") : financePath("kasa-banka")} className="inline-flex min-h-11 items-center text-xs font-semibold text-accent-text hover:underline">
          Henüz hesap yok: {personalScope ? "Kasam'dan" : "Kasa ve banka sekmesinden"} açın
        </a>
      ) : null}
    </div>
  );

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      hidden={hidden}
      aria-label={formLabel}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          formRef.current?.requestSubmit();
        }
      }}
      className="grid grid-cols-[minmax(0,1fr)] gap-3"
    >
      {seed.openItemId ? (
        <p role="status" className="tone-info flex items-center gap-2 rounded-[var(--radius-card)] px-4 py-3 text-sm">
          <CalendarClock className="h-4 w-4 shrink-0" aria-hidden="true" /> Bu kayıt bir vadeli kalemin tahsilatı/ödemesi olarak o kaleme bağlanır.
        </p>
      ) : null}
      {storedDraft ? (
        <div role="status" className="tone-info flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] px-4 py-2 text-sm">
          <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">Yarım kalan bir kaydınız var{storedDraft.amountText ? ` (${storedDraft.amountText}${storedDraft.title ? ` · ${storedDraft.title}` : ""})` : ""}.</span>
          <Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => restoreDraft(storedDraft)}>
            Geri yükle
          </Button>
          <Button size="sm" variant="ghost" icon={Trash2} onClick={discardDraft}>
            Sil
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
          {/* Temel alanlar: tek kart */}
          <section aria-label={formLabel} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--elev-1)] sm:p-5">
            <div className="grid gap-2">
              <div className="flex items-end justify-between gap-2">
                <label htmlFor="ew-amount" className="text-sm font-medium text-ink-950">
                  {officeMode && !isTransfer && vatRate != null && vatRate > 0 ? (vatIncluded ? "Tutar (KDV dahil)" : "Tutar (KDV hariç)") : "Tutar"}
                  <span aria-hidden="true" className="ml-0.5 text-danger-500">*</span>
                </label>
                {!isTransfer ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Sparkles}
                    onClick={() => setShowSmart((v) => !v)}
                    aria-expanded={showSmart}
                    aria-controls="ew-smart-wrap"
                    className="rounded-full px-2 font-semibold text-accent-text"
                  >
                    Tek satırda yazın
                  </Button>
                ) : null}
              </div>
              {!isTransfer && showSmart ? (
                <div id="ew-smart-wrap">
                  <FormInput
                    id="ew-smart"
                    aria-label="Tek satırda yazın"
                    value={smartText}
                    onChange={(e) => applySmart(e.target.value)}
                    autoComplete="off"
                    maxLength={300}
                    placeholder={office ? "ör. 4.500 portal Sahibinden · 48k komisyon Ahmet Yılmaz vadeli" : "ör. 1.250 market dün"}
                  />
                  {smart ? (
                    <ul className="mt-1.5 flex flex-wrap gap-1 text-xs" aria-label="Anlaşılanlar">
                      {smart.amount != null ? <li className="numeric rounded-full bg-surface-accent-soft px-2 py-0.5 font-semibold text-accent-text">{formatAccountMoney(smart.amount, currency)}</li> : null}
                      {smart.category ? <li className="rounded-full bg-surface-accent-soft px-2 py-0.5 font-semibold text-accent-text">{catLabelOf(smart.category)}</li> : null}
                      {smart.partyName ? <li className="rounded-full bg-surface-accent-soft px-2 py-0.5 font-semibold text-accent-text">Kişi/firma: {smart.partyName}</li> : null}
                      {smart.vatRate != null ? <li className="rounded-full bg-surface-accent-soft px-2 py-0.5 font-semibold text-accent-text">KDV %{smart.vatRate}</li> : null}
                      {smart.deferred && officeMode ? <li className="rounded-full bg-surface-accent-soft px-2 py-0.5 font-semibold text-accent-text">Vadeli</li> : null}
                      {smart.dayOffset != null && smart.dayOffset !== 0 ? <li className="rounded-full bg-surface-accent-soft px-2 py-0.5 font-semibold text-accent-text">{smart.dayOffset === -1 ? "Dün" : `${Math.abs(smart.dayOffset)} gün önce`}</li> : null}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              <div className="relative">
                <FormInput
                  ref={amountRef}
                  id="ew-amount"
                  name="amount"
                  inputMode="decimal"
                  autoComplete="off"
                  enterKeyHint="done"
                  placeholder="0"
                  autoFocus={!hidden}
                  value={amountText}
                  aria-required="true"
                  aria-invalid={amountInvalid || undefined}
                  aria-describedby="ew-amount-hint"
                  onChange={(e) => {
                    release("amount");
                    setAmountText(e.target.value);
                  }}
                  // Odakta binliksiz düzenleme biçimi: biçimli "1.500" sonuna rakam eklenince yanlış tutar oluşmaz.
                  onFocus={() => (amount != null && amountText !== formatAmountEdit(amount) ? setAmountText(formatAmountEdit(amount)) : undefined)}
                  onBlur={() => (amount != null ? setAmountText(formatAmountInput(amount)) : undefined)}
                  className="numeric h-14 pr-12 text-2xl font-bold sm:text-3xl"
                />
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-lg font-semibold text-text-faint">
                  {currency === "USD" ? "$" : currency === "EUR" ? "€" : "₺"}
                </span>
              </div>
              <p id="ew-amount-hint" className={cn("text-xs", amountInvalid ? "font-semibold text-danger-strong" : "text-text-muted")}>
                {amountInvalid
                  ? "Tutar anlaşılamadı. Örnek: 1.250,50 · 1250 · 48k · 1,2m"
                  : amount != null && amountText && formatAmountInput(amount) !== amountText && formatAmountEdit(amount) !== amountText
                    ? `= ${formatAccountMoney(amount, currency)}`
                    : "1.250,50 · 48k · 1,2m yazabilirsiniz"}
              </p>
              <EntryLiveSummary compact {...summaryProps} className="lg:hidden" />
            </div>

            {!isTransfer ? (
              <div className="grid gap-2">
                <p id="ew-category-label" className="text-sm font-medium text-ink-950">
                  Kategori<span aria-hidden="true" className="ml-0.5 text-danger-500">*</span>
                </p>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="ew-category-label" aria-required="true">
                  {visibleCats.map((c) => (
                    <RadioChip key={c.value} name="ew-category" checked={effCategory === c.value} onSelect={() => pickCategory(c.value)} className={cn(chipClass(effCategory === c.value), "min-h-11 px-3.5 text-sm")}>
                      {c.label}
                    </RadioChip>
                  ))}
                  {hiddenCatCount > 0 || showAllCats ? (
                    <Button
                      variant="ghost"
                      onClick={() => setShowAllCats((v) => !v)}
                      aria-expanded={showAllCats}
                      className="min-h-11 rounded-full border border-dashed border-line-strong px-3.5 font-semibold"
                    >
                      {showAllCats ? "Daha az" : `Tümü (${cats.length})`}
                    </Button>
                  ) : null}
                </div>
                {historyPick && !category ? (
                  <p className="flex items-center gap-1 text-xs text-text-muted">
                    <Wand2 className="h-3.5 w-3.5 text-accent-text" aria-hidden="true" /> Bu cariye önceki {historyPick.count} kayda göre seçildi; değiştirebilirsiniz.
                  </p>
                ) : suggestion && suggestion.category !== effCategory ? (
                  <Button variant="secondary" size="sm" icon={Wand2} onClick={() => pickCategory(suggestion.category)} className="justify-self-start rounded-full border-dashed text-accent-text">
                    Öneri: {catLabelOf(suggestion.category)}
                  </Button>
                ) : suggestion?.mode === "auto" && suggestion.category === effCategory ? (
                  <p className="flex items-center gap-1 text-xs text-text-muted">
                    <Wand2 className="h-3.5 w-3.5" aria-hidden="true" /> Kategori kurala göre otomatik seçildi.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="grid gap-2">
              <label htmlFor="ew-date" className="text-sm font-medium text-ink-950">
                Tarih
              </label>
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="flex gap-1.5" role="radiogroup" aria-label="Hızlı tarih">
                  <RadioChip name="ew-quick-date" checked={date === today} onSelect={() => { release("date"); setDate(today); }} className={cn(chipClass(date === today), "min-h-11 px-3.5 text-sm")}>
                    Bugün
                  </RadioChip>
                  <RadioChip name="ew-quick-date" checked={date === yesterday} onSelect={() => { release("date"); setDate(yesterday); }} className={cn(chipClass(date === yesterday), "min-h-11 px-3.5 text-sm")}>
                    Dün
                  </RadioChip>
                </div>
                <FormInput
                  id="ew-date"
                  name="date"
                  type="date"
                  value={date}
                  max={today}
                  min="2000-01-01"
                  onChange={(e) => {
                    release("date");
                    setDate(e.target.value);
                  }}
                  className="h-11 w-auto min-w-0 flex-1 basis-40 sm:flex-none"
                />
              </div>
            </div>

            {needsAccount && showAccount ? accountPicker : null}

            {!isTransfer ? (
              <FormField label="Açıklama" htmlFor="ew-title">
                <FormInput
                  id="ew-title"
                  value={title}
                  onChange={(e) => {
                    release("title");
                    setTitle(e.target.value);
                  }}
                  name="title"
                  maxLength={160}
                  enterKeyHint="done"
                  placeholder={direction === "in" ? "ör. Ekim kira yönetim bedeli (boşsa kategori adı)" : "ör. Sahibinden Ekim paketi (boşsa kategori adı)"}
                />
              </FormField>
            ) : (
              <FormField label="Not" htmlFor="ew-note">
                <FormInput id="ew-note" name="note" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="İsteğe bağlı" />
              </FormField>
            )}
          </section>

          {/* Ayrıntılar (isteğe bağlı): tek katlanır bölüm */}
          {!isTransfer ? (
            <section aria-label="Ayrıntılar" className="min-w-0 rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--elev-1)]">
              <Button
                variant="ghost"
                onClick={toggleDetails}
                aria-expanded={detailsOpen}
                aria-controls="ew-details"
                className="h-auto min-h-14 w-full justify-start gap-2 rounded-[var(--radius-card)] px-4 py-2 text-left text-text sm:px-5"
              >
                <SlidersHorizontal className="h-4 w-4 shrink-0 text-text-faint" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-text">Ayrıntılar (isteğe bağlı)</span>
                  <span className="block truncate text-xs text-text-muted">
                    {filledDetails.length > 0
                      ? filledDetails.join(" · ")
                      : officeMode
                        ? "Kişi/firma, vade, KDV ve stopaj, portföy, belge, not, tekrar"
                        : "Karşı taraf, belge, not, tekrar"}
                  </span>
                </span>
                <ChevronDown className={cn("h-4 w-4 shrink-0 text-text-faint transition-transform", detailsOpen && "rotate-180")} aria-hidden="true" />
              </Button>
              <div id="ew-details" hidden={!detailsOpen} className="grid grid-cols-[minmax(0,1fr)] gap-5 border-t border-line px-4 pb-4 pt-4 sm:px-5 sm:pb-5">
                {officeMode ? (
                  <FormField
                    label={direction === "in" ? "Kimden? (kişi ya da firma)" : "Kime? (kişi ya da firma)"}
                    htmlFor="ew-party"
                    required={deferredMode}
                    hint={partyName && !picked ? `Yazılan: ${partyName}. Seçmezseniz bu adla yeni kişi/firma eklenir.` : "Kişi ya da firma; yoksa yazın, yeni kişi/firma olarak eklenir."}
                  >
                    <PartyPicker
                      key={pickerKey}
                      id="ew-party"
                      name="party"
                      defaultValue={picked?.id ?? null}
                      defaultLabel={picked?.name ?? null}
                      kindHint={partyKind}
                      allowCreate
                      onValueChange={(p) => {
                        release("party");
                        setPicked(p ? { id: p.id, name: p.name } : null);
                      }}
                    />
                  </FormField>
                ) : (
                  <FormField label={direction === "in" ? "Kimden?" : "Kime?"} htmlFor="ew-counterparty">
                    <FormInput
                      id="ew-counterparty"
                      maxLength={120}
                      value={partyName ?? ""}
                      onChange={(e) => {
                        release("party");
                        setPartyName(e.target.value || null);
                      }}
                      placeholder={direction === "in" ? "Müşteri / kurum" : "Firma / kişi"}
                    />
                  </FormField>
                )}

                {officeMode ? (
                  <div className="grid gap-2">
                    <p className="text-sm font-medium text-ink-950">Ödeme durumu</p>
                    <div className="grid grid-cols-2 gap-1 rounded-[var(--radius-control)] border border-line bg-canvas p-1" role="radiogroup" aria-label="Ödeme durumu">
                      {[
                        { on: !deferred, label: direction === "in" ? "Tahsil edildi" : "Ödendi", icon: Check, set: false },
                        { on: deferred, label: "Vadeli", icon: CalendarClock, set: true },
                      ].map((o) => (
                        <RadioChip
                          key={o.label}
                          name="ew-paid"
                          checked={o.on}
                          onSelect={() => {
                            release("deferred");
                            setDeferred(o.set);
                            if (o.set) setRepeat(false);
                          }}
                          className={cn(
                            "press inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-[var(--radius-control)] text-sm font-semibold transition",
                            o.on ? "bg-surface text-ink-950 shadow-[var(--shadow-xs)]" : "text-text-muted hover:text-ink-950",
                          )}
                        >
                          <o.icon className="h-4 w-4" aria-hidden="true" />
                          {o.label}
                        </RadioChip>
                      ))}
                    </div>
                    {deferred ? (
                      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
                        <FormField
                          label="Vade tarihi"
                          htmlFor="ew-due"
                          hint={direction === "in" ? "Alacak olarak açılır; tahsil edince Alacak ve borç sekmesinden kapatılır. Hareket şimdi oluşmaz." : "Borç olarak açılır; ödeyince Alacak ve borç sekmesinden kapatılır. Hareket şimdi oluşmaz."}
                        >
                          <FormInput
                            id="ew-due"
                            type="date"
                            value={dueDate}
                            min={date}
                            onChange={(e) => {
                              release("deferred");
                              setDueDate(e.target.value);
                            }}
                          />
                        </FormField>
                        <FormField label="Para birimi" htmlFor="ew-open-currency">
                          <FormSelect id="ew-open-currency" value={openCurrency} onChange={(e) => setOpenCurrency(e.target.value === "USD" || e.target.value === "EUR" ? e.target.value : "TRY")}>
                            <option value="TRY">TL</option>
                            <option value="USD">USD</option>
                            <option value="EUR">EUR</option>
                          </FormSelect>
                        </FormField>
                        <div className="flex flex-wrap gap-1.5 sm:col-span-2" role="radiogroup" aria-label="Hızlı vade">
                          {[7, 15, 30, 60].map((d) => (
                            <RadioChip key={d} name="ew-quick-due" checked={dueDate === shiftDayKey(date, d)} onSelect={() => setDueDate(shiftDayKey(date, d))}>
                              {d} gün
                            </RadioChip>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {needsAccount && !showAccount ? accountPicker : null}

                {officeMode ? (
                  <div className="grid gap-2">
                    <p className="text-sm font-medium text-ink-950">KDV ve stopaj</p>
                    <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="KDV oranı">
                      <span className="mr-1 w-12 text-xs font-semibold text-text-muted">KDV</span>
                      <RadioChip
                        name="ew-vat"
                        checked={vatRate == null}
                        onSelect={() => {
                          release("vat");
                          setVatRate(null);
                        }}
                      >
                        Yok
                      </RadioChip>
                      {LEDGER_VAT_RATES.filter((r) => r > 0).map((r) => (
                        <RadioChip
                          key={r}
                          name="ew-vat"
                          checked={vatRate === r}
                          onSelect={() => {
                            release("vat");
                            setVatRate(r);
                          }}
                        >
                          %{r}
                        </RadioChip>
                      ))}
                      {vatRate != null && vatRate > 0 ? (
                        <span className="ml-auto inline-flex min-h-11 items-center gap-2 text-xs">
                          <label htmlFor="ew-vat-incl" className="font-semibold text-text-muted">
                            {vatIncluded ? "Tutara dahil" : "Tutara ek"}
                          </label>
                          <Switch
                            id="ew-vat-incl"
                            checked={vatIncluded}
                            onCheckedChange={(v) => {
                              release("vatIncluded");
                              setVatIncluded(v);
                            }}
                            aria-label="KDV tutara dahil"
                          />
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Stopaj oranı">
                      <span className="mr-1 w-12 text-xs font-semibold text-text-muted">Stopaj</span>
                      <RadioChip name="ew-wh" checked={withholdingRate == null} onSelect={() => setWithholdingRate(null)}>
                        Yok
                      </RadioChip>
                      {[...new Set<number>([...WITHHOLDING_CHOICES, ...(suggestedWh ? [suggestedWh] : [])])].map((r) => (
                        <RadioChip key={r} name="ew-wh" checked={withholdingRate === r} onSelect={() => setWithholdingRate(r)}>
                          %{r}
                        </RadioChip>
                      ))}
                    </div>
                    {suggestedWh && withholdingRate == null ? (
                      <Button variant="secondary" size="sm" onClick={() => setWithholdingRate(suggestedWh)} className="justify-self-start rounded-full border-dashed text-warning-strong">
                        {isRent ? `İşyeri kirasında %${suggestedWh} stopaj kesilir. Uygula` : `Bu kategoride %${suggestedWh} stopaj önerilir. Uygula`}
                      </Button>
                    ) : null}
                    {withholdingRate && totals?.withheld != null ? (
                      <p className="numeric text-xs text-text-muted">
                        Stopaj %{withholdingRate}: {formatAccountMoney(totals.withheld, currency)} vergi dairesine; hesaptan {direction === "in" ? "giren" : "çıkan"} {formatAccountMoney(totals.cash, currency)}.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {officeMode ? (
                  <FormField label="İlgili portföy" htmlFor="ew-property" hint="Portföy detayındaki gider ve getiri hesabına yansır.">
                    <Combobox
                      id="ew-property"
                      name="property_id"
                      placeholder="Portföy seçin"
                      searchPlaceholder="Portföy kodu veya başlığı…"
                      emptyText="Eşleşen portföy yok"
                      onSearch={searchProperties}
                      options={[]}
                      value={propertyId}
                      onValueChange={setPropertyId}
                      selectedLabel={seed.propertyId && propertyId === seed.propertyId ? (seed.propertyLabel ?? "Seçili portföy") : undefined}
                    />
                  </FormField>
                ) : null}

                {officeMode ? (
                  <FormField label="Belge / fiş" htmlFor="ew-file" inject={false}>
                    <AttachmentField id="ew-file" value={upload} onChange={setUpload} onOcr={onOcr} />
                  </FormField>
                ) : (
                  <FormField label="Belge bağlantısı" htmlFor="ew-doc" hint="Fiş, makbuz veya fatura (https://…)">
                    <FormInput id="ew-doc" name="documentUrl" type="url" inputMode="url" maxLength={500} placeholder="https://" value={documentUrl} onChange={(e) => setDocumentUrl(e.target.value)} />
                  </FormField>
                )}

                <FormField label="Not" htmlFor="ew-note">
                  <FormTextarea id="ew-note" name="note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
                </FormField>

                {!deferredMode ? (
                  <div className="grid gap-3">
                    <div className="flex items-center justify-between gap-3">
                      <label htmlFor="ew-repeat" className="text-sm font-medium text-ink-950">
                        Her ay tekrarla
                        <span className="block text-xs font-normal text-text-muted">Gelecek aydan itibaren aynı tutar düzenli kayıt olarak işlenir.</span>
                      </label>
                      <Switch id="ew-repeat" checked={repeat} onCheckedChange={setRepeat} aria-label="Her ay tekrarla" />
                    </div>
                    {repeat ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <FormField label="Ayın kaçıncı günü?" htmlFor="ew-repeat-day" hint="31 = ayın son günü">
                          <FormInput id="ew-repeat-day" name="repeatDay" type="number" inputMode="numeric" min={1} max={31} value={repeatDay} onChange={(e) => setRepeatDay(e.target.value)} />
                        </FormField>
                        <FormField label="Nasıl işlensin?" htmlFor="ew-repeat-mode">
                          <FormSelect id="ew-repeat-mode" value={repeatMode} onChange={(e) => setRepeatMode(e.target.value === "approve" ? "approve" : "auto")}>
                            <option value="auto">Otomatik kaydet</option>
                            <option value="approve">Bana sor</option>
                          </FormSelect>
                        </FormField>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="hidden min-w-0 lg:sticky lg:top-20 lg:block" aria-label="Canlı özet">
          <EntryLiveSummary {...summaryProps} />
        </aside>
      </div>

      {missingShown && missing.length > 0 ? (
        <p role="status" className="tone-warning rounded-[var(--radius-control)] px-3 py-2 text-xs font-semibold">
          {missing.length} zorunlu alan eksik: {missing.map((m) => m.label).join(", ")}.
        </p>
      ) : null}
      <FormError error={error} nextStep={null} />
      <FormActionBar
        formRef={formRef}
        pending={busy}
        error={error}
        dirty={dirty}
        submitLabel={saveLabel}
        submitDisabled={upload.status === "uploading"}
        cancelHref={ctx.returnHref}
        cancelLabel="Vazgeç"
        missing={missing.map((m) => ({ label: m.label, onGo: () => focusMissing(m.selector) }))}
        progress={{ done: Math.max(0, requiredTotal - missing.length), total: requiredTotal }}
        draft={{ savedAt: draftSavedAt }}
        saveAndNew
        saveAndNewLabel="Kaydet ve yeni"
      />
    </form>
  );
}
