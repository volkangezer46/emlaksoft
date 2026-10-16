import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { immutableReadonlyPermissions } from "@/lib/permissions-effective";
import { loadTvData, propertyTypeLabel } from "./tv-data";
import { TV_CONFIG_KEY } from "@/lib/settings/registry/tv";

type Row = Record<string, unknown>;

/**
 * Sahte PostgREST istemcisi: her zincir kendini döndürür, `await` tablo fikstürünü verir. Seçilen sütunlar kaydedilir
 * (sözleşme: TV hiçbir sorguda iletişim/kimlik sütunu SEÇMEZ). Fikstürler bilerek fazladan kişisel alan taşır:
 * yükleyici seçmediği alanı DTO'ya taşımamalıdır.
 */
function mockClient(fixtures: Record<string, Row[]>) {
  const selects: { table: string; cols: string }[] = [];
  const make = (table: string) => {
    let head = false;
    let single = false;
    const result = () => ({
      data: single ? (fixtures[table]?.[0] ?? null) : head ? null : (fixtures[table] ?? []),
      count: head ? (fixtures[table]?.length ?? 0) : null,
      error: null,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = new Proxy(() => undefined, {
      get(_t, prop) {
        if (prop === "then") return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
        if (prop === "select")
          return (cols: string, o?: { head?: boolean }) => {
            selects.push({ table, cols: String(cols) });
            head = Boolean(o?.head);
            return b;
          };
        if (prop === "maybeSingle" || prop === "single")
          return () => {
            single = true;
            return b;
          };
        return () => b;
      },
    });
    return b;
  };
  const client = {
    from: (t: string) => make(t),
    rpc: () => Promise.resolve({ data: [], error: null }),
  } as unknown as SupabaseClient;
  return { client, selects };
}

const NOW = Date.UTC(2026, 9, 16, 12, 0); // 16 Ekim 2026 15:00 İstanbul
const iso = (minsAgo: number) => new Date(NOW - minsAgo * 60_000).toISOString();

function fixtures(): Record<string, Row[]> {
  return {
    tenants: [{ name: "Demo Emlak", city: "İstanbul", logo_url: "javascript:alert(1)", province: null, sample_seeded_at: null }],
    tenant_settings: [{ key: TV_CONFIG_KEY, value: JSON.stringify({ showMoney: true, theme: "light" }) }],
    customers: [
      { id: "c1", created_at: iso(30), full_name: "Ahmet Yılmaz", source: "portal_sahibinden", phone: "05321234567", email: "ahmet@ornek.com" },
      { id: "c2", created_at: iso(60 * 24 * 20), full_name: "Ayşe Demir", source: "web", phone: "05551112233" },
    ],
    appointments: [
      {
        id: "a1",
        scheduled_at: iso(-60),
        status: "confirmed",
        assigned_to: "u1",
        appointment_type: "showing",
        customer: { full_name: "Zeynep Karaca", phone: "05329998877" },
        updated_at: iso(10),
      },
    ],
    tasks: [{ id: "t1", kind: "call", priority: "high", due_at: iso(-30), assigned_to: "u1", title: "Ahmet Bey'i ara 05321234567" }],
    properties: [
      {
        id: "p1",
        property_code: "P-1",
        title: "Boğaz manzaralı villa",
        list_price: 12500000,
        currency: "TRY",
        status: "live",
        transaction_type: "sale",
        property_type: "villa",
        features: { rooms: "5+2", sqm: 320 },
        created_at: iso(60),
        district: { name: "Sarıyer" },
      },
    ],
    property_media: [{ id: "m1", property_id: "p1", file_type: "image/webp", file_name: "on-cephe.webp", is_document: false, kind: "image", is_cover: true }],
    announcements: [{ id: "n1", title: "Cuma toplantısı 10:00", body: "Herkes katılsın.", level: "info", pinned: true }],
    offers: [{ id: "o1", created_at: iso(5), property: { assigned_to: "u1", property_type: "daire", district: { name: "Kadıköy" } } }],
    portal_listings: [{ portal_name: "Sahibinden", last_confirmed_at: iso(60), published_at: iso(600), created_at: iso(600) }],
  };
}

describe("loadTvData: veri sözleşmesi ve gizlilik", () => {
  it("DTO şekli: bütün sahne alanları dolu, sayılar sayı", async () => {
    const { client } = mockClient(fixtures());
    const d = await loadTvData(client, { viewer: { userId: "v", role: "owner", perms: immutableReadonlyPermissions() }, tenantId: "t", moneyAllowed: true, coverMode: "session", nowMs: NOW });
    expect(d.office).toEqual({ name: "Demo Emlak", city: "İstanbul", logoUrl: null }); // https olmayan logo atılır
    expect(d.config.theme).toBe("light");
    expect(d.config.showMoney).toBe(true);
    // Ayar açık olsa da earnings_all yok → tutar yok
    expect(d.moneyVisible).toBe(false);
    expect(d.kpis.revenue).toBeNull();
    for (const k of [d.kpis.wonDeals, d.kpis.newCustomers, d.kpis.newDemands, d.kpis.inboundCalls]) {
      expect(typeof k.value).toBe("number");
      expect(k.series).toHaveLength(14);
    }
    expect(d.today.appointments[0]).toMatchObject({ id: "a1", customer: "Zeynep K.", type: "showing" });
    expect(d.today.tasks[0]).toMatchObject({ kind: "Arama", high: true, overdue: false });
    expect(d.today.leads[0]).toMatchObject({ name: "Ahmet Y.", source: "Sahibinden" });
    expect(d.today.newLeadsToday).toBe(1);
    expect(d.listings[0]).toMatchObject({ district: "Sarıyer", rooms: "5+2", sqm: 320, transaction: "Satılık", propertyType: "Villa", badge: "Yeni", price: 12500000 });
    expect(d.listings[0].coverSrc).toBe("/api/property-media/m1/download");
    expect(d.announcements[0]).toMatchObject({ title: "Cuma toplantısı 10:00", pinned: true });
    expect(d.wins[0]).toMatchObject({ id: "o1", district: "Kadıköy", propertyType: "Daire" });
    expect(d.health.liveListings).toBe(1);
    expect(d.health.portals[0]).toMatchObject({ label: "Sahibinden", live: 1 });
    expect(d.month.days).toBe(31);
    expect(Array.isArray(d.league)).toBe(true);
  });

  it("DTO'da müşteri telefonu, e-postası, tam adı ya da görev başlığı YOK", async () => {
    const { client } = mockClient(fixtures());
    const d = await loadTvData(client, { viewer: { userId: "v", role: "owner", perms: immutableReadonlyPermissions() }, tenantId: "t", moneyAllowed: true, coverMode: "session", nowMs: NOW });
    const text = JSON.stringify(d);
    for (const pii of ["0532", "0555", "@ornek.com", "Yılmaz", "Karaca", "Demir", "Ahmet Bey"]) expect(text, pii).not.toContain(pii);
  });

  it("hiçbir sorgu iletişim / kimlik / adres sütunu seçmez; görev başlığı seçilmez", async () => {
    const { client, selects } = mockClient(fixtures());
    await loadTvData(client, { viewer: { userId: "v", role: "owner", perms: immutableReadonlyPermissions() }, tenantId: "t", moneyAllowed: false, coverMode: "public", nowMs: NOW });
    const tvSelects = selects.filter((s) => ["customers", "appointments", "tasks", "offers", "properties", "calls", "advisor_profiles"].includes(s.table));
    for (const s of tvSelects) {
      expect(s.cols, `${s.table}: ${s.cols}`).not.toMatch(/\b(phone|email|tc_no|national_id\w*|address_line|iban\w*|birth_date)\b/);
    }
    expect(selects.filter((s) => s.table === "tasks").some((s) => /\btitle\b/.test(s.cols) && /kind/.test(s.cols))).toBe(false);
    expect(selects.some((s) => s.table === "advisor_private")).toBe(false);
  });

  it("cihaz kipi: tutar hiç açılmaz, kapaklar yalnız herkese açık uçtan", async () => {
    const { client } = mockClient(fixtures());
    const d = await loadTvData(client, { viewer: { userId: "v", role: "owner", perms: immutableReadonlyPermissions() }, tenantId: "t", moneyAllowed: false, coverMode: "public", nowMs: NOW });
    expect(d.moneyVisible).toBe(false);
    expect(d.moneyPossible).toBe(false);
    expect(d.listings[0].coverSrc).toBe("/api/property-media/m1");
  });

  it("portföy türü etiketi", () => {
    expect(propertyTypeLabel("daire")).toBe("Daire");
    expect(propertyTypeLabel("is_merkezi")).toBe("İs merkezi");
    expect(propertyTypeLabel(null)).toBeNull();
  });
});
