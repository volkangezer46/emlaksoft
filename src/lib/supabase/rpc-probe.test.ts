import { describe, expect, it } from "vitest";
import {
  RPC_MISSING_TTL_MS,
  isMissingFunctionError,
  nextProbeState,
  recordRpcOutcome,
  resetRpcProbes,
  rpcKnownMissing,
  shouldSkipRpc,
} from "./rpc-probe";

describe("rpc-probe (RPC henüz yok yoklaması)", () => {
  it("yalnız 'fonksiyon yok' hatalarını eksik sayar", () => {
    expect(isMissingFunctionError({ code: "PGRST202", message: "Could not find the function public.x" })).toBe(true);
    expect(isMissingFunctionError({ code: "42883", message: "function public.x(uuid) does not exist" })).toBe(true);
    expect(isMissingFunctionError({ code: null, message: "Could not find the function public.y in the schema cache" })).toBe(true);
    expect(isMissingFunctionError({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingFunctionError({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(false);
    expect(isMissingFunctionError(null)).toBe(false);
  });

  it("eksik fonksiyon TTL boyunca atlanır, süre dolunca yeniden denenir", () => {
    const t0 = 1_000_000;
    const state = nextProbeState({ code: "PGRST202" }, t0);
    expect(shouldSkipRpc(state, t0 + 1)).toBe(true);
    expect(shouldSkipRpc(state, t0 + RPC_MISSING_TTL_MS - 1)).toBe(true);
    expect(shouldSkipRpc(state, t0 + RPC_MISSING_TTL_MS)).toBe(false);
  });

  it("geçici hata ve başarı yoklamayı temizler (kalıcı atlama yok)", () => {
    expect(nextProbeState(null, 5)).toBeNull();
    expect(nextProbeState({ code: "57014" }, 5)).toBeNull();
    expect(shouldSkipRpc(null, 5)).toBe(false);
  });

  it("kayıt defteri ada göre ayrı tutar", () => {
    resetRpcProbes();
    const t0 = 50_000;
    recordRpcOutcome("a", { code: "PGRST202" }, t0);
    recordRpcOutcome("b", null, t0);
    expect(rpcKnownMissing("a", t0 + 10)).toBe(true);
    expect(rpcKnownMissing("b", t0 + 10)).toBe(false);
    expect(rpcKnownMissing("c", t0 + 10)).toBe(false);
    recordRpcOutcome("a", null, t0 + 20);
    expect(rpcKnownMissing("a", t0 + 30)).toBe(false);
    resetRpcProbes();
  });
});
