import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCustomerEvents } from "./customer-events";

/**
 * YD2 kabul (müşteri kartı tarafı): sunumda bırakılan "İlgileniyorum" geri bildirimi müşteri 360 geçmişine
 * (portal kategorisi) ilan adı, sunum başlığı ve notla düşer; tablo yoksa (hata) kaynak sessizce boş kalır.
 */
type Result = { data: unknown; error: unknown };

function fakeSupabase(tables: Record<string, Result>): SupabaseClient {
  return {
    from(table: string) {
      const result = tables[table] ?? { data: [], error: null };
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "is", "not", "order", "limit"]) chain[m] = () => chain;
      chain.then = (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
      return chain;
    },
  } as unknown as SupabaseClient;
}

const pre = { calls: [], appts: [], comms: [], offers: [], tasks: [], deals: [], stageNames: {} };

describe("buildCustomerEvents — sunum geri bildirimi", () => {
  it("ilgileniyorum kaydı müşteri geçmişine portföy, sunum ve notla düşer", async () => {
    const supabase = fakeSupabase({
      presentation_feedback: {
        data: [
          {
            id: "pf-1",
            property_id: "prop-1",
            verdict: "interested",
            note: "Hafta sonu görebilir miyiz?",
            updated_at: "2026-10-14T09:00:00.000Z",
            presentation: { title: "Ayşe Hanım için seçki" },
          },
        ],
        error: null,
      },
      properties: { data: [{ id: "prop-1", title: "Kadıköy 3+1", property_code: "P-1" }], error: null },
    });

    const events = await buildCustomerEvents(supabase, "cust-1", "2026-10-01T00:00:00.000Z", pre);
    const ev = events.find((e) => e.id === "pfb-pf-1");
    expect(ev).toMatchObject({
      category: "portal",
      title: 'Gönderilen ilanlarda "İlgileniyorum" dedi · Kadıköy 3+1',
      detail: "Gönderim: Ayşe Hanım için seçki · Not: Hafta sonu görebilir miyiz?",
      tone: "success",
      href: "/app/portfoyler/prop-1",
    });
  });

  it("tablo yokken (hata) olay üretmez, akış bozulmaz", async () => {
    const supabase = fakeSupabase({
      presentation_feedback: { data: null, error: { code: "PGRST205", message: "schema cache" } },
    });
    const events = await buildCustomerEvents(supabase, "cust-1", "2026-10-01T00:00:00.000Z", pre);
    expect(events.some((e) => e.id.startsWith("pfb-"))).toBe(false);
    expect(events.some((e) => e.id === "created")).toBe(true);
  });
});
