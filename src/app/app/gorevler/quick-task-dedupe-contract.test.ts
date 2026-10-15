import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M3 sözleşmesi: hızlı görevin iyimser satırı, sunucu listesi aynı kimlikli görevi çizdiğinde gizlenir (çift satır ve
 * kalıcı vurgu yok). Sayfa çizdiği kimlikleri verir; kart kimliğini DOM'da taşır (tek seferlik vurgu için).
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("hızlı görev tekilleştirme", () => {
  it("sayfa çizdiği görev kimliklerini QuickTask'e verir", () => {
    expect(read("src/app/app/gorevler/page.tsx")).toContain("<QuickTask listedIds={tasks.map((t) => t.id)} />");
  });

  it("iyimser satır listedeki kimlikle süzülür; kart data-task-id taşır", () => {
    const src = read("src/app/app/gorevler/quick-task.tsx");
    expect(src).toMatch(/recent\.filter\(\(r\) => !r\.id \|\| !listed\.has\(r\.id\)\)/);
    expect(src).toContain("shown.map(");
    expect(src).not.toContain("recent.map(");
    expect(read("src/app/app/gorevler/task-card.tsx")).toContain("data-task-id={task.id}");
  });
});
