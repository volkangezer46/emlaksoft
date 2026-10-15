import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type ManifestIcon = { src?: string; purpose?: string };
type Manifest = {
  id?: string;
  scope?: string;
  start_url?: string;
  icons?: ManifestIcon[];
  shortcuts?: Array<{ url?: string; icons?: ManifestIcon[] }>;
  launch_handler?: { client_mode?: string | string[] };
  share_target?: { action?: string; method?: string; enctype?: string; params?: { files?: { name?: string; accept?: string[] }[] } };
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

  it("keeps every shortcut in app scope and uses existing PNG icons (Android ignores SVG shortcut icons)", () => {
    expect(manifest.shortcuts?.length).toBeGreaterThanOrEqual(3);
    expect(manifest.shortcuts?.length).toBeLessThanOrEqual(4);
    expect(manifest.shortcuts?.map((s) => s.url)).toContain("/app/hizli");
    for (const shortcut of manifest.shortcuts ?? []) {
      expect(shortcut.url === "/app" || shortcut.url?.startsWith("/app/")).toBe(true);
      for (const icon of shortcut.icons ?? []) {
        expect(existsSync(`public${icon.src}`)).toBe(true);
        expect(icon.src?.endsWith(".png")).toBe(true);
      }
    }
  });

  it("focuses the running app instead of opening a second window", () => {
    expect([manifest.launch_handler?.client_mode].flat()[0]).toBe("focus-existing");
  });

  it("declares a POST multipart share target that the service worker handles", () => {
    expect(manifest.share_target?.action).toBe("/app/paylas-al");
    expect(manifest.share_target?.method).toBe("POST");
    expect(manifest.share_target?.enctype).toBe("multipart/form-data");
    expect(manifest.share_target?.params?.files?.[0]?.name).toBe("media");
    expect(worker).toContain('const SHARE_PATH = "/app/paylas-al"');
    expect(worker).toContain('form.getAll("media")');
    expect(existsSync("src/app/app/paylas-al/page.tsx")).toBe(true);
  });

  it("precaches PNG notification icon + monochrome badge (Android rejects SVG badges)", () => {
    expect(worker).toContain('const NOTIFICATION_ICON = "/brand/icon-192.png"');
    expect(worker).toContain('const NOTIFICATION_BADGE = "/brand/badge-96.png"');
    expect(worker).toContain("icon: NOTIFICATION_ICON");
    expect(worker).toContain("badge: NOTIFICATION_BADGE");
    expect(existsSync("public/brand/badge-96.png")).toBe(true);
    expect(worker).not.toContain('badge: "/icon.svg"');
  });
});
