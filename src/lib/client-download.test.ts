import { describe, expect, it, vi } from "vitest";
import { fetchTrustedQrPng, normalizeInternalApiUrl } from "./client-download";

describe("client download boundaries", () => {
  it("accepts only same-origin API paths", () => {
    expect(normalizeInternalApiUrl("/api/customers?q=test")).toBe("/api/customers?q=test");
    expect(() => normalizeInternalApiUrl("https://evil.example/api/customers")).toThrow();
    expect(() => normalizeInternalApiUrl("//evil.example/api/customers")).toThrow();
    expect(() => normalizeInternalApiUrl("/app/customers")).toThrow();
  });

  it("downloads only bounded PNG responses from the fixed QR endpoint", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Blob(["png"], { type: "image/png" }), {
      status: 200,
      headers: { "content-type": "image/png", "content-length": "3" },
    })) as unknown as typeof fetch;

    const blob = await fetchTrustedQrPng(
      "https://api.qrserver.com/v1/create-qr-code/?data=https%3A%2F%2Fexample.com",
      fetchImpl,
    );
    expect(blob.size).toBe(3);
    expect(fetchImpl).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    }));
  });

  it("rejects wrong hosts, wrong media, and oversized bodies", async () => {
    await expect(fetchTrustedQrPng("https://evil.example/v1/create-qr-code/"))
      .rejects.toThrow("Güvenilmeyen");

    const wrongMedia = vi.fn(async () => new Response("not png", {
      status: 200,
      headers: { "content-type": "text/html" },
    })) as unknown as typeof fetch;
    await expect(fetchTrustedQrPng(
      "https://api.qrserver.com/v1/create-qr-code/?data=x",
      wrongMedia,
    )).rejects.toThrow("PNG");

    const oversized = vi.fn(async () => new Response(null, {
      status: 200,
      headers: { "content-type": "image/png", "content-length": String(2 * 1024 * 1024 + 1) },
    })) as unknown as typeof fetch;
    await expect(fetchTrustedQrPng(
      "https://api.qrserver.com/v1/create-qr-code/?data=x",
      oversized,
    )).rejects.toThrow("boyut sınırını");
  });
});
