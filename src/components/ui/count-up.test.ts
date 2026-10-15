import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COUNT_UP_CHANGE_MS, countUpKind, createCountUpController, numericOf, type TextNodeLike } from "./count-up";
import { walkSource } from "@/lib/test-support/src-tree";

/**
 * CountUp sözleşmesi (B028/B051). Not: vitest yalnız `*.test.ts` toplar ve ortam `node`dur (vitest.config.ts; jsdom
 * yok), bu yüzden bileşen React'siz denetleyici üstünden sınanır: React'in metin düğümü sahte `{ nodeValue }` ile,
 * React'in güncellemesi `node.nodeValue = yeni` ile, efekt sırası (useLayoutEffect → eski efekt temizliği → yeni efekt)
 * aynı sırayla taklit edilir.
 */

/** Elle ilerletilen rAF. */
function fakeRaf() {
  let id = 0;
  const queue = new Map<number, (t: number) => void>();
  return {
    raf: (cb: (t: number) => void) => {
      id += 1;
      queue.set(id, cb);
      return id;
    },
    cancelRaf: (n: number) => void queue.delete(n),
    /** Bekleyen kareleri `t` anıyla çalıştırır. */
    frame(t: number) {
      const pending = [...queue.entries()];
      queue.clear();
      for (const [, cb] of pending) cb(t);
    },
    pending: () => queue.size,
  };
}

type Scenario = { softNav: boolean; clientMounted?: boolean };

/**
 * Bileşenin efekt akışının birebir taklidi: React metni yazar → layout efekt `latest`'i günceller → eski pasif efektin
 * temizliği → yeni pasif efekt. İlk kurulum: sunucu çizdiyse ya da yumuşak gezinmede sayım yok; istemcide kurulan
 * oran değeri 0'dan sayar. Değişim: para/adet hariç eskiden yeniye kısa geçiş.
 */
function mount(initial: string, { softNav, clientMounted = false }: Scenario) {
  const r = fakeRaf();
  const c = createCountUpController(r);
  const node: TextNodeLike = { nodeValue: initial }; // React'in ilk çizdiği metin
  let cleanup: (() => void) | null = null;
  c.setLatest(initial);
  const first = numericOf(initial, { decimals: 0, prefix: "", suffix: "" });
  if (clientMounted && !softNav && first && countUpKind(initial, undefined, 0) === "other" && Math.abs(first.target) >= 10) {
    c.run(node, 0, first.target, first.fmt, 700);
    cleanup = () => c.cancel();
  }
  let prev: string | null = initial;
  const rerender = (next: string) => {
    node.nodeValue = next; // React kendi metin düğümüne yazar
    c.setLatest(next); // useLayoutEffect
    cleanup?.(); // eski pasif efektin temizliği
    cleanup = null;
    const from = prev ? numericOf(prev, { decimals: 0, prefix: "", suffix: "" }) : null;
    const to = numericOf(next, { decimals: 0, prefix: "", suffix: "" });
    prev = next;
    if (countUpKind(next, undefined, 0) !== "other" || !from || !to || from.target === to.target) return;
    c.run(node, from.target, to.target, to.fmt, COUNT_UP_CHANGE_MS);
    cleanup = () => c.cancel();
  };
  return { node, rerender, raf: r, controller: c };
}

describe("CountUp: DOM metni React prop'uyla aynı kalır (B051)", () => {
  for (const softNav of [false, true]) {
    it(`yeniden çizimde textContent === yeni değer (soft-nav ${softNav ? "açık" : "kapalı"})`, () => {
      const m = mount("128", { softNav }); // 'Açık görev' KPI'ı (adet)
      m.rerender("129");
      expect(m.node.nodeValue).toBe("129");
      m.rerender("130");
      expect(m.node.nodeValue).toBe("130");
      m.raf.frame(10_000);
      expect(m.node.nodeValue).toBe("130");
    });

    it(`istemcide kurulup sayarken güncelleme gelirse DOM = yeni prop (soft-nav ${softNav ? "açık" : "kapalı"})`, () => {
      const m = mount("%60", { softNav, clientMounted: true });
      m.raf.frame(0);
      m.raf.frame(100);
      m.rerender("%75");
      expect(m.node.nodeValue).toBe("%75");
      m.raf.frame(150);
      m.raf.frame(2_000);
      expect(m.node.nodeValue).toBe("%75");
    });

    it(`ardışık 3 güncelleme: her birinde DOM = prop, 0'a düşüş yok (soft-nav ${softNav ? "açık" : "kapalı"})`, () => {
      const m = mount("%198", { softNav });
      const seen: string[] = [];
      for (const v of ["%199", "%200", "%209"]) {
        m.rerender(v);
        for (let t = 0; t <= 400; t += 16) {
          m.raf.frame(1_000 + t);
          seen.push(m.node.nodeValue ?? "");
        }
        expect(m.node.nodeValue).toBe(v);
      }
      expect(seen.some((s) => s === "%0")).toBe(false);
    });
  }

  it("geçiş eskiden yeniye gider (asla 0'dan değil) ve ≤200 ms'de biter", () => {
    const m = mount("%40", { softNav: false });
    m.rerender("%80");
    m.raf.frame(0);
    const values: number[] = [];
    for (let t = 16; t <= COUNT_UP_CHANGE_MS; t += 16) {
      m.raf.frame(t);
      values.push(Number((m.node.nodeValue ?? "").replace("%", "")));
    }
    m.raf.frame(COUNT_UP_CHANGE_MS + 1);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(40);
    expect(m.node.nodeValue).toBe("%80");
    expect(m.raf.pending()).toBe(0);
  });

  it("yarıda kesilen geçişin temizliği EN GÜNCEL metni koyar (eski metni değil)", () => {
    const m = mount("%10", { softNav: false });
    m.rerender("%50");
    m.raf.frame(0);
    m.raf.frame(50);
    expect(m.node.nodeValue).not.toBe("%50"); // ara değer
    m.rerender("%90"); // React yeni değeri yazar; eski efekt temizliği çalışır
    expect(m.node.nodeValue).toBe("%90");
    m.raf.frame(100);
    m.raf.frame(1_000);
    expect(m.node.nodeValue).toBe("%90");
  });

  it("animasyon yokken temizlik hiçbir şey yazmaz (React'in yazdığı metin kalır)", () => {
    const r = fakeRaf();
    const c = createCountUpController(r);
    const node: TextNodeLike = { nodeValue: "eski" };
    c.setLatest("eski");
    node.nodeValue = "yeni";
    c.cancel();
    expect(node.nodeValue).toBe("yeni");
  });
});

describe("CountUp: animasyon sınıfı (B028)", () => {
  it("para ve adet KPI'larında animasyon kapalı", () => {
    expect(countUpKind(1234, "money", 0)).toBe("money");
    expect(countUpKind("372.305 ₺", undefined, 0)).toBe("money");
    expect(countUpKind("₺1.234", undefined, 0)).toBe("money");
    expect(countUpKind(128, undefined, 0)).toBe("count");
    expect(countUpKind("1.234", undefined, 0)).toBe("count");
    expect(countUpKind("%12", undefined, 0)).toBe("other");
    expect(countUpKind(12, "percent", 0)).toBe("other");
    expect(countUpKind(4.5, "number", 1)).toBe("other");
  });

  it("bileşen: sunucu değeri çizildiyse ilk sayım yok; değişimde 0'dan başlamaz; textContent yazmaz", () => {
    const src = readFileSync(resolve(process.cwd(), "src/components/ui/count-up.tsx"), "utf8");
    expect(src).not.toMatch(/\.textContent\s*=[^=]/);
    expect(src).toMatch(/useSyncExternalStore\(noopSubscribe, \(\) => false, \(\) => true\)/);
    expect(src).toMatch(/if \(serverPainted\.current \|\| isSoftNavigated\(\)/);
    expect(src).toMatch(/kind !== "other"/);
    expect(src).toMatch(/useLayoutEffect\(\(\) => \{[\s\S]*?setLatest\(text\)/);
    expect(src).toMatch(/c\.run\(node, from\.target, parsed\.target/);
  });
});

/**
 * YASAK: src/components altında React'in çizdiği (JSX çocuğu olan) öğeye `.textContent =` yazımı. React metin düğümü
 * koparılır; sonraki güncellemeler ekrana yansımaz ya da temizlik eski metni geri koyar (B051). İstisna yalnız
 * `document.createElement` ile bileşenin kendi kurduğu öğe (gerekçeli liste).
 */
const TEXT_CONTENT_ALLOWED: Readonly<Record<string, string>> = {
  "src/components/marketing/motion-root.tsx": "düğme document.createElement ile kurulur; React çocuğu yok",
};

describe("sözleşme: React öğesine .textContent yazılmaz", () => {
  it("src/components'te .textContent = yalnız gerekçeli istisnalarda", () => {
    const root = process.cwd().replace(/\\/g, "/");
    const offenders: string[] = [];
    for (const file of walkSource(resolve(process.cwd(), "src/components"))) {
      const text = readFileSync(file, "utf8");
      if (!/\.textContent\s*=[^=]/.test(text)) continue;
      const rel = file.replace(/\\/g, "/").replace(`${root}/`, "");
      if (!TEXT_CONTENT_ALLOWED[rel]) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("istisnalar gerçekten createElement ile kurulan öğeye yazar", () => {
    for (const rel of Object.keys(TEXT_CONTENT_ALLOWED)) {
      const text = readFileSync(resolve(process.cwd(), rel), "utf8");
      expect(text, rel).toMatch(/document\.createElement\(/);
    }
  });
});
