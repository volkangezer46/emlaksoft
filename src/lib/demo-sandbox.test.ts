import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * YD1 demo gönderim sandbox'ı (davranış): demo kiracıdan (slug=demo-ofis) tetiklenen SMS, WhatsApp ve e-posta dış
 * sağlayıcıya GİTMEZ; günlüğe "demo: gönderilmedi" satırı düşer. Gerçek kiracıda sağlayıcı aynen çağrılır.
 * Bellek içi sahte service_role istemcisi: tenants (slug), message_sends, email_sends, email_suppressions.
 */
type Row = Record<string, unknown>;
const DEMO = "11111111-1111-4111-8111-111111111111";
const REAL = "22222222-2222-4222-8222-222222222222";

const db = vi.hoisted(() => ({
  tenants: [] as Record<string, unknown>[],
  message_sends: [] as Record<string, unknown>[],
  email_sends: [] as Record<string, unknown>[],
}));
const provider = vi.hoisted(() => ({ sendEmail: vi.fn(async () => ({ ok: true as const, id: "re_1" })) }));

function fakeAdmin() {
  return {
    from(name: string) {
      const filters: ((r: Row) => boolean)[] = [];
      const rows = () => ((db as Record<string, Row[]>)[name] ?? []).filter((r) => filters.every((f) => f(r)));
      const api = {
        select: () => api,
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), api),
        in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), api),
        limit: () => api,
        insert: (row: Row) => {
          ((db as Record<string, Row[]>)[name] ??= []).push(row);
          return Promise.resolve({ error: null });
        },
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: rows(), error: null }),
      };
      return api;
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeAdmin() }));
vi.mock("@/lib/settings/read", () => ({ getSettings: vi.fn(async () => ({})) }));
vi.mock("@/lib/email/provider", () => ({ sendEmail: provider.sendEmail }));

import { withSmsLog, withWhatsAppLog } from "@/lib/messaging/message-log";
import { demoSandboxAuthEmail, sendLoggedEmail } from "@/lib/email/send";
import { isDemoTenantId, resetDemoTenantCache } from "@/lib/demo-sandbox";
import { DEMO_SANDBOX_CODE, DEMO_SANDBOX_MESSAGE } from "@/lib/demo-tenant";

beforeEach(() => {
  db.tenants.splice(0, db.tenants.length, { id: DEMO, slug: "demo-ofis" }, { id: REAL, slug: "gercek-ofis" });
  db.message_sends.length = 0;
  db.email_sends.length = 0;
  provider.sendEmail.mockClear();
  resetDemoTenantCache();
});

describe("demo kiracı tanıma", () => {
  it("yalnız slug=demo-ofis demo sayılır; kimliksiz gönderim demo değildir", async () => {
    expect(await isDemoTenantId(DEMO)).toBe(true);
    expect(await isDemoTenantId(REAL)).toBe(false);
    expect(await isDemoTenantId(null)).toBe(false);
  });
});

describe("SMS / WhatsApp sandbox", () => {
  it("demo ofisten SMS: sağlayıcı çağrılmaz, günlükte demo kaydı oluşur", async () => {
    const send = vi.fn(async () => ({ ok: true, jobid: "J1" }));
    const res = await withSmsLog("tenant", { source: "campaign", tenantId: DEMO }, "05321234567", "Merhaba", send);
    expect(send).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ok: false, code: DEMO_SANDBOX_CODE, error: DEMO_SANDBOX_MESSAGE });
    expect(db.message_sends).toHaveLength(1);
    expect(db.message_sends[0]).toMatchObject({
      tenant_id: DEMO,
      channel: "sms",
      source: "campaign",
      status: "failed",
      error_code: DEMO_SANDBOX_CODE,
      error: DEMO_SANDBOX_MESSAGE,
      provider_id: null,
    });
  });

  it("demo ofisten WhatsApp: sağlayıcı çağrılmaz, günlükte demo kaydı oluşur", async () => {
    const send = vi.fn(async () => ({ ok: true, messageId: "wamid.1" }));
    await withWhatsAppLog("tenant", { source: "whatsapp_reply", tenantId: DEMO }, "05321234567", send);
    expect(send).not.toHaveBeenCalled();
    expect(db.message_sends[0]).toMatchObject({ channel: "whatsapp", error_code: DEMO_SANDBOX_CODE, error: DEMO_SANDBOX_MESSAGE });
  });

  it("gerçek ofiste sağlayıcı aynen çağrılır", async () => {
    const send = vi.fn(async () => ({ ok: true, jobid: "J2" }));
    const res = await withSmsLog("tenant", { source: "campaign", tenantId: REAL }, "05321234567", "Merhaba", send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ ok: true, jobid: "J2" });
    expect(db.message_sends[0]).toMatchObject({ tenant_id: REAL, status: "queued", provider_id: "J2" });
  });
});

describe("e-posta sandbox", () => {
  it("demo ofisten e-posta: sağlayıcı çağrılmaz, günlüğe 'disabled' + demo kaydı", async () => {
    const res = await sendLoggedEmail({ to: "musteri@ornek.com", subject: "Rapor", text: "x", template: "rapor", source: "report_delivery", tenantId: DEMO });
    expect(provider.sendEmail).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ok: false, code: "disabled", error: DEMO_SANDBOX_MESSAGE });
    expect(db.email_sends).toHaveLength(1);
    expect(db.email_sends[0]).toMatchObject({ tenant_id: DEMO, status: "disabled", error: DEMO_SANDBOX_MESSAGE, to_masked: "mu***@ornek.com" });
  });

  it("gerçek ofiste e-posta sağlayıcıya gider", async () => {
    const res = await sendLoggedEmail({ to: "musteri@ornek.com", subject: "Rapor", text: "x", template: "rapor", source: "report_delivery", tenantId: REAL });
    expect(provider.sendEmail).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ ok: true });
    expect(db.email_sends[0]).toMatchObject({ tenant_id: REAL, status: "sent", provider_id: "re_1" });
  });

  it("ekip daveti (GoTrue e-postası): demo ofiste gönderim atlanır ve günlüğe düşer; gerçek ofiste dokunulmaz", async () => {
    expect(await demoSandboxAuthEmail({ tenantId: DEMO, to: "yeni@ornek.com", template: "team_invite", source: "team_invite", subject: "Ekip daveti" })).toBe(true);
    expect(db.email_sends[0]).toMatchObject({ tenant_id: DEMO, template: "team_invite", status: "disabled", error: DEMO_SANDBOX_MESSAGE });
    expect(await demoSandboxAuthEmail({ tenantId: REAL, to: "yeni@ornek.com", template: "team_invite", source: "team_invite", subject: "Ekip daveti" })).toBe(false);
    expect(db.email_sends).toHaveLength(1);
  });
});
