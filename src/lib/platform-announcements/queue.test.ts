import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Kuyruk uçtan uca (bellek içi sahte PostgREST): 200 ofislik segment partiler halinde süre bütçesi içinde gider,
 * kapalı e-posta kanalı sahte gönderim yapmadan 'failed' + "Kanal kapalı" raporlanır, zamanı gelmemiş duyuru
 * gitmez, bitmiş duyuru 'partial' kapanır.
 */
const h = vi.hoisted(() => ({ nowMs: 0, emailEnabled: false, sent: [] as string[] }));
vi.mock("@/lib/clock", async (orig) => ({ ...(await orig<typeof import("@/lib/clock")>()), now: () => h.nowMs }));
vi.mock("@/lib/email/provider", () => ({
  emailChannelStatus: async () => ({ enabled: h.emailEnabled, reason: h.emailEnabled ? null : "Resend API anahtarı tanımlı değil" }),
  sendEmail: async (i: { to: string }) => {
    h.sent.push(i.to);
    return { ok: true, id: "re_1" };
  },
}));
vi.mock("@/lib/push", () => ({ pushConfigured: () => false, sendPushToUser: async () => undefined }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => null }));
vi.mock("@/lib/settings/registry", () => ({ getSettingDef: () => undefined }));

import { processAnnouncementQueue } from "./queue";

type Row = Record<string, unknown>;

/** Yalnız kuyruğun kullandığı PostgREST alt kümesi. */
function fakeDb(tables: Record<string, Row[]>) {
  let seq = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  function builder(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let op: "select" | "update" | "insert" | "upsert" = "select";
    let payload: Row | Row[] | null = null;
    let upsertKey: string[] = [];
    let ignoreDup = false;
    let head = false;
    let count = false;
    let lim = Infinity;
    let from = 0;
    let to = Infinity;
    let single: "single" | "maybe" | null = null;
    let returning = false;
    const rows = () => (tables[table] ??= []);
    const cmp = (a: unknown, b: unknown) => String(a ?? "") < String(b ?? "");
    const parseOr = (expr: string) => {
      // and(status.eq.scheduled,scheduled_at.lte.X),and(...) deseni
      const groups = [...expr.matchAll(/and\(([^)]*)\)/g)].map((m) => m[1].split(","));
      return (r: Row) =>
        groups.some((conds) =>
          conds.every((c) => {
            const [col, opx, ...rest] = c.split(".");
            const val = rest.join(".");
            if (opx === "eq") return String(r[col]) === val;
            if (opx === "lte") return String(r[col] ?? "") <= val;
            if (opx === "lt") return r[col] != null && String(r[col]) < val;
            if (opx === "is") return r[col] == null;
            return false;
          }),
        );
    };
    const api: Record<string, unknown> = {
      select(_c?: string, o?: { count?: string; head?: boolean }) {
        if (op === "select") op = "select";
        else returning = true;
        head = Boolean(o?.head);
        count = Boolean(o?.count);
        return api;
      },
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), api),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), api),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), api),
      gte: (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), api),
      not: (c: string, _o: string, _v: null) => (filters.push((r) => r[c] != null), api),
      is: (c: string) => (filters.push((r) => r[c] == null), api),
      or: (e: string) => (filters.push(parseOr(e)), api),
      order: () => api,
      limit: (n: number) => ((lim = n), api),
      range: (a: number, b: number) => ((from = a), (to = b), api),
      maybeSingle: () => ((single = "maybe"), api),
      single: () => ((single = "single"), api),
      update: (p: Row) => ((op = "update"), (payload = p), api),
      insert: (p: Row | Row[]) => ((op = "insert"), (payload = p), api),
      upsert: (p: Row[], o?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
        op = "upsert";
        payload = p;
        upsertKey = (o?.onConflict ?? "id").split(",");
        ignoreDup = Boolean(o?.ignoreDuplicates);
        return api;
      },
      then(resolve: (v: unknown) => void) {
        const match = () => rows().filter((r) => filters.every((f) => f(r)));
        let data: unknown = null;
        if (op === "select") {
          const all = match().sort((a, b) => (cmp(a.id, b.id) ? -1 : 1));
          const sliced = all.slice(from, to + 1).slice(0, lim);
          if (head) return resolve({ data: null, error: null, count: all.length });
          data = single ? (sliced[0] ?? null) : sliced;
          return resolve({ data, error: null, count: count ? all.length : null });
        }
        if (op === "update") {
          const hit = match();
          for (const r of hit) Object.assign(r, payload);
          data = single ? (hit[0] ?? null) : hit;
          return resolve({ data: returning || single ? data : null, error: null });
        }
        const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
        for (const p of list) {
          const key = upsertKey.length ? upsertKey : ["id"];
          const existing = op === "upsert" ? rows().find((r) => key.every((k) => r[k] === p[k])) : undefined;
          if (existing) {
            if (!ignoreDup) Object.assign(existing, p);
          } else rows().push({ id: p.id ?? uuid(), created_at: new Date(h.nowMs).toISOString(), attempts: 0, read_at: null, clicked_at: null, notification_id: null, provider_id: null, sent_at: null, ...p });
        }
        return resolve({ data: single ? list[0] : list, error: null });
      },
    };
    return api;
  }
  const client = {
    from: (t: string) => builder(t),
    rpc: async (name: string, args: { p_limit: number; p_announcement: string | null }) => {
      if (name !== "platform_announcement_claim") return { data: null, error: { message: "yok" } };
      const picked = (tables.platform_announcement_deliveries ?? [])
        .filter((d) => d.status === "pending" && (!args.p_announcement || d.announcement_id === args.p_announcement))
        .slice(0, args.p_limit);
      for (const d of picked) {
        d.status = "sending";
        d.attempts = Number(d.attempts) + 1;
      }
      return { data: picked.map((d) => ({ ...d })), error: null };
    },
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id}@ornek.com` } } }) } },
  };
  return client;
}

function seed(nTenants: number) {
  const iso = (ms: number) => new Date(ms).toISOString();
  const tenants: Row[] = [];
  const profiles: Row[] = [];
  for (let i = 0; i < nTenants; i++) {
    const id = `t${String(i).padStart(4, "0")}`;
    tenants.push({ id, plan: "office", status: "trial", trial_ends_at: iso(h.nowMs + (i % 2 === 0 ? 2 : 10) * 86_400_000), city: "İstanbul" });
    profiles.push({ id: `${id}-owner`, tenant_id: id, role: "owner", is_active: true, notification_prefs: null });
    profiles.push({ id: `${id}-agent`, tenant_id: id, role: "agent", is_active: true, notification_prefs: null });
  }
  return { tenants, profiles };
}

describe("duyuru kuyruğu", () => {
  beforeEach(() => {
    h.nowMs = Date.UTC(2026, 9, 14, 6, 59, 0); // yarın 09:59 TSİ
    h.emailEnabled = false;
    h.sent = [];
  });

  it("zamanı gelmeyen duyuru gitmez; 10:00'da 'denemesi 3 gün içinde bitecek sahipler' segmenti uygulama içi + e-posta ile işlenir", async () => {
    const { tenants, profiles } = seed(400); // 200'ü segmentte
    const ann = {
      id: "ann-1",
      title: "Denemeniz bitiyor",
      body: "Paket seçin",
      kind: "warning",
      href: "/app/abonelik",
      channels: ["in_app", "email"],
      segment_json: { statuses: ["trial"], trialEndsWithinDays: 3, ownersOnly: true },
      commercial: false,
      status: "scheduled",
      expires_at: null,
      scheduled_at: new Date(Date.UTC(2026, 9, 14, 7, 0, 0)).toISOString(),
      materialized_at: null,
      started_at: null,
    };
    const tables: Record<string, Row[]> = { tenants, profiles, platform_announcements: [ann], platform_announcement_deliveries: [], notifications: [] };
    const db = fakeDb(tables) as never;

    const early = await processAnnouncementQueue(db, { budgetMs: 20_000, batchSize: 100 });
    expect(early.materialized).toBe(0);
    expect(tables.notifications).toHaveLength(0);

    h.nowMs = Date.UTC(2026, 9, 14, 7, 0, 30); // 10:00:30 TSİ
    const run = await processAnnouncementQueue(db, { budgetMs: 20_000, batchSize: 100 });
    expect(run.materialized).toBe(400); // 200 sahip x 2 kanal
    expect(tables.notifications).toHaveLength(200);
    expect(tables.notifications.every((n) => String(n.user_id).endsWith("-owner") && (n.meta as Row).pad)).toBe(true);
    expect(String(tables.notifications[0].href)).toMatch(/^\/api\/duyuru\/tik\?d=/);
    // E-posta kanalı kapalı: istek yok, 200 alıcı 'failed' + "Kanal kapalı" olarak raporlanır.
    expect(h.sent).toHaveLength(0);
    const email = tables.platform_announcement_deliveries.filter((d) => d.channel === "email");
    expect(email.every((d) => d.status === "failed" && String(d.error).startsWith("Kanal kapalı"))).toBe(true);
    expect(ann).toMatchObject({ status: "partial", recipient_count: 200, sent_count: 200, delivered_count: 200, failed_count: 200 });

    // Anahtar girildi → yeniden dene: yalnız başarısızlar gider, duyuru 'sent' kapanır.
    h.emailEnabled = true;
    for (const d of email) d.status = "pending";
    ann.status = "sending";
    const retry = await processAnnouncementQueue(db, { budgetMs: 20_000, batchSize: 100, announcementId: "ann-1" });
    expect(retry.delivered).toBe(200);
    expect(h.sent).toHaveLength(200);
    expect(tables.notifications).toHaveLength(200); // uygulama içi tekrar yazılmadı
    expect(ann).toMatchObject({ status: "sent", delivered_count: 400, failed_count: 0 });
  });

  it("bitiş tarihi geçmiş duyuru gönderilmez", async () => {
    const { tenants, profiles } = seed(4);
    const ann = {
      id: "ann-2",
      title: "Geç kaldı",
      body: null,
      kind: "info",
      href: null,
      channels: ["in_app"],
      segment_json: {},
      commercial: false,
      status: "scheduled",
      expires_at: new Date(h.nowMs - 1000).toISOString(),
      scheduled_at: new Date(h.nowMs - 60_000).toISOString(),
      materialized_at: null,
      started_at: null,
    };
    const tables: Record<string, Row[]> = { tenants, profiles, platform_announcements: [ann], platform_announcement_deliveries: [], notifications: [] };
    await processAnnouncementQueue(fakeDb(tables) as never, { budgetMs: 5_000 });
    expect(ann.status).toBe("expired");
    expect(tables.notifications).toHaveLength(0);
  });
});
