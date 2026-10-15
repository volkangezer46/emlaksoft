import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SN3 SMS/WhatsApp teslim günlüğü: gönderim günlüğe "kuyrukta" düşer, Netgsm iletim raporu (doğru gizli anahtarla) onu
 * "teslim edildi"ye ilerletir; yanlış anahtar 401 ve satır değişmez. Bellek içi sahte service_role istemcisiyle uçtan uca.
 */

type Row = Record<string, unknown>;
const table: Row[] = [];

function fakeAdmin() {
  return {
    from(name: string) {
      if (name !== "message_sends") throw new Error(`unexpected table ${name}`);
      const filters: [string, unknown][] = [];
      let mode: "select" | "update" = "select";
      let patch: Row = {};
      const match = () => table.filter((r) => filters.every(([k, v]) => r[k] === v));
      const builder = {
        insert(row: Row) {
          table.push({ id: `id-${table.length + 1}`, created_at: "2026-10-14T10:00:00.000Z", delivered_at: null, read_at: null, ...row });
          return Promise.resolve({ error: null });
        },
        select() {
          return builder;
        },
        update(p: Row) {
          mode = "update";
          patch = p;
          return builder;
        },
        eq(k: string, v: unknown) {
          filters.push([k, v]);
          return builder;
        },
        maybeSingle() {
          const rows = match();
          if (mode === "update") {
            for (const r of rows) Object.assign(r, patch);
            return Promise.resolve({ data: rows[0] ? { id: rows[0].id } : null, error: null });
          }
          return Promise.resolve({ data: rows[0] ? { ...rows[0] } : null, error: null });
        },
      };
      return builder;
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeAdmin() }));

import {
  maskRecipient,
  nextMessageStatus,
  outcomeStatus,
  recipientHash,
  smsSegments,
  withSmsLog,
  withWhatsAppLog,
  applyMessageLogStatus,
} from "./message-log";
import { parseNetgsmReport, parseNetgsmDate } from "@/lib/webhooks/netgsm-report";
import { POST } from "@/app/api/webhooks/netgsm-rapor/route";

const SECRET = "rapor-gizli-anahtar";

function report(body: string, opts: { secret?: string; type?: string } = {}) {
  const q = opts.secret === undefined ? `?secret=${SECRET}` : opts.secret ? `?secret=${opts.secret}` : "";
  return new NextRequest(`http://localhost/api/webhooks/netgsm-rapor${q}`, {
    method: "POST",
    body,
    headers: { "content-type": opts.type ?? "application/x-www-form-urlencoded" },
  });
}

beforeEach(() => {
  table.length = 0;
  vi.unstubAllEnvs();
  vi.stubEnv("NETGSM_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("OTP_HMAC_SECRET", "test-otp-hmac-secret-0123456789abcdef");
});

describe("saf yardımcılar", () => {
  it("numara maskelenir, özet E.164 rakamlarından (biçimden bağımsız)", () => {
    expect(maskRecipient("0532 123 45 42")).toBe("05** *** ** 42");
    expect(maskRecipient("+49 151 2345 6723")).toBe("+49*** 23");
    expect(maskRecipient("abc")).toBe("***");
    expect(recipientHash("05321234542")).toBe(recipientHash("+90 532 123 45 42"));
    expect(recipientHash("5321234542")).toMatch(/^[0-9a-f]{64}$/);
    expect(recipientHash("12")).toBeNull();
  });

  it("alıcı özeti anahtarlıdır: düz SHA-256'ya eşit değil, anahtar değişince değişir, anahtar yoksa null", () => {
    const h = recipientHash("05321234542");
    expect(h).not.toBe(createHash("sha256").update("905321234542", "utf8").digest("hex"));
    vi.stubEnv("OTP_HMAC_SECRET", "baska-bir-sunucu-sirri-0123456789abcdef");
    expect(recipientHash("05321234542")).not.toBe(h);
    vi.stubEnv("OTP_HMAC_SECRET", "");
    vi.stubEnv("TWO_FACTOR_COOKIE_SECRET", "");
    vi.stubEnv("PROPERTY_MEDIA_SIGNING_SECRET", "");
    expect(recipientHash("05321234542")).toBeNull();
  });

  it("SMS kredi boyu: GSM-7 160/153, Türkçe dil tablosu 155/149, Unicode 70/67", () => {
    expect(smsSegments("a".repeat(160))).toBe(1);
    expect(smsSegments("a".repeat(161))).toBe(2);
    expect(smsSegments("ş".repeat(155))).toBe(1);
    expect(smsSegments("ş".repeat(156))).toBe(2);
    expect(smsSegments("😀".repeat(70))).toBe(1);
    expect(smsSegments("😀".repeat(71))).toBe(2);
    expect(smsSegments("")).toBe(0);
  });

  it("durum geri çekilmez; başarısız teslimi ezmez", () => {
    expect(nextMessageStatus("queued", "delivered")).toBe("delivered");
    expect(nextMessageStatus("read", "sent")).toBe("read");
    expect(nextMessageStatus("delivered", "failed")).toBe("delivered");
    expect(nextMessageStatus("sent", "failed")).toBe("failed");
    expect(outcomeStatus({ ok: true, jobid: "1" })).toBe("queued");
    expect(outcomeStatus({ ok: false, code: "unknown_provider_outcome" })).toBe("unknown");
    expect(outcomeStatus({ ok: false, code: "30" })).toBe("failed");
  });

  it("Netgsm raporu: eş alan adları, durum kodları ve tarih", () => {
    expect(parseNetgsmReport({ jobid: "J1", status: "1" })?.status).toBe("delivered");
    expect(parseNetgsmReport({ bulkid: "J1", durum: "3", telno: "5321234542" })).toMatchObject({ status: "failed", phone: "5321234542", code: "netgsm_3" });
    expect(parseNetgsmReport({ jobid: "J1", status: "0" })?.status).toBe("queued");
    expect(parseNetgsmReport({ jobid: "J1", status: "99" })).toBeNull();
    expect(parseNetgsmReport({ status: "1" })).toBeNull();
    expect(parseNetgsmDate("14.10.2026 13:05:00")).toBe("2026-10-14T10:05:00.000Z");
  });
});

describe("gönderim → günlük → teslim raporu", () => {
  it("gönderilen SMS günlükte 'kuyrukta' görünür; teslim raporu gelince 'teslim edildi'ye geçer", async () => {
    const send = vi.fn(async () => ({ ok: true, jobid: "JOB-77" }));
    const res = await withSmsLog("platform", { source: "dunning", tenantId: "11111111-1111-4111-8111-111111111111", audience: "office" }, "05321234542", "Ödeme hatırlatması", send);
    expect(res).toEqual({ ok: true, jobid: "JOB-77" });
    expect(table).toHaveLength(1);
    expect(table[0]).toMatchObject({
      channel: "sms",
      account: "platform",
      audience: "office",
      source: "dunning",
      status: "queued",
      provider_id: "JOB-77",
      to_masked: "05** *** ** 42",
      segments: 1,
      tenant_id: "11111111-1111-4111-8111-111111111111",
    });
    // Düz numara ve mesaj metni saklanmaz.
    expect(JSON.stringify(table[0])).not.toContain("5321234542");
    expect(JSON.stringify(table[0])).not.toContain("hatırlatması");

    const r = await POST(report("jobid=JOB-77&status=1&telno=905321234542&deliveredDate=14.10.2026%2013:05:00"));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, applied: 1 });
    expect(table[0]).toMatchObject({ status: "delivered", delivered_at: "2026-10-14T10:05:00.000Z" });

    // Aynı rapor tekrar gelirse (yeniden deneme) durum değişmez.
    const again = await POST(report("jobid=JOB-77&status=1"));
    expect(await again.json()).toMatchObject({ ok: true, applied: 0 });
    expect(table[0].status).toBe("delivered");
  });

  it("başarısız rapor hata nedenini yazar; JSON dizi gövdesi desteklenir", async () => {
    await withSmsLog("tenant", { source: "campaign", tenantId: null }, "05321234542", "x", async () => ({ ok: true, jobid: "JOB-9" }));
    const r = await POST(report(JSON.stringify([{ jobid: "JOB-9", status: 11 }]), { type: "application/json" }));
    expect(r.status).toBe(200);
    expect(table[0]).toMatchObject({ status: "failed", error_code: "netgsm_11", error: "Operatör mesajı kabul etmedi." });
  });

  it("200'den fazla raporlu JSON gövde sessizce kesilmez: 413 ve hiçbir satır değişmez", async () => {
    await withSmsLog("tenant", { source: "campaign" }, "05321234542", "x", async () => ({ ok: true, jobid: "JOB-0" }));
    const body = JSON.stringify(Array.from({ length: 201 }, (_, i) => ({ jobid: `JOB-${i}`, status: 1 })));
    const r = await POST(report(body, { type: "application/json" }));
    expect(r.status).toBe(413);
    expect(await r.json()).toMatchObject({ ok: false, error: "too_many_reports", max: 200 });
    expect(table[0].status).toBe("queued");
  });

  it("rapor numarası günlükteki alıcıyla eşleşmezse güncelleme yapılmaz", async () => {
    await withSmsLog("platform", { source: "login_otp" }, "05321234542", "kod", async () => ({ ok: true, jobid: "JOB-5" }));
    await POST(report("jobid=JOB-5&status=1&telno=905559998877"));
    expect(table[0].status).toBe("queued");
  });

  it("gizli anahtar yanlış ya da eksikse 401 ve satır değişmez; anahtar tanımsızsa 503", async () => {
    await withSmsLog("platform", { source: "login_otp" }, "05321234542", "kod", async () => ({ ok: true, jobid: "JOB-1" }));
    expect((await POST(report("jobid=JOB-1&status=1", { secret: "yanlis" }))).status).toBe(401);
    expect((await POST(report("jobid=JOB-1&status=1", { secret: "" }))).status).toBe(401);
    expect(table[0].status).toBe("queued");
    vi.stubEnv("NETGSM_WEBHOOK_SECRET", "");
    expect((await POST(report("jobid=JOB-1&status=1"))).status).toBe(503);
    expect(table[0].status).toBe("queued");
  });

  it("sağlayıcı hatası 'başarısız', belirsiz sonuç 'sonuç belirsiz' yazılır; günlük hatası gönderimi bozmaz", async () => {
    await withSmsLog("platform", { source: "system" }, "05321234542", "x", async () => ({ ok: false, code: "30", error: "Geçersiz kullanıcı kodu veya şifre." }));
    await withWhatsAppLog("tenant", { source: "campaign" }, "05321234542", async () => ({ ok: false, code: "unknown_provider_outcome", error: "belirsiz" }));
    expect(table.map((r) => [r.channel, r.status, r.provider_id, r.segments])).toEqual([
      ["sms", "failed", null, 1],
      ["whatsapp", "unknown", null, null],
    ]);
  });

  it("WhatsApp: Meta durumu (wamid) günlüğü ilerletir, okundu zamanı yazılır, geç gelen 'sent' geri çekmez", async () => {
    await withWhatsAppLog("tenant", { source: "inbox_reply" }, "05321234542", async () => ({ ok: true, messageId: "wamid.ABC" }));
    expect(await applyMessageLogStatus({ channel: "whatsapp", providerId: "wamid.ABC", status: "read", occurredAt: "2026-10-14T11:00:00.000Z" })).toBe("applied");
    expect(await applyMessageLogStatus({ channel: "whatsapp", providerId: "wamid.ABC", status: "sent", occurredAt: "2026-10-14T10:59:00.000Z" })).toBe("unchanged");
    expect(table[0]).toMatchObject({ status: "read", read_at: "2026-10-14T11:00:00.000Z", delivered_at: "2026-10-14T11:00:00.000Z" });
    expect(await applyMessageLogStatus({ channel: "sms", providerId: "wamid.ABC", status: "delivered" })).toBe("not_found");
  });
});
