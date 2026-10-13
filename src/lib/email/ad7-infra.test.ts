import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform-settings", () => ({ getPlatformSettingsMany: vi.fn(async () => ({})), getPlatformSetting: vi.fn(async () => null) }));

import {
  EMAIL_TEMPLATES,
  EMAIL_VARIABLES,
  renderAuthTemplateHtml,
  renderBrandedHtml,
  sampleVars,
  templateDef,
  templateSettingKey,
  unknownVariables,
} from "./templates";
import { emailHash, maskEmail } from "./send";
import { nextStatus, parseResendEvent, verifySvixSignature } from "./webhook";
import { prepareWrite } from "@/lib/settings/prepare";
import { buildOfficeTimeline, officeAccess, type TimelineInput } from "@/lib/admin/office-360";

describe("şablon kataloğu ve değişken doğrulaması", () => {
  it("katalog: paket şablonları var, her değişken katalogda, varsayılan metinler geçerli", () => {
    const keys = EMAIL_TEMPLATES.map((t) => t.key);
    for (const k of [
      "welcome",
      "team_invite",
      "receipt",
      "payment_failed",
      "dunning_1",
      "dunning_2",
      "dunning_3",
      "plan_changed",
      "trial_ended",
      "ticket_reply",
      "kvkk_reply",
      "auth_invite",
      "auth_recovery",
      "auth_confirmation",
    ]) {
      expect(keys).toContain(k);
    }
    for (const t of EMAIL_TEMPLATES) {
      for (const v of t.variables) expect(EMAIL_VARIABLES, `${t.key}.${v}`).toHaveProperty(v);
      expect(unknownVariables(t.defaultSubject, t.variables), t.key).toEqual([]);
      expect(unknownVariables(t.defaultBody, t.variables), t.key).toEqual([]);
    }
  });

  it("tanımsız değişken içeren şablon KAYDEDİLEMEZ (ayar defteri çapraz kuralı)", () => {
    const bad = prepareWrite({ key: templateSettingKey("trial_ending", "body"), value: "Merhaba {ofis}, {bilinmeyen} hazır.", reason: "deneme gerekçesi" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/tanımsız değişken \{bilinmeyen\}/);
    const badSubject = prepareWrite({ key: templateSettingKey("receipt", "subject"), value: "{gun} gün", reason: "deneme gerekçesi" });
    expect(badSubject.ok).toBe(false);
    const ok = prepareWrite({ key: templateSettingKey("trial_ending", "body"), value: "Merhaba {ofis}, {gun} gün kaldı: {baglanti}", reason: "deneme gerekçesi" });
    expect(ok.ok).toBe(true);
    const auth = prepareWrite({ key: templateSettingKey("auth_recovery", "body"), value: "Şifre: {baglanti} {ofis}", reason: "deneme gerekçesi" });
    expect(auth.ok).toBe(false);
  });
});

describe("ortak marka yerleşimi (HTML)", () => {
  it("değerler kaçışlanır, tek başına bağlantı düğme olur, alt bilgi yerleşir", () => {
    const html = renderBrandedHtml({
      title: "Konu",
      body: "Merhaba {ofis}\n\n{baglanti}",
      vars: { ofis: "<script>x</script>", baglanti: "https://emlaksoft.com.tr/app?a=1&b=2" },
      footer: "Alt <bilgi>",
    });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('href="https://emlaksoft.com.tr/app?a=1&amp;b=2"');
    expect(html).toContain("Bağlantıyı aç");
    expect(html).toContain("Alt &lt;bilgi&gt;");
  });

  it("auth şablonu: yalnız katalog yer tutucuları Go ifadesi olur; admin metnindeki {{ }} ÇALIŞMAZ", () => {
    const t = templateDef("auth_recovery");
    const html = renderAuthTemplateHtml(t, "Sıfırla: {baglanti}\nKod: {kod}\n{{ .Data }} {{ template \"x\" }}");
    expect(html).toContain('href="{{ .ConfirmationURL }}"');
    expect(html).toContain("{{ .Token }}");
    expect(html).not.toContain("{{ .Data }}");
    expect(html).not.toContain('{{ template "x" }}');
    expect(html).toContain("&#123;&#123; .Data &#125;&#125;");
    // Go yer tutucularından başka çift süslü parantez yok.
    const actions = html.match(/\{\{[^}]*\}\}/g) ?? [];
    for (const a of actions) expect(["{{ .ConfirmationURL }}", "{{ .Token }}"]).toContain(a);
  });

  it("önizleme örnek değerleri katalogdan", () => {
    expect(sampleVars("trial_ending")).toEqual({ ofis: "Örnek Emlak Ofisi", gun: 3, baglanti: "https://emlaksoft.com.tr/app" });
  });
});

describe("alıcı maskesi ve özeti", () => {
  it("maskeler ve küçük harf/boşluk duyarsız özetler", () => {
    expect(maskEmail("Ayse.Yilmaz@Ornek.com")).toBe("ay***@ornek.com");
    expect(maskEmail("a@b.co")).toBe("a***@b.co");
    expect(emailHash(" A@B.com ")).toBe(emailHash("a@b.com"));
    expect(emailHash("a@b.com")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("Resend webhook", () => {
  const secretRaw = Buffer.from("test-signing-secret-32-bytes!!!!").toString("base64");
  const secret = `whsec_${secretRaw}`;
  const sign = (id: string, ts: string, body: string) =>
    `v1,${createHmac("sha256", Buffer.from(secretRaw, "base64")).update(`${id}.${ts}.${body}`).digest("base64")}`;

  it("Svix imzası: doğru imza kabul, gövde değişirse / süre aşılırsa / yanlış anahtarla red", () => {
    const body = '{"type":"email.delivered"}';
    const ts = "1760000000";
    const sig = sign("msg_1", ts, body);
    expect(verifySvixSignature({ id: "msg_1", timestamp: ts, signature: `v1,eHh4 ${sig}`, body, secret, nowSec: 1760000010 })).toBe(true);
    expect(verifySvixSignature({ id: "msg_1", timestamp: ts, signature: sig, body: body + " ", secret, nowSec: 1760000010 })).toBe(false);
    expect(verifySvixSignature({ id: "msg_1", timestamp: ts, signature: sig, body, secret, nowSec: 1760000000 + 3600 })).toBe(false);
    expect(verifySvixSignature({ id: "msg_1", timestamp: ts, signature: sig, body, secret: "whsec_YmFza2E=", nowSec: 1760000010 })).toBe(false);
    expect(verifySvixSignature({ id: null, timestamp: ts, signature: sig, body, secret, nowSec: 1760000010 })).toBe(false);
  });

  it("olay ayrıştırma: bounce (kalıcı) ve şikâyet bastırılır, geçici bounce bastırılmaz", () => {
    const hard = parseResendEvent({ type: "email.bounced", created_at: "2026-10-13T10:00:00Z", data: { email_id: "e1", to: ["x@y.com"], bounce: { type: "Permanent", message: "mailbox yok" } } });
    expect(hard).toMatchObject({ status: "bounced", providerId: "e1", to: ["x@y.com"], suppress: "bounce" });
    expect(hard?.detail).toContain("Permanent");
    const soft = parseResendEvent({ type: "email.bounced", data: { email_id: "e2", to: ["x@y.com"], bounce: { type: "Transient" } } });
    expect(soft?.suppress).toBeNull();
    expect(parseResendEvent({ type: "email.complained", data: { email_id: "e3", to: ["x@y.com"] } })?.suppress).toBe("complaint");
    expect(parseResendEvent({ type: "email.delivered", data: { email_id: "e4", to: ["x@y.com"] } })).toMatchObject({ status: "delivered", suppress: null });
    expect(parseResendEvent({ type: "contact.created", data: {} })?.status).toBeNull();
    expect(parseResendEvent("x")).toBeNull();
  });

  it("durum önceliği: geç gelen zayıf olay durumu geri çekmez", () => {
    expect(nextStatus("sent", "delivered")).toBe("delivered");
    expect(nextStatus("delivered", "opened")).toBe("opened");
    expect(nextStatus("opened", "delivered")).toBe("opened");
    expect(nextStatus("bounced", "opened")).toBe("bounced");
    expect(nextStatus("delivered", "complained")).toBe("complained");
  });

  it("uç: imza anahtarı yoksa 503 (kapalı kapı), doğrulama yazmadan önce", () => {
    const src = readFileSync("src/app/api/webhooks/resend/route.ts", "utf8");
    expect(src).toContain('"not_configured" }, 503');
    expect(src.indexOf("verifySvixSignature(")).toBeLessThan(src.indexOf("applyResendEvent("));
  });
});

describe("günlüklü gönderim (bastırma + kanal kapalı)", () => {
  const inserts: Record<string, unknown>[] = [];
  const sendEmailMock = vi.fn(async () => ({ ok: true as const, id: "re_1" }));
  let suppressedHashes: string[] = [];

  beforeEach(() => {
    inserts.length = 0;
    sendEmailMock.mockClear();
    suppressedHashes = [];
    vi.resetModules();
    vi.doMock("./provider", async (orig) => ({ ...(await orig<typeof import("./provider")>()), sendEmail: sendEmailMock }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: (table: string) => ({
          select: () => ({
            eq: (_col: string, hash: string) => ({
              limit: async () => ({ data: table === "email_suppressions" && suppressedHashes.includes(hash) ? [{ id: "s1" }] : [], error: null }),
            }),
          }),
          insert: async (row: Record<string, unknown>) => {
            inserts.push({ table, ...row });
            return { error: null };
          },
        }),
      }),
    }));
  });

  it("bastırılmış adrese istek ATILMAZ ve günlüğe 'suppressed' yazılır", async () => {
    const { sendLoggedEmail, emailHash: hash } = await import("./send");
    suppressedHashes = [hash("bounce@ornek.com")];
    const r = await sendLoggedEmail({ to: "Bounce@Ornek.com", subject: "S", text: "T", template: "test", source: "admin_test" });
    expect(r).toMatchObject({ ok: false, code: "suppressed" });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ table: "email_sends", status: "suppressed", to_masked: "bo***@ornek.com", provider_id: null });
    expect(JSON.stringify(inserts[0])).not.toContain("bounce@ornek.com");
  });

  it("kabul edilen gönderim sağlayıcı kimliğiyle 'sent'; kanal kapalı 'disabled' olarak düşer", async () => {
    const { sendLoggedEmail } = await import("./send");
    const tenant = "11111111-1111-4111-8111-111111111111";
    await sendLoggedEmail({ to: "a@b.com", subject: "S", text: "T", template: "trial_ending", source: "x", tenantId: tenant });
    expect(inserts[0]).toMatchObject({ status: "sent", provider_id: "re_1", tenant_id: tenant, template: "trial_ending" });
    sendEmailMock.mockResolvedValueOnce({ ok: false, code: "disabled", error: "Resend API anahtarı tanımlı değil" } as never);
    await sendLoggedEmail({ to: "a@b.com", subject: "S", text: "T", template: "trial_ending", source: "x" });
    expect(inserts[1]).toMatchObject({ status: "disabled", provider_id: null, tenant_id: null });
  });
});

describe("webhook yarışı: günlük satırı henüz yok", () => {
  const writes: { table: string; op: string }[] = [];
  let sendRow: Record<string, unknown> | null = null;

  beforeEach(() => {
    writes.length = 0;
    sendRow = null;
    vi.resetModules();
    vi.doMock("@/lib/clock", async (orig) => ({ ...(await orig<typeof import("@/lib/clock")>()), now: () => Date.parse("2026-10-13T10:01:00Z") }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: (table: string) => ({
          select: () => ({ eq: () => ({ limit: async () => ({ data: sendRow ? [sendRow] : [], error: null }) }) }),
          update: () => ({ eq: async () => (writes.push({ table, op: "update" }), { error: null }) }),
          upsert: async () => (writes.push({ table, op: "upsert" }), { error: null }),
          insert: async () => (writes.push({ table, op: "insert" }), { error: null }),
        }),
      }),
    }));
  });

  const ev = (type: string, createdAt: string) =>
    parseResendEvent({ type, created_at: createdAt, data: { email_id: "re_9", to: ["x@y.com"], bounce: { type: "Permanent" } } })!;

  it("taze durum olayı satır yoksa 'pending' (olay yazılmaz, Resend yeniden dener); bastırma yine uygulanır", async () => {
    const { applyResendEvent } = await import("./webhook");
    expect(await applyResendEvent("msg_a", ev("email.delivered", "2026-10-13T10:00:55Z"))).toBe("pending");
    expect(writes).toEqual([]);
    expect(await applyResendEvent("msg_b", ev("email.bounced", "2026-10-13T10:00:55Z"))).toBe("pending");
    expect(writes).toEqual([{ table: "email_suppressions", op: "upsert" }]);
  });

  it("email.sent, pencere dışı olay ya da satır varsa olay yazılır ('applied')", async () => {
    const { applyResendEvent } = await import("./webhook");
    expect(await applyResendEvent("msg_c", ev("email.sent", "2026-10-13T10:00:55Z"))).toBe("applied");
    expect(await applyResendEvent("msg_d", ev("email.delivered", "2026-10-13T09:00:00Z"))).toBe("applied");
    sendRow = { id: "s1", status: "sent", tenant_id: null, delivered_at: null, opened_at: null };
    expect(await applyResendEvent("msg_e", ev("email.delivered", "2026-10-13T10:00:55Z"))).toBe("applied");
    expect(writes).toContainEqual({ table: "email_sends", op: "update" });
  });

  it("uç: 'pending' 503 döner", () => {
    const src = readFileSync("src/app/api/webhooks/resend/route.ts", "utf8");
    expect(src).toContain('if (result === "pending") return json({ ok: false, result }, 503);');
  });
});

describe("Ofis 360 İletişim kategorisi", () => {
  it("ofise giden e-postalar 'iletisim' olayı olur; günlük bağlantısı yalnız sistem erişiminde", () => {
    const base: TimelineInput = {
      tenantId: "t1",
      tenantCreatedAt: null,
      tenantName: "Ofis",
      access: officeAccess("support"),
      actorNames: new Map(),
      audit: [],
      platformAudit: [],
      sub: null,
      invoices: [],
      captures: [],
      tickets: [],
      logins: [],
      consents: [],
      iys: [],
      erasures: [],
      profiles: [],
      emails: [
        {
          id: "m1",
          created_at: "2026-10-12T10:00:00Z",
          tenant_id: "t1",
          template: "trial_ending",
          source: "abonelik-kontrol",
          to_masked: "ay***@ornek.com",
          subject: "x",
          status: "delivered",
          error: null,
          delivered_at: null,
          opened_at: null,
          last_event_at: null,
        },
      ],
    };
    const ev = buildOfficeTimeline(base).find((e) => e.id === "mail-m1");
    expect(ev).toMatchObject({ category: "iletisim", title: "E-posta: Deneme süresi bitiyor", tone: "success" });
    expect(ev?.detail).toContain("ay***@ornek.com");
    expect(ev?.href).toBeUndefined();
    const sa = buildOfficeTimeline({ ...base, access: officeAccess("super_admin") }).find((e) => e.id === "mail-m1");
    expect(sa?.href).toBe("/admin/ayarlar/eposta?sekme=gunluk&ofis=t1");
  });
});
