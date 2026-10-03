import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function actionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? actionFiles(path)
      : entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)
        ? [path]
        : [];
  });
}

describe("Server Action binary body limit", () => {
  const appRoot = join(process.cwd(), "src", "app");
  const binaryActionFiles = actionFiles(appRoot)
    .filter((path) => {
      const contents = readFileSync(path, "utf8");
      return (
        contents.includes('"use server"') &&
        (/(?:formData|fd)\.get\([^)]*\)\s+as\s+File\b/.test(contents) || /instanceof\s+File\b/.test(contents))
      );
    })
    .map((path) => path.slice(process.cwd().length + 1).replaceAll("\\", "/"))
    .sort();

  it("keeps the global limit at 4 MiB and reserves 1 MiB above the largest file", () => {
    const config = source("next.config.ts");
    expect(config).toContain('serverActions: { bodySizeLimit: "4mb" }');

    const limitBytes = 4 * 1024 * 1024;
    const largestFileBytes = 3 * 1024 * 1024;
    expect(limitBytes - largestFileBytes).toBe(1024 * 1024);
  });

  it("allows binary Server Action bodies only in the bounded logo/photo actions", () => {
    expect(binaryActionFiles).toEqual([
      "src/app/actions/agent-profile.ts",
      "src/app/actions/platform-brand.ts",
      "src/app/actions/tenant-logo.ts",
    ]);

    const logo = source("src/app/actions/tenant-logo.ts");
    const profile = source("src/app/actions/agent-profile.ts");
    expect(logo).toContain("const MAX_SIZE = 2 * 1024 * 1024");
    expect(logo).toContain("file.size > MAX_SIZE");
    expect(profile).toContain("const PHOTO_MAX_SIZE = 3 * 1024 * 1024");
    expect(profile).toContain("file.size > PHOTO_MAX_SIZE");
    expect(source("src/app/actions/platform-brand.ts")).toContain("file.size > HARD_FILE_LIMIT");
  });

  it("keeps larger customer/property files on the signed direct-upload path", () => {
    const customer = source("src/app/actions/customer-files.ts");
    const property = source("src/app/actions/property-media.ts");
    expect(customer).not.toContain("export async function uploadCustomerFile");
    expect(property).not.toContain("export async function uploadPropertyMedia");
    expect(customer).toContain("prepareCustomerFileUpload");
    expect(property).toContain("preparePropertyMediaUpload");
  });
});
