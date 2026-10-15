/**
 * Kiralık işlem süreci (SP4) — SAF. Satıştaki 8 adımlı tapu sürecinin kiralık karşılığı: kira kaydı açıldıktan sonra
 * teslime kadar olan adımlar. Bazı adımlar kayıtlardan KENDİLİĞİNDEN tamamlanır (imzalı kira sözleşmesi, kasaya işlenen
 * depozito + ödenen ilk tahakkuk); diğerleri danışmanın işaretlediği tarihle (`rentals.handover_steps`) tutulur.
 */

export const RENTAL_PROCESS_STEPS = [
  { key: "application", label: "Başvuru ve kiracı kaydı", hint: "Kira kaydı açıldı; kiracı müşteri kaydına bağlandı." },
  { key: "guarantor", label: "Kefil / teminat", hint: "Kefil bilgisi ya da teminat (depozito, senet) netleşti." },
  { key: "owner_approval", label: "Malik onayı", hint: "Kiraya veren kiracıyı ve koşulları onayladı." },
  { key: "contract_signed", label: "Kira sözleşmesi imzalandı", hint: "Kiraya bağlı sözleşme imzalanınca kendiliğinden tamamlanır." },
  { key: "deposit_first_rent", label: "Depozito ve ilk kira", hint: "Depozito kasaya işlenip ilk tahakkuk ödenince kendiliğinden tamamlanır." },
  { key: "handover_report", label: "Teslim tutanağı", hint: "Demirbaş listesi, sayaç değerleri ve fotoğraflarla teslim tutanağı imzalandı." },
  { key: "utilities", label: "Abonelik devri", hint: "Elektrik, su ve doğalgaz abonelikleri kiracı adına açıldı." },
  { key: "keys", label: "Anahtar teslimi", hint: "Anahtarlar kiracıya teslim edildi." },
] as const;

export type RentalProcessStepKey = (typeof RENTAL_PROCESS_STEPS)[number]["key"];

/** Danışmanın elle işaretleyebildiği adımlar ("Başvuru" kira kaydının kendisidir). */
export const MANUAL_RENTAL_STEP_KEYS: readonly RentalProcessStepKey[] = RENTAL_PROCESS_STEPS
  .map((s) => s.key)
  .filter((k) => k !== "application");

export function isManualRentalStepKey(v: unknown): v is RentalProcessStepKey {
  return typeof v === "string" && (MANUAL_RENTAL_STEP_KEYS as readonly string[]).includes(v);
}

/** jsonb `{anahtar: "YYYY-MM-DD"}` güvenli okuma; bilinmeyen anahtar/biçim atılır. */
export function parseHandoverSteps(raw: unknown): Partial<Record<RentalProcessStepKey, string>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Partial<Record<RentalProcessStepKey, string>> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isManualRentalStepKey(k) && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) out[k] = v;
  }
  return out;
}

export type RentalProcessInput = {
  createdDay: string;
  manual: Partial<Record<RentalProcessStepKey, string>>;
  contractStatuses: readonly string[];
  deposit: number | null;
  depositReceived: boolean;
  /** En eski dönemin tahakkuku ödendi mi (kısmi değil). */
  firstChargePaid: boolean;
};

export type RentalProcessStep = {
  key: RentalProcessStepKey;
  label: string;
  hint: string;
  state: "done" | "in_progress" | "todo";
  /** done ise kaynak: kayıtlardan (auto) ya da danışman işaretledi (manual). */
  source: "auto" | "manual" | null;
  doneDay: string | null;
  canToggle: boolean;
};

export function buildRentalProcess(i: RentalProcessInput): { steps: RentalProcessStep[]; done: number; total: number; next: RentalProcessStep | null } {
  const signed = i.contractStatuses.includes("signed");
  const contractInProgress = !signed && i.contractStatuses.some((s) => s === "draft" || s === "sent");
  const depositOk = i.deposit == null || i.deposit <= 0 || i.depositReceived;
  const autoDone: Partial<Record<RentalProcessStepKey, boolean>> = {
    application: true,
    contract_signed: signed,
    deposit_first_rent: depositOk && i.firstChargePaid,
  };
  const inProgress: Partial<Record<RentalProcessStepKey, boolean>> = {
    contract_signed: contractInProgress,
    deposit_first_rent: !(depositOk && i.firstChargePaid) && (i.depositReceived || i.firstChargePaid),
  };

  const steps: RentalProcessStep[] = RENTAL_PROCESS_STEPS.map((s) => {
    const auto = Boolean(autoDone[s.key]);
    const manualDay = i.manual[s.key] ?? null;
    const done = auto || Boolean(manualDay);
    return {
      key: s.key,
      label: s.label,
      hint: s.hint,
      state: done ? "done" : inProgress[s.key] ? "in_progress" : "todo",
      source: auto ? "auto" : manualDay ? "manual" : null,
      doneDay: s.key === "application" ? i.createdDay : auto ? null : manualDay,
      // Kayıtlardan tamamlanan adım elle geri alınamaz (gerçek durum kayıttadır).
      canToggle: isManualRentalStepKey(s.key) && !auto,
    };
  });
  const done = steps.filter((s) => s.state === "done").length;
  return { steps, done, total: steps.length, next: steps.find((s) => s.state !== "done") ?? null };
}
