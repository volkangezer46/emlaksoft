import { describe, expect, it } from "vitest";
import { normalizeExternalHref } from "./external-href";

describe("normalizeExternalHref", () => {
  it.each([
    ["https://video.example/tour?id=42", "https://video.example/tour?id=42"],
    [" http://legacy.example/video ", "http://legacy.example/video"],
  ])("normalizes a public HTTP(S) URL", (input, expected) => {
    expect(normalizeExternalHref(input)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    "",
    "#",
    "/relative",
    "javascript:alert(1)",
    "data:text/html,test",
    "https://user:secret@example.com/video",
    "not a url",
  ])("rejects a deceptive or unsafe href: %s", (input) => {
    expect(normalizeExternalHref(input)).toBeNull();
  });
});
