import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VIRTUAL_TOUR_FRAME_HOSTS, parseVirtualTourUrl, readVirtualTour, withVirtualTour } from "./virtual-tour";

const ok = (raw: string) => {
  const r = parseVirtualTourUrl(raw);
  return r.ok ? r.value : "HATA";
};

describe("virtual-tour URL doğrulama", () => {
  it("boş girdi silme demektir", () => {
    expect(parseVirtualTourUrl("  ")).toEqual({ ok: true, value: null });
  });
  it("YouTube biçimlerini nocookie gömmeye çevirir", () => {
    expect(ok("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toMatchObject({ provider: "youtube", embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" });
    expect(ok("https://youtu.be/dQw4w9WgXcQ")).toMatchObject({ provider: "youtube" });
  });
  it("Matterport, Vimeo, Kuula kabul", () => {
    expect(ok("https://my.matterport.com/show/?m=SxQL3iGyoDo")).toMatchObject({ provider: "matterport" });
    expect(ok("https://vimeo.com/123456789")).toMatchObject({ embedUrl: "https://player.vimeo.com/video/123456789" });
    expect(ok("https://kuula.co/share/7abcd")).toMatchObject({ provider: "kuula" });
  });
  it("http, başka alan adı, kullanıcı bilgisi, port, javascript reddedilir", () => {
    for (const bad of [
      "http://youtu.be/dQw4w9WgXcQ",
      "https://evil.example.com/watch?v=dQw4w9WgXcQ",
      "https://user:pw@my.matterport.com/show/?m=SxQL3iGyoDo",
      "https://my.matterport.com:8443/show/?m=SxQL3iGyoDo",
      "javascript:alert(1)",
      "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
      "https://my.matterport.com/show/?m=<script>",
      "veri değil",
    ]) {
      expect(parseVirtualTourUrl(bad).ok, bad).toBe(false);
    }
  });
  it("readVirtualTour kayıtlı değeri yeniden doğrular", () => {
    expect(readVirtualTour({ virtual_tour_url: "https://evil.com/x" })).toBeNull();
    expect(readVirtualTour(null)).toBeNull();
    expect(readVirtualTour({ virtual_tour_url: "https://youtu.be/dQw4w9WgXcQ" })?.provider).toBe("youtube");
  });
  it("withVirtualTour diğer anahtarları korur", () => {
    expect(withVirtualTour({ rooms: "3+1" }, "https://x")).toEqual({ rooms: "3+1", virtual_tour_url: "https://x" });
    expect(withVirtualTour({ rooms: "3+1", virtual_tour_url: "a" }, null)).toEqual({ rooms: "3+1" });
  });
  it("CSP frame-src izinli alan adlarından türer; gömme adresleri bu alan adlarında", () => {
    expect(readFileSync("next.config.ts", "utf8")).toContain("VIRTUAL_TOUR_FRAME_HOSTS");
    for (const raw of ["https://youtu.be/dQw4w9WgXcQ", "https://my.matterport.com/show/?m=SxQL3iGyoDo", "https://vimeo.com/123456789", "https://kuula.co/share/7abcd"]) {
      const v = ok(raw);
      if (v === "HATA" || v === null) throw new Error(raw);
      expect(VIRTUAL_TOUR_FRAME_HOSTS).toContain(new URL(v.embedUrl).hostname);
    }
  });
});
