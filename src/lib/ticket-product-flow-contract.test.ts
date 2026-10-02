import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("professional support product flow contract", () => {
  const tenantReply = source("src/app/app/destek/ticket-reply-form.tsx");
  const staffReply = source("src/app/admin/tickets/staff-reply-form.tsx");
  const newTicket = source("src/app/app/destek/yeni/new-ticket-form.tsx");
  const tenantDetail = source("src/app/app/destek/[id]/page.tsx");
  const thread = source("src/app/app/destek/[id]/ticket-thread.tsx");
  const controls = source("src/app/admin/tickets/[id]/ticket-detail-controls.tsx");

  it("idempotency UUID'sini form ömrü boyunca hidden inputta sabit tutar", () => {
    for (const form of [tenantReply, staffReply, newTicket]) {
      expect(form).toContain('name="request_id" value={requestId}');
      expect(form).toContain('String(formData.get("request_id") ?? "")');
      expect(form).toContain("setRequestId(crypto.randomUUID())");
    }
    expect(tenantReply).not.toContain('replyData.set("request_id", crypto.randomUUID())');
    expect(staffReply).not.toContain('replyData.set("request_id", crypto.randomUUID())');
  });

  it("tenant konuşmasında internal satırı query, initial render ve Realtime katmanında reddeder", () => {
    expect(tenantDetail).toContain('.eq("visibility", "public")');
    expect(thread).toContain('messages.filter((message) => message.visibility === "public")');
    expect(thread).toContain('audience === "tenant" && row.visibility !== "public"');
  });

  it("closed ticket'ta public yanıtı kapatırken staff iç notunu açık tutar", () => {
    expect(staffReply).toContain('closed ? "internal" : visibility');
    expect(staffReply).toContain("disabled={closed}");
    expect(staffReply).not.toMatch(/if \(disabled\)[\s\S]*return/);
  });

  it("detay işlem panelini geçerli transition, kategori ve öncelik actionlarına bağlar", () => {
    expect(controls).toContain("isTicketTransitionAllowed");
    expect(controls).toContain("updateTicketPriority");
    expect(controls).toContain("updateTicketCategory");
    expect(controls).toContain('aria-live="polite"');
  });
});
