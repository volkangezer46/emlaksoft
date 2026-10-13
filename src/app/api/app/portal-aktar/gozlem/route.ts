import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { isMissingSchema } from "@/lib/listing-control/server/db";
import { Redactor } from "@/lib/ai/redact";
import { guardBridgeRequest, NO_STORE } from "@/lib/portal-transfer/bridge-guard";
import { EXT_VERSION_HEADER } from "@/lib/listing-control/worker/bridge-request";
import { isSupportedExtension } from "@/lib/portal-rules/server/serve";
import { FILL_FIELD_KEYS } from "@/lib/portal-transfer/rules";
import {
  FEEDBACK_CONTROLS,
  FEEDBACK_LIMITS,
  FEEDBACK_MAX_BYTES,
  FEEDBACK_OUTCOMES,
  FEEDBACK_PHASES,
  LABEL_SOURCES,
  sanitizeFeedbackPayload,
  type FeedbackPayload,
} from "@/lib/portal-transfer/feedback-format";

export const dynamic = "force-dynamic";

const MAX_BODY = FEEDBACK_MAX_BYTES;
/** Kiracı başına dakikalık üst sınır (kullanıcı başına 20/dk ayrıca guard'da; O3: çok kullanıcılı sel). */
const TENANT_LIMIT_PER_MIN = 60;

const text = z.string().max(200);
const correctionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("other_option"), option: text, valueKey: z.string().max(40).optional() }).strict(),
  z.object({ kind: z.literal("value_edited"), category: z.enum(["format", "rewritten"]) }).strict(),
  z.object({ kind: z.literal("cleared") }).strict(),
]);
const fieldSchema = z
  .object({
    sig: z.string().regex(/^[0-9a-f]{64}$/),
    key: z.enum(FILL_FIELD_KEYS).nullable(),
    control: z.enum(FEEDBACK_CONTROLS),
    label: text,
    labelSource: z.enum(LABEL_SOURCES),
    options: z.array(text).max(200),
    required: z.boolean(),
    outcome: z.enum(FEEDBACK_OUTCOMES),
    correction: correctionSchema.optional(),
    anchorHit: z.boolean().optional(),
  })
  .strict();
/** Değer taşıyan anahtar (value/current/checked/text/title/description) şemada YOK: .strict() reddeder. */
const bodySchema = z
  .object({
    v: z.literal(1),
    sessionId: z.string().uuid(),
    portal: z.enum(["sahibinden", "hepsiemlak", "emlakjet"]),
    engine: z.literal("f1"),
    ruleVersion: z.number().int().min(0).max(2_147_483_647),
    ruleSha: z.string().regex(/^[0-9a-f]{16,64}$/),
    phase: z.enum(FEEDBACK_PHASES),
    formFp: z.string().regex(/^[0-9a-f]{64}$/),
    rulesRegressed: z.boolean(),
    consentTextVersion: z.number().int().min(1).max(1000),
    counts: z.object({ controls: z.number().int().min(0).max(2000), droppedPii: z.number().int().min(0).max(2000) }).strict(),
    fields: z.array(fieldSchema).max(FEEDBACK_LIMITS.maxFields),
  })
  .strict();

/** Sunucu ikinci savunması: Redactor bir şey maskelediyse (telefon, TC, e-posta, IBAN, kart) o öğe atılır. */
function redactorPass(p: FeedbackPayload): { payload: FeedbackPayload; dropped: number } {
  const r = new Redactor();
  const clean = (s: string) => r.redactText(s) === s;
  let dropped = 0;
  const fields = [];
  for (const f of p.fields) {
    if (!clean(f.label)) {
      dropped++;
      continue;
    }
    const options = f.options.filter((o) => clean(o));
    dropped += f.options.length - options.length;
    if (f.correction?.kind === "other_option" && !options.includes(f.correction.option)) {
      dropped++;
      continue;
    }
    fields.push({ ...f, options });
  }
  return { payload: { ...p, fields }, dropped };
}

const OUTCOME_STATUS: Record<string, number> = {
  forbidden: 403,
  invalid: 404,
  expired: 410,
  invalid_state: 409,
  consent_required: 400,
  invalid_input: 400,
};

/**
 * POST /api/app/portal-aktar/gozlem — rızalı form geri bildirimi (şema + sonuç türü; kullanıcı değeri YOK). Kapılar: aynı
 * köken + köprü başlığı + oturum + kullanıcı 20/dk + portals/edit + eklenti ≥0.6.0 + kiracı 60/dk; gövde ≤48 KB (413);
 * zod .strict() (400) → `sanitizeFeedbackPayload` → Redactor → `pt_report_form_feedback` (SQL'de oturum sahipliği, ≤24 saat,
 * günlük kiracı kotaları ve desen kontrolü tekrar). Kişisel veriye takılan öğe isteği düşürmez, yalnız atılır.
 */
export async function POST(request: Request) {
  const guard = await guardBridgeRequest(request, { rateKey: "pt-gozlem", limit: 20, permissions: [["portals", "edit"]] });
  if (!guard.ok) return guard.response;
  if (!isSupportedExtension(request.headers.get(EXT_VERSION_HEADER))) {
    return NextResponse.json({ ok: false, error: "upgrade_required" }, { status: 426, headers: NO_STORE });
  }
  const tenantLimit = await checkRateLimit(`pt-gozlem-ofis:${guard.gate.tenantId}`, { limit: TENANT_LIMIT_PER_MIN, windowSec: 60, failurePolicy: "deny" });
  if (!tenantLimit.allowed) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } });

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400, headers: NO_STORE });
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY) return NextResponse.json({ ok: false, error: "too_large" }, { status: 413, headers: NO_STORE });
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400, headers: NO_STORE });
  }
  const sanitized = sanitizeFeedbackPayload(parsed);
  if (!sanitized.payload) return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400, headers: NO_STORE });
  const second = redactorPass(sanitized.payload);

  const db = await createClient();
  const { data, error } = await db.rpc("pt_report_form_feedback", { p_session_id: second.payload.sessionId, p_payload: second.payload });
  if (error) {
    console.error("pt_report_form_feedback", { code: error.code });
    return NextResponse.json({ ok: false, error: isMissingSchema(error) ? "schema_pending" : "rpc_error" }, { status: 502, headers: NO_STORE });
  }
  const r = (data ?? {}) as { outcome?: string; accepted?: number; dropped?: number; limited?: number };
  if (r.outcome !== "ok") {
    const outcome = String(r.outcome ?? "rpc_error");
    return NextResponse.json({ ok: false, error: outcome }, { status: OUTCOME_STATUS[outcome] ?? 400, headers: NO_STORE });
  }
  return NextResponse.json(
    { ok: true, accepted: Number(r.accepted ?? 0), dropped: sanitized.dropped + second.dropped + Number(r.dropped ?? 0), limited: Number(r.limited ?? 0) },
    { headers: NO_STORE },
  );
}
