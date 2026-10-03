import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHandoffInput, handoffEditableScopes } from "./handoff";

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
  it("eski form toleransı yok: gerekçe veya kapsam alanı yoksa reddedilir", () => {
    expect(parseHandoffInput(form({ from: A, to: B })).ok).toBe(false);
    expect(parseHandoffInput(form({ from: A, to: B, scope_customers: "1" })).ok).toBe(false);
    expect(parseHandoffInput(form({ from: A, to: B, reason: "ekipten ayrıldı" })).ok).toBe(false);
  });
  it("gerekçe 300 karakteri aşamaz", () => {
    expect(parseHandoffInput(form({ from: A, to: B, reason: "x".repeat(301), scope_tasks: "1" })).ok).toBe(false);
    expect(parseHandoffInput(form({ from: A, to: B, reason: "x".repeat(300), scope_tasks: "1" })).ok).toBe(true);
  });
});

describe("handoffEditableScopes", () => {
  it("yalnız edit izni olan modüllerin kapsamlarını verir", () => {
    expect(handoffEditableScopes({ customers: ["view", "edit"], commissions: ["view"], tasks: ["edit"] })).toEqual(["customers", "tasks"]);
    expect(handoffEditableScopes({})).toEqual([]);
  });
});

describe("handoffMemberWorkload sözleşmesi (B5)", () => {
  const src = readFileSync("src/app/actions/team.ts", "utf8");
  const start = src.indexOf("export async function handoffMemberWorkload");
  const fn = src.slice(start, src.indexOf("export async function getHandoffCounts"));
  it("seçili kalem başına modül düzenleme yetkisi, audit ve geri çevirme içerir", () => {
    expect(fn).toContain("HANDOFF_PERMISSION[scope]");
    expect(src).toContain("export async function getHandoffCounts");
    expect(fn).toContain('"edit"');
    expect(fn).toContain('"team.handoff.failed"');
    expect(fn).toContain(".update({ assigned_to: from })");
    expect(fn).not.toContain("Promise.all([");
  });
});
