import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ROLE_LABELS, roleLabel } from "./role-labels";

/**
 * Rol etiketi TEK kaynak: `src/lib/role-labels.ts`. Rol adı sabitini ("Takım lideri" gibi) başka dosyada
 * yeniden yazma; `ROLE_LABELS`/`roleLabel()` kullan.
 */

const EXEMPT: Record<string, string> = {
  "src/lib/role-labels.ts": "tek kaynak",
  "src/lib/demo-personas.ts": "demo giriş kartı başlığı (persona adı, rol etiketi değil)",
  "src/app/app/ayarlar/roller/page.tsx": "roller ekranı MODULES/ROLES listesi (Modüller paketi sahibi; birleşimden sonra ROLE_LABELS'a bağlanacak)",
  "src/lib/role-labels-contract.test.ts": "bu test",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("rol etiketi tek kaynak", () => {
  it("roleLabel bilinen rolleri Türkçe etiketler", () => {
    expect(roleLabel("team_lead")).toBe("Takım lideri");
    expect(roleLabel("branch_manager")).toBe("Şube müdürü");
    expect(roleLabel(null)).toBe("");
    expect(roleLabel("bilinmeyen_rol")).toBe("bilinmeyen rol");
  });

  it("başka dosyada rol etiketi metni (Takım lideri / Şube müdürü / Çağrı merkezi) tanımlanmaz", () => {
    const labels = [ROLE_LABELS.team_lead, ROLE_LABELS.branch_manager, ROLE_LABELS.call_center];
    const hits: string[] = [];
    const res = labels.map((l) => new RegExp(String.raw`(?:[:=]\s*|label:\s*)"${l}"`));
    for (const f of walk(join(process.cwd(), "src"))) {
      const rel = relative(process.cwd(), f).replace(/\\/g, "/");
      if (EXEMPT[rel]) continue;
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
          // yalnız tanım biçimleri: anahtar: "Etiket" ya da label: "Etiket"
          for (const re of res) {
            if (re.test(line)) hits.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
          }
        });
    }
    expect(hits, `Rol etiketi kopyası bulundu (ROLE_LABELS kullan):\n${hits.join("\n")}`).toEqual([]);
  }, 60_000);
});
