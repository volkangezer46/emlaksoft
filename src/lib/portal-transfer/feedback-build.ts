import type { FieldOutcome } from "./correction";
import { FEEDBACK_CONSENT_TEXT_VERSION, FEEDBACK_VERSION, sanitizeFeedbackPayload, type FeedbackField, type FeedbackPhase, type SanitizeResult } from "./feedback-format";
import type { ControlDescriptor, FillPlan } from "./fill-plan";
import { formShapes, sigIndex, type SignedShape } from "./form-signature";
import type { FieldValue } from "./payload";
import { fold, type FillFieldKey, type TransferPortal } from "./rules";

/**
 * GERİ BİLDİRİM YÜKÜ ÜRETİCİSİ (SAF, testli). Doldurma planından, imzalı form şemasından ve (kontrol/bağlama anında)
 * düzeltme sonuçlarından `FeedbackPayload` kurar ve ZORUNLU olarak ortak kişisel veri süzgecinden geçirir
 * (`sanitizeFeedbackPayload`). Değer alanı ÜRETMEZ: yük yalnız şema (bağlı etiket, tür, portal seçenekleri, zorunlu işareti),
 * sonuç türü ve düzeltme türü taşır. Kişisel denetimler şemaya hiç girmez (yalnız sayaç). Rıza yoksa çağrılmaz.
 */

const SEED_RULE_SHA = "0000000000000000";
const VALUE_KEY = /^[a-z0-9 ]{1,40}$/;

export type BuildFeedbackInput = {
  sessionId: string;
  portal: TransferPortal;
  phase: FeedbackPhase;
  plan: Pick<FillPlan, "report" | "unclaimed" | "ruleVersion" | "ruleSha" | "rulesRegressed">;
  descs: readonly ControlDescriptor[];
  signed: readonly SignedShape[];
  formFp: string;
  /** Kontrol/bağlama anındaki düzeltme sonuçları (yalnız "checked"/"published"). */
  outcomes?: readonly FieldOutcome[];
  /**
   * Seçim düzeltmesinde öğrenme anahtarı (`valueKey`): EmlakSoft'un KENDİ alan değeri katlanmış haliyle (ör. "dogalgaz").
   * Yalnız seçim alanlarında ve kısa sözlük değerlerinde gönderilir; serbest metin değeri asla.
   */
  values?: Partial<Record<FillFieldKey, FieldValue>>;
};

function valueKeyOf(v: FieldValue | undefined): string | null {
  if (v === undefined) return null;
  const f = typeof v === "boolean" ? (v ? "evet" : "hayir") : fold(String(v));
  return VALUE_KEY.test(f) ? f : null;
}

export function buildFeedback(input: BuildFeedbackInput): SanitizeResult {
  const byIdx = sigIndex(input.signed);
  const { personal } = formShapes(input.descs);
  const fields: FeedbackField[] = [];
  const seen = new Set<string>();
  const outcomeBySig = new Map((input.outcomes ?? []).map((o) => [o.sig, o]));

  const base = (shape: SignedShape) => ({ sig: shape.sig, control: shape.control, label: shape.label, labelSource: shape.labelSource, options: [...shape.options], required: shape.required });
  const fromOutcome = (shape: SignedShape, o: FieldOutcome): FeedbackField => {
    const field: FeedbackField = { ...base(shape), key: o.key, outcome: o.outcome };
    if (o.correction?.kind === "other_option") {
      const choice = shape.control === "choice" || shape.control === "bool";
      const vk = choice ? valueKeyOf(input.values?.[o.key]) : null;
      field.correction = vk ? { kind: "other_option", option: o.correction.option, valueKey: vk } : { kind: "other_option", option: o.correction.option };
    } else if (o.correction?.kind === "value_edited") field.correction = { kind: "value_edited", category: o.correction.category };
    else if (o.outcome === "cleared") field.correction = { kind: "cleared" };
    return field;
  };

  for (const r of input.plan.report) {
    if (r.idx === undefined) continue;
    const shape = byIdx.get(r.idx);
    if (!shape || seen.has(shape.sig)) continue;
    let field: FeedbackField | null = null;
    const o = outcomeBySig.get(shape.sig);
    if (o && o.key === r.key) field = fromOutcome(shape, o);
    else if (r.status === "planned") field = { ...base(shape), key: r.key, outcome: "filled" };
    else if (r.status === "already_filled") field = { ...base(shape), key: r.key, outcome: "already_filled" };
    else if (r.status === "no_option") field = { ...base(shape), key: r.key, outcome: "no_option" };
    if (!field) continue;
    if (r.anchorHit !== undefined) field.anchorHit = r.anchorHit;
    seen.add(shape.sig);
    fields.push(field);
  }
  // Plan raporunda olmayan düzeltme sonuçları (popup yeniden açıldı ya da sayfa yeniden çizildi): şema şimdiki sayfadan.
  const bySig = new Map(input.signed.map((s) => [s.sig, s]));
  for (const o of input.outcomes ?? []) {
    const shape = bySig.get(o.sig);
    if (!shape || seen.has(o.sig)) continue;
    seen.add(o.sig);
    fields.push(fromOutcome(shape, o));
  }
  for (const idx of input.plan.unclaimed) {
    const shape = byIdx.get(idx);
    if (!shape || seen.has(shape.sig)) continue;
    seen.add(shape.sig);
    fields.push({ ...base(shape), key: null, outcome: "unmatched" });
  }

  return sanitizeFeedbackPayload({
    v: FEEDBACK_VERSION,
    sessionId: input.sessionId,
    portal: input.portal,
    engine: "f1",
    ruleVersion: input.plan.ruleVersion,
    ruleSha: input.plan.ruleSha ?? SEED_RULE_SHA,
    phase: input.phase,
    formFp: input.formFp,
    rulesRegressed: input.plan.rulesRegressed === true,
    consentTextVersion: FEEDBACK_CONSENT_TEXT_VERSION,
    counts: { controls: Math.min(2000, input.descs.length), droppedPii: Math.min(2000, personal) },
    fields,
  });
}
