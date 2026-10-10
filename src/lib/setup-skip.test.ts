import { describe, expect, it } from "vitest";
import { parseSkipped, serializeSkipped, toggleSkipped } from "./setup-skip";

describe("setup-skip", () => {
  it("geçersiz ve tekrar eden kimlikleri eler", () => {
    expect(parseSkipped("team,xx,team,pool")).toEqual(["team", "pool"]);
    expect(parseSkipped(null)).toEqual([]);
    expect(parseSkipped("")).toEqual([]);
  });

  it("serileştirme gidiş-dönüş", () => {
    expect(parseSkipped(serializeSkipped(["office", "portals"]))).toEqual(["office", "portals"]);
  });

  it("atla ve geri al", () => {
    expect(toggleSkipped([], "team", true)).toEqual(["team"]);
    expect(toggleSkipped(["team", "pool"], "team", false)).toEqual(["pool"]);
    expect(toggleSkipped(["team"], "team", true)).toEqual(["team"]);
  });
});
