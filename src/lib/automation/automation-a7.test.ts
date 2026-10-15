import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decideExistingClaim,
  inSequenceSendWindow,
  nextDueAt,
  parseSequenceSteps,
  stepToAction,
  trDayStartIso,
} from "@/lib/automation/sequence-rules";
import { SEQUENCE_TEMPLATES } from "@/lib/automation/sequence-templates";
import { ackDecision, inboundLeadName, inboundSourceFor } from "@/lib/automation/inbound-rules";
import { draftFromAction, draftToAction, draftValid, emptyDraft, moveDraft } from "@/app/app/otomasyonlar/wizard-actions";
import { availableActionsForTrigger, skipReasonLabel, TRIGGER_OPTIONS } from "@/app/app/otomasyonlar/labels";
import { leadSourceWithUtm } from "@/lib/lead-utm";

const read = (p: string) => readFileSync(p, "utf8");

describe("COM-04 sihirbaz eylem listesi", () => {
  it("taslak ↔ eylem gidiş-dönüş; WhatsApp yalnız şablon adı + dil ile geçerli", () => {
    const wa = { ...emptyDraft("a", "send_whatsapp"), templateName: "portfoy_duyurusu", language: "tr", bodyParam: "{{name}}" };
    expect(draftValid(wa)).toBe(true);
    expect(draftToAction(wa)).toEqual({ type: "send_whatsapp", config: { template_name: "portfoy_duyurusu", language: "tr", body_param: "{{name}}" } });
    expect(draftValid({ ...wa, templateName: "Serbest Metin" })).toBe(false);
    // Eski serbest metinli WhatsApp satırı şablonsuz gelir → kaydedilemez, kullanıcı şablon seçer.
    expect(draftValid(draftFromAction("x", { type: "send_whatsapp", config: { template: "Merhaba" } }))).toBe(false);
    const mail = { ...emptyDraft("b", "send_email"), subject: "Konu", body: "Metin" };
    expect(draftToAction(mail)).toEqual({ type: "send_email", config: { subject: "Konu", body: "Metin" } });
    expect(draftValid({ ...mail, body: " " })).toBe(false);
  });

  it("sıralama sınırda değişmez, ortada yer değiştirir", () => {
    expect(moveDraft([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(moveDraft([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(moveDraft([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
  });

  it("müşteri bağlamlı tetikleyicide WhatsApp ve e-posta eylemi sunulur; portföy/FSBO'da sunulmaz", () => {
    const vals = (t: string) => availableActionsForTrigger(t).map((a) => a.value);
    expect(vals("new_customer")).toEqual(expect.arrayContaining(["send_whatsapp", "send_email", "send_sms"]));
    expect(vals("inbound_message")).toEqual(expect.arrayContaining(["send_whatsapp", "send_email"]));
    expect(vals("new_property")).not.toContain("send_whatsapp");
    expect(vals("new_fsbo_lead")).not.toContain("send_email");
  });

  it("sonuç kodları Türkçe nedene çevrilir", () => {
    expect(skipReasonLabel("iys_consent_not_granted")).toBe("İYS izni yok");
    expect(skipReasonLabel("http_400")).toContain("400");
    expect(skipReasonLabel("bilinmeyen_kod")).toBe("bilinmeyen_kod");
  });

  it("sunucu en çok 3 eylem kabul eder; sihirbaz tek eylem göndermez", () => {
    const actions = read("src/app/actions/automations.ts");
    expect(actions).toContain("if (rawActions.length > 3)");
    const wizard = read("src/app/app/otomasyonlar/automation-wizard.tsx");
    expect(wizard).toContain("JSON.stringify(drafts.map(draftToAction))");
    expect(wizard).not.toContain("JSON.stringify([{ type: actionType");
  });
});

describe("COM-14 iletişim tetikleyicileri", () => {
  it("gelen mesaj ve form başvurusu sihirbazda, motorda ve sunucu eyleminde tanımlı", () => {
    expect(TRIGGER_OPTIONS.map((t) => t.value)).toEqual(expect.arrayContaining(["inbound_message", "lead_form_submitted"]));
    const engine = read("src/lib/automation-engine.ts");
    expect(engine).toContain('| "inbound_message"');
    expect(engine).toContain("HOURLY_CAPPED_TRIGGERS");
    expect(engine).toContain("firedWithinLastHour(admin, row.id, payload.entityId)");
    expect(read("src/app/actions/automations.ts")).toContain('"inbound_message", "lead_form_submitted"');
    // Enum değeri ayrı migration'da, kullanılmadan eklenir.
    const mig = read("supabase/migrations/20261018070000_automation_trigger_inbound.sql");
    expect(mig).toContain("add value if not exists 'inbound_message'");
    expect(mig).not.toMatch(/insert|update/i);
  });

  it("form başvurusu her gönderimde, gelen mesaj webhook ilk temas akışında yayılır", () => {
    expect(read("src/lib/lead-intake.ts")).toContain('dispatchAutomationEvent(tenantId, "lead_form_submitted"');
    expect(read("src/lib/automation/inbound-intake.ts")).toContain('dispatchAutomationEvent(input.tenantId, "inbound_message"');
  });
});

describe("COM-02 bilinmeyen numara", () => {
  it("kaynak ve kayıt adı kanala göre", () => {
    expect(inboundSourceFor("whatsapp")).toBe("whatsapp_inbound");
    expect(inboundSourceFor("sms")).toBe("sms_inbound");
    expect(inboundLeadName("whatsapp", "0532 123 45 67")).toBe("WhatsApp · 0532 123 45 67");
  });

  it("karşılama: kapalı / 24 saat içinde tekrar / boş metin gönderilmez; mesai içi-dışı metni seçilir", () => {
    const base = { enabled: true, lastAckAt: null, nowMs: Date.parse("2026-10-15T10:00:00Z"), inHours: true, textHours: "İç", textAfter: "Dış" };
    expect(ackDecision(base)).toEqual({ send: true, text: "İç" });
    expect(ackDecision({ ...base, inHours: false })).toEqual({ send: true, text: "Dış" });
    expect(ackDecision({ ...base, enabled: false })).toEqual({ send: false, reason: "disabled" });
    expect(ackDecision({ ...base, lastAckAt: "2026-10-15T00:00:00Z" })).toEqual({ send: false, reason: "cooldown" });
    expect(ackDecision({ ...base, lastAckAt: "2026-10-13T00:00:00Z" })).toMatchObject({ send: true });
    expect(ackDecision({ ...base, textHours: "  " })).toEqual({ send: false, reason: "empty" });
  });

  it("webhook işleyicileri ilk temas akışını çağırır; varsayılan ayar KAPALI", () => {
    expect(read("src/lib/webhooks/meta-inbound.ts")).toContain("handleInboundFirstContact(admin, {");
    expect(read("src/lib/webhooks/netgsm-inbound.ts")).toContain("handleInboundFirstContact(admin, {");
    const reg = read("src/lib/settings/registry/tenant.ts");
    expect(reg).toMatch(/key: INBOUND_KEYS\.autoCreate,[\s\S]{0,80}default: false/);
    expect(reg).toMatch(/key: INBOUND_KEYS\.autoAck,[\s\S]{0,80}default: false/);
  });
});

describe("COM-05 takip dizileri", () => {
  it("adım doğrulaması: tür, gecikme, zorunlu alanlar, WhatsApp şablonu", () => {
    expect(parseSequenceSteps([])).toEqual({ ok: false, error: "En az bir adım ekleyin." });
    expect(parseSequenceSteps([{ step_type: "sms", delay_days: 0, config: { text: "Merhaba" } }])).toMatchObject({ ok: true });
    expect(parseSequenceSteps([{ step_type: "sms", delay_days: -1, config: { text: "x" } }])).toMatchObject({ ok: false });
    expect(parseSequenceSteps([{ step_type: "whatsapp_template", delay_days: 1, config: { template_name: "Kötü Ad", language: "tr" } }])).toMatchObject({ ok: false });
    expect(parseSequenceSteps([{ step_type: "fax", delay_days: 1, config: {} }])).toMatchObject({ ok: false });
    const ok = parseSequenceSteps([{ step_type: "task", delay_days: 2, config: { title: "Ara", priority: "x", extra: "atılır" } }]);
    expect(ok).toEqual({ ok: true, steps: [{ step_type: "task", delay_days: 2, config: { title: "Ara", priority: "normal" } }] });
  });

  it("hazır diziler doğrulamadan geçer", () => {
    for (const t of SEQUENCE_TEMPLATES) expect(parseSequenceSteps(t.steps).ok, t.key).toBe(true);
  });

  it("adım → otomasyon eylemi (aynı İYS kapılı uygulayıcı)", () => {
    expect(stepToAction({ step_type: "sms", config: { text: "Merhaba" } })).toEqual({ type: "send_sms", config: { template: "Merhaba" } });
    expect(stepToAction({ step_type: "whatsapp_template", config: { template_name: "a", language: "tr" } })?.type).toBe("send_whatsapp");
    expect(stepToAction({ step_type: "email", config: { subject: "s", body: "b" } })?.type).toBe("send_email");
    expect(stepToAction({ step_type: "task", config: { title: "t" } })?.type).toBe("create_task");
    expect(stepToAction({ step_type: "x", config: {} })).toBeNull();
  });

  it("sessiz saat TR 09:00-20:00; gün başı TR", () => {
    expect(inSequenceSendWindow(Date.parse("2026-10-15T05:59:00Z"))).toBe(false); // 08:59 TR
    expect(inSequenceSendWindow(Date.parse("2026-10-15T06:00:00Z"))).toBe(true); // 09:00 TR
    expect(inSequenceSendWindow(Date.parse("2026-10-15T17:00:00Z"))).toBe(false); // 20:00 TR
    expect(trDayStartIso(Date.parse("2026-10-15T22:30:00Z"))).toBe("2026-10-15T21:00:00.000Z");
    expect(nextDueAt(Date.parse("2026-10-15T10:00:00Z"), 2)).toBe("2026-10-17T10:00:00.000Z");
  });

  it("idempotent sahiplenme: sonuçlanmış ya da eski sahiplenme ilerler, taze sahiplenme bekler (yeniden gönderme yok)", () => {
    const now = Date.parse("2026-10-15T10:00:00Z");
    expect(decideExistingClaim({ result: "ok", created_at: "2026-10-15T09:59:00Z" }, now)).toBe("advance");
    expect(decideExistingClaim({ result: "claimed", created_at: "2026-10-15T09:58:00Z" }, now)).toBe("wait");
    expect(decideExistingClaim({ result: "claimed", created_at: "2026-10-15T09:00:00Z" }, now)).toBe("advance");
    expect(decideExistingClaim(null, now)).toBe("wait");
  });

  it("çalıştırıcı mevcut cron adımıdır (yeni cron yok) ve UNIQUE sahiplenmeyle gönderir", () => {
    expect(read("src/app/api/cron/gorev-hatirlat/route.ts")).toContain("runDueSequenceSteps(admin, {");
    const runner = read("src/lib/automation/sequence-runner.ts");
    expect(runner.indexOf('result: "claimed"')).toBeLessThan(runner.indexOf("executeSequenceAction("));
    expect(runner).toContain('claimErr?.code !== "23505"');
    expect(runner).toContain('.eq("next_step", row.next_step)');
    const mig = read("supabase/migrations/20261018070001_message_sequences.sql");
    expect(mig).toContain("on public.message_sequence_step_runs(enrollment_id, step_index)");
    expect(mig).toContain("revoke insert, update, delete on public.message_sequence_step_runs from anon, authenticated");
    expect(mig).not.toMatch(/^\s*notify pgrst/m);
  });

  it("yanıt gelince dur: gelen mesaj müşterinin aktif kayıtlarını durdurur", () => {
    expect(read("src/lib/automation/inbound-intake.ts")).toContain("stopSequencesOnReply(admin, input.tenantId, input.customer.id)");
    expect(read("src/lib/automation/sequences.ts")).toContain('stop_reason: "reply"');
  });
});

describe("COM-13 talep formu", () => {
  it("utm kaynağı sınırlı ve temiz", () => {
    expect(leadSourceWithUtm("web_form", "Instagram", "Bahar 2026!")).toBe("utm_instagram_bahar-2026");
    expect(leadSourceWithUtm("qr", "", "x")).toBe("qr");
    expect(leadSourceWithUtm("web_form", "<script>", null)).toBe("utm_script");
  });

  it("ilan bağlamı sunucuda kiracı + yayın filtresiyle çözülür (IDOR yok)", () => {
    const src = read("src/lib/lead-listing.ts");
    expect(src).toContain('.eq("tenant_id", tenantId)');
    expect(src).toContain('.eq("status", "live")');
    expect(src).toContain('.eq("is_sample", false)');
    const page = read("src/app/lead/[token]/page.tsx");
    expect(page).toContain("PublicTokenPage");
    expect(page).toContain("brandColor={tenant.brand_color");
    expect(page).not.toContain("--grad-ink");
  });
});

describe("COM-12 Google yorum yönlendirme", () => {
  it("bağlantı herkese gösterilir (gating yok), tıklama izi yazılır", () => {
    const form = read("src/app/anket/[token]/survey-form.tsx");
    expect(form.match(/reviewLink\(false\)/g)?.length).toBe(2);
    expect(form).toContain("reviewLink(true)");
    expect(form).toContain("recordSurveyReviewClick(token)");
    const action = read("src/app/actions/survey-review.ts");
    expect(action).toContain('.is("review_clicked_at", null)');
    expect(action).toContain('survey.status !== "answered"');
  });
});

describe("COM-05 gün rozeti", () => {
  it("gecikmeler birikir; geçersiz değer 0 sayılır", async () => {
    const { cumulativeDays } = await import("@/lib/automation/sequence-rules");
    expect(cumulativeDays([0, 1, 2])).toEqual([0, 1, 3]);
    expect(cumulativeDays(["2", "", -3, 1])).toEqual([2, 2, 2, 3]);
  });
});
