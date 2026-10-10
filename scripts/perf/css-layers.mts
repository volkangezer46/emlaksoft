/**
 * Derlenmis CSS dosyasinin katman bazli bayt dagilimi. Kullanim: npx tsx scripts/perf/css-layers.mts .next/static/chunks/<dosya>.css
 */
import { readFileSync } from "node:fs";
import postcss from "postcss";

const css = readFileSync(process.argv[2]!, "utf8");
const root = postcss.parse(css);
const by = new Map<string, number>();
const add = (k: string, n: number) => by.set(k, (by.get(k) ?? 0) + n);
root.each((n) => {
  const len = n.toString().length;
  if (n.type === "atrule") add(`@${n.name} ${n.name === "layer" || n.name === "supports" || n.name === "media" ? n.params.slice(0, 40) : ""}`.trim(), len);
  else if (n.type === "rule") add("(katmansiz kural)", len);
  else add(n.type, len);
});
for (const [k, v] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(String(v).padStart(8), k);
