import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const action = readFileSync("src/app/actions/demo.ts", "utf8");
const form = readFileSync("src/app/demo/demo-form.tsx", "utf8");

describe("public demo intake contract", () => {
  it("persists consent evidence and an idempotency hash", () => {
    expect(action).toContain('source: "demo_callback_form"');
    expect(action).toContain('consent_scope: "demo_callback"');
    expect(action).toContain("consent_version: DEMO_CONSENT_VERSION");
    expect(action).toContain("idempotency_key_hash: requestHash");
    expect(action).toContain('requestError?.code === "23505"');
  });

  it("fails visibly when the primary lead write fails", () => {
    expect(action).toContain("if (requestError || !request)");
    expect(action).toContain("Talebiniz kaydedilemedi");
    expect(action).not.toContain("Form yine de başarılı sayılsın");
  });

  it("submits explicit consent and shows the durable reference code", () => {
    expect(form).toContain('name="request_id"');
    expect(form).toContain('name="consent"');
    expect(form).toContain('value="1"');
    expect(form).toContain("state.referenceCode");
    expect(form).toContain("crypto.randomUUID()");
  });
});
