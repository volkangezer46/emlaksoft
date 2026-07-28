/* Geçici ölçüm aracı — rota başına istemci JS ağırlığı (.next/server/.../page_client-reference-manifest.js) */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const appDir = path.join(root, ".next", "server", "app");
const staticDir = path.join(root, ".next");

const sizeCache = new Map<string, number>();
function fileSize(rel: string) {
  if (sizeCache.has(rel)) return sizeCache.get(rel)!;
  let s = 0;
  try {
    s = fs.statSync(path.join(staticDir, rel.replace(/^\/_next\//, ""))).size;
  } catch {
    s = 0;
  }
  sizeCache.set(rel, s);
  return s;
}

function walk(dir: string, out: string[] = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === "page_client-reference-manifest.js") out.push(p);
  }
  return out;
}

const rows: { route: string; chunks: number; bytes: number }[] = [];
for (const file of walk(appDir)) {
  const src = fs.readFileSync(file, "utf8");
  const i = src.indexOf("] = ");
  const routeMatch = src.match(/__RSC_MANIFEST\["([^"]+)"\]/);
  if (!routeMatch || i < 0) continue;
  const json = src.slice(i + 4).replace(/;?\s*$/, "");
  let manifest: { clientModules?: Record<string, { chunks?: string[] }> };
  try {
    manifest = JSON.parse(json);
  } catch {
    continue;
  }
  const chunks = new Set<string>();
  for (const mod of Object.values(manifest.clientModules ?? {})) {
    for (const c of mod.chunks ?? []) if (c.endsWith(".js")) chunks.add(c);
  }
  let bytes = 0;
  for (const c of chunks) bytes += fileSize(c);
  rows.push({ route: routeMatch[1].replace(/\/page$/, "") || "/", chunks: chunks.size, bytes });
}

rows.sort((a, b) => b.bytes - a.bytes);
const asKb = (b: number) => (b / 1024).toFixed(1);
const limit = Number(process.argv[2] ?? 20);
console.log("route\tchunks\tclientJS_kB");
for (const r of rows.slice(0, limit)) console.log(`${r.route}\t${r.chunks}\t${asKb(r.bytes)}`);
console.log(`\nTOPLAM_ROTA=${rows.length}`);
fs.writeFileSync(process.argv[3] ?? "routesizes.json", JSON.stringify(rows, null, 1));
