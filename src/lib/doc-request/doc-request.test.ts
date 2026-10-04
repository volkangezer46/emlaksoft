import { describe, expect, it } from "vitest";
import {
  evaluateRequestState,
  displayStatus,
  isOcrEligible,
  isWellFormedToken,
  missingTypes,
  parseCreateRequestForm,
} from "./doc-request";

const NOW = Date.parse("2026-10-05T12:00:00Z");
const base = { status: "active", expires_at: "2026-10-10T00:00:00Z", file_count: 0, max_files: 3 };

describe("evaluateRequestState", () => {
  it("açık link ok", () => expect(evaluateRequestState(base, NOW)).toBe("ok"));
  it("iptal her şeyden önce gelir", () => {
    expect(evaluateRequestState({ ...base, status: "revoked", expires_at: "2020-01-01T00:00:00Z" }, NOW)).toBe("revoked");
  });
  it("tamamlanan link kapalı", () => expect(evaluateRequestState({ ...base, status: "completed" }, NOW)).toBe("completed"));
  it("süre dolunca expired; geçersiz tarih de expired", () => {
    expect(evaluateRequestState({ ...base, expires_at: "2026-10-05T12:00:00Z" }, NOW)).toBe("expired");
    expect(evaluateRequestState({ ...base, expires_at: "bozuk" }, NOW)).toBe("expired");
  });
  it("dosya sınırı dolunca full", () => {
    expect(evaluateRequestState({ ...base, file_count: 3 }, NOW)).toBe("full");
    expect(displayStatus({ ...base, file_count: 2 }, NOW)).toBe("active");
  });
});

describe("isWellFormedToken", () => {
  it("yalnız 43 karakter base64url kabul eder", () => {
    expect(isWellFormedToken("A".repeat(43))).toBe(true);
    expect(isWellFormedToken("A".repeat(42))).toBe(false);
    expect(isWellFormedToken("A".repeat(42) + "=")).toBe(false);
    expect(isWellFormedToken("../" + "A".repeat(40))).toBe(false);
    expect(isWellFormedToken(undefined)).toBe(false);
  });
});

describe("OCR uygunluğu", () => {
  it("kimlik belgesi hiçbir zaman OCR'a gitmez", () => {
    expect(isOcrEligible("identity", "image/jpeg")).toBe(false);
    expect(isOcrEligible("other", "image/jpeg")).toBe(false);
  });
  it("tapu/yetki yalnız görselde uygun, PDF'te değil", () => {
    expect(isOcrEligible("title_deed", "image/png")).toBe(true);
    expect(isOcrEligible("authorization_contract", "image/webp")).toBe(true);
    expect(isOcrEligible("title_deed", "application/pdf")).toBe(false);
  });
});

describe("parseCreateRequestForm", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  function fd(extra: Record<string, string | string[]>) {
    const f = new FormData();
    f.set("title", "Satış evrakları");
    f.set("customer_id", id);
    for (const [k, v] of Object.entries(extra)) {
      f.delete(k);
      for (const item of Array.isArray(v) ? v : [v]) f.append(k, item);
    }
    return f;
  }
  it("varsayılanlarla geçerli", () => {
    const r = parseCreateRequestForm(fd({ types: ["title_deed", "identity", "title_deed", "zz"] }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.types).toEqual(["title_deed", "identity"]);
      expect(r.value.expiryDays).toBe(7);
      expect(r.value.maxFiles).toBe(10);
    }
  });
  it("tür yoksa, süre listede değilse, sınır dışıysa, bağlantı yoksa reddeder", () => {
    expect(parseCreateRequestForm(fd({ types: [] })).ok).toBe(false);
    expect(parseCreateRequestForm(fd({ types: "identity", expiry_days: "365" })).ok).toBe(false);
    expect(parseCreateRequestForm(fd({ types: "identity", max_files: "99" })).ok).toBe(false);
    expect(parseCreateRequestForm(fd({ types: "identity", customer_id: "" })).ok).toBe(false);
    expect(parseCreateRequestForm(fd({ types: "identity", title: " " })).ok).toBe(false);
  });
});

describe("missingTypes", () => {
  it("yüklenmeyen istenen türleri verir", () => {
    expect(missingTypes(["identity", "title_deed"], ["title_deed"])).toEqual(["identity"]);
    expect(missingTypes(["bilinmeyen"], [])).toEqual([]);
  });
});
