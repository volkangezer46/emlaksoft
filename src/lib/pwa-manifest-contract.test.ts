import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type ManifestIcon = { src?: string; purpose?: string };
type Manifest = {
  id?: string;
  scope?: string;
  start_url?: string;
  icons?: ManifestIcon[];
  shortcuts?: Array<{ url?: string; icons?: ManifestIcon[] }>;
};

const manifest = JSON.parse(
  readFileSync("public/manifest.webmanifest", "utf8"),
) as Manifest;
const worker = readFileSync("public/sw.js", "utf8");

describe("installable PWA contract", () => {
  it("uses an in-scope app start URL and a real maskable icon", () => {
    expect(manifest.id).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.start_url).toBe("/app");
    expect(manifest.icons?.some((icon) => icon.purpose === "maskable")).toBe(true);
    for (const icon of manifest.icons ?? []) {
      expect(icon.src?.startsWith("/")).toBe(true);
      expect(existsSync(`public${icon.src}`)).toBe(true);
    }
  });

  it("keeps every shortcut in app scope and uses existing icons", () => {
    for (const shortcut of manifest.shortcuts ?? []) {
      expect(shortcut.url?.startsWith("/app/")).toBe(true);
      for (const icon of shortcut.icons ?? []) expect(existsSync(`public${icon.src}`)).toBe(true);
    }
  });

  it("precaches and uses the declared brand icon for push notifications", () => {
    expect(worker).toContain('"/icon.svg"');
    expect(worker).toContain('icon: "/icon.svg"');
    expect(worker).toContain('badge: "/icon.svg"');
  });
});
