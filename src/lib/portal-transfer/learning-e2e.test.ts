import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlDescriptor } from "./fill-plan";
import { planFill } from "./fill-plan";
import { buildPortalPayload, type PortalPropertyInput } from "./payload";
import { canonicalJson, signedMessage, validateRuleSet, type RuleSet } from "./rule-format";
import { applyProposals, restamp, stampFor } from "./rule-apply";
import { seedRuleSet } from "./seed-rules";
import { decideAccept, type StoredRules } from "./rules-store";
import { formFingerprint, formShapes, sigIndex, signShapes } from "./form-signature";
import { buildSnapshot, diffSnapshot } from "./correction";
import { buildFeedback } from "./feedback-build";
import { sanitizeFeedbackPayload } from "./feedback-format";
import type { ReadValue } from "./page-fns";

/**
 * ÖĞRENEN FORM KURALLARI — UÇTAN UCA (SAF, AĞSIZ). Sunucu, eklenti ve geri bildirim parçalarını tek zincirde koşar:
 * tohum → applyProposals → validateRuleSet → imza (test anahtarı, node:crypto IEEE-P1363) → decideAccept (eklenti, WebCrypto)
 * → planFill → anlık görüntü → diffSnapshot → buildFeedback → sanitizeFeedbackPayload → /gozlem ucunun zod şeması.
 * Ağ yok: gözlem ucunun kapıları ve RPC'si sahte; yalnız şema ve süzgeç gerçek kodla çalışır.
 */

const rpc = vi.fn();
vi.mock("@/lib/portal-transfer/bridge-guard", () => ({
  NO_STORE: { "Cache-Control": "no-store" },
  guardBridgeRequest: async () => ({ ok: true, gate: { tenantId: "00000000-0000-4000-8000-0000000000aa", userId: "00000000-0000-4000-8000-0000000000bb" } }),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true, remaining: 10 }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));

const PORTAL = "sahibinden" as const;
const KID = "test-k1";
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const KEYS = { [KID]: publicKey.export({ format: "jwk" }) as JsonWebKey };
const T0 = Date.parse("2026-11-02T03:40:00Z");
const DAY = 86_400_000;
const INSTALLED = "0.6.0";
const SESSION = "4f1c2b7a-9d3e-4a51-8c6b-2e0f9a1d7c35";

/** Sunucunun yayın anında yaptığı: sha = sha256(canonicalJson(rules)), imza = ECDSA P-256 / SHA-256, r||s (P1363), base64url. */
function envelopeFor(rules: RuleSet, key = privateKey) {
  const sha = createHash("sha256").update(canonicalJson(rules)).digest("hex");
  const sig = sign("sha256", Buffer.from(signedMessage(rules.portal, rules.version, sha)), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return { portal: rules.portal, rules, sha256: sha, kid: KID, sig };
}

/** Arka plan `rulesPut` semantiği: yalnız kabul edilen set depoya ileri yazılır; ret son iyi seti korur. */
async function put(lastGood: StoredRules | null, env: unknown, nowMs: number) {
  const d = await decideAccept(lastGood, env, { installedVersion: INSTALLED, nowMs, keys: KEYS });
  return { decision: d, stored: d.accept ? d.entry : lastGood };
}

function d(p: Partial<ControlDescriptor> & { idx: number; labels: string[] }): ControlDescriptor {
  return { tag: "input", type: "text", options: [], current: "", checked: false, group: "", optionText: "", disabled: false, visible: true, required: false, sources: ["label_for"], ...p };
}

const input: PortalPropertyInput = {
  id: "p1",
  propertyCode: "ES-2611-AB12CD",
  title: "Kadıköy Moda 3+1",
  transactionType: "Satılık",
  propertyType: "Daire",
  listPrice: 6_750_000,
  provinceName: "İstanbul",
  districtName: "Kadıköy",
  neighborhoodName: "Moda",
  addressLine: null,
  features: { rooms: "3 + 1", sqm: 120, net_sqm: 105, heating: "Kombi (Doğalgaz)", description: "<p>Güzel daire</p>" },
  parcelBlock: null,
  parcelLot: null,
  swapOk: false,
  eidsPropertyNo: "ABC-123456",
  authorityDocNo: null,
  authorityEidsStatus: null,
  authorizationStart: null,
  authorizationEnd: null,
  deedStatus: "kat_mulkiyeti",
  photos: [],
};

/** Portalın formu: ısıtma alanı tohumun tanımadığı "Yakıt Tipi" etiketiyle; bir kişisel denetim ve bir eşleşmeyen soru. */
const FORM: ControlDescriptor[] = [
  d({ idx: 0, labels: ["İlan Başlığı"], required: true }),
  d({ idx: 1, labels: ["Fiyat"], type: "number", required: true }),
  d({ idx: 2, tag: "select", type: "", labels: ["Yakıt Tipi"], options: ["Seçiniz", "Soba", "Doğalgaz (Kombi)"], current: "Seçiniz" }),
  d({ idx: 3, type: "tel", labels: ["Cep Telefonu"] }),
  d({ idx: 4, tag: "select", type: "", labels: ["Kimden"], options: ["Seçiniz", "Emlak Ofisinden", "Sahibinden"], current: "Seçiniz" }),
];

/** Personel onayıyla gelen öneriler (portal_rule_proposals satırı biçimi). */
const PROPOSALS = [
  { id: "pr-1", kind: "label_map" as const, field_key: "heating" as const, source: "staff" as const, proposal: { label: "yakit tipi" } },
  { id: "pr-2", kind: "option_map" as const, field_key: "heating" as const, source: "staff" as const, proposal: { value: "kombi dogalgaz", alias: "dogalgaz kombi" } },
];

function publishV1(): RuleSet {
  const r = applyProposals(seedRuleSet(PORTAL), PROPOSALS, { maxChanges: 5, stamp: { ...stampFor(1, T0, 14), minExtension: INSTALLED } });
  if (!r.ok) throw new Error(`applyProposals: ${r.reason}`);
  return r.content;
}

describe("öğrenen form kuralları: uçtan uca zincir", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: { outcome: "ok", accepted: 3, dropped: 0 }, error: null });
  });

  it("tohum → öneri → doğrula → imzala → kabul → doldur → düzeltme → geri bildirim → gözlem şeması", async () => {
    // 1) Sunucu: tohumdan yeni sürüm (öneri uygulanır, aynı doğrulayıcıdan geçer).
    const v1 = publishV1();
    expect(v1.version).toBe(1);
    expect(validateRuleSet(v1, { allowSeed: false }).ok).toBe(true);
    expect(v1.fields.find((f) => f.key === "heating")!.labels).toContain("yakit tipi");

    // 2) Eklenti: imzalı zarf kabul edilir (sha TS canonicalJson ile aynı; P1363 imza WebCrypto'da doğrulanır).
    const { decision, stored } = await put(null, envelopeFor(v1), T0 + 60_000);
    expect(decision.accept).toBe(true);
    expect(stored?.version).toBe(1);

    // 3) Popup: kabul edilen setle plan; tohum aynı formda ısıtmayı BULAMAZ, öğrenilen etiket bulur.
    const payload = buildPortalPayload(input, PORTAL, T0);
    const seedPlan = planFill(FORM, payload);
    const plan = planFill(FORM, payload, v1);
    expect(seedPlan.report.find((r) => r.key === "heating")!.status).toBe("not_found");
    expect(plan.actions).toContainEqual({ idx: 2, op: "select", field: "heating", optionIndex: 2 });
    expect(plan.actions.some((a) => a.idx === 3)).toBe(false); // telefon denetimine asla dokunulmaz
    expect(plan.ruleVersion).toBe(1);

    // 4) Doldurma sonrası anlık görüntü (yalnız özet / seçenek metni), kullanıcı ısıtmayı "Soba" yapar.
    const { shapes } = formShapes(FORM);
    const signed = await signShapes(shapes);
    const fp = await formFingerprint(shapes);
    const bySig = sigIndex(signed);
    const applied = plan.actions.map((a) => ({ idx: a.idx, ok: true }));
    const afterFill: ReadValue[] = [
      { idx: 0, kind: "text", valueHash: "1a2b3c4d" },
      { idx: 1, kind: "text", valueHash: "5e6f7a8b", digitsHash: "9c0d1e2f" },
      { idx: 2, kind: "select", option: "Doğalgaz (Kombi)" },
    ];
    const snap = buildSnapshot({ sessionId: SESSION, portal: PORTAL, ruleVersion: plan.ruleVersion, ruleSha: plan.ruleSha, at: T0 }, plan.actions, applied, afterFill, bySig, FORM);
    expect(JSON.stringify(snap)).not.toMatch(/Kadıköy|6750000|6\.750\.000|Güzel daire/);
    const beforePublish: ReadValue[] = [afterFill[0]!, { idx: 1, kind: "text", valueHash: "aa11bb22", digitsHash: "9c0d1e2f" }, { idx: 2, kind: "select", option: "Soba" }];
    const outcomes = diffSnapshot(snap, beforePublish, { shapes: bySig, descs: FORM });
    const byKey = Object.fromEntries(outcomes.map((o) => [o.key, o]));
    expect(byKey.title!.outcome).toBe("accepted");
    expect(byKey.price).toMatchObject({ outcome: "corrected", correction: { kind: "value_edited", category: "format" } });
    expect(byKey.heating).toMatchObject({ outcome: "corrected", correction: { kind: "other_option", option: "soba" } });

    // 5) Geri bildirim (rıza varsayılır): değer yok, kişisel denetim yok; süzgeç idempotent. Popup'taki gibi `values` (payload.fields)
    // geçilir ve kontrol anındaki sayfa kullanıcı değerlerini taşır; böylece değer sızmama iddiası values→valueKey dalında da sınanır.
    const atCheck: ControlDescriptor[] = FORM.map((c) =>
      c.idx === 0 ? { ...c, current: "Kadıköy Moda 3+1" } : c.idx === 1 ? { ...c, current: "6750000" } : c.idx === 2 ? { ...c, current: "Soba" } : c.idx === 3 ? { ...c, current: "0532 123 45 67" } : c,
    );
    const fb = buildFeedback({ sessionId: SESSION, portal: PORTAL, phase: "checked", plan, descs: atCheck, signed, formFp: fp, outcomes, values: payload.fields });
    expect(fb.payload).not.toBeNull();
    const body = fb.payload!;
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/"(value|current|checked|text|title|description)"\s*:/);
    expect(text).not.toMatch(/cep telefonu|Kadıköy|kadikoy|moda 3|6750000|6\.750\.000|6 750 000|0532|5321234567|güzel daire/i);
    // values dalı gerçekten çalıştı: seçim düzeltmesi yalnız EmlakSoft'un katlanmış sözlük değerini taşır.
    expect(body.fields.find((f) => f.key === "heating")!.correction).toEqual({ kind: "other_option", option: "soba", valueKey: "kombi dogalgaz" });
    // Serbest metin/sayı alanı düzeltmesi yalnız kategori taşır.
    expect(body.fields.find((f) => f.key === "price")!.correction).toEqual({ kind: "value_edited", category: "format" });
    expect(body.fields.some((f) => f.key === null && f.outcome === "unmatched" && f.label === "kimden")).toBe(true);
    const again = sanitizeFeedbackPayload(body);
    expect(again.payload).toEqual(body);
    expect(again.dropped).toBe(0);

    // 6) Sunucu: /gozlem ucu (gerçek zod .strict() şeması + süzgeç; kapılar ve RPC sahte) yükü kabul eder.
    const { POST } = await import("@/app/api/app/portal-aktar/gozlem/route");
    const { EXT_VERSION_HEADER } = await import("@/lib/listing-control/worker/bridge-request");
    const res = await POST(new Request("https://emlaksoft.com.tr/api/app/portal-aktar/gozlem", { method: "POST", headers: { [EXT_VERSION_HEADER]: INSTALLED, "content-type": "application/json" }, body: text }));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]![0]).toBe("pt_report_form_feedback");
    expect(JSON.stringify(rpc.mock.calls[0]![1])).not.toMatch(/"(value|current|checked)"\s*:/);

    // Değer taşıyan anahtar eklenmiş yük şemadan dönmez (400), RPC'ye ulaşmaz.
    const bad = JSON.parse(text) as { fields: Record<string, unknown>[] };
    bad.fields[0]!.value = "6.750.000";
    const res2 = await POST(new Request("https://emlaksoft.com.tr/api/app/portal-aktar/gozlem", { method: "POST", headers: { [EXT_VERSION_HEADER]: INSTALLED }, body: JSON.stringify(bad) }));
    expect(res2.status).toBe(400);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("bozuk imza, değiştirilmiş içerik ya da bilinmeyen anahtar → ret; son iyi set (v1) kalır ve doldurma onunla sürer", async () => {
    const v1 = publishV1();
    const { stored: good } = await put(null, envelopeFor(v1), T0 + 60_000);
    expect(good?.version).toBe(1);

    const v2 = restamp(v1, { ...stampFor(2, T0 + DAY, 14), minExtension: INSTALLED });
    const env2 = envelopeFor(v2);
    const sigBytes = Buffer.from(env2.sig, "base64url");
    sigBytes[5] ^= 0xff;
    const broken = await put(good, { ...env2, sig: sigBytes.toString("base64url") }, T0 + DAY + 60_000);
    expect(broken.decision.accept).toBe(false);
    expect(broken.stored).toBe(good);

    // İmza geçerli ama içerik yolda değişmiş (sha tutmaz): ret.
    const tampered = { ...env2, rules: { ...v2, fields: v2.fields.map((f) => (f.key === "price" ? { ...f, labels: [...f.labels, "kimden"] } : f)) } };
    expect((await put(good, tampered, T0 + DAY + 60_000)).decision.accept).toBe(false);

    // Başka bir anahtarla imzalanmış set (sızmış/yabancı anahtar): ret.
    const foreign = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
    expect((await put(good, envelopeFor(v2, foreign), T0 + DAY + 60_000)).decision.accept).toBe(false);

    // Ret sonrası plan hâlâ v1'in öğrenilmiş etiketini kullanır.
    const plan = planFill(FORM, buildPortalPayload(input, PORTAL, T0), good!.envelope.rules);
    expect(plan.ruleVersion).toBe(1);
    expect(plan.actions.some((a) => a.field === "heating")).toBe(true);
  });

  it("geri alma: v1 içeriği v3 olarak yeniden yayınlanır ve v2 üstüne kabul edilir; aynı/eski sürüm reddedilir", async () => {
    const v1 = publishV1();
    const r2 = applyProposals(v1, [{ id: "pr-3", kind: "field_demote", field_key: "heating", source: "corrections", proposal: {} }], {
      maxChanges: 5,
      stamp: { ...stampFor(2, T0 + DAY, 14), minExtension: INSTALLED },
    });
    if (!r2.ok) throw new Error(r2.reason);
    const v2 = r2.content;
    expect(v2.fields.find((f) => f.key === "heating")!.state).toBe("degraded");

    let s = (await put(null, envelopeFor(v1), T0 + 60_000)).stored;
    s = (await put(s, envelopeFor(v2), T0 + DAY + 60_000)).stored;
    expect(s?.version).toBe(2);

    // Eski v1 zarfının yeniden oynatılması: ret (sürüm ileri değil).
    const replay = await put(s, envelopeFor(v1), T0 + DAY + 120_000);
    expect(replay.decision.accept).toBe(false);
    expect(replay.stored?.version).toBe(2);

    // Rollback = eski içerik, YENİ ve daha büyük sürüm (max+1).
    const v3 = restamp(v1, { ...stampFor(3, T0 + 2 * DAY, 14), minExtension: INSTALLED });
    const rolled = await put(s, envelopeFor(v3), T0 + 2 * DAY + 60_000);
    expect(rolled.decision.accept).toBe(true);
    expect(rolled.stored?.version).toBe(3);
    expect(rolled.stored!.envelope.rules.fields).toEqual(v1.fields);
  });
});
