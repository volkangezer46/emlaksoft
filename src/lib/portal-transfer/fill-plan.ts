import { FIELD_RULES, fold, type FieldRule, type FillFieldKey } from "./rules";
import type { FieldValue, PortalPayload } from "./payload";

/**
 * FORM DOLDURMA PLANI (SAF, testli). Eklenti, portal sekmesinden form denetimlerinin BETİMLEYİCİLERİNİ okur
 * (`page-fns.ts: collectControlsInPage`), burada plan çıkarılır (hangi alana hangi değer), sonra sayfada uygulanır
 * (`applyActionsInPage`). Böylece eşleme mantığı sayfaya taşınmadan test edilir ve DOM'da tahmin yapılmaz:
 * bulunamayan alan, seçenek eşleşmeyen alan ve zaten dolu alan AYRI ve dürüst raporlanır.
 */

export type ControlDescriptor = {
  /** Sayfada `data-emlaksoft-fill` ile damgalanan sıra numarası. */
  idx: number;
  tag: "input" | "select" | "textarea";
  /** input türü (küçük harf; select/textarea için boş). */
  type: string;
  /** Alanı tarif eden ham metinler (etiket, aria, placeholder, ad, kimlik, komşu metin). */
  labels: string[];
  /** select seçenek metinleri (yer tutucu dahil). */
  options: string[];
  /** Seçili seçenek metni (select) ya da ham değer. */
  current: string;
  checked: boolean;
  /** Radyo grubu adı (aynı grup tek soru). */
  group: string;
  /** Radyo/onay kutusunun kendi etiketi. */
  optionText: string;
  disabled: boolean;
  visible: boolean;
};

export type FillAction =
  | { idx: number; op: "text"; field: FillFieldKey; value: string }
  | { idx: number; op: "select"; field: FillFieldKey; optionIndex: number }
  | { idx: number; op: "click"; field: FillFieldKey };

export type FieldStatus = "planned" | "not_found" | "no_option" | "already_filled" | "skipped";
export type FieldReport = { key: FillFieldKey; label: string; status: FieldStatus; detail?: string };
export type FillPlan = { actions: FillAction[]; report: FieldReport[]; manual: string[] };

const NEVER_TYPES = new Set(["hidden", "submit", "button", "image", "reset", "file", "password", "email", "tel", "search", "range", "color", "date", "datetime-local", "time", "month", "week"]);
const PLACEHOLDER_OPTION = /^(seciniz|sec|seciniz\.\.\.|secim yapiniz|seciniz lutfen|lutfen seciniz|tumu|hepsi|-+|\.\.\.)?$/;

const wordIn = (haystack: string, phrase: string) => ` ${haystack} `.includes(` ${phrase} `);

/** camelCase / snake / kebab → boşluk ("m2Brut" → "m2 Brut"). Ad ve kimlik değerleri için. */
export function splitIdentifier(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-.[\]]+/g, " ");
}

function labelScore(rule: FieldRule, rawLabels: readonly string[]): number {
  let best = 0;
  for (const raw of rawLabels) {
    if (!raw || raw.length > 80) continue;
    const f = fold(splitIdentifier(raw));
    if (!f) continue;
    for (const phrase of rule.labels) {
      if (f === phrase) best = Math.max(best, 100);
      else if (wordIn(f, phrase)) best = Math.max(best, 60 - Math.min(30, f.length / 3));
    }
    for (const ex of rule.exact ?? []) {
      if (f === ex) best = Math.max(best, 90);
    }
  }
  return best;
}

function isPlaceholderOption(text: string): boolean {
  return PLACEHOLDER_OPTION.test(fold(text));
}

// ---------------------------------------------------------------- seçenek seçimi

const YES = ["evet", "var", "mevcut", "uygun", "esyali", "kapali"];
const NO = ["hayir", "yok", "esyasiz", "uygun degil"];

/** "21-25", "21 ve uzeri", "5+", "0 (sifir)" gibi sayısal seçeneği {min,max}'a çevirir. */
export function parseNumericOption(text: string): { min: number; max: number } | null {
  const f = fold(text);
  if (!f) return null;
  if (/\b(sifir|yeni)\b/.test(f) && !/\d/.test(f.replace(/\b0\b/, ""))) return { min: 0, max: 0 };
  let m = /^(\d{1,3}) ?(?:-|ile|a) ?(\d{1,3})\b/.exec(f);
  if (!m) m = /^(\d{1,3}) (\d{1,3})(?: (?:yasinda|kat))?$/.exec(f);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  m = /^(\d{1,3}) ?(?:\+|ve uzeri|ve ustu|uzeri|ustu|ve fazlasi)/.exec(f);
  if (m) return { min: Number(m[1]), max: Number.POSITIVE_INFINITY };
  m = /^(\d{1,3})(?: (?:kat|yasinda|adet|banyo|oda))?$/.exec(f);
  if (m) return { min: Number(m[1]), max: Number(m[1]) };
  m = /^(\d{1,3}) (?:kat|yasinda)\b/.exec(f);
  if (m) return { min: Number(m[1]), max: Number(m[1]) };
  return null;
}

function floorWords(n: number): string[] {
  if (n === 0) return ["giris", "zemin", "giris kat", "zemin kat", "bahce kati", "yuksek giris"];
  if (n < 0) return ["bodrum", "bodrum kat", "kot 1", "kot 2", "kot 3"].slice(0, Math.abs(n) === 1 ? 2 : 5);
  return [];
}

/**
 * Bir alan değerine karşılık gelen seçenek sırasını bulur (yoksa null). Kurallar, sırasıyla: bayrak (evet/hayır), sayısal aralık
 * (bina yaşı, kat), tam katlanmış eşitlik, kapsama, sözcük örtüşmesi. Yer tutucu seçenekler hiç seçilmez.
 */
export function chooseOption(key: FillFieldKey, value: FieldValue, options: readonly string[]): number | null {
  const cands = options.map((text, i) => ({ text, i, f: fold(text) })).filter((o) => !isPlaceholderOption(o.text));
  if (cands.length === 0) return null;

  if (typeof value === "boolean") {
    const words = value ? YES : NO;
    const hit = cands.find((o) => words.includes(o.f)) ?? cands.find((o) => words.some((w) => wordIn(o.f, w)));
    return hit ? hit.i : null;
  }

  const numeric = typeof value === "number" ? value : null;
  const numericKeys: FillFieldKey[] = ["building_age", "floor", "total_floors", "bathrooms"];
  if (numeric !== null && numericKeys.includes(key)) {
    const words = key === "floor" ? floorWords(numeric) : [];
    const byWord = cands.find((o) => words.includes(o.f));
    if (byWord) return byWord.i;
    // Önce tek değerli tam eşleşme, sonra aralık.
    const exact = cands.find((o) => {
      const r = parseNumericOption(o.text);
      return r !== null && r.min === numeric && r.max === numeric;
    });
    if (exact) return exact.i;
    const range = cands.find((o) => {
      const r = parseNumericOption(o.text);
      return r !== null && r.min !== r.max && numeric >= r.min && numeric <= r.max;
    });
    return range ? range.i : null;
  }

  const target = fold(String(value)).replace(/ ?\+ ?/g, "+");
  if (!target) return null;
  const norm = (f: string) => f.replace(/ ?\+ ?/g, "+");
  const eq = cands.find((o) => norm(o.f) === target);
  if (eq) return eq.i;
  // Kapsama: yalnız yeterince uzun ifadelerde ("1" gibi kısa değerler yanlış eşleşmesin).
  if (target.length >= 3) {
    const inc = cands.find((o) => o.f.length >= 3 && (norm(o.f).includes(target) || target.includes(norm(o.f))));
    if (inc) return inc.i;
  }
  const tokens = new Set(target.split(" ").filter((t) => t.length > 1));
  if (tokens.size > 0) {
    let best: { i: number; score: number } | null = null;
    for (const o of cands) {
      const ot = new Set(norm(o.f).split(" ").filter((t) => t.length > 1));
      if (ot.size === 0) continue;
      let shared = 0;
      for (const t of tokens) if (ot.has(t)) shared += 1;
      const score = shared / Math.max(tokens.size, ot.size);
      if (score >= 0.6 && (!best || score > best.score)) best = { i: o.i, score };
    }
    if (best) return best.i;
  }
  return null;
}

// ---------------------------------------------------------------- plan

function textFor(value: FieldValue): string {
  if (typeof value === "boolean") return value ? "Evet" : "Hayır";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100).replace(".", ",");
  return value;
}

/**
 * Form betimleyicilerinden doldurma planı üretir. Bir denetim en çok bir alana atanır; her alan için en yüksek puanlı
 * (en kısa ve belirgin etiketli) denetim seçilir. Dolu alanlara DOKUNULMAZ. Telefon/e-posta/parola/dosya denetimleri hiç
 * değerlendirilmez.
 */
export function planFill(descriptors: readonly ControlDescriptor[], payload: PortalPayload): FillPlan {
  const usable = descriptors.filter((d) => d.visible && !d.disabled && !NEVER_TYPES.has(d.type));
  const used = new Set<number>();
  const usedGroups = new Set<string>();
  const actions: FillAction[] = [];
  const report: FieldReport[] = [];

  // Radyo grupları tek soru: grup etiketlerini birleştir, seçenekler = üyelerin kendi metni.
  type Q = { key: string; idxs: number[]; labels: string[]; options: string[]; isRadio: boolean };
  const questions: Q[] = [];
  const groups = new Map<string, ControlDescriptor[]>();
  for (const d of usable) {
    if (d.type === "radio" && d.group) {
      const arr = groups.get(d.group) ?? [];
      arr.push(d);
      groups.set(d.group, arr);
    } else {
      questions.push({ key: `c${d.idx}`, idxs: [d.idx], labels: d.labels, options: d.tag === "select" ? d.options : [], isRadio: false });
    }
  }
  for (const [g, members] of groups) {
    questions.push({ key: `g${g}`, idxs: members.map((m) => m.idx), labels: members.flatMap((m) => m.labels), options: members.map((m) => m.optionText), isRadio: true });
  }
  const byIdx = new Map(usable.map((d) => [d.idx, d]));

  for (const rule of FIELD_RULES) {
    const value = payload.fields[rule.key];
    if (value === undefined) {
      report.push({ key: rule.key, label: rule.label, status: "skipped", detail: "EmlakSoft'ta değer yok" });
      continue;
    }
    let best: { q: Q; score: number } | null = null;
    for (const q of questions) {
      if (used.has(q.idxs[0]!) || (q.isRadio && usedGroups.has(q.key))) continue;
      const score = labelScore(rule, q.labels);
      if (score > 0 && (!best || score > best.score)) best = { q, score };
    }
    if (!best) {
      report.push({ key: rule.key, label: rule.label, status: "not_found", detail: `${textFor(value)}` });
      continue;
    }
    const q = best.q;
    const first = byIdx.get(q.idxs[0]!)!;

    if (q.isRadio) {
      const pick = chooseOption(rule.key, value, q.options);
      if (pick === null) {
        report.push({ key: rule.key, label: rule.label, status: "no_option", detail: `${textFor(value)}` });
        continue;
      }
      used.add(q.idxs[0]!);
      usedGroups.add(q.key);
      const target = byIdx.get(q.idxs[pick]!)!;
      if (target.checked) report.push({ key: rule.key, label: rule.label, status: "already_filled" });
      else {
        actions.push({ idx: target.idx, op: "click", field: rule.key });
        report.push({ key: rule.key, label: rule.label, status: "planned", detail: textFor(value) });
      }
      continue;
    }

    used.add(first.idx);
    if (first.tag === "select") {
      const pick = chooseOption(rule.key, value, first.options);
      if (pick === null) {
        report.push({ key: rule.key, label: rule.label, status: "no_option", detail: `${textFor(value)}` });
        continue;
      }
      const cur = first.current.trim();
      if (cur && !isPlaceholderOption(cur)) {
        report.push({ key: rule.key, label: rule.label, status: "already_filled", detail: cur });
        continue;
      }
      actions.push({ idx: first.idx, op: "select", field: rule.key, optionIndex: pick });
      report.push({ key: rule.key, label: rule.label, status: "planned", detail: textFor(value) });
      continue;
    }
    if (first.tag === "input" && first.type === "checkbox") {
      if (typeof value !== "boolean") {
        report.push({ key: rule.key, label: rule.label, status: "no_option", detail: textFor(value) });
        continue;
      }
      if (first.checked === value) report.push({ key: rule.key, label: rule.label, status: "already_filled" });
      else {
        actions.push({ idx: first.idx, op: "click", field: rule.key });
        report.push({ key: rule.key, label: rule.label, status: "planned", detail: textFor(value) });
      }
      continue;
    }
    // Metin / sayı / çok satırlı.
    if (first.current.trim() !== "") {
      report.push({ key: rule.key, label: rule.label, status: "already_filled", detail: first.current.slice(0, 40) });
      continue;
    }
    const raw = typeof value === "number" ? String(value) : textFor(value);
    actions.push({ idx: first.idx, op: "text", field: rule.key, value: raw });
    report.push({ key: rule.key, label: rule.label, status: "planned", detail: raw.length > 40 ? `${raw.slice(0, 40)}…` : raw });
  }

  const manual = report.filter((r) => r.status === "not_found" || r.status === "no_option").map((r) => `${r.label}: ${r.detail ?? ""}`.trim());
  return { actions, report, manual };
}

/** Uygulama sonuçlarını rapora yansıtır (başarısız uygulama "bulunamadı" sayılır). */
export function mergeApplyResults(plan: FillPlan, results: readonly { idx: number; ok: boolean }[]): FieldReport[] {
  const failed = new Set(results.filter((r) => !r.ok).map((r) => r.idx));
  const failedFields = new Set(plan.actions.filter((a) => failed.has(a.idx)).map((a) => a.field));
  return plan.report.map((r) => (r.status === "planned" && failedFields.has(r.key) ? { ...r, status: "not_found" as const, detail: "yazılamadı" } : r));
}

export function summarizeReport(report: readonly FieldReport[]): { filled: number; manual: number; skipped: number; already: number } {
  return {
    filled: report.filter((r) => r.status === "planned").length,
    manual: report.filter((r) => r.status === "not_found" || r.status === "no_option").length,
    skipped: report.filter((r) => r.status === "skipped").length,
    already: report.filter((r) => r.status === "already_filled").length,
  };
}
