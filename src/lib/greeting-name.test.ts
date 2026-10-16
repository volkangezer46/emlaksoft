import { describe, expect, it } from "vitest";
import { greetingLine, greetingName, isTitleLikeName, timeGreeting } from "./greeting-name";

describe("saat dilimi selamı (ofis saati)", () => {
  it("sınırlar: 05/12/18/22", () => {
    expect(timeGreeting(4)).toBe("İyi geceler");
    expect(timeGreeting(5)).toBe("Günaydın");
    expect(timeGreeting(11)).toBe("Günaydın");
    expect(timeGreeting(12)).toBe("İyi günler");
    expect(timeGreeting(17)).toBe("İyi günler");
    expect(timeGreeting(18)).toBe("İyi akşamlar");
    expect(timeGreeting(21)).toBe("İyi akşamlar");
    expect(timeGreeting(22)).toBe("İyi geceler");
    expect(timeGreeting(0)).toBe("İyi geceler");
    expect(timeGreeting(24)).toBe("İyi geceler");
  });
});

describe("selamdaki ad", () => {
  it("profil adı soyadı aynen (Hanım/Bey eklenmez)", () => {
    expect(greetingName({ fullName: "  Hacer   Gezertaşar " })).toBe("Hacer Gezertaşar");
    expect(greetingLine(9, greetingName({ fullName: "Hacer Gezertaşar" }))).toBe("Günaydın, Hacer Gezertaşar");
  });
  it("ad yoksa e-posta yerel kısmı, o da yoksa rol unvanı; hiçbiri yoksa yalnız selam", () => {
    expect(greetingName({ fullName: "", email: "hacer.gezertasar@ornek.com" })).toBe("Hacer Gezertasar");
    expect(greetingName({ fullName: null, email: "ismail_92@ornek.com" })).toBe("İsmail");
    expect(greetingName({ email: "123@ornek.com", roleTitle: "Ofis sahibi" })).toBe("Ofis sahibi");
    expect(greetingName({})).toBeNull();
    expect(greetingLine(23, null)).toBe("İyi geceler");
  });
  it("unvan benzeri adlar (demo/sistem hesapları) tanınır ve aynen gösterilir", () => {
    expect(isTitleLikeName("Süper admin")).toBe(true);
    expect(isTitleLikeName("ofis sahibi")).toBe(true);
    expect(isTitleLikeName("Hacer Gezertaşar")).toBe(false);
    expect(greetingLine(19, greetingName({ fullName: "Süper admin" }))).toBe("İyi akşamlar, Süper admin");
  });
});
