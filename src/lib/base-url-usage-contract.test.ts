import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("public URL source contract", () => {
  it("centralizes application URL fallback logic", () => {
    const allowed = new Set([
      "src/lib/base-url.ts",
      // Production boot validates the configured origin but never generates
      // public links; link construction remains centralized in base-url.ts.
      "src/lib/deployment-env.ts",
      // CORS allowlisting consumes the raw configured origin intentionally; it
      // does not generate a public link and also merges explicit extra origins.
      "src/app/api/leads/[token]/route.ts",
    ]);
    const directReads = sourceFiles("src")
      .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
      .filter((file) => !allowed.has(relative(".", file).replaceAll("\\", "/")))
      .filter((file) => readFileSync(file, "utf8").includes("NEXT_PUBLIC_APP_URL"))
      .map((file) => relative(".", file).replaceAll("\\", "/"));

    expect(directReads).toEqual([]);
  });
});
