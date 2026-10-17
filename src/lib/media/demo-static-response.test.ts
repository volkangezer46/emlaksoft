import { describe, expect, it } from "vitest";
import { demoStaticResponse } from "./demo-static-response";

describe("demoStaticResponse", () => {
  it("konum göreli yoldur: konteynerin iç adresi (0.0.0.0:3000) tarayıcıya sızmaz", () => {
    const res = demoStaticResponse(new Request("http://0.0.0.0:3000/api/property-media/x/thumb"), "/img/demo/a-01-exterior-ab12cd34-960.webp");
    expect(res.status).toBe(307);
    const loc = res.headers.get("Location") ?? "";
    expect(loc.startsWith("/img/demo/")).toBe(true);
    expect(loc).not.toContain("0.0.0.0");
  });
});
