import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const revalidatePath = vi.fn();
const updateTag = vi.fn();
const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => revalidatePath(p),
  updateTag: (t: string) => updateTag(t),
  revalidateTag: (t: string, p: string) => revalidateTag(t, p),
  unstable_cache: vi.fn(),
}));

import { revalidateTenantData } from "./revalidate";

beforeEach(() => {
  revalidatePath.mockReset();
  updateTag.mockReset();
  revalidateTag.mockReset();
});

describe("revalidateTenantData", () => {
  it("path'leri tazeler ve tenant rapor tag'ini updateTag ile düşürür", () => {
    revalidateTenantData("t1", ["/app", "/app/komisyon"]);
    expect(revalidatePath).toHaveBeenCalledTimes(2);
    expect(updateTag).toHaveBeenCalledWith("reports:t1");
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("tenantId yoksa yalnız path'ler tazelenir", () => {
    revalidateTenantData(null, ["/app"]);
    expect(revalidatePath).toHaveBeenCalledWith("/app");
    expect(updateTag).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("updateTag Server Action dışında fırlatırsa revalidateTag(max)'e düşer", () => {
    updateTag.mockImplementation(() => {
      throw new Error("updateTag can only be called from within a Server Action");
    });
    revalidateTenantData("t1");
    expect(revalidateTag).toHaveBeenCalledWith("reports:t1", "max");
  });
});
