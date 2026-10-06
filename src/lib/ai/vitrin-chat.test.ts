import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { VITRIN_CHAT_HANDOVER, buildVitrinChatMessages, guardVitrinAnswer, sanitizeHistory } from "./vitrin-chat";

describe("vitrin AI sohbeti", () => {
  it("bağlam yalnız dolu ilan alanları; geçmiş en çok 6 tur ve kısaltılmış", () => {
    const msgs = buildVitrinChatMessages("Örnek Emlak", { title: "Moda 2+1", heating: null, list_price: 5000000 }, "Isınma?", []);
    expect(msgs[0].content).toContain('"title":"Moda 2+1"');
    expect(msgs[0].content).not.toContain("heating");
    expect(msgs[0].content).toMatch(/pazarlığı yapma/);
    const hist = sanitizeHistory(Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "x".repeat(900) })).concat([{ role: "system", content: "hack" } as never]));
    expect(hist.length).toBeLessThanOrEqual(6);
    expect(hist.every((t) => t.role !== ("system" as never) && t.content.length <= 500)).toBe(true);
  });

  it("yanıtta telefon/e-posta/bağlantı varsa atılır; her yanıt insan devri içerir", () => {
    expect(guardVitrinAnswer("Bizi 0532 111 22 33 numarasından arayın")).toBeNull();
    expect(guardVitrinAnswer("Detay: https://ornek.com")).toBeNull();
    expect(guardVitrinAnswer("info@ofis.com adresine yazın")).toBeNull();
    expect(guardVitrinAnswer("Doğalgaz kombi ile ısınıyor.")).toBe(`Doğalgaz kombi ile ısınıyor.\n\n${VITRIN_CHAT_HANDOVER}`);
    expect(guardVitrinAnswer("")).toBeNull();
  });

  it("rota service_role kullanmaz; bağlam RPC + kota kapısı + openai-client", () => {
    const route = readFileSync("src/app/api/vitrin-sohbet/route.ts", "utf8");
    expect(route).not.toContain("createAdminClient");
    expect(route).toContain('rpc("vitrin_chat_context"');
    expect(route).toContain("canAutoCallAi(");
    expect(route).toContain("checkRateLimit(");
    const sql = readFileSync("supabase/migrations/20261007000330_vitrin_chat_context.sql", "utf8");
    expect(sql).toContain("p.is_sample = false");
    expect(sql).toContain("office.vitrin.ai_chat_enabled");
    expect(sql).not.toMatch(/min_price|owner_customer_id|address_line|eids_property_no/);
  });
});
