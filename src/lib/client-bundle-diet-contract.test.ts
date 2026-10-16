import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * İlk yük JS diyeti (B9, 2026-10): panel rotalarının ilk yükünden çıkarılan ağır zincirler geri sızmasın.
 *  - realtime çekirdeği (konu hub'ı + realtime-throttle + use-realtime-refresh): kabukta yalnız tembel RealtimeRefresh;
 *    sayfa başlığındaki DataFreshness bağımlılıksız durum deposunu (realtime-status), zil köprüyü (realtime-bridge) okur.
 *  - müşteri listesi: temas sonucu penceresi (Radix Dialog) ilk temasta iner.
 *  - portföy listesi: toplu sorumlu seçici (Combobox + Radix Popover) panel açılınca iner.
 *  - Muhasebe sekmeleri ve portföy detay bölümleri: ağır istemci parçaları `_lazy.tsx` (next/dynamic) üzerinden.
 * Statik zincir izleyici: değer içe aktarmaları; `import type`, dinamik `import()` ve "use server" sınırı sayılmaz.
 */
const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function resolveSpec(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const p = base + ext;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

function valueImports(text: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[1]) continue;
    const inner = m[2].match(/^\{([\s\S]*)\}$/);
    if (inner && inner[1].split(",").map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith("type "))) continue;
    out.push(m[3]);
  }
  return out;
}

/** `entry`den `target` modülüne (dosya yolu, src/ göreli) giden ilk statik değer zinciri. */
function chainTo(entry: string, target: string): string | null {
  const want = join(ROOT, target);
  const seen = new Set<string>();
  const walk = (file: string, chain: string[]): string | null => {
    if (seen.has(file)) return null;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    if (chain.length > 0 && /^\s*["']use server["']/.test(text)) return null;
    const short = file.slice(ROOT.length + 1);
    for (const spec of valueImports(text)) {
      const next = resolveSpec(spec, file);
      if (!next) continue;
      if (next === want) return [...chain, short, target].join(" -> ");
      const hit = walk(next, [...chain, short]);
      if (hit) return hit;
    }
    return null;
  };
  return walk(join(ROOT, entry), []);
}

describe("ilk yük diyeti: realtime çekirdeği kabuğa ve sayfa başlığına sızmaz", () => {
  const CORE = ["src/lib/realtime.ts", "src/hooks/use-realtime-refresh.ts", "src/lib/realtime-throttle.ts"];
  it.each([
    "src/app/app/layout.tsx",
    "src/components/app/notification-bell.tsx",
    "src/components/ui/data-freshness.tsx",
    "src/components/ui/page-header.tsx",
    "src/components/ui/list-page.tsx",
  ])("%s", (entry) => {
    for (const core of CORE) expect(chainTo(entry, core), `${entry} → ${core}`).toBeNull();
  });

  it("RealtimeRefresh layout'ta tembel sarmalayıcıyla bağlanır; durum deposu ve köprü bağımlılıksızdır", () => {
    const layout = read("src/app/app/layout.tsx");
    expect(layout).toContain("<RealtimeRefreshLazy tenantId={m.tenantId} />");
    expect(layout).not.toMatch(/from "@\/components\/app\/realtime-refresh"/);
    expect(read("src/components/app/realtime-refresh-lazy.tsx")).toMatch(/dynamic\(\(\) => import\("\.\/realtime-refresh"\)/);
    for (const f of ["src/lib/realtime-status.ts", "src/lib/realtime-bridge.ts"]) expect(valueImports(read(f)), f).toEqual([]);
    // Tek kaynak: realtime.ts aynı adları yeniden dışa aktarır (eski içe aktarmalar çalışır).
    const rt = read("src/lib/realtime.ts");
    expect(rt).toMatch(/from "@\/lib\/realtime-status"/);
    expect(rt).toMatch(/from "@\/lib\/realtime-bridge"/);
    expect(rt).toContain("publishRealtimeStatus(");
  });
});

describe("ilk yük diyeti: liste ve detay rotaları", () => {
  it("müşteri listesi: temas sonucu penceresi (Dialog) ilk yükte yok", () => {
    expect(chainTo("src/app/app/musteriler/contact-outcome-prompt.tsx", "src/components/ui/dialog.tsx")).toBeNull();
    expect(read("src/app/app/musteriler/contact-outcome-prompt.tsx")).toMatch(/import\("\.\/contact-outcome-dialog"\)/);
  });

  it("portföy listesi: toplu sorumlu seçici (Combobox) ilk yükte yok", () => {
    expect(chainTo("src/app/app/portfoyler/property-bulk-actions.tsx", "src/components/ui/combobox.tsx")).toBeNull();
  });

  it("Muhasebe ve portföy detayı: ağır parçalar _lazy üzerinden", () => {
    const heavy: Array<[string, string]> = [
      ["src/app/app/finans/(merkez)/_tabs/ayarlar.tsx", "src/app/app/finans/(merkez)/ayarlar/rules-list.tsx"],
      ["src/app/app/finans/(merkez)/_tabs/duzenli.tsx", "src/app/app/finans/(merkez)/recurring-panel.tsx"],
      ["src/app/app/finans/(merkez)/_tabs/kasa-banka.tsx", "src/app/app/finans/(merkez)/statement-upload.tsx"],
      ["src/app/app/finans/(merkez)/_tabs/butce.tsx", "src/app/app/finans/(merkez)/budget-form.tsx"],
      ["src/app/app/finans/(merkez)/_tabs/belgeler.tsx", "src/app/app/finans/(merkez)/belgeler/upload-dropzone.tsx"],
      ["src/app/app/portfoyler/[id]/sections.tsx", "src/app/app/portfoyler/[id]/property-media-manager.tsx"],
      ["src/app/app/portfoyler/[id]/sections.tsx", "src/app/app/portfoyler/[id]/property-keys-section.tsx"],
    ];
    for (const [entry, mod] of heavy) expect(chainTo(entry, mod), `${entry} → ${mod}`).toBeNull();
  });
});
