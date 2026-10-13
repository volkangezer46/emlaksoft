#!/usr/bin/env node
// /_next/static dosyalarının yanına önceden sıkıştırılmış .br (brotli q11) ve .gz (gzip -9) kopyaları üretir.
// deploy/compose.prod.yml'deki `static` (Caddy) servisi bunları `precompressed br gzip` ile doğrudan sunar:
// Traefik'in anlık (düşük kaliteli) sıkıştırmasından ~%15 daha küçük aktarım. Var olan kopyaya dokunulmaz (idempotent).
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, gzipSync, constants } from "node:zlib";

const root = process.argv[2];
if (!root) { console.error("kullanım: precompress-static.mjs <next-static-dizini>"); process.exit(2); }
const EXT = /\.(js|css|svg|json|txt|map|woff)$/; // woff2 zaten sıkıştırılmış
let made = 0, bytesIn = 0, bytesBr = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    if (!EXT.test(name) || st.size < 1024) continue;
    if (existsSync(`${p}.br`) && existsSync(`${p}.gz`)) continue;
    const buf = readFileSync(p);
    const br = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
    const gz = gzipSync(buf, { level: 9 });
    writeFileSync(`${p}.br`, br);
    writeFileSync(`${p}.gz`, gz);
    made++; bytesIn += buf.length; bytesBr += br.length;
  }
};
walk(root);
console.log(`önceden sıkıştırma: ${made} yeni dosya${made ? ` · ${(bytesIn / 1024).toFixed(0)} KB → br ${(bytesBr / 1024).toFixed(0)} KB` : ""}`);
