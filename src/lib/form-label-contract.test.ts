import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Form etiket sözleşmesi (denetim A1 + A2).
 *
 * Kaynak taramasıyla doğrular:
 *  - her görünür kontrol (input/select/textarea/PhoneInput/EmailInput/SelectTrigger)
 *    bir etikete bağlıdır: aria-label | aria-labelledby | <label> sarmalı | id + eşleşen htmlFor
 *  - yetim <label> yoktur (kontrol sarmalamıyorsa htmlFor zorunlu ve hedef id dosyada var)
 *  - hata/başarı mesajı gösteren dosyalarda role="alert" / role="status" / aria-live vardır
 *
 * Yeni form dosyası eklenirse FILES listesine koyun; istisna gerekiyorsa gerekçeyle EXEMPT'e.
 */

const FILES = [
  "src/app/lead/[token]/lead-form.tsx",
  "src/app/odeme-link/[token]/pay-buttons.tsx",
  "src/app/acik-ev-kayit/[token]/checkin-form.tsx",
  "src/app/anket/[token]/survey-form.tsx",
  "src/app/anket/[token]/task-survey-form.tsx",
  "src/app/app/otomasyonlar/automation-wizard.tsx",
  "src/components/app/communication-timeline.tsx",
  "src/app/admin/tickets/[id]/ticket-detail-controls.tsx",
  "src/app/app/portfoyler/[id]/property-extras.tsx",
  "src/app/app/uyum/iys-form.tsx",
];

/** Hata/uyarı metni gösteren ve role="alert" (veya aria-live) şart koşulan dosyalar. */
const ALERT_FILES = FILES.filter((f) => !f.endsWith("iys-form.tsx")); // iys-form hatayı toast ile gösterir

const CONTROL_TAGS = ["input", "select", "textarea", "PhoneInput", "EmailInput", "SelectTrigger"];

/** Gerekçeli istisna: yok. (Honeypot ve type=hidden/aria-hidden kontroller koddan otomatik atlanır.) */
const EXEMPT: Record<string, string> = {};

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");
}

type Tag = { name: string; text: string; index: number };

/** `<name ...>` açılış etiketlerini, süslü parantez ve tırnakları izleyerek çıkarır. */
function openingTags(src: string, names: string[]): Tag[] {
  const out: Tag[] = [];
  const re = new RegExp(`<(${names.join("|")})(?=[\\s/>])`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 0;
    let quote: string | null = null;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (depth === 0 && (ch === '"' || ch === "'")) quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0 && src[i - 1] !== "=") break;
    }
    out.push({ name: m[1], text: src.slice(m.index, i + 1), index: m.index });
  }
  return out;
}

/** index, açık (kapanmamış) bir <label> içinde mi? */
function insideLabel(src: string, index: number): boolean {
  const before = src.slice(0, index);
  return before.lastIndexOf("<label") > before.lastIndexOf("</label>");
}

describe("form etiket sözleşmesi", () => {
  for (const rel of FILES) {
    describe(rel, () => {
      const src = read(rel);
      const ids = new Set([...src.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
      const htmlFors = new Set([...src.matchAll(/\bhtmlFor="([^"]+)"/g)].map((m) => m[1]));

      it("her görünür kontrol etiketlidir", () => {
        if (EXEMPT[rel]) return;
        const bad: string[] = [];
        for (const tag of openingTags(src, CONTROL_TAGS)) {
          const t = tag.text;
          if (/aria-hidden=/.test(t) || /type="(hidden|checkbox|radio)"/.test(t)) {
            // checkbox: sarmalayan label kuralı ayrıca aşağıda denetlenir
            if (/type="(checkbox|radio)"/.test(t) && !/aria-hidden=/.test(t) && !insideLabel(src, tag.index) && !/aria-label/.test(t)) {
              bad.push(t.slice(0, 80));
            }
            continue;
          }
          if (/aria-label=|aria-labelledby=/.test(t)) continue;
          if (insideLabel(src, tag.index)) continue;
          const id = /\bid="([^"]+)"/.exec(t)?.[1];
          if (id && htmlFors.has(id)) continue;
          bad.push(t.replace(/\s+/g, " ").slice(0, 100));
        }
        expect(bad, `etiketsiz kontroller:\n${bad.join("\n")}`).toEqual([]);
      });

      it("yetim <label> yoktur", () => {
        const bad: string[] = [];
        for (const tag of openingTags(src, ["label"])) {
          const end = src.indexOf("</label>", tag.index);
          const body = src.slice(tag.index, end === -1 ? undefined : end);
          const wraps = /<(input|select|textarea|PhoneInput|EmailInput)(?=[\s/>])/.test(body);
          if (wraps) continue;
          const dyn = /htmlFor=\{/.test(tag.text);
          const target = /htmlFor="([^"]+)"/.exec(tag.text)?.[1];
          if (dyn) continue;
          if (!target || !ids.has(target)) bad.push(tag.text.replace(/\s+/g, " ").slice(0, 100));
        }
        expect(bad, `yetim label'lar:\n${bad.join("\n")}`).toEqual([]);
      });
    });
  }

  for (const rel of ALERT_FILES) {
    it(`${rel}: hata/durum bildirimi duyurulur (role=alert|status veya aria-live)`, () => {
      const src = read(rel);
      expect(/role=\{?"?(alert|status)|aria-live=/.test(src)).toBe(true);
    });
  }

  it("lead-form ve pay-buttons hata paragrafı role=alert taşır", () => {
    expect(read("src/app/lead/[token]/lead-form.tsx")).toMatch(/\{error && <p role="alert"/);
    expect(read("src/app/odeme-link/[token]/pay-buttons.tsx")).toMatch(/\{error \? <p role="alert"/);
  });
});
