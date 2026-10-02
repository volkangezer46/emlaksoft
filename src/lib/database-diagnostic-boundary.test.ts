import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("database diagnostic script boundary", () => {
  it("does not accept arbitrary SQL and forces diagnostics read-only", () => {
    const indexes = readFileSync("scripts/_tmp-idx.ts", "utf8");
    const explain = readFileSync("scripts/_tmp-explain.ts", "utf8");

    expect(indexes).not.toContain("process.argv");
    expect(indexes).toContain('client.query("begin read only")');
    expect(indexes).toContain('client.query("rollback")');
    expect(explain).toContain('c.query("begin read only")');
    expect(explain).toContain('c.query("rollback")');
    expect(explain).toContain('c.query("set local enable_seqscan=off")');
  });
});
