import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { extractPhoneCandidate, extractUrl, listingPortal, OFFLINE_NOTES_KEY, OFFLINE_SCOPE_KEY, parseOfflineNotes, parseVcard, splitByScope } from "./intake";
import { FIELD_CAPTURE_PREFIX } from "@/lib/field-capture/outbox";

describe("share/offline intake helpers (MP8 / MP9)", () => {
  it("extracts a phone candidate and the first URL", () => {
    expect(extractPhoneCandidate("Merhaba 0532 123 45 67 numaram")).toBe("05321234567");
    expect(extractPhoneCandidate("+49 151 2345 6789 arayın")).toBe("+4915123456789");
    expect(extractPhoneCandidate("fiyat 3.500.000 TL")).toBeNull();
    expect(extractUrl(null, "bakın https://www.sahibinden.com/ilan/123.")).toBe("https://www.sahibinden.com/ilan/123");
    expect(listingPortal("https://www.sahibinden.com/ilan/1")).toBe("sahibinden.com");
    expect(listingPortal("https://example.com")).toBeNull();
  });

  it("parses vCard name + phone (folded lines)", () => {
    const v = "BEGIN:VCARD\r\nVERSION:3.0\r\nN:Yılmaz;Ayşe;;;\r\nFN:Ayşe\r\n  Yılmaz\r\nTEL;TYPE=CELL:+90 532 111 22 33\r\nEND:VCARD";
    expect(parseVcard(v)).toEqual({ name: "Ayşe Yılmaz", phone: "+905321112233" });
  });

  it("only same-scope notes are shown; bad JSON is ignored", () => {
    const notes = parseOfflineNotes(JSON.stringify([
      { id: "a", at: 1, scope: "s1", name: "A", phone: "", note: "" },
      { id: "b", at: 2, scope: "s2", name: "B", phone: "", note: "" },
      { id: "c", at: 3, scope: null, name: "C", phone: "", note: "" },
    ]));
    const { mine, foreign } = splitByScope(notes, "s1");
    expect(mine.map((n) => n.id)).toEqual(["a"]);
    expect(foreign.map((n) => n.id)).toEqual(["b", "c"]);
    expect(parseOfflineNotes("{bozuk")).toEqual([]);
  });

  it("offline notes are wiped with field-capture storage on sign-out and offline.html uses the same keys", () => {
    expect(OFFLINE_NOTES_KEY.startsWith(FIELD_CAPTURE_PREFIX)).toBe(true);
    const html = readFileSync("public/offline.html", "utf8");
    expect(html).toContain(`"${OFFLINE_NOTES_KEY}"`);
    expect(html).toContain(`"${OFFLINE_SCOPE_KEY}"`);
    expect(html).toContain("Çevrimdışısınız");
    expect(html).not.toMatch(/Çevrimdışısın[^ı]/);
    expect(html).toContain('href="/app/hizli"');
  });
});
