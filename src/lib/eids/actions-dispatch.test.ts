import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * EİDS ANLIK AKIŞ (GP3) kabul testleri. Gerçek yönlendirici (`processInboundMail`, mailauth imzalı fikstür) → gerçek EP3→EP2
 * köprüsü (`ledgerApplier`) → defter RPC taklidi → `after()` (yakalanır, test elle boşaltır) → gerçek aksiyon motoru.
 * Kabul:
 *  1. Yetki iptali e-postası işlendiği anda (cron beklenmeden) danışmana ACİL kaldırma görevi + bildirim açılır.
 *  2. Cron (`runEidsActionSweep`) aynı olay için ikinci görev ya da bildirim açmaz (görev açıkken de kapandıktan sonra da).
 *  3. Aksiyon motoru hata verse de e-posta işleme (defter yazımı) sonucu bozulmaz.
 */
vi.mock("server-only", () => ({}));

type Notice = { tenantId: string; userId: string; title: string; kind?: string; dedupeKey?: string };
const notices: Notice[] = [];
vi.mock("@/lib/notify", () => ({
  notifyTenant: async (n: Notice) => {
    // notifications.dedupe_key tekil dizini: aynı anahtar ikinci kez yazılmaz.
    if (n.dedupeKey && notices.some((x) => x.dedupeKey === n.dedupeKey)) return;
    notices.push(n);
  },
}));
vi.mock("@/lib/settings/tenant-read", () => ({ readTenantSettings: async () => ({}), numberSetting: (_v: unknown, _k: string, f: number) => f }));
vi.mock("@/lib/listing-control/server/queue", () => ({ enqueueTakedownChecks: async () => ({ hasClient: false, enqueued: 0, schemaMissing: false }) }));
vi.mock("@/lib/modules/state", () => ({ getDisabledModulesByTenant: async () => new Map(), isDisabledFor: () => false }));
vi.mock("@/lib/supabase/fetch-all", () => ({ fetchAllRowsKeepError: async () => ({ data: [], error: null }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("e-posta yolunda çağıranın service_role istemcisi kullanılmalı");
  },
}));
const pendingAfter: (() => unknown)[] = [];
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void pendingAfter.push(fn) }));

const { processInboundMail } = await import("./inbound");
const { ledgerApplier } = await import("./inbound-ledger");
const { runEidsActionSweep } = await import("./actions");
const { now } = await import("@/lib/clock");
import type { InboundInsert, InboundMessageRow, InboundStore } from "./inbound";

const fx = JSON.parse(readFileSync(join(__dirname, "fixtures", "eids-mail.fixture.json"), "utf8")) as Record<string, string> & {
  keys: { ticaret: string; google: string };
};
const resolver = async (name: string): Promise<string[][]> => {
  if (name === "eids2026._domainkey.ticaret.gov.tr") return [[`v=DKIM1; k=rsa; p=${fx.keys.ticaret}`]];
  if (name === "arc-20240605._domainkey.google.com") return [[`v=DKIM1; k=rsa; p=${fx.keys.google}`]];
  throw Object.assign(new Error("NXDOMAIN"), { code: "ENOTFOUND" });
};

const T = "00000000-0000-0000-0000-0000000000aa";
const P = "22222222-2222-2222-2222-222222222222";
const DANISMAN = "u-danisman";
const OWNER = "u-owner";
const HOUR = 3_600_000;

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let clock: number;
let seq = 0;
let failEventRead = false;
const iso = (ms: number) => new Date(ms).toISOString();

/** `after()` ile ertelenen işleri çalıştırır (Next yanıttan sonra yapar). */
async function drainAfter() {
  while (pendingAfter.length > 0) await pendingAfter.shift()!();
}

/** Bellek içi PostgREST taklidi (actions-replay.test.ts ile aynı zincir) + defter RPC'si. */
function fakeDb(): SupabaseClient {
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let op: "select" | "update" | "delete" | "insert" = "select";
    let patch: Row = {};
    let inserted: Row[] = [];
    let limit = Infinity;
    let wantRows = false;
    const rows = () => (tables[table] ??= []);
    const like = (v: unknown, pat: string, ci: boolean) => {
      const re = new RegExp(`^${pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, ci ? "i" : "");
      return re.test(String(v ?? ""));
    };
    const run = (): { data: unknown; error: unknown } => {
      if (table === "eids_authority_events" && failEventRead) return { data: null, error: { code: "57014", message: "timeout" } };
      if (op === "insert") {
        const out: Row[] = [];
        for (const r of inserted) {
          if (table === "tasks" && r.dedupe_key && rows().some((x) => x.tenant_id === r.tenant_id && x.dedupe_key === r.dedupe_key)) {
            return { data: null, error: { code: "23505", message: "dup" } };
          }
          const row = { id: `${table}-${++seq}`, created_at: iso(clock), ...r };
          rows().push(row);
          out.push(row);
        }
        return { data: out, error: null };
      }
      const hit = rows().filter((r) => filters.every((f) => f(r))).slice(0, limit);
      if (op === "update") for (const r of hit) Object.assign(r, patch);
      if (op === "delete") tables[table] = rows().filter((r) => !hit.includes(r));
      return { data: op === "select" || wantRows ? hit.map((r) => ({ ...r })) : null, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => ((wantRows = true), q),
      insert: (v: Row | Row[]) => ((op = "insert"), (inserted = Array.isArray(v) ? v : [v]), q),
      update: (v: Row) => ((op = "update"), (patch = v), q),
      delete: () => ((op = "delete"), q),
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
      is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), q),
      in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), q),
      not: (k: string, o: string, v: unknown) => {
        if (o === "in") filters.push((r) => !String(v).slice(1, -1).split(",").includes(String(r[k])));
        else filters.push((r) => (r[k] ?? null) !== v);
        return q;
      },
      lt: (k: string, v: string) => (filters.push((r) => r[k] != null && String(r[k]) < v), q),
      gt: (k: string, v: string) => (filters.push((r) => r[k] != null && String(r[k]) > v), q),
      gte: (k: string, v: string) => (filters.push((r) => r[k] != null && String(r[k]) >= v), q),
      lte: (k: string, v: string) => (filters.push((r) => r[k] != null && String(r[k]) <= v), q),
      like: (k: string, v: string) => (filters.push((r) => like(r[k], v, false)), q),
      ilike: (k: string, v: string) => (filters.push((r) => like(r[k], v, true)), q),
      order: () => q,
      limit: (n: number) => ((limit = n), q),
      maybeSingle: async () => {
        const r = run();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
      },
      single: async () => {
        const r = run();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    };
    return q;
  };
  /** `eids_apply_authority_event` taklidi: portföy durumu + yalnız eklenen olay satırı (atomik varsayılır). */
  const rpc = async (fn: string, args: { p_tenant_id: string; p_property_id: string | null; p_event: Row }) => {
    if (fn !== "eids_apply_authority_event") return { data: null, error: { code: "42883", message: "yok" } };
    const p = tables.properties.find((r) => r.id === args.p_property_id && r.tenant_id === args.p_tenant_id);
    if (!p) return { data: { outcome: "not_found" }, error: null };
    const prev = (p.authority_eids_status as string | null) ?? null;
    const next = (args.p_event.new_status as string | null) ?? prev;
    p.authority_eids_status = next;
    const id = `ev-${++seq}`;
    (tables.eids_authority_events ??= []).push({
      id,
      tenant_id: args.p_tenant_id,
      property_id: args.p_property_id,
      kind: args.p_event.kind,
      source: args.p_event.source,
      valid_until: args.p_event.valid_until ?? null,
      prev_status: prev,
      new_status: next,
      created_at: iso(clock),
    });
    return { data: { outcome: "applied", event_id: id, prev_status: prev, new_status: next }, error: null };
  };
  return { from, rpc } as unknown as SupabaseClient;
}

function memoryStore(): InboundStore {
  const rows: (InboundInsert & { id: string })[] = [];
  return {
    async insertMessage(row) {
      if (rows.some((r) => r.message_id && r.message_id === row.message_id)) return { ok: false, conflict: true };
      const id = `m${rows.length + 1}`;
      rows.push({ ...row, id });
      return { ok: true, id };
    },
    async findExisting(tenantId, keys) {
      return (rows.find((r) => r.tenant_id === tenantId && ((keys.messageId && r.message_id === keys.messageId) || (keys.bodySha && r.body_sha256 === keys.bodySha))) ??
        null) as InboundMessageRow | null;
    },
    async updateMessage(tenantId, id, patch) {
      const r = rows.find((x) => x.id === id && x.tenant_id === tenantId);
      if (r) Object.assign(r, patch);
      return Boolean(r);
    },
    async findSemanticCandidates() {
      return [];
    },
    async findPropertiesByEidsNo(_t, no) {
      return no === "9876543210" ? [{ id: P, transaction_type: "Kiralık" }] : [];
    },
    async readAutoApply() {
      return true;
    },
    async touchAddress() {},
    async alertUnknownFormat() {},
  };
}

const takedowns = () => (tables.tasks ?? []).filter((t) => t.kind === "eids_takedown");

beforeEach(() => {
  seq = 0;
  failEventRead = false;
  notices.length = 0;
  pendingAfter.length = 0;
  clock = now();
  tables = {
    properties: [
      {
        id: P,
        tenant_id: T,
        title: "Kiralık daire",
        property_code: "P-9",
        assigned_to: DANISMAN,
        branch_id: null,
        status: "live",
        authorization_end: "2027-06-30",
        authority_eids_status: "approved",
        eids_property_no: "9876543210",
        deleted_at: null,
        is_sample: false,
      },
    ],
    tasks: [],
    eids_takedown_items: [],
    eids_authority_events: [],
    share_links: [],
    portal_listings: [],
    tenant_portal_accounts: [],
    profiles: [{ id: OWNER, tenant_id: T, role: "owner", is_active: true, branch_id: null }],
  };
});

/** İptal e-postasını (Gmail iletimi, ARC doğrulamalı) SMTP köprüsüyle aynı yoldan işler. */
async function receiveRevoke(db: SupabaseClient) {
  return processInboundMail(memoryStore(), ledgerApplier(db), { tenantId: T, via: "eml_upload", raw: fx.revokeArc, resolver });
}

describe("EİDS anlık akış", () => {
  it("yetki iptali e-postası işlendiği anda danışmana ACİL kaldırma görevi ve bildirim açılır", async () => {
    const db = fakeDb();
    const r = await receiveRevoke(db);
    expect(r).toMatchObject({ ok: true, outcome: "applied" });
    // Yanıt anında yalnız defter yazılmıştır; aksiyon `after()` kuyruğundadır (yanıtı geciktirmez).
    expect(tables.eids_authority_events).toHaveLength(1);
    expect(pendingAfter).toHaveLength(1);
    expect(takedowns()).toHaveLength(0);

    await drainAfter();
    expect(takedowns()).toHaveLength(1);
    const ev = tables.eids_authority_events[0];
    expect(takedowns()[0]).toMatchObject({
      status: "open",
      priority: "urgent",
      assigned_to: DANISMAN,
      property_id: P,
      dedupe_key: `eids:takedown:${P}:revoke:${ev.id}`,
    });
    // Vitrin anında kapanır; danışmana ACİL, sahibe bilgi bildirimi.
    expect(tables.properties[0].status).toBe("draft");
    expect(notices.find((n) => n.userId === DANISMAN)).toMatchObject({ title: "ACİL: ilanı 3 gün içinde kaldırın", kind: "danger" });
    expect(notices.some((n) => n.userId === OWNER)).toBe(true);
  });

  it("cron aynı olay için ikinci görev ya da bildirim açmaz (görev açıkken ve kapandıktan sonra)", async () => {
    const db = fakeDb();
    await receiveRevoke(db);
    await drainAfter();
    expect(takedowns()).toHaveLength(1);
    const noticeCount = notices.length;

    clock += 2 * HOUR;
    const s1 = await runEidsActionSweep(db, clock);
    expect(s1.events).toBe(1);
    expect(s1.created).toBe(0);
    expect(s1.errors).toBe(0);
    expect(takedowns()).toHaveLength(1);
    expect(notices).toHaveLength(noticeCount);

    // Danışman görevi kapattı; gece turu olayı yeniden oynatır → tekil anahtar yeni görev açtırmaz.
    takedowns()[0].status = "done";
    clock += 6 * HOUR;
    const s2 = await runEidsActionSweep(db, clock);
    expect(s2.created).toBe(0);
    expect(takedowns()).toHaveLength(1);
    expect(notices).toHaveLength(noticeCount);
  });

  it("aksiyon motoru hata verse de e-posta işleme sonucu bozulmaz; cron sonra görevi açar", async () => {
    const db = fakeDb();
    failEventRead = true;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await receiveRevoke(db);
    expect(r).toMatchObject({ ok: true, outcome: "applied" });
    await expect(drainAfter()).resolves.toBeUndefined();
    expect(takedowns()).toHaveLength(0);
    errSpy.mockRestore();

    failEventRead = false;
    const s = await runEidsActionSweep(db, clock + HOUR);
    expect(s.created).toBe(1);
    expect(takedowns()).toHaveLength(1);
  });
});
