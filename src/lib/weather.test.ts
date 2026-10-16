import { describe, expect, it } from "vitest";
import { describeWeather, parseOpenMeteo } from "./weather";

describe("hava durumu (Open-Meteo)", () => {
  it("anlık yanıtı ayrıştırır, sıcaklığı yuvarlar", () => {
    expect(parseOpenMeteo({ current: { temperature_2m: 23.6, weather_code: 2, is_day: 1 } })).toEqual({ tempC: 24, code: 2, isDay: true, kind: "partly", label: "Parçalı bulutlu" });
  });
  it("eksik ya da bozuk yanıtta null (çip çizilmez)", () => {
    expect(parseOpenMeteo(null)).toBeNull();
    expect(parseOpenMeteo({ current: { temperature_2m: "x", weather_code: 1 } })).toBeNull();
    expect(parseOpenMeteo({})).toBeNull();
  });
  it("WMO kodları Türkçe etikete çevrilir", () => {
    expect(describeWeather(0).label).toBe("Açık");
    expect(describeWeather(61).kind).toBe("rain");
    expect(describeWeather(73).kind).toBe("snow");
    expect(describeWeather(95).kind).toBe("storm");
  });
});
