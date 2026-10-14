import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * YD2 kabul: müşteri sunumda bir ilana "İlgileniyorum" deyince (1) presentation_feedback'e müşteri bağıyla kayıt
 * düşer (müşteri kartı geçmişi bunu okur) ve (2) sunumu hazırlayan danışmana bildirim gider. Kapılar: ilan sunumda
 * olmalı, ofis aktif, modül açık; aynı seçim tekrarında bildirim yok; tablo yokken bildirim yine gider.
 */
type Row = Record<string, unknown>;

const TOKEN = "11111111-1111-4111-8111-111111111111";
const PRES = "22222222-2222-4222-8222-222222222222";
const PROP = "33333333-3333-4333-8333-333333333333";
const OTHER_PROP = "44444444-4444-4444-8444-444444444444";
const CUSTOMER = "55555555-5555-4555-8555-555555555555";
const ADVISOR = "66666666-6666-4666-8666-666666666666";

const h = vi.hoisted(() => ({
  presentation: null as Row | null,
  property: null as Row | null,
  existing: null as Row | null,
  upsertError: null as null | { code?: string; message: string },
  closed: false,
  allowed: true,
  upserts: [] as Array<{ table: string; row: Row; opts: unknown }>,
  notify: vi.fn(async (..._args: unknown[]) => undefined),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/notify", () => ({ notifyTenant: h.notify }));
vi.mock("@/lib/rate-limit", () => ({
  clientIp: async () => "203.0.113.7",
  checkRateLimit: async () => ({ allowed: h.allowed }),
}));
vi.mock("@/lib/modules/public", () => ({ isPublicFeatureClosed: async () => h.closed }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        in: () => chain,
        maybeSingle: async () => {
          if (table === "presentations") return { data: h.presentation, error: null };
          if (table === "properties") return { data: h.property, error: null };
          if (table === "presentation_feedback") return { data: h.existing, error: null };
          if (table === "profiles") return { data: { id: ADVISOR }, error: null };
          return { data: null, error: null };
        },
        upsert: async (row: Row, opts: unknown) => {
          h.upserts.push({ table, row, opts });
          return { error: h.upsertError };
        },
      };
      return chain;
    },
  }),
}));

import { submitPresentationFeedback } from "./presentation-feedback";

beforeEach(() => {
  vi.clearAllMocks();
  h.presentation = {
    id: PRES,
    tenant_id: "t-1",
    title: "Ayşe Hanım için seçki",
    property_ids: [PROP],
    customer_id: CUSTOMER,
    customer_name: "Ayşe Yılmaz",
    created_by: ADVISOR,
    tenant: { status: "active" },
  };
  h.property = { id: PROP, title: "Kadıköy 3+1", property_code: "P-1", status: "live" };
  h.existing = null;
  h.upsertError = null;
  h.closed = false;
  h.allowed = true;
  h.upserts = [];
});

describe("submitPresentationFeedback", () => {
  it("İlgileniyorum: müşteri bağlı kayıt düşer ve danışmana bildirim gider", async () => {
    const res = await submitPresentationFeedback({ token: TOKEN, propertyId: PROP, verdict: "interested", note: "  Hafta sonu bakabilir miyiz?  " });
    expect(res).toEqual({ ok: true, verdict: "interested", note: "Hafta sonu bakabilir miyiz?" });

    expect(h.upserts).toHaveLength(1);
    expect(h.upserts[0]!.table).toBe("presentation_feedback");
    expect(h.upserts[0]!.row).toMatchObject({
      tenant_id: "t-1",
      presentation_id: PRES,
      property_id: PROP,
      customer_id: CUSTOMER,
      verdict: "interested",
      note: "Hafta sonu bakabilir miyiz?",
    });
    expect(h.upserts[0]!.opts).toEqual({ onConflict: "presentation_id,property_id" });

    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "t-1",
        userId: ADVISOR,
        kind: "success",
        prefKey: "share",
        href: `/app/musteriler/${CUSTOMER}?sekme=gecmis&kategori=portal`,
        title: "Müşteri sunumdaki bir portföyle ilgileniyor",
        body: expect.stringContaining('Kadıköy 3+1 için "İlgileniyorum" dedi. Not: "Hafta sonu bakabilir miyiz?"'),
        // Gidip gelen seçimler bildirim yağdırmasın: ilan + seçim + TR saati penceresi.
        dedupeKey: expect.stringMatching(new RegExp(`^presentation-feedback:${PRES}:${PROP}:interested:\\d{4}-\\d{2}-\\d{2}T\\d{2}$`)),
      }),
    );
  });

  it("müşterisiz sunumda bildirim Sunumlar listesine gider", async () => {
    h.presentation = { ...h.presentation!, customer_id: null, customer_name: null };
    const res = await submitPresentationFeedback({ token: TOKEN, propertyId: PROP, verdict: "not_interested" });
    expect(res.ok).toBe(true);
    expect(h.upserts[0]!.row).toMatchObject({ customer_id: null, verdict: "not_interested", note: null });
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ href: "/app/portfoyler/sunumlar", kind: "info" }));
  });

  it("sunumda olmayan ilan reddedilir, hiçbir şey yazılmaz", async () => {
    const res = await submitPresentationFeedback({ token: TOKEN, propertyId: OTHER_PROP, verdict: "interested" });
    expect(res).toEqual({ ok: false, error: "Bu portföy sunumda yok." });
    expect(h.upserts).toHaveLength(0);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("geçersiz token/seçim, pasif ofis, kapalı modül ve taslak ilan reddedilir", async () => {
    expect((await submitPresentationFeedback({ token: "x", propertyId: PROP, verdict: "interested" })).ok).toBe(false);
    expect((await submitPresentationFeedback({ token: TOKEN, propertyId: PROP, verdict: "liked" })).ok).toBe(false);
    h.presentation = { ...h.presentation!, tenant: { status: "suspended" } };
    expect((await submitPresentationFeedback({ token: TOKEN, propertyId: PROP, verdict: "interested" })).ok).toBe(false);
    h.presentation = { ...h.presentation!, tenant: { status: "active" } };
    h.closed = true;
    expect((await submitPresentationFeedback({ token: TOKEN, propertyId: PROP, verdict: "interested" })).ok).toBe(false);
    h.closed = false;
    h.property = { ...h.property!, status: "draft" };
    expect((await submitPresentationFeedback({ token: TOKEN, propertyId: PROP, verdict: "interested" })).ok).toBe(false);
    expect(h.upserts).toHaveLength(0);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("uzun not reddedilir; hız sınırı aşılırsa yazılmaz", async () => {
    const long = await submitPresentationFeedback({ token: TOKEN, propertyId: PROP, verdict: "interested", note: "a".repeat(501) });
    expect(long).toEqual({ ok: false, error: "Not en fazla 500 karakter olabilir." });
    h.allowed = false;
    const limited = await submitPresentationFeedback({ token: TOKEN, propertyId: PROP, verdict: "interested" });
    expect(limited.ok).toBe(false);
    expect(h.upserts).toHaveLength(0);
  });

  it("honeypot dolu: sessizce başarı, kayıt ve bildirim yok", async () => {
    const res = await submitPresentationFeedback({ token: TOKEN, propertyId: PROP, verdict: "interested", website: "spam" });
    expect(res.ok).toBe(true);
    expect(h.upserts).toHaveLength(0);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("aynı seçim + aynı not tekrarında bildirim tekrar gitmez; fikir değişince gider", async () => {
    h.existing = { verdict: "interested", note: null };
    await submitPresentationFeedback({ token: TOKEN, propertyId: PROP, verdict: "interested" });
    expect(h.upserts).toHaveLength(0);
    expect(h.notify).not.toHaveBeenCalled();

    await submitPresentationFeedback({ token: TOKEN, propertyId: PROP, verdict: "not_interested" });
    expect(h.upserts).toHaveLength(1);
    expect(h.notify).toHaveBeenCalledTimes(1);
  });

  it("tablo yokken (migration uygulanmadı) bildirim yine gider ve başarı döner; ikisi de düşerse hata", async () => {
    h.upsertError = { code: "PGRST205", message: "Could not find the table 'public.presentation_feedback' in the schema cache" };
    const res = await submitPresentationFeedback({ token: TOKEN, propertyId: PROP, verdict: "interested" });
    expect(res.ok).toBe(true);
    expect(h.notify).toHaveBeenCalledTimes(1);

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.notify.mockRejectedValueOnce(new Error("bildirim yazılamadı"));
    const failed = await submitPresentationFeedback({ token: TOKEN, propertyId: PROP, verdict: "interested" });
    expect(failed).toEqual({ ok: false, error: "Geri bildiriminiz iletilemedi. Lütfen tekrar deneyin." });
    log.mockRestore();
  });
});
