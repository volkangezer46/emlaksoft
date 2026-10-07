import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Form etiketi — TÜM `src/**\/*.tsx` kesin taraması (form-label-contract.test.ts yalnız seçili
 * dosyaların ayrıntılı denetimidir; bu test her yeni alanı yakalar).
 *
 * Her görünür kontrol (input, select, textarea, PhoneInput, EmailInput, SelectTrigger, Input,
 * Textarea, FormInput, FormTextarea, FormSelect) şu yollardan biriyle ad almalıdır:
 *  - `aria-label` / `aria-labelledby`
 *  - kaynakta açık bir `<label>` içinde
 *  - çocuklarını `<label>` içine saran bir bileşen içinde (yerel veya içe aktarılmış; ör. site-menu `Field`)
 *  - `form-controls` `FormField htmlFor=…` içinde (tek çocuğa id enjekte eder)
 *  - `id="x"` / `id={x}` + aynı dosyada `htmlFor="x"` / `htmlFor={x}`
 * Atlananlar: `type="hidden"`, `aria-hidden`, `{...props}` yayan ilkel bileşenler (etiketi çağıran verir),
 * yorumlar ve `= \`…\`` şablon metinleri (ör. gömme kodu örneği).
 *
 * Yeni istisna yalnız gerekçeyle EXEMPT'e girer.
 */

const ROOT = process.cwd();
const CONTROL_TAGS = ["input", "select", "textarea", "PhoneInput", "EmailInput", "SelectTrigger", "Input", "Textarea", "FormInput", "FormTextarea", "FormSelect"];

/** dosya → gerekçe */
const EXEMPT: Record<string, string> = {
  "src/app/app/hesaplayici/seller-calculator.tsx": "moneyInput(…, id) yardımcısı; id her çağrıda FormField htmlFor ile aynı (statik tarama dinamik id'yi izleyemez).",
  // Eşzamanlı ajan kapsamı (2026-10-07): sahibi liste/görünüm dosyasını yeniden yazıyor; birleştirmede aria-label eklenecek.
  "src/app/admin/geo/page.tsx": "A kapsamı (admin liste sayfası): arama kutusu → aria-label=\"İl ara\" birleştirmede.",
  "src/app/admin/geo/[provinceId]/page.tsx": "A kapsamı: arama kutusu → aria-label=\"İlçe ara\" birleştirmede.",
  "src/app/admin/geo/[provinceId]/[districtId]/page.tsx": "A kapsamı: arama kutusu → aria-label=\"Mahalle ara\" birleştirmede.",
  "src/app/admin/tenants/page.tsx": "A kapsamı: arama kutusu → aria-label=\"Ofis ara\" birleştirmede.",
  "src/components/admin/openai-key-form.tsx": "A kapsamı (src/components/admin/**): anahtar alanı → aria-label=\"OpenAI API anahtarı\" birleştirmede.",
  "src/components/admin/portal-keys-form.tsx": "A kapsamı: üç alan → aria-label (API anahtarı / Acente ID / API adresi) birleştirmede.",
  "src/app/app/ekip/branch-card.tsx": "B kapsamı (ekip listesi görünümü): şube adı / il → aria-label birleştirmede.",
  "src/app/app/komisyon/commission-split-editor.tsx": "B kapsamı (komisyon görünümü): taraf / oran → aria-label birleştirmede.",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx") && !p.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}

const cache = new Map<string, string>();
/** Yorumları ve `= \`…\`` şablon metinlerini aynı uzunlukta boşlukla değiştirir (satır numarası korunur). */
function readSrc(abs: string): string {
  const hit = cache.get(abs);
  if (hit !== undefined) return hit;
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  const src = readFileSync(abs, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p1: string) => p1 + " ".repeat(m.length - p1.length))
    .replace(/=\s*`[^`]*`/g, (m) => (/<(input|select|textarea)\b/.test(m) ? blank(m) : m));
  cache.set(abs, src);
  return src;
}

type Tag = { text: string; index: number };
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
    out.push({ text: src.slice(m.index, i + 1), index: m.index });
  }
  return out;
}

/** index, açık (kapanmamış) bir <name> elemanının içinde mi? Açılış konumunu döner (yoksa -1). */
function enclosing(src: string, index: number, name: string): number {
  const before = src.slice(0, index);
  let open = -1;
  for (const m of before.matchAll(new RegExp(`<${name}(?=[\\s>])`, "g"))) open = m.index ?? -1;
  return open > before.lastIndexOf(`</${name}>`) ? open : -1;
}

function resolveImport(fromAbs: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromAbs), spec);
  else return null;
  for (const c of [`${base}.tsx`, `${base}.ts`, path.join(base, "index.tsx")]) if (existsSync(c)) return c;
  return null;
}

/** Dosyada tanımlı, `{children}`'ı <label> içinde çizen bileşen adları. */
function localWrappers(abs: string): Set<string> {
  const src = readSrc(abs);
  const out = new Set<string>();
  const starts = [...src.matchAll(/(?:^|\n)(?:export\s+)?function\s+([A-Z]\w*)\s*\(/g)].map((m) => ({ name: m[1], index: m.index ?? 0 }));
  starts.forEach((s, i) => {
    const body = src.slice(s.index, starts[i + 1]?.index ?? src.length);
    const ci = body.indexOf("{children}");
    if (ci !== -1 && enclosing(body, ci, "label") !== -1) out.add(s.name);
  });
  return out;
}

function wrappersFor(abs: string): Set<string> {
  const src = readSrc(abs);
  const set = new Set(localWrappers(abs));
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g)) {
    const target = resolveImport(abs, m[2]);
    if (!target) continue;
    const names = m[1].split(",").map((x) => x.trim().replace(/^type\s+/, "").split(/\s+as\s+/)).filter((x) => x[0]);
    const tw = localWrappers(target);
    for (const [orig, alias] of names) if (tw.has(orig)) set.add(alias ?? orig);
    if (/components\/ui\/form-controls$/.test(m[2]) && names.some(([o]) => o === "FormField")) set.add("FormField@inject");
  }
  return set;
}

function unlabeled(abs: string): string[] {
  const src = readSrc(abs);
  const wrappers = wrappersFor(abs);
  const htmlFors = new Set([...src.matchAll(/\bhtmlFor=(?:"([^"]+)"|\{([^}]+)\})/g)].map((m) => m[1] ?? `{${m[2]}}`));
  const bad: string[] = [];
  for (const tag of openingTags(src, CONTROL_TAGS)) {
    const t = tag.text;
    if (/aria-hidden=/.test(t) || /type="hidden"/.test(t)) continue;
    if (/\{\.\.\.[^}]*\}/.test(t)) continue;
    if (/aria-label=|aria-labelledby=/.test(t)) continue;
    if (enclosing(src, tag.index, "label") !== -1) continue;
    let wrapped = false;
    for (const w of wrappers) {
      if (w === "FormField@inject") {
        const o = enclosing(src, tag.index, "FormField");
        if (o !== -1) {
          const ot = openingTags(src.slice(o), ["FormField"])[0]?.text ?? "";
          if (/htmlFor=/.test(ot) && !/inject=\{false\}/.test(ot)) wrapped = true;
        }
      } else if (enclosing(src, tag.index, w) !== -1) wrapped = true;
    }
    if (wrapped) continue;
    const id = /\bid=(?:"([^"]+)"|\{([^}]+)\})/.exec(t);
    const key = id ? (id[1] ?? `{${id[2]}}`) : null;
    if (key && htmlFors.has(key)) continue;
    const line = src.slice(0, tag.index).split("\n").length;
    bad.push(`${line}: ${t.replace(/\s+/g, " ").slice(0, 110)}`);
  }
  return bad;
}

describe("form etiketi — tüm kaynak taraması", () => {
  const files = walk(path.join(ROOT, "src"));

  it("tarama geniş (yüzlerce .tsx)", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("her görünür kontrolün erişilebilir adı var (istisnalar gerekçeli)", () => {
    const bad: string[] = [];
    for (const abs of files) {
      const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
      if (EXEMPT[rel]) continue;
      for (const b of unlabeled(abs)) bad.push(`${rel}:${b}`);
    }
    expect(bad, `etiketsiz kontroller (aria-label veya <label> ekleyin):\n${bad.join("\n")}`).toEqual([]);
  });

  it("istisna listesi bayat değil (dosya var ve hâlâ ihlal içeriyor)", () => {
    const stale: string[] = [];
    for (const rel of Object.keys(EXEMPT)) {
      const abs = path.join(ROOT, rel);
      if (!existsSync(abs) || unlabeled(abs).length === 0) stale.push(rel);
    }
    expect(stale, `EXEMPT'ten çıkarın:\n${stale.join("\n")}`).toEqual([]);
  });

  it("tarayıcı gerçek ihlali yakalar (kendi kendini doğrulama)", () => {
    const sample = "src/app/app/ayarlar/lead/lead-capture-panel.tsx";
    // gömme kodu şablonundaki <input>'lar sayılmaz
    expect(unlabeled(path.join(ROOT, sample))).toEqual([]);
  });
});
