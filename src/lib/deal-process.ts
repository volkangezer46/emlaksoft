/**
 * Satış anlaşması TAPU SÜRECİ adım takibi (SAF; vitest). Tek kaynak: anlaşma detayındaki adım takibi ve
 * müşteri portalındaki (alıcı/satıcı) salt-okunur ilerleme çubuğu aynı hesabı kullanır.
 *
 * Adımlar sabittir (satış): teklif kabul, kapora, ekspertiz/kredi, DASK, TKGM randevusu, harç/döner sermaye, tapu devri,
 * anahtar teslim. Her adım için tarih (planlanan), sorumlu ve not tutulur; "yapıldı" damgası `done_at`.
 * TKGM randevu tarihi için ayrıca anlaşmadaki `title_deed_appointment_at` (GÖS kartı) yedek olarak kullanılır — çift giriş yok.
 *
 * KVKK/dürüstlük: portal görünümü YALNIZ adım adı, durum ve tarih taşır; iç not ve sorumlu kişi portala GİTMEZ
 * (`toPortalSteps` bunu sağlar, test kilitler). Para/IBAN alanı yoktur.
 */

export type DealProcessStepKey =
  | "offer_accepted"
  | "deposit"
  | "appraisal_credit"
  | "dask"
  | "tkgm_appointment"
  | "fees"
  | "title_transfer"
  | "key_handover";

export const DEAL_PROCESS_STEPS: readonly { key: DealProcessStepKey; label: string; hint: string }[] = [
  { key: "offer_accepted", label: "Teklif kabul", hint: "Alıcı teklifi satıcı tarafından kabul edildi." },
  { key: "deposit", label: "Kapora", hint: "Kapora/ön ödeme sözleşme ile alındı (para ürünün içinden geçmez)." },
  { key: "appraisal_credit", label: "Ekspertiz / kredi", hint: "Banka ekspertizi ve (varsa) konut kredisi onayı." },
  { key: "dask", label: "DASK", hint: "Zorunlu deprem sigortası poliçesi." },
  { key: "tkgm_appointment", label: "TKGM randevusu", hint: "Tapu müdürlüğü randevusu alındı." },
  { key: "fees", label: "Harç / döner sermaye", hint: "Tapu harcı ve döner sermaye bedeli ödendi." },
  { key: "title_transfer", label: "Tapu devri", hint: "Tapu müdürlüğünde devir tamamlandı." },
  { key: "key_handover", label: "Anahtar teslim", hint: "Taşınmaz ve anahtarlar teslim edildi." },
] as const;

export const DEAL_PROCESS_KEYS: readonly DealProcessStepKey[] = DEAL_PROCESS_STEPS.map((s) => s.key);

export function isDealProcessKey(v: unknown): v is DealProcessStepKey {
  return typeof v === "string" && (DEAL_PROCESS_KEYS as readonly string[]).includes(v);
}

export const DEAL_PROCESS_NOTE_MAX = 500;

/** DB satırı (yalnız ilgili alanlar). */
export type DealProcessRow = {
  stepKey: string;
  doneAt: string | null;
  plannedAt: string | null;
  assignedTo: string | null;
  note: string | null;
};

export type DealProcessStatus = "done" | "overdue" | "current" | "upcoming";

export type DealProcessStep = {
  key: DealProcessStepKey;
  label: string;
  hint: string;
  status: DealProcessStatus;
  doneAt: string | null;
  plannedAt: string | null;
  assignedTo: string | null;
  note: string | null;
};

export type DealProcessView = {
  steps: DealProcessStep[];
  doneCount: number;
  total: number;
  /** 0-100 (tamamlanan adım / toplam). */
  percent: number;
  /** İlk tamamlanmamış adım; hepsi bittiyse null. */
  currentKey: DealProcessStepKey | null;
  overdueCount: number;
  complete: boolean;
};

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * Satırlardan görünüm üretir. `nowMs` dışarıdan gelir (bileşenlerde Date.now yasak).
 * `titleDeedAt`: anlaşmadaki tapu randevu tarihi; TKGM adımında planlanan tarih boşsa yedek olur.
 * Durum: done · overdue (planlanan tarih geçmiş, yapılmamış) · current (ilk yapılmamış) · upcoming.
 */
export function buildDealProcess(rows: readonly DealProcessRow[], nowMs: number, titleDeedAt?: string | null): DealProcessView {
  const byKey = new Map<string, DealProcessRow>();
  for (const r of rows) byKey.set(r.stepKey, r);

  let currentSeen = false;
  let overdueCount = 0;
  const steps: DealProcessStep[] = DEAL_PROCESS_STEPS.map((def) => {
    const row = byKey.get(def.key);
    const doneAt = row?.doneAt ?? null;
    const plannedAt = row?.plannedAt ?? (def.key === "tkgm_appointment" ? (titleDeedAt ?? null) : null);
    let status: DealProcessStatus;
    if (doneAt) status = "done";
    else {
      const p = ms(plannedAt);
      if (p !== null && p < nowMs) {
        status = "overdue";
        overdueCount += 1;
        currentSeen = true;
      } else if (!currentSeen) {
        status = "current";
        currentSeen = true;
      } else status = "upcoming";
    }
    return {
      key: def.key,
      label: def.label,
      hint: def.hint,
      status,
      doneAt,
      plannedAt,
      assignedTo: row?.assignedTo ?? null,
      note: row?.note ?? null,
    };
  });

  const doneCount = steps.filter((s) => s.status === "done").length;
  const total = steps.length;
  const firstOpen = steps.find((s) => s.status !== "done") ?? null;
  return {
    steps,
    doneCount,
    total,
    percent: Math.round((doneCount / total) * 100),
    currentKey: firstOpen ? firstOpen.key : null,
    overdueCount,
    complete: doneCount === total,
  };
}

export type PortalProcessStep = { key: DealProcessStepKey; label: string; status: Exclude<DealProcessStatus, "overdue">; doneAt: string | null; plannedAt: string | null };
export type PortalProcessView = { steps: PortalProcessStep[]; doneCount: number; total: number; percent: number; complete: boolean };

/** Müşteri portalı görünümü: not ve sorumlu kişi ÇIKARILIR; "gecikti" müşteriye "sırada" olarak sadeleşir. */
export function toPortalSteps(view: DealProcessView): PortalProcessView {
  return {
    steps: view.steps.map((s) => ({
      key: s.key,
      label: s.label,
      status: s.status === "overdue" ? "current" : s.status,
      doneAt: s.doneAt,
      plannedAt: s.plannedAt,
    })),
    doneCount: view.doneCount,
    total: view.total,
    percent: view.percent,
    complete: view.complete,
  };
}

export type DealProcessInput = { ok: true; value: { plannedAt: string | null; assignedTo: string | null; note: string | null; done: boolean } } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Form girdisini doğrular. Tarih ISO (sunucuda `parseTrLocalDateTime` ile çözülmüş) beklenir. */
export function parseDealProcessInput(raw: { plannedAt?: string | null; assignedTo?: string | null; note?: string | null; done?: unknown }): DealProcessInput {
  const note = String(raw.note ?? "").replace(/\s+/g, " ").trim();
  if (note.length > DEAL_PROCESS_NOTE_MAX) return { ok: false, error: `Not en fazla ${DEAL_PROCESS_NOTE_MAX} karakter olabilir.` };
  const assigned = String(raw.assignedTo ?? "").trim();
  if (assigned && !UUID_RE.test(assigned)) return { ok: false, error: "Sorumlu seçimi geçersiz." };
  let plannedAt: string | null = null;
  const p = String(raw.plannedAt ?? "").trim();
  if (p) {
    const t = Date.parse(p);
    if (Number.isNaN(t)) return { ok: false, error: "Tarih geçerli değil." };
    const y = new Date(t).getUTCFullYear();
    if (y < 2020 || y > 2100) return { ok: false, error: "Tarih yılı 2020-2100 arasında olmalı." };
    plannedAt = new Date(t).toISOString();
  }
  return { ok: true, value: { plannedAt, assignedTo: assigned || null, note: note || null, done: raw.done === true || raw.done === "true" || raw.done === "on" } };
}

/** Tablo yok (migration uygulanmadı) hatası mı? Bölüm "etkin değil" der, sayfa kırılmaz. */
export function isMissingDealProcessTable(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /deal_process_steps/.test(String(error.message ?? ""));
}
