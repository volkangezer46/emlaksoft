import { describe, expect, it } from "vitest";
import { deriveDemoPassword } from "./demo-credentials";

describe("derived demo credentials", () => {
  const secret = "test-only-secret-with-at-least-thirty-two-characters";

  it("is stable per identity without using a shared public password", () => {
    const first = deriveDemoPassword(secret, "Owner@Demo.Example");
    expect(first).toBe(deriveDemoPassword(secret, "owner@demo.example"));
    expect(first).not.toBe(deriveDemoPassword(secret, "advisor@demo.example"));
    expect(first).toMatch(/^Em!1[A-Za-z0-9_-]{40}$/);
  });

  it("changes when the server secret rotates", () => {
    expect(deriveDemoPassword(secret, "owner@demo.example")).not.toBe(
      deriveDemoPassword(`${secret}-rotated`, "owner@demo.example"),
    );
  });

  it("rejects weak secrets and malformed identities", () => {
    expect(() => deriveDemoPassword("short", "owner@demo.example")).toThrow();
    expect(() => deriveDemoPassword(secret, "not-an-email")).toThrow();
  });
});
