import { describe, expect, it } from "vitest";
import { tvGreeting } from "./tv-greeting";

/** Türkiye saati (UTC+3) ile verilen saat:dakikanın epoch ms değeri. */
const trAt = (h: number, m = 0) => Date.UTC(2026, 9, 17, h - 3, m);

describe("tvGreeting (Pano TV selamı, saat dilimine göre)", () => {
  it("gece 01:58'de 'İyi geceler' der (eski hata: 'Günaydın')", () => {
    expect(tvGreeting(trAt(1, 58))).toBe("İyi geceler");
  });
  it.each([
    [4, 59, "İyi geceler"],
    [5, 0, "Günaydın"],
    [11, 59, "Günaydın"],
    [12, 0, "İyi günler"],
    [17, 59, "İyi günler"],
    [18, 0, "İyi akşamlar"],
    [21, 59, "İyi akşamlar"],
    [22, 0, "İyi geceler"],
    [23, 30, "İyi geceler"],
  ])("%i:%i → %s", (h, m, want) => {
    expect(tvGreeting(trAt(h, m))).toBe(want);
  });
});
