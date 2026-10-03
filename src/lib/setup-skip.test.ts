import { describe, expect, it } from "vitest";
import { parseSkipped, serializeSkipped, toggleSkipped } from "./setup-skip";

describe("setup-skip", () => {
  it("geçersiz ve tekrar eden kimlikleri eler", () => {
    expect(parseSkipped("team,xx,team,data")).toEqual(["team", "data"]);
    expect(parseSkipped(null)).toEqual([]);
    expect(parseSkipped("")).toEqual([]);
  });

  it("serileştirme gidiş-dönüş", () => {
    expect(parseSkipped(serializeSkipped(["office", "portals"]))).toEqual(["office", "portals"]);
  });

  it("atla ve geri al", () => {
    expect(toggleSkipped([], "team", true)).toEqual(["team"]);
    expect(toggleSkipped(["team", "data"], "team", false)).toEqual(["data"]);
    expect(toggleSkipped(["team"], "team", true)).toEqual(["team"]);
  });
});
