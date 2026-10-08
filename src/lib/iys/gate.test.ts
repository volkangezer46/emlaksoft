import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COMMERCIAL_KINDS,
  TRANSACTIONAL_KINDS,
  TRANSACTIONAL_LABEL,
  describeIysGate,
  describeSkipReasons,
  evaluateConsent,
  evaluateIysGate,
  gateIysRecipient,
  gateIysRecipients,
  messagePurpose,
  type IysConsentRow,
} from "@/lib/iys/gate";

// Ofis İYS modu ayarı (varsayılan "warn"); her test kendi modunu seçer.
let iysMode = "block";
vi.mock("@/lib/settings/read", () => ({ getSetting: async () => iysMode }));

const row = (customer_id: string, status: string, channel = "sms", revoked_at: string | null = null): IysConsentRow => ({ customer_id, channel, status, revoked_at });

describe("evaluateConsent", () => {
  it("yalnız granted ve geri alınmamış izin geçer", () => {
    expect(evaluateConsent({ status: "granted", revoked_at: null })).toEqual({ allowed: true });
    expect(evaluateConsent({ status: "granted", revoked_at: "2026-10-01T00:00:00Z" })).toEqual({ allowed: false, reason: "revoked" });
    expect(evaluateConsent({ status: "denied", revoked_at: null })).toEqual({ allowed: false, reason: "denied" });
    expect(evaluateConsent({ status: "pending", revoked_at: null })).toEqual({ allowed: false, reason: "not_granted" });
    expect(evaluateConsent({ status: "unknown", revoked_at: null })).toEqual({ allowed: false, reason: "not_granted" });
    expect(evaluateConsent(undefined)).toEqual({ allowed: false, reason: "no_record" });
  });
});

describe("messagePurpose", () => {
  it("her tür tek amaca bağlıdır ve iki liste ayrıktır", () => {
    for (const k of COMMERCIAL_KINDS) expect(messagePurpose(k)).toBe("commercial");
    for (const k of TRANSACTIONAL_KINDS) expect(messagePurpose(k)).toBe("transactional");
    expect(COMMERCIAL_KINDS.filter((k) => (TRANSACTIONAL_KINDS as readonly string[]).includes(k))).toEqual([]);
    // Anket ticari sayılır; randevu hatırlatma ve sözleşme imzası işlem amaçlıdır.
    expect(messagePurpose("survey")).toBe("commercial");
    expect(messagePurpose("appointment_reminder")).toBe("transactional");
    expect(messagePurpose("contract_signature")).toBe("transactional");
  });
});

describe("evaluateIysGate (ticari)", () => {
  const rows = [row("a", "granted"), row("b", "denied"), row("c", "granted", "sms", "2026-09-01T00:00:00Z"), row("d", "granted", "whatsapp")];

  it("izinsiz alıcıyı atlar, sayar ve nedenini raporlar", () => {
    const r = evaluateIysGate({ kind: "campaign", channel: "sms", customerIds: ["a", "b", "c", "d", "e"], rows });
    expect(r.exempt).toBe(false);
    expect(r.label).toBeNull();
    expect(r.allowed).toEqual(["a"]);
    expect(r.skippedCount).toBe(4);
    expect(r.reasons).toEqual({ denied: 1, revoked: 1, no_record: 2 });
    expect(r.total).toBe(5);
  });

  it("izin KANAL bazlıdır: WhatsApp izni SMS'e geçmez", () => {
    expect(evaluateIysGate({ kind: "bulk_message", channel: "sms", customerIds: ["d"], rows }).allowed).toEqual([]);
    expect(evaluateIysGate({ kind: "bulk_message", channel: "whatsapp", customerIds: ["d"], rows }).allowed).toEqual(["d"]);
  });

  it("aynı alıcıyı tek sayar, boş kimliği yok sayar", () => {
    const r = evaluateIysGate({ kind: "automation", channel: "sms", customerIds: ["a", "a", ""], rows });
    expect(r.total).toBe(1);
    expect(r.allowed).toEqual(["a"]);
  });

  it("okuma hatasında ticari ileti güvenli tarafta HİÇ gitmez", () => {
    const r = evaluateIysGate({ kind: "campaign", channel: "sms", customerIds: ["a", "b"], rows, lookupFailed: true });
    expect(r.allowed).toEqual([]);
    expect(r.reasons).toEqual({ lookup_failed: 2 });
  });
});

describe("evaluateIysGate (işlem amaçlı)", () => {
  it("muaftır, etiketlidir, kimseyi elemez", () => {
    for (const kind of TRANSACTIONAL_KINDS) {
      const r = evaluateIysGate({ kind, channel: "sms", customerIds: ["x", "y"], rows: [] });
      expect(r.exempt).toBe(true);
      expect(r.label).toBe(TRANSACTIONAL_LABEL);
      expect(r.allowed).toEqual(["x", "y"]);
      expect(r.skippedCount).toBe(0);
    }
  });

  it("okuma hatası işlem amaçlı iletiyi etkilemez", () => {
    const r = evaluateIysGate({ kind: "contract_signature", channel: "sms", customerIds: ["x"], rows: [], lookupFailed: true });
    expect(r.allowed).toEqual(["x"]);
  });
});

/** İz bırakan sahte istemci: hangi tablo/filtre ile sorgulandığını kaydeder. */
function fakeDb(rows: IysConsentRow[], opts: { fail?: boolean } = {}) {
  const calls: { table: string; eq: [string, unknown][]; inCol?: string; inLen?: number }[] = [];
  const db = {
    from(table: string) {
      const call: (typeof calls)[number] = { table, eq: [] };
      calls.push(call);
      const chain = {
        select: () => chain,
        eq: (c: string, v: unknown) => (call.eq.push([c, v]), chain),
        in: (c: string, v: unknown[]) => ((call.inCol = c), (call.inLen = v.length), chain),
        order: () => chain,
        range: () => chain,
        then: (resolve: (v: unknown) => void) => resolve(opts.fail ? { data: null, error: { message: "x" } } : { data: rows, error: null }),
      };
      return chain;
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

describe("gateIysRecipients (veritabanı)", () => {
  beforeEach(() => {
    iysMode = "block";
  });

  it("varsayılan 'yalnız uyar' modunda gönderim engellenmez, izni eksikler bilgi olarak döner", async () => {
    iysMode = "warn";
    const { db } = fakeDb([row("a", "granted")]);
    const r = await gateIysRecipients(db, { tenantId: "t1", kind: "campaign", channel: "sms", customerIds: ["a", "b"] });
    expect(r.allowed).toEqual(["a", "b"]);
    expect(r.skippedCount).toBe(0);
    expect(r.warned?.map((w) => w.customerId)).toEqual(["b"]);
  });

  it("sorguyu tenant + kanal ile sınırlar ve kararı verir", async () => {
    const { db, calls } = fakeDb([row("a", "granted")]);
    const r = await gateIysRecipients(db, { tenantId: "t1", kind: "campaign", channel: "sms", customerIds: ["a", "b"] });
    expect(r.allowed).toEqual(["a"]);
    expect(calls[0]!.table).toBe("iys_consents");
    expect(calls[0]!.eq).toEqual(expect.arrayContaining([["tenant_id", "t1"], ["channel", "sms"]]));
  });

  it("işlem amaçlı ileti için veritabanına hiç gitmez", async () => {
    const { db, calls } = fakeDb([]);
    const r = await gateIysRecipients(db, { tenantId: "t1", kind: "rent_reminder", channel: "sms", customerIds: ["a"] });
    expect(r.exempt).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("sorgu hatasında ticari ileti reddedilir (fail-closed)", async () => {
    const { db } = fakeDb([], { fail: true });
    const r = await gateIysRecipients(db, { tenantId: "t1", kind: "campaign", channel: "sms", customerIds: ["a"] });
    expect(r.allowed).toEqual([]);
    expect(r.reasons.lookup_failed).toBe(1);
  });

  it("çok alıcıda kanalın izin satırları sayfalanarak okunur (in(...) şişmez)", async () => {
    const { db, calls } = fakeDb([row("c0", "granted")]);
    const ids = Array.from({ length: 450 }, (_, i) => `c${i}`);
    const r = await gateIysRecipients(db, { tenantId: "t1", kind: "campaign", channel: "sms", customerIds: ids });
    expect(r.allowed).toEqual(["c0"]);
    expect(calls.every((c) => c.inCol === undefined)).toBe(true);
  });

  it("tekil kısayol neden döner", async () => {
    const { db } = fakeDb([row("a", "denied")]);
    const v = await gateIysRecipient(db, { tenantId: "t1", kind: "marketing_single", channel: "sms", customerId: "a" });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe("denied");
  });
});

describe("özet metinleri", () => {
  it("ticari: izinli/atlanan sayısı; işlem amaçlı: etiket", () => {
    const r = evaluateIysGate({ kind: "campaign", channel: "sms", customerIds: ["a", "b"], rows: [row("a", "granted")] });
    expect(describeIysGate(r)).toContain("1 izinli");
    expect(describeIysGate(r)).toContain("1 İYS izni olmadığı için atlanacak");
    expect(describeSkipReasons(r.reasons)).toContain("İYS kaydı yok: 1");
    const t = evaluateIysGate({ kind: "owner_report", channel: "sms", customerIds: ["a"], rows: [] });
    expect(describeIysGate(t)).toContain(TRANSACTIONAL_LABEL);
  });
});
