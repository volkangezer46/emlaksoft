import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Durum kümesi literal'leri için RATCHET.
 *
 * "Açık talep" (new/active/matched), "açık anlaşma" (new/qualified/negotiation) ve
 * "kapanmış anlaşma" ((won,lost)) kümeleri `src/lib/workflow-state.ts` içinde TEK kaynaktır
 * (OPEN_DEMAND_STATUSES, OPEN_DEAL_STAGES, CLOSED_DEAL_STAGES + postgrestInList).
 * Kopyalar bir yerde güncellenip diğerinde unutulunca (ör. silme etkisi yalnız "active" talebi
 * sayıyordu) sessiz tutarsızlık doğar. Bu test elle yazılmış literal sayısının YUKARI
 * ÇIKMASINI engeller; dosya başına tavan vardır. Bir kopyayı sabite bağlayınca tavanı
 * aşağı çekin (artırmak yasak).
 *
 * Bilinçli olarak FARKLI olan kümeler (ör. otomasyonun [new,active] bayat-talep kuralı,
 * yinelenen-talep denetiminin yalnız "active"i) bu desenlere uymaz; yanlarında gerekçe yorumu vardır.
 */
const ROOT = join(process.cwd(), "src");

const PATTERNS = {
  talepDizisi: /\[\s*["']new["'],\s*["']active["'],\s*["']matched["']\s*\]/g,
  anlasmaAcikDizisi: /\[\s*["']new["'],\s*["']qualified["'],\s*["']negotiation["']\s*\]/g,
  anlasmaKapali: /\(won,lost\)/g,
} as const;
type Kind = keyof typeof PATTERNS;

/** Gerekçeli muaf dosya: sabitlerin tanımlandığı kaynak. */
const EXEMPT = new Set(["src/lib/workflow-state.ts"]);

/**
 * Bugünkü kalan kopyalar (dosya başına tavan). Aşağıdakiler bu paketin dosya kapsamı dışındaydı
 * (detay sayfaları, customer-state, properties, anlaşma/sayfa görünümleri); sonraki turlarda
 * sabite bağlanıp buradan düşülür. Toplam: talepDizisi 12, anlasmaKapali 14, anlasmaAcikDizisi 0.
 */
const BASELINE: Record<Kind, Record<string, number>> = {
  talepDizisi: {
    "src/app/actions/customer-portal.ts": 1,
    "src/app/app/gelen-kutusu/calls-view.tsx": 1,
    "src/app/app/musteriler/[id]/page.tsx": 1,
    "src/app/app/talepler/demands-view.tsx": 1,
    "src/app/app/yabanci-satis/page.tsx": 1,
    "src/app/musteri-portali/[token]/page.tsx": 1,
    "src/lib/customer-state/load.ts": 1,
    "src/lib/customer-state/seller.ts": 1,
    "src/lib/insights/lifecycle-facts.ts": 1,
    "src/lib/insights/revenue-facts.ts": 1,
    "src/lib/office-score.ts": 2,
  },
  anlasmaAcikDizisi: {},
  anlasmaKapali: {
    "src/app/actions/ai-tenant-advisor.ts": 1,
    "src/app/actions/properties.ts": 1,
    "src/app/app/anlasmalar/page.tsx": 1,
    "src/app/app/asistan/insights.ts": 1,
    "src/app/app/ekip/[id]/tab-panels.tsx": 1,
    "src/app/app/gorevler/page.tsx": 1,
    "src/app/app/gorevler/yeni/page.tsx": 1,
    "src/app/app/finans/(merkez)/komisyon/pipeline-forecast.tsx": 1,
    "src/app/app/performansim/komisyonum.tsx": 1,
    "src/app/app/_home/data.ts": 1,
    "src/app/app/_home/ofis-nabzi.tsx": 1,
    "src/lib/tv/tv-data.ts": 1,
  },
};

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

function scan(): Record<Kind, Record<string, number>> {
  const found: Record<Kind, Record<string, number>> = { talepDizisi: {}, anlasmaAcikDizisi: {}, anlasmaKapali: {} };
  for (const file of files(ROOT)) {
    const rel = file.slice(process.cwd().length + 1).split("\\").join("/");
    if (EXEMPT.has(rel)) continue;
    const text = readFileSync(file, "utf8");
    for (const kind of Object.keys(PATTERNS) as Kind[]) {
      const n = (text.match(PATTERNS[kind]) ?? []).length;
      if (n > 0) found[kind][rel] = n;
    }
  }
  return found;
}

describe("durum kümesi literal ratchet'i", () => {
  const found = scan();

  for (const kind of Object.keys(PATTERNS) as Kind[]) {
    it(`${kind}: dosya başına literal sayısı tavanı aşmaz`, () => {
      const over = Object.entries(found[kind])
        .filter(([file, n]) => n > (BASELINE[kind][file] ?? 0))
        .map(([file, n]) => `${file}: ${n} > ${BASELINE[kind][file] ?? 0}`);
      expect(
        over,
        `Elle yazılmış durum kümesi artıyor. src/lib/workflow-state.ts sabitlerini (OPEN_DEMAND_STATUSES, OPEN_DEAL_STAGES, CLOSED_DEAL_STAGES, postgrestInList) kullanın:\n${over.join("\n")}`,
      ).toEqual([]);
    });

    it(`${kind}: tavan bayatlamaz (sabite bağlanan kopya tavandan düşülür)`, () => {
      const stale = Object.entries(BASELINE[kind])
        .filter(([file, n]) => (found[kind][file] ?? 0) < n)
        .map(([file, n]) => `${file}: tavan ${n}, gerçek ${found[kind][file] ?? 0}`);
      expect(stale, `Tavanı aşağı çekin:\n${stale.join("\n")}`).toEqual([]);
    });
  }
});
