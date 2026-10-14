import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runReportSubscriptionDelivery, type DeliveryDeps } from "./delivery";
import { runDayStartIso } from "./schedule";
import type { RenderResult } from "./render";

/**
 * Zamanlanmış rapor teslimi (DG4): haftalık abonelik zamanı gelince e-posta (ya da kanal kapalı kaydı) oluşur,
 * aynı dönem ikinci kez gitmez, kiracı yalıtımı (başka ofisin alıcısı/sahibi) korunur. Bellek içi sahte PostgREST.
 */

type Row = Record<string, unknown>;

function fakeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  let seq = 0;
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
    let payload: Row | null = null;
    let onConflict: string[] = [];
    let single = false;
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
      lte: (c: string, v: string) => (filters.push((r) => String(r[c]) <= v), q),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
      or: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: () => ((single = true), q),
      insert: (p: Row) => ((op = "insert"), (payload = p), q),
      update: (p: Row) => ((op = "update"), (payload = p), q),
      upsert: (p: Row, o: { onConflict: string }) => ((op = "upsert"), (payload = p), (onConflict = o.onConflict.split(",")), q),
      then: (resolve: (v: unknown) => void) => {
        const rows = (tables[table] ??= []);
        const hit = () => rows.filter((r) => filters.every((f) => f(r)));
        if (op === "insert") rows.push({ id: `id-${++seq}`, ...payload });
        if (op === "upsert") {
          const dup = rows.find((r) => onConflict.every((k) => r[k] === payload![k]));
          if (dup) return resolve({ data: [], error: null });
          const row = { id: `run-${++seq}`, ...payload };
          rows.push(row);
          return resolve({ data: [row], error: null });
        }
        if (op === "update") for (const r of hit()) Object.assign(r, payload);
        const data = hit();
        resolve({ data: single ? (data[0] ?? null) : data, error: null, count: data.length });
      },
    };
    return q;
  };
  return { db: { from } as unknown as SupabaseClient, tables };
}

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const OWNER = "aaaaaaaa-1111-4111-8111-111111111111";
const GM = "aaaaaaaa-2222-4222-8222-222222222222";
const FOREIGN = "bbbbbbbb-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-10-19T07:00:00Z"); // Pazartesi 10:00 TR

function seed(over: Partial<Row> = {}) {
  return {
    tenants: [
      { id: T1, name: "Deniz Emlak", status: "active", plan: "office", created_at: "2026-01-01T00:00:00Z" },
      { id: T2, name: "Başka Ofis", status: "active", plan: "office", created_at: "2026-01-01T00:00:00Z" },
    ],
    profiles: [
      { id: OWNER, tenant_id: T1, full_name: "Ayşe Sahip", role: "owner", is_active: true },
      { id: GM, tenant_id: T1, full_name: "Mert Müdür", role: "gm", is_active: true },
      { id: FOREIGN, tenant_id: T2, full_name: "Yabancı Kişi", role: "owner", is_active: true },
    ],
    report_subscriptions: [
      {
        id: "sub-1",
        scope: "tenant",
        tenant_id: T1,
        user_id: OWNER,
        staff_id: null,
        report_id: "musteriler",
        name: "Haftalık müşteri raporu",
        filters: { type: "Alıcı" },
        relative_range: true,
        format: "xlsx",
        frequency: "weekly",
        weekday: 1,
        month_day: null,
        recipient_ids: [OWNER, FOREIGN],
        active: true,
        next_run_at: runDayStartIso("2026-10-19"),
        ...over,
      },
    ],
    report_subscription_runs: [] as Row[],
  };
}

const okRender: RenderResult = {
  ok: true,
  body: new Uint8Array([80, 75, 3, 4]),
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  filename: "musteriler-2026-10-19.xlsx",
  rowCount: 12,
  total: 12,
  truncated: false,
  stopReason: null,
};

function deps(over: Partial<DeliveryDeps> = {}) {
  const send = vi.fn(async (_input: Parameters<DeliveryDeps["send"]>[0]) => ({ ok: true as const, id: "re_1" }));
  const render = vi.fn(async (_o: Parameters<DeliveryDeps["render"]>[0]) => okRender);
  const audit = vi.fn(async () => undefined);
  const d: DeliveryDeps = {
    nowMs: NOW,
    send,
    render,
    audit,
    channel: async () => ({ enabled: true, reason: null }),
    userEmail: async (id) => ({ [OWNER]: "ayse@deniz.com", [GM]: "mert@deniz.com", [FOREIGN]: "yabanci@baska.com" })[id] ?? null,
    platformContext: () => {
      throw new Error("platform bağlamı beklenmiyor");
    },
    attachmentMaxBytes: 8 * 1024 * 1024,
    appUrl: "https://emlaksoft.com.tr",
    ...over,
  };
  return { d, send, render, audit };
}

describe("zamanlanmış rapor teslimi", () => {
  it("haftalık abonelik zamanı gelince e-posta eki gider; dönem son 7 gün; sonraki teslim bir hafta sonra", async () => {
    const { db, tables } = fakeDb(seed());
    const { d, send, render, audit } = deps();
    const out = await runReportSubscriptionDelivery(db, d);

    expect(out).toMatchObject({ due: 1, processed: 1, sent: 1, channelDisabled: 0 });
    expect(render).toHaveBeenCalledTimes(1);
    const r = render.mock.calls[0]![0];
    expect(r.format).toBe("xlsx");
    expect(r.filters).toEqual({ type: "Alıcı", from: "2026-10-12", to: "2026-10-18" });
    // Rapor ALICININ kendi bağlamıyla üretilir (kiracı + kimlik).
    expect(r.ctx.tenantId).toBe(T1);
    expect(r.ctx.userId).toBe(OWNER);

    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0]![0];
    expect(mail.to).toBe("ayse@deniz.com");
    expect(mail.tenantId).toBe(T1);
    expect(mail.template).toBe("report_subscription");
    expect(mail.attachments?.[0]?.filename).toBe("musteriler-2026-10-19.xlsx");
    expect(mail.subject).toContain("Müşteriler");
    expect(mail.text).toContain("12.10.2026 – 18.10.2026");
    expect(audit).toHaveBeenCalledTimes(1);

    expect(tables.report_subscription_runs).toHaveLength(1);
    expect(tables.report_subscription_runs[0]).toMatchObject({ subscription_id: "sub-1", period_key: "2026-10-19", status: "sent", sent: 1, row_count: 12 });
    expect(tables.report_subscriptions[0]).toMatchObject({ last_status: "sent", next_run_at: runDayStartIso("2026-10-26") });
  });

  it("e-posta kanalı kapalıysa rapor üretilmez, AD7 günlüğüne kanal kapalı kaydı düşer ve teslim günlüğü channel_disabled olur", async () => {
    const { db, tables } = fakeDb(seed());
    const { d, send, render } = deps({ channel: async () => ({ enabled: false, reason: "Resend API anahtarı tanımlı değil" }) });
    const out = await runReportSubscriptionDelivery(db, d);

    expect(out.channelDisabled).toBe(1);
    expect(render).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1); // sendLoggedEmail kanal kapalıyken istek atmaz, 'disabled' satırı yazar
    expect(send.mock.calls[0]![0].attachments).toBeUndefined();
    expect(send.mock.calls[0]![0].text).toContain("e-posta kanalı kapalı");
    expect(tables.report_subscription_runs[0]).toMatchObject({ status: "channel_disabled", error: "Resend API anahtarı tanımlı değil" });
    expect(tables.report_subscriptions[0]).toMatchObject({ last_status: "channel_disabled", next_run_at: runDayStartIso("2026-10-26") });
  });

  it("aynı dönem ikinci kez gönderilmez (teslim günlüğü tekil)", async () => {
    const s = seed();
    s.report_subscription_runs.push({ id: "run-x", subscription_id: "sub-1", tenant_id: T1, period_key: "2026-10-19", status: "sent" });
    const { db, tables } = fakeDb(s);
    const { d, send } = deps();
    await runReportSubscriptionDelivery(db, d);
    expect(send).not.toHaveBeenCalled();
    expect(tables.report_subscriptions[0]!.next_run_at).toBe(runDayStartIso("2026-10-26"));
  });

  it("zamanı gelmemiş abonelik işlenmez", async () => {
    const { db } = fakeDb(seed({ next_run_at: runDayStartIso("2026-10-26") }));
    const { d, send } = deps();
    const out = await runReportSubscriptionDelivery(db, d);
    expect(out.due).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("kiracı yalıtımı: başka ofisin kullanıcısı alıcı listesine yazılmış olsa da e-posta almaz", async () => {
    const { db } = fakeDb(seed({ recipient_ids: [OWNER, GM, FOREIGN] }));
    const { d, send } = deps();
    await runReportSubscriptionDelivery(db, d);
    const to = send.mock.calls.map((c) => c[0].to);
    expect(to).toEqual(["ayse@deniz.com", "mert@deniz.com"]);
    expect(to).not.toContain("yabanci@baska.com");
  });

  it("kiracı yalıtımı: sahibi başka ofisin profili olan abonelik atlanır (gönderim yok)", async () => {
    const { db, tables } = fakeDb(seed({ user_id: FOREIGN }));
    const { d, send, render } = deps();
    const out = await runReportSubscriptionDelivery(db, d);
    expect(out.skipped).toBe(1);
    expect(render).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(tables.report_subscription_runs[0]).toMatchObject({ status: "skipped" });
  });

  it("zamanlanamayan (hesaplanan) rapor atlanır", async () => {
    const { db } = fakeDb(seed({ report_id: "kar-zarar" }));
    const { d, send } = deps();
    const out = await runReportSubscriptionDelivery(db, d);
    expect(out.skipped).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("ek tavanı aşılırsa ek yerine rapor merkezi bağlantısı gider", async () => {
    const { db } = fakeDb(seed());
    const { d, send } = deps({ attachmentMaxBytes: 2 });
    await runReportSubscriptionDelivery(db, d);
    const mail = send.mock.calls[0]![0];
    expect(mail.attachments).toBeUndefined();
    expect(mail.text).toContain("https://emlaksoft.com.tr/app/raporlar?sekme=merkez&rapor=musteriler");
  });
});
