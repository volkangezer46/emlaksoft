import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { foldTrSql, phoneDigitsNeedle, searchTermFilter } from "@/lib/pgrst";
import { evaluatePaletteInput, looksLikePhoneInput } from "@/lib/palette-calc";
import { isValidEmail, normalizeEmail } from "@/lib/email";
import { assertCustomerNotDuplicate, findCustomerDuplicates, viewerCanSee } from "@/lib/duplicate-finders";
import { toAssignableAdvisors, isSalesAssigneeRole, SALES_ASSIGNEE_ROLES } from "@/lib/team/assignable-roles";
import { batches, crossChunkSeen, mapLimit } from "@/app/app/ice-aktarma/preview-parallel";
import { duplicateDelay, isCompletePhone } from "@/components/app/use-duplicate-check";

/**
 * SK7 arama çekirdeği ve müşteri kaydı birim testleri (B059, B060, B091, B092, B097, B049, B070, B036).
 */

describe("Türkçe katlama (customers.search_fold ile aynı kural)", () => {
  it("İ/I/ı/ş/ğ/ç/ö/ü düzleşir, büyük/küçük harf ve boşluk önemsiz", () => {
    expect(foldTrSql("Kemal IŞIK")).toBe("kemal isik");
    expect(foldTrSql("kemal ışık")).toBe("kemal isik");
    expect(foldTrSql("KEMAL  IŞIK ")).toBe("kemal isik");
    expect(foldTrSql("Çağlar Öztürk")).toBe("caglar ozturk");
    expect(foldTrSql("İSMAİL")).toBe("ismail");
    expect(foldTrSql("SELİN@ornek.com")).toBe("selin@ornek.com");
  });

  it("aramalar search_fold'da aynı katlanmış metinle eşleşir ('IŞIK', 'kemal isik', 'caglar')", () => {
    const stored = foldTrSql("Kemal Işık kemal@ornek.com");
    for (const q of ["IŞIK", "kemal isik", "Kemal Işık", "kemal ışık"]) {
      expect(stored.includes(foldTrSql(q)), q).toBe(true);
      expect(searchTermFilter(q), q).toBe(`search_fold.ilike."%${foldTrSql(q)}%"`);
    }
    expect(foldTrSql("Çağlar Demir").includes(foldTrSql("caglar"))).toBe(true);
  });

  it("migration fold_tr ile aynı harf tablosu (sözleşme)", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/20260725000056_fold_tr_dotted_i.sql", "utf8");
    expect(sql).toContain("translate(v, 'İIıĞğÜüŞşÖöÇçÂâÎîÛû', 'iiigguussooccaaiiuu')");
    const mig = readFileSync("supabase/migrations/20261016070000_customer_search_fold.sql", "utf8");
    expect(mig).toContain("public.fold_tr(coalesce(full_name, '') || ' ' || coalesce(email, ''))");
    expect(mig).not.toMatch(/notify\s+pgrst/i);
  });
});

describe("telefon iğnesi (phone_digits)", () => {
  const SIX = ["05559990001", "0555 999 00 01", "+90 555 999 00 01", "+905559990001", "90 555 999 0001", "(555) 999-00-01"];
  it("6 telefon biçimi aynı iğneyi verir ve yalnız rakam sütununda aranır", () => {
    for (const s of SIX) {
      expect(phoneDigitsNeedle(s), s).toBe("5559990001");
      expect(searchTermFilter(s), s).toBe('phone_digits.ilike."%5559990001%"');
    }
    expect(searchTermFilter("0532 111 22 33")).toBe('phone_digits.ilike."%5321112233%"');
  });

  it("ad/e-posta telefon sayılmaz; 3+ rakamlı metin rakam sütununda da aranır", () => {
    expect(phoneDigitsNeedle("Ayşe 0532")).toBeNull();
    expect(searchTermFilter("532")).toBe('search_fold.ilike."%532%",phone_digits.ilike."%532%"');
    expect(searchTermFilter("ali@ornek.com")).toBe('search_fold.ilike."%ali@ornek.com%"');
  });

  it("PostgREST/LIKE özel karakterleri temizlenir; boş girdi süzgeç üretmez", () => {
    expect(searchTermFilter('a%b_c*"d')).toBe('search_fold.ilike."%a b c d%"');
    expect(searchTermFilter("   ")).toBeNull();
    expect(searchTermFilter("%%")).toBeNull();
  });
});

describe("palet hesap modu telefonu yutmaz (B060)", () => {
  it("tireli/boşluklu numara hesap değildir; gerçek ifade hesaplanır", () => {
    for (const s of ["0532-111-22-33", "0555-999-00-01", "+90 532 111 22 33", "(532) 111-2233"]) {
      expect(looksLikePhoneInput(s), s).toBe(true);
      expect(evaluatePaletteInput(s), s).toBeNull();
    }
    expect(evaluatePaletteInput("100-20")?.value).toBe(80);
    expect(evaluatePaletteInput("5.400.000 - 200.000")?.value).toBe(5_200_000);
    expect(evaluatePaletteInput("%2 5400000")?.value).toBe(108_000);
  });
});

describe("e-posta: Türkçe İ (B097b)", () => {
  it("'SELİN@ornek.com' geçerli ve 'selin@ornek.com' olur", () => {
    expect(normalizeEmail("SELİN@ornek.com")).toBe("selin@ornek.com");
    expect(isValidEmail("SELİN@ornek.com")).toBe(true);
  });
});

/** Zincirleme sorgu taklidi: tablo verisi + RPC yanıtları. */
function fake(tables: Record<string, unknown[]>, rpc: Record<string, unknown> = {}): SupabaseClient {
  const builder = (rows: unknown[]) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in", "order", "limit", "ilike", "or"]) b[m] = () => b;
    b.maybeSingle = async () => ({ data: rows[0] ?? null });
    b.then = (res: (v: unknown) => unknown) => res({ data: rows, error: null });
    return b;
  };
  return {
    from: (t: string) => builder(tables[t] ?? []),
    rpc: async (fn: string) => ({ data: rpc[fn] ?? [], error: null }),
  } as unknown as SupabaseClient;
}

describe("mükerrer görünürlüğü liste kapsamıyla aynı (B059)", () => {
  const ME = "me";
  const OTHER = "other";
  const customer = { id: "c1", full_name: "Ayşe", phone: "05559990001", email: null, assigned_to: OTHER, created_by: OTHER };

  it("kapsam 'none' (ofis bayrağı kapalı, liste ofis geneli) → çağrı merkezi de kaydı görür", async () => {
    expect(viewerCanSee({ userId: ME, officeWide: false, scope: { kind: "none" } }, OTHER)).toBe(true);
    const hits = await findCustomerDuplicates(fake({ customers: [customer], profiles: [] }), { tenantId: "t", phone: "0555 999 00 01", email: "" }, { userId: ME, officeWide: false, scope: { kind: "none" } });
    expect(hits[0]?.visible).toBe(true);
    expect(hits[0]?.id).toBe("c1");
  });

  it("kapsam dışı tam telefon eşleşmesi: 'Bu numara X danışmanının müşterisi' (ad + danışman, kimlik yok)", async () => {
    const sb = fake(
      { customers: [customer], profiles: [] },
      { lookup_customer_by_phone: [{ full_name: "Ayşe", phone_masked: "0555 *** ** 01", advisor_name: "Danışman Deniz" }] },
    );
    const hits = await findCustomerDuplicates(sb, { tenantId: "t", phone: "05559990001", email: "" }, { userId: ME, officeWide: false, scope: { kind: "self", userId: ME } });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ id: null, visible: false, label: "Ayşe", advisor: "Danışman Deniz", reasons: ["telefon"] });
  });

  it("üyeler kapsamı: takım üyesinin kaydı görünür, takım dışı maskelenir", () => {
    const scope = { kind: "members" as const, ids: ["a", "b"] };
    expect(viewerCanSee({ userId: ME, officeWide: false, scope }, "a")).toBe(true);
    expect(viewerCanSee({ userId: ME, officeWide: false, scope }, "z")).toBe(false);
  });
});

describe("tek sunucu mükerrer kapısı (B092)", () => {
  it("aynı telefon ofiste varsa onaysız yeni kayıt reddedilir; onayla geçer; telefonsuz kayıt serbest", async () => {
    const sb = fake({ customers: [{ id: "c1" }] });
    expect(await assertCustomerNotDuplicate(sb, { tenantId: "t" }, { phone: "05559990001", email: "" }, false)).toEqual({ duplicate: true, count: 1 });
    expect(await assertCustomerNotDuplicate(sb, { tenantId: "t" }, { phone: "05559990001", email: "" }, true)).toEqual({ duplicate: false });
    expect(await assertCustomerNotDuplicate(sb, { tenantId: "t" }, { phone: "", email: "" }, false)).toEqual({ duplicate: false });
  });

  it("kapsam dışı (RLS'in göstermediği) kayıt da RPC ile yakalanır", async () => {
    const sb = fake({ customers: [] }, { lookup_customer_by_phone: [{ full_name: "X", phone_masked: "0555 *** ** 01", advisor_name: null }] });
    expect(await assertCustomerNotDuplicate(sb, { tenantId: "t" }, { phone: "05559990001", email: "" }, false)).toEqual({ duplicate: true, count: 1 });
  });

  it("kapı sorgusu hata verirse kayıt engellenmez (fail-open)", async () => {
    const broken = { from: () => { throw new Error("boom"); }, rpc: async () => ({ data: null, error: { message: "x" } }) } as unknown as SupabaseClient;
    expect(await assertCustomerNotDuplicate(broken, { tenantId: "t" }, { phone: "05559990001", email: "" }, false)).toEqual({ duplicate: false });
  });
});

describe("atanabilir danışmanlar (B070)", () => {
  it("salt okunur, muhasebe ve çağrı merkezi listede yok; takım lideri takımını önerilen görür", () => {
    expect([...SALES_ASSIGNEE_ROLES].sort()).toEqual(["advisor", "branch_manager", "gm", "owner", "team_lead"]);
    for (const r of ["readonly", "accounting", "call_center"]) expect(isSalesAssigneeRole(r), r).toBe(false);
    const rows = [
      { id: "tl", full_name: "Lider", role: "team_lead", team_id: "T1" },
      { id: "a1", full_name: "Takım Danışmanı", role: "advisor", team_id: "T1" },
      { id: "a2", full_name: "Diğer Danışman", role: "advisor", team_id: "T2" },
      { id: "cc", full_name: "Çağrı", role: "call_center", team_id: "T1" },
      { id: "ro", full_name: "Salt", role: "readonly", team_id: null },
      { id: "ac", full_name: "Muhasebe", role: "accounting", team_id: null },
    ];
    const list = toAssignableAdvisors(rows, { userId: "tl", role: "team_lead" });
    expect(list.map((a) => a.id)).toEqual(["tl", "a1", "a2"]);
    expect(list.filter((a) => a.featured).map((a) => a.id)).toEqual(["tl", "a1"]);
    expect(toAssignableAdvisors(rows, { userId: "x", role: "owner" }).some((a) => a.featured)).toBe(false);
  });
});

describe("içe aktarma önizlemesi eşzamanlı (B049)", () => {
  it("önceki parçalarla ortak anahtarlar yalnız gereken parçaya taşınır (sıralı akışla aynı)", () => {
    expect(crossChunkSeen([["p:1", "e:a"], ["p:2"], ["p:1", "p:3"], ["e:a", "p:2", "p:9"]])).toEqual([[], [], ["p:1"], ["e:a", "p:2"]]);
  });

  it("parçalar 10'luk demetlere bölünür (sunucu eylemleri istemcide sıralı: paralellik demet içinde)", () => {
    expect(batches([...Array(23).keys()], 10).map((b) => b.length)).toEqual([10, 10, 3]);
    expect(batches([], 10)).toEqual([]);
  });

  it("mapLimit sırayı korur ve eşzamanlılığı sınırlar", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90]);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });
});

describe("mükerrer denetim gecikmesi (B036)", () => {
  it("numara tamamlanınca 0 ms, aksi halde 150 ms; portföy 500 ms", () => {
    for (const s of ["0532 111 22 33", "+90 532 111 2233", "5321112233"]) expect(isCompletePhone(s), s).toBe(true);
    expect(isCompletePhone("0532 111")).toBe(false);
    expect(duplicateDelay("customer", "0532 111 22 33")).toBe(0);
    expect(duplicateDelay("customer", "0532 11")).toBe(150);
    expect(duplicateDelay("property", "x")).toBe(500);
  });
});
