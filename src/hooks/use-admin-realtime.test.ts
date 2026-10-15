import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ADMIN_TOPIC,
  adminTablesForPath,
  createAdminChannels,
  isLocalEcho,
  noteAdminLocalWrite,
  parseAdminEvent,
  staffTopic,
  type AdminRtEvent,
} from "./use-admin-realtime";

/**
 * Admin canlı veri (B006) sözleşmesi: Broadcast yükü yalnız kimlik taşır, rota eşlemesi açık sayfayı tazeler, kendi
 * yazımının yankısı ikinci tazeleme yapmaz, kanallar ÖZEL katılır ve yeniden katılımda tek tazeleme istenir.
 */
const ID = "11111111-2222-4333-8444-555555555555";
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("parseAdminEvent", () => {
  it("bilinen tablo + işlem kabul; kimlikler süzülür; ≤200 B yük", () => {
    const raw = { t: "support_tickets", op: "INSERT", by: null, ids: [ID, "kotu"] };
    expect(JSON.stringify(raw).length).toBeLessThanOrEqual(200);
    expect(parseAdminEvent(raw)).toEqual({ t: "support_tickets", op: "INSERT", by: null, ids: [ID] });
  });
  it("bilinmeyen tablo/işlem ya da bozuk yük yok sayılır", () => {
    expect(parseAdminEvent({ t: "customers", op: "INSERT" })).toBeNull();
    expect(parseAdminEvent({ t: "invoices", op: "TRUNCATE" })).toBeNull();
    expect(parseAdminEvent("x")).toBeNull();
    expect(parseAdminEvent(null)).toBeNull();
  });
});

describe("adminTablesForPath", () => {
  it("pano tüm özet kaynaklarını, alt sayfalar kendi tablolarını dinler; ilgisiz rota hiçbirini", () => {
    expect(adminTablesForPath("/admin")).toEqual(["support_tickets", "invoices", "subscriptions", "alert_events"]);
    expect(adminTablesForPath("/admin/tickets")).toContain("support_tickets");
    expect(adminTablesForPath(`/admin/tickets/${ID}`)).toContain("support_ticket_messages");
    expect(adminTablesForPath("/admin/billing/faturalar")).toEqual(["invoices", "subscriptions"]);
    expect(adminTablesForPath("/admin/sistem")).toEqual(["alert_events"]);
    expect(adminTablesForPath("/admin/raporlar")).toEqual([]);
    expect(adminTablesForPath("/admin/ticketsx")).toEqual([]);
  });
});

describe("yerel yazım yankısı", () => {
  it("bu sekmenin yazdığı talep olayı 5 sn içinde yankı sayılır, başka kimlik sayılmaz", () => {
    noteAdminLocalWrite(["support_tickets", "support_ticket_messages"], [ID]);
    const ev: AdminRtEvent = { t: "support_tickets", op: "UPDATE", by: null, ids: [ID] };
    expect(isLocalEcho(ev, Date.now())).toBe(true);
    expect(isLocalEcho({ ...ev, ids: ["99999999-2222-4333-8444-555555555555"] }, Date.now())).toBe(false);
    expect(isLocalEcho({ ...ev, ids: null }, Date.now())).toBe(false);
    expect(isLocalEcho(ev, Date.now() + 10_000)).toBe(false);
  });
});

describe("createAdminChannels (sahte istemci)", () => {
  function fakeClient() {
    const subs: { topic: string; config: unknown; handler?: (m: { payload?: unknown }) => void; status?: (s: string) => void }[] = [];
    const client = {
      channel: vi.fn((topic: string, config: unknown) => {
        const entry: (typeof subs)[number] = { topic, config };
        subs.push(entry);
        const ch = {
          on: (_type: string, _filter: unknown, handler: (m: { payload?: unknown }) => void) => {
            entry.handler = handler;
            return ch;
          },
          subscribe: (cb: (s: string) => void) => {
            entry.status = cb;
            return ch;
          },
        };
        return ch;
      }),
      removeChannel: vi.fn(async () => "ok"),
    };
    return { client, subs };
  }

  it("iki ÖZEL konu açar; olay, zil, yeniden katılım ve canlılık doğru iletilir", () => {
    const { client, subs } = fakeClient();
    const onAdmin = vi.fn();
    const onStaff = vi.fn();
    const onAdminRejoin = vi.fn();
    const onStaffRejoin = vi.fn();
    const onLive = vi.fn();
    const mgr = createAdminChannels({ staffId: ID, onAdmin, onStaff, onAdminRejoin, onStaffRejoin, onLive });
    mgr.attach(client as never);
    expect(subs.map((s) => s.topic)).toEqual([ADMIN_TOPIC, staffTopic(ID)]);
    for (const s of subs) expect(s.config).toEqual({ config: { private: true } });

    const [admin, staff] = subs;
    admin!.status!("SUBSCRIBED");
    staff!.status!("SUBSCRIBED");
    expect(onLive).toHaveBeenLastCalledWith(true);
    expect(onAdminRejoin).not.toHaveBeenCalled();

    admin!.handler!({ payload: { t: "support_tickets", op: "INSERT", by: null, ids: [ID] } });
    admin!.handler!({ payload: { t: "nope", op: "INSERT" } });
    expect(onAdmin).toHaveBeenCalledTimes(1);
    staff!.handler!({ payload: { t: "platform_notifications", op: "INSERT", by: null } });
    expect(onStaff).toHaveBeenCalledTimes(1);

    // Kopup yeniden katılım: kaçan olaylar için tek tazeleme + zil yeniden okunur; zil kanalı koparsa yedek yoklama döner.
    staff!.status!("CHANNEL_ERROR");
    expect(onLive).toHaveBeenLastCalledWith(false);
    admin!.status!("SUBSCRIBED");
    staff!.status!("SUBSCRIBED");
    expect(onAdminRejoin).toHaveBeenCalledTimes(1);
    expect(onStaffRejoin).toHaveBeenCalledTimes(1);

    mgr.dispose();
    expect(client.removeChannel).toHaveBeenCalledTimes(2);
    expect(onLive).toHaveBeenLastCalledWith(false);
  });
});

describe("kabuk bağlantısı", () => {
  it("admin layout canlı adacığı taşır; zil 60 sn yoklamayı yalnız canlı kanal yokken çalıştırır", () => {
    expect(read("src/app/admin/layout.tsx")).toContain("<AdminRealtime staffId={staff.id} />");
    const bell = read("src/components/admin/notification-bell.tsx");
    expect(bell).toContain("onAdminNotification(");
    expect(bell).toMatch(/if \(!isAdminRealtimeLive\(\)/);
    // Katılım jetonu kanaldan ÖNCE (özel konu politikası oturum kimliğine bakar).
    const hook = read("src/hooks/use-admin-realtime.ts");
    expect(hook.indexOf("await ensureRealtimeAuth(supabase)")).toBeLessThan(hook.indexOf("mgr.attach(supabase)"));
  });

  it("migration: admin:staff yalnız aktif personel, yük PII'siz", () => {
    const sql = read("supabase/migrations/20261016040000_admin_staff_broadcast.sql");
    expect(sql).toContain("admin:staff");
    expect(sql).toMatch(/platform_staff/);
    expect(sql).not.toMatch(/'email'|'subject'|'body'/);
  });
});
