import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHandoffInput, LEGACY_HANDOFF_REASON } from "./handoff";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function form(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

describe("parseHandoffInput (B5)", () => {
  it("geçersiz/aynı kimlikleri reddeder", () => {
    expect(parseHandoffInput(form({ from: "x", to: B, reason: "ayrıldı" })).ok).toBe(false);
    expect(parseHandoffInput(form({ from: A, to: A, reason: "ayrıldı" })).ok).toBe(false);
    expect(parseHandoffInput(form({ from: A })).ok).toBe(false);
  });
  it("gerekçe gönderilmişse boş/kısa olamaz", () => {
    const r = parseHandoffInput(form({ from: A, to: B, reason: "  ab " }));
    expect(r).toMatchObject({ ok: false });
  });
  it("seçili kapsamları okur; hiçbiri seçili değilse hata", () => {
    const r = parseHandoffInput(form({ from: A, to: B, reason: "ekipten ayrıldı", scope_customers: "1", scope_deals: "1", scope_tasks: "0" }));
    expect(r.ok && r.input.scopes).toEqual(["customers", "deals"]);
    const none = parseHandoffInput(form({ from: A, to: B, reason: "ekipten ayrıldı", scope_customers: "0" }));
    expect(none.ok).toBe(false);
  });
  it("eski form (alan yok): tüm kapsamlar + varsayılan gerekçe", () => {
    const r = parseHandoffInput(form({ from: A, to: B }));
    expect(r.ok && r.input.reason).toBe(LEGACY_HANDOFF_REASON);
    expect(r.ok && r.input.scopes).toHaveLength(5);
  });
});

describe("handoffMemberWorkload sözleşmesi (B5)", () => {
  const src = readFileSync("src/app/actions/team.ts", "utf8");
  const fn = src.slice(src.indexOf("export async function handoffMemberWorkload"));
  it("seçili kalem başına modül düzenleme yetkisi, audit ve geri çevirme içerir", () => {
    expect(fn).toContain("HANDOFF_PERMISSION[scope]");
    expect(fn).toContain('"edit"');
    expect(fn).toContain('"team.handoff.failed"');
    expect(fn).toContain(".update({ assigned_to: from })");
    expect(fn).not.toContain("Promise.all([");
  });
});
