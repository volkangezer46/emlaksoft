import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkVoiceSummary, fileNameForAudio, formatVoiceNote, isAllowedAudioType } from "./voice-note";

describe("ses biçimi", () => {
  it("izinli türler ve dosya adı", () => {
    expect(isAllowedAudioType("audio/webm;codecs=opus")).toBe(true);
    expect(isAllowedAudioType("audio/mp4")).toBe(true);
    expect(isAllowedAudioType("video/mp4")).toBe(false);
    expect(isAllowedAudioType("")).toBe(false);
    expect(fileNameForAudio("audio/mp4")).toBe("not.m4a");
    expect(fileNameForAudio("audio/webm")).toBe("not.webm");
  });
});

describe("özet doğrulama", () => {
  const transcript = "Müşteri 3+1 daire istiyor, bütçesi 4.500.000 TL. Cuma günü tekrar aranacak.";
  it("transkriptte geçen sayılarla özet kabul edilir", () => {
    expect(checkVoiceSummary("- 3+1 daire arıyor\n- Bütçe 4.500.000 TL", transcript).ok).toBe(true);
  });
  it("uydurma sayı veya boş çıktı reddedilir", () => {
    expect(checkVoiceSummary("- Bütçe 9.000.000 TL", transcript).ok).toBe(false);
    expect(checkVoiceSummary("", transcript).ok).toBe(false);
  });
  it("not gövdesi özet + transkript içerir", () => {
    const t = formatVoiceNote({ summary: "- özet", transcript: "ham metin", stamp: "08.10.2026" });
    expect(t).toContain("Sesli not");
    expect(t).toContain("- özet");
    expect(t).toContain("Transkript:");
  });
});

describe("sözleşme: ses saklanmaz, yalnız openai-client", () => {
  const action = readFileSync("src/app/actions/voice-note.ts", "utf8");
  it("sunucu eylemi dosyaya/depoya ses yazmaz ve doğrudan OpenAI çağırmaz", () => {
    expect(action).not.toMatch(/storage\.from|writeFile|createWriteStream/);
    expect(action).not.toContain("api.openai.com");
    expect(action).toContain('from "@/lib/ai/openai-client"');
  });
  it("ofis ayarı, kota ve rıza kapıları var; her eylem requirePermission çağırır", () => {
    expect(action).toContain("AI_VOICE_NOTES_KEY");
    expect(action).toContain("canAutoCallAi");
    expect(action).toContain('formData.get("consent")');
    expect((action.match(/requirePermission\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
  it("transkript çağrısı denetim + kredi defterine yazar", () => {
    const client = readFileSync("src/lib/ai/openai-client.ts", "utf8");
    const fn = client.slice(client.indexOf("export async function openAiTranscribe"));
    expect(fn).toContain("ai.openai_call");
    expect(fn).toContain("chargeAiUsage");
  });
  it("ayar varsayılanları KAPALI", async () => {
    const { getSettingDef } = await import("@/lib/settings/registry");
    expect(getSettingDef("office.ai.voice_notes_enabled")?.default).toBe(false);
    expect(getSettingDef("office.ai.listing_text_enabled")?.default).toBe(false);
  });
});
