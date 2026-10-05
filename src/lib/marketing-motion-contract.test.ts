import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ana sayfa HAREKET sözleşmesi (src/app/marketing-motion.css + MotionRoot).
 * Ürün kararları: fare takibi (mouse-follow/parallax/tilt) YOK; sonsuz döngü yalnız .mk-demo kapsamında ve duraklatılabilir;
 * her keyframe `prefers-reduced-motion: no-preference` içinde; TEMEL CSS = SON KARE (hareket yalnız .mk[data-motion="on"] altında);
 * ekran altı öğeleri gizleme yalnız .js-reveal altında (JS yokken içerik görünür).
 */

const read = (p: string) => readFileSync(p, "utf8");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

function files(dir: string, ext: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files(full, ext, out);
    else if (ext.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full.split("\\").join("/"));
  }
  return out;
}

/** `seçici { gövde }` çiftleri (iç içe @media başlığı seçiciye karışmaz). */
function rules(css: string): Array<{ sel: string; body: string }> {
  return [...strip(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim().replace(/\s+/g, " "), body: m[2]!.trim() }));
}

/** Her @keyframes bildiriminin kuşatan blok başlıkları. */
function keyframeParents(css: string): string[][] {
  const text = strip(css);
  const out: string[][] = [];
  const stack: string[] = [];
  let head = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "{") {
      const h = head.trim().replace(/\s+/g, " ");
      if (h.startsWith("@keyframes")) out.push([...stack]);
      stack.push(h);
      head = "";
    } else if (ch === "}") {
      stack.pop();
      head = "";
    } else if (ch === ";") head = "";
    else head += ch;
  }
  return out;
}

const MARKETING_CSS = files("src/app", /^marketing.*\.css$/);
const MOTION = "src/app/marketing-motion.css";

describe("ana sayfa hareket sözleşmesi", () => {
  it("marketing-motion.css var ve page.tsx'ten yüklenir; MotionRoot sayfada", () => {
    expect(MARKETING_CSS).toContain(MOTION);
    const page = read("src/app/page.tsx");
    expect(page).toContain('import "./marketing-motion.css"');
    expect(page).toContain("<MotionRoot />");
  });

  it("sonsuz döngü yalnız .mk-demo kapsamında; .mk-demo hareketi data-paused ile durdurulur", () => {
    for (const f of MARKETING_CSS) {
      for (const r of rules(read(f))) {
        if (/\binfinite\b/.test(r.body)) expect(r.sel, `${f}: ${r.sel}`).toContain(".mk-demo");
      }
    }
    const motion = strip(read(MOTION));
    expect(motion).toContain('.mk-demo[data-paused="true"]');
    expect(motion).toMatch(/\.mk-demo\[data-paused="true"\][^{]*\{[^}]*animation-play-state:\s*paused/);
    const root = read("src/components/marketing/motion-root.tsx");
    expect(root).toContain("IntersectionObserver");
    expect(root).toContain("visibilitychange");
    expect(root).toContain("aria-pressed"); // WCAG 2.2.2: görünür duraklat düğmesi
    expect(root).toContain("Animasyonu duraklat");
  });

  it("fare/imleç takibi yok: marketing/** ve site-menu/** (onMouseMove, pointermove, tilt, parallax)", () => {
    const sources = [...files("src/components/marketing", /\.tsx?$/), ...files("src/components/site-menu", /\.tsx?$/)];
    expect(sources.length).toBeGreaterThan(10);
    for (const f of sources) {
      expect(read(f), f).not.toMatch(/onMouseMove|onPointerMove|mousemove|pointermove|\btilt\b|parallax/i);
    }
    for (const f of MARKETING_CSS) expect(strip(read(f)), f).not.toMatch(/parallax|\btilt\b/i);
  });

  it("her keyframe prefers-reduced-motion: no-preference içinde (hareket + bölüm dosyası)", () => {
    for (const f of [MOTION, "src/app/marketing-sections.css"]) {
      const parents = keyframeParents(read(f));
      expect(parents.length, f).toBeGreaterThan(0);
      for (const chain of parents) expect(chain.join(" > "), f).toContain("prefers-reduced-motion: no-preference");
    }
  });

  it("temel CSS = son kare: animasyon bildirimi yalnız hareket işaretli (data-motion / açık panel) seçicilerde", () => {
    for (const r of rules(read(MOTION))) {
      if (/(^|;)\s*animation(-name)?\s*:/.test(r.body) && !/^(from|to|\d+%)/.test(r.sel)) {
        expect(r.sel, r.sel).toMatch(/data-motion="on"/);
      }
    }
    // KPI SVG metni yalnız hareket açıkken gizlenir; sayaç katmanı temelde kapalı.
    for (const r of rules(read(MOTION))) {
      if (/visibility:\s*hidden/.test(r.body)) expect(r.sel, r.sel).toContain('[data-motion="on"]');
    }
    expect(strip(read(MOTION))).toMatch(/\.mk-dash-ov\s*\{[^}]*display:\s*none/);
  });

  it(".mk-reveal gizleme yalnız .js-reveal altında (JS yoksa içerik görünür)", () => {
    for (const f of MARKETING_CSS) {
      for (const r of rules(read(f))) {
        if (r.sel.includes(".mk-reveal") && /opacity:\s*0\b|visibility:\s*hidden|display:\s*none/.test(r.body)) {
          expect(r.sel, `${f}: ${r.sel}`).toContain(".js-reveal");
        }
      }
    }
    const root = read("src/components/marketing/motion-root.tsx");
    expect(root).toContain("navigator.webdriver");
    expect(root).toContain("prefers-reduced-motion: reduce");
    expect(root).toContain("beforeprint");
  });

  it("cam bütçesi: hareket katmanında backdrop-filter yok; transition: all yok", () => {
    const motion = strip(read(MOTION));
    expect(motion).not.toContain("backdrop-filter");
    expect(motion).not.toMatch(/transition:\s*all/);
  });

  it("süre ve eğri token'dan (motion.css): hareket dosyasında ham ms/cubic-bezier süre yok (gecikmeler hariç)", () => {
    const motion = strip(read(MOTION));
    expect(motion).not.toMatch(/cubic-bezier\(/);
    expect(motion).toContain("var(--motion-draw)");
    expect(motion).toContain("var(--ease-out)");
  });
});
