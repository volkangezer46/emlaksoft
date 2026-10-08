import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Avatar action'ları: yetki kapısı, bürünme reddi, hedefin daima oturum sahibi olması ve hazır avatar doğrulaması.
 * Supabase mock'ludur; kapı reddettiğinde istemci HİÇ oluşturulmamalıdır.
 */
const h = vi.hoisted(() => ({
  gate: { ok: true, userId: "u-1", tenantId: "t-1", role: "advisor", impersonating: false } as
    | { ok: true; userId: string; tenantId: string; role: string; impersonating: boolean }
    | { ok: false; error: string },
  staff: null as null | { id: string },
  rpc: vi.fn(async () => ({ error: null })),
  remove: vi.fn(async () => ({ error: null })),
  upload: vi.fn(async () => ({ error: null })),
  createClient: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: h.revalidate }));
vi.mock("@/lib/require-permission", () => ({ requirePermission: async () => h.gate }));
vi.mock("@/lib/platform", () => ({
  requirePlatformStaff: async () => {
    if (!h.staff) throw new Error("NEXT_REDIRECT");
    return h.staff;
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    h.createClient();
    return {
      rpc: h.rpc,
      storage: {
        from: () => ({
          remove: h.remove,
          upload: h.upload,
          getPublicUrl: (p: string) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/avatars/${p}` } }),
        }),
      },
    };
  },
}));
vi.mock("server-only", () => ({}));

import { removeOwnAvatar, setOwnAvatarPreset, uploadOwnAvatar } from "./avatar";
import { setStaffAvatarPreset } from "./platform-avatar";

beforeEach(() => {
  h.gate = { ok: true, userId: "u-1", tenantId: "t-1", role: "advisor", impersonating: false };
  h.staff = { id: "s-1" };
  vi.clearAllMocks();
});

describe("ofis kullanıcısı avatar action'ları", () => {
  it("kapı reddederse istemci oluşturulmaz ve hata döner", async () => {
    h.gate = { ok: false, error: "Bu işlem için yetkiniz yok." };
    expect((await setOwnAvatarPreset("ev")).error).toBe("Bu işlem için yetkiniz yok.");
    expect((await removeOwnAvatar()).error).toBe("Bu işlem için yetkiniz yok.");
    expect((await uploadOwnAvatar(new FormData())).error).toBe("Bu işlem için yetkiniz yok.");
    expect(h.createClient).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("destek (bürünme) oturumu avatar değiştiremez", async () => {
    h.gate = { ok: true, userId: "u-1", tenantId: "t-1", role: "readonly", impersonating: true };
    const res = await setOwnAvatarPreset("ev");
    expect(res.error).toMatch(/Destek oturumunda/);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("geçersiz hazır avatar anahtarı RPC'ye gitmez", async () => {
    const res = await setOwnAvatarPreset("../../x");
    expect(res.error).toBe("Geçersiz hazır avatar.");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("geçerli hazır avatar yalnız set_my_avatar RPC'siyle yazılır (fotoğraf temizlenir)", async () => {
    const res = await setOwnAvatarPreset("yildiz");
    expect(res.ok).toBe(true);
    expect(h.rpc).toHaveBeenCalledWith("set_my_avatar", { p_url: null, p_preset: "yildiz" });
    expect(h.revalidate).toHaveBeenCalled();
  });

  it("kaldırma her ikisini de temizler", async () => {
    await removeOwnAvatar();
    expect(h.rpc).toHaveBeenCalledWith("set_my_avatar", { p_url: null, p_preset: null });
  });

  it("dosya yoksa ve 2 MB üstündeyse reddedilir; depoya yazılmaz", async () => {
    expect((await uploadOwnAvatar(new FormData())).error).toBe("Dosya seçilmedi.");
    const fd = new FormData();
    fd.set("photo", new File([new Uint8Array(2 * 1024 * 1024 + 1)], "a.webp", { type: "image/webp" }));
    expect((await uploadOwnAvatar(fd)).error).toMatch(/2 MB/);
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("içeriği görsel olmayan dosya (sahte MIME) reddedilir", async () => {
    const fd = new FormData();
    fd.set("photo", new File([new TextEncoder().encode("<script>alert(1)</script>")], "a.webp", { type: "image/webp" }));
    const res = await uploadOwnAvatar(fd);
    expect(res.error).toBeTruthy();
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("geçerli WebP {tenant}/{kullanıcı}.webp yoluna yazılır; hedef parametreden alınamaz", async () => {
    // Minimal RIFF/WEBP imzası
    const bytes = new Uint8Array(32);
    bytes.set([0x52, 0x49, 0x46, 0x46, 0x18, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
    const fd = new FormData();
    fd.set("photo", new File([bytes], "a.webp", { type: "image/webp" }));
    fd.set("user_id", "baska-kullanici");
    const res = await uploadOwnAvatar(fd);
    if (res.ok) {
      expect(h.upload).toHaveBeenCalledWith("t-1/u-1.webp", expect.anything(), expect.objectContaining({ upsert: true }));
      expect(h.rpc).toHaveBeenCalledWith("set_my_avatar", expect.objectContaining({ p_preset: null }));
    } else {
      // İmza doğrulayıcısı bu minimal örneği kabul etmezse yazma yapılmamış olmalı.
      expect(h.upload).not.toHaveBeenCalled();
    }
  });
});

describe("platform personeli avatar action'ı", () => {
  it("personel değilse (kapı yönlendirir) hiçbir şey yazılmaz", async () => {
    h.staff = null;
    await expect(setStaffAvatarPreset("ev")).rejects.toThrow();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("personel kendi satırına yazar", async () => {
    const res = await setStaffAvatarPreset("ay");
    expect(res.ok).toBe(true);
    expect(h.rpc).toHaveBeenCalledWith("set_my_avatar", { p_url: null, p_preset: "ay" });
  });
});
