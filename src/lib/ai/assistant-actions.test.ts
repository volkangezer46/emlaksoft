import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseAssistantProposal } from "./assistant-actions";
import { describeProposal } from "./assistant-actions-view";

describe("onaylı eylemli asistan", () => {
  it("geçerli öneriler doğrulanır; kod bloğu tolere edilir", () => {
    const t = parseAssistantProposal('```json\n{"type":"task","title":"Ayşe Hanım\'ı ara","dueInDays":1}\n```');
    expect(t.ok && t.proposal.type).toBe("task");
    const p = parseAssistantProposal(JSON.stringify({ type: "followup_plan", title: "Satıcı takibi", steps: [{ dayOffset: 0, title: "Tanışma araması" }, { dayOffset: 3, title: "Değerleme sunumu" }] }));
    expect(p.ok).toBe(true);
    if (p.ok) expect(describeProposal(p.proposal)[2]).toBe("2. 3. gün: Değerleme sunumu");
  });

  it("kapalı liste dışı, şemasız, 'none' ve kişisel veri içeren taslak reddedilir", () => {
    expect(parseAssistantProposal('{"type":"delete_customer","id":"x"}').ok).toBe(false);
    expect(parseAssistantProposal('{"type":"none"}').ok).toBe(false);
    expect(parseAssistantProposal("merhaba").ok).toBe(false);
    expect(parseAssistantProposal(JSON.stringify({ type: "task", title: "x", dueInDays: 99 })).ok).toBe(false);
    expect(parseAssistantProposal(JSON.stringify({ type: "message_draft", audience: "kiracılar", channel: "sms", message: "Bizi arayın 0532 111 22 33 hemen" })).ok).toBe(false);
    expect(parseAssistantProposal(JSON.stringify({ type: "followup_plan", title: "Plan", steps: Array.from({ length: 6 }, (_, i) => ({ dayOffset: i, title: "Adım " + i })) })).ok).toBe(false);
  });

  it("öneri yazmaz; onay yeniden doğrular; OpenAI yalnız openai-client + audit + kota kapısı", () => {
    const src = readFileSync("src/app/actions/assistant-actions.ts", "utf8");
    const propose = src.slice(src.indexOf("export async function proposeAssistantAction"), src.indexOf("export async function approveAssistantAction"));
    expect(propose).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
    expect(propose).toContain("canAutoCallAi(");
    expect(propose).toContain("audit: { tenantId: gate.tenantId, actorId: gate.userId }");
    expect(src).toContain("AssistantProposalSchema.safeParse(input)");
    expect(src).not.toContain("api.openai.com");
  });
});
