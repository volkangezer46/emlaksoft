import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mergeCandidates, mergeErrorMessage, parseMergePayload } from "./ticket-merge";

describe("talep birleştirme yardımcıları", () => {
  it("RPC yükünü doğrular", () => {
    expect(parseMergePayload(null)).toBeNull();
    expect(parseMergePayload({ ok: true, sourceId: "a", targetId: "b" })).toBeNull();
    expect(parseMergePayload({ ok: true, sourceId: "a", targetId: "b", tenantId: "t", sourceNo: "ES-1", createdBy: null })).toMatchObject({ sourceNo: "ES-1", createdBy: null });
  });
  it("bilinen hataları Türkçeye çevirir", () => {
    expect(mergeErrorMessage({ message: "MERGE_TARGET_CLOSED: x" })).toContain("Kapalı talebe");
    expect(mergeErrorMessage({ code: "PGRST202", message: "Could not find the function" })).toContain("etkin değil");
    expect(mergeErrorMessage({ message: "başka" })).toBeNull();
  });
  it("aday listesi kendisini, kapalıyı ve birleşmişi dışlar", () => {
    const rows = [
      { id: "1", ticket_no: null, subject: "a", status: "open" },
      { id: "2", ticket_no: null, subject: "b", status: "closed" },
      { id: "3", ticket_no: null, subject: "c", status: "waiting", merged_into_id: "9" },
      { id: "4", ticket_no: null, subject: "d", status: "resolved" },
    ];
    expect(mergeCandidates(rows, "1").map((r) => r.id)).toEqual(["4"]);
  });
});

describe("birleştirme migration sözleşmesi", () => {
  const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261019070001_support_ticket_merge.sql"), "utf8");
  it("yalnız service_role, sabit kilit sırası, aynı ofis ve SECURITY DEFINER + boş search_path", () => {
    expect(sql).toContain("perform public.support_require_service_role()");
    expect(sql).toContain("order by t.id for update");
    expect(sql).toContain("MERGE_TENANT");
    expect(sql).toMatch(/security definer\s+set search_path = ''/);
    expect(sql).toContain("revoke all on function public.support_merge_tickets(uuid, uuid, uuid) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.support_merge_tickets(uuid, uuid, uuid) to service_role");
    expect(sql).not.toMatch(/^\s*notify pgrst/m);
  });
});
