import { describe, expect, it } from "vitest";
import { KnowledgeBase } from "./knowledge/base";
import { buildBm25, cosine, hybridScores, searchBm25 } from "./knowledge/bm25";
import { faqChunks, glossaryChunks, guideChunks, knowledgeVersion, planChunks, qaChunks, siteChunks, staticAppChunks, termChunks } from "./knowledge/chunks";
import { chunksToEmbed, chunkText, contentHash } from "./knowledge/index-job";
import { answerLocalPublic } from "./surfaces/public";
import { answerLocalVitrin, vitrinFiltersFrom } from "./surfaces/vitrin";
import { answerLocalAdmin, pickAdminMetric } from "./surfaces/admin";
import type { AdvisorContext } from "@/lib/ai-advisor";

const NOW = Date.parse("2026-10-17T09:00:00+03:00");
const GEO = { provinces: [{ id: "p34", name: "İstanbul" }], districts: [{ id: "d-kadikoy", name: "Kadıköy", parentId: "p34" }] };

describe("bilgi katmanı", () => {
  it("rota grafiği koddan üretilir: menü, eylemler, niyetler, SSS, rehber, sözlük, terimler", () => {
    const chunks = staticAppChunks();
    const sources = new Set(chunks.map((c) => c.source));
    for (const s of ["nav", "action", "intent", "faq", "guide", "glossary", "term"]) expect(sources.has(s as never), s).toBe(true);
    expect(chunks.find((c) => c.href === "/app/portfoyler")?.modules).toEqual(["properties"]);
    expect(chunks.find((c) => c.id === "action:/app/randevular/yeni")?.body).toMatch(/tarih, saat/);
    expect(new Set(chunks.map((c) => c.id)).size).toBe(chunks.length);
  });
  it("sürüm içerikten türer: içerik değişince değişir", () => {
    const a = staticAppChunks();
    const v1 = knowledgeVersion(a);
    expect(knowledgeVersion(a)).toBe(v1);
    expect(knowledgeVersion([...a, ...qaChunks([{ id: "1", surface: "all", question: "Soru?", answer: "Yanıt.", href: null }])])).not.toBe(v1);
  });
  it("BM25 Türkçe ekleri köke indirger; melez sıralama gömme yokken sözcüksel kalır", () => {
    const idx = buildBm25([
      { id: "a", text: "Müşterilerinizi Excel ile içe aktarın" },
      { id: "b", text: "Randevu hatırlatma SMS ayarı" },
    ]);
    expect(searchBm25(idx, "müşteri aktarma")[0]?.id).toBe("a");
    expect(searchBm25(idx, "randevularım")[0]?.id).toBe("b");
    const lex = [{ id: "a", score: 3 }, { id: "b", score: 1 }];
    expect(hybridScores(lex, null)).toEqual(lex);
    expect(hybridScores(lex, [{ id: "b", score: 0.99 }])[0]?.id).toBe("b");
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });
  it("yetki süzgeci aramadan ÖNCE: modülü görmeyen kullanıcı o sayfanın parçasını alamaz", () => {
    const kb = new KnowledgeBase(staticAppChunks());
    const hits = kb.search("portföyler", { surface: "app", canView: (m) => m !== "properties" }, { limit: 10, sources: ["nav"] });
    expect(hits.some((h) => h.chunk.href === "/app/portfoyler")).toBe(false);
  });
  it("gömme dizini yalnız yeni / içeriği değişen / modeli değişen parçaları yeniden gömer", () => {
    const chunks = staticAppChunks().slice(0, 3);
    const state = new Map(chunks.map((c) => [c.id, { hash: contentHash(chunkText(c)), model: "m1" }]));
    expect(chunksToEmbed(chunks, state, "m1")).toHaveLength(0);
    expect(chunksToEmbed(chunks, state, "m2")).toHaveLength(3);
    state.set(chunks[0]!.id, { hash: "eski", model: "m1" });
    expect(chunksToEmbed(chunks, state, "m1").map((c) => c.id)).toEqual([chunks[0]!.id]);
  });
});

describe("public yüzey (yalnız herkese açık içerik)", () => {
  const kb = new KnowledgeBase([
    ...planChunks(
      [
        { id: "office", name: "Ofis", monthlyTry: 2790, blurb: "Küçük ve orta ofis", features: ["5 kullanıcı dahil"] },
        { id: "advisor", name: "Danışman", monthlyTry: 749, blurb: "Bağımsız danışman", features: ["1 kullanıcı"] },
      ],
      14,
    ),
    ...siteChunks([{ path: "/kvkk-aydinlatma", label: "KVKK aydınlatma metni", description: "Kişisel verilerin işlenmesi ve haklarınız" }], [{ q: "Verilerim nerede saklanıyor?", a: "Türkiye'deki sunucularda, şifreli yedekle." }]),
    ...faqChunks(),
    ...guideChunks(),
    ...glossaryChunks(),
    ...termChunks(),
  ]);
  it("fiyat sorusu: paketler tam TL, KDV hariç, deneme ve kayıt çağrısı", () => {
    const r = answerLocalPublic("fiyatlar ne kadar", { kb });
    expect(r.cards.map((c) => (c.kind === "metric" ? c.value : ""))).toContain("₺2.790/ay");
    expect(r.answer).toMatch(/14 gün ücretsiz/);
    expect(r.actions.some((a) => a.href === "/kayit")).toBe(true);
  });
  it("KVKK sorusu site içeriğinden; iç panel (/app) bağlantısı ziyaretçiye gösterilmez", () => {
    const r = answerLocalPublic("verilerim nerede saklanıyor kvkk", { kb });
    expect(r.answered).toBe(true);
    expect(JSON.stringify(r.actions)).not.toContain('"/app');
  });
  it("public yüzeyde kiracıya ait araç yok (yalnız ürün araçları)", async () => {
    const { ZEKA_PUBLIC_TOOL_DEFS } = await import("./surfaces/public");
    expect(ZEKA_PUBLIC_TOOL_DEFS.map((t) => t.function.name).sort()).toEqual(["pricing", "product_lookup"]);
  });
});

describe("vitrin yüzeyi (yalnız o ofisin yayındaki ilanları)", () => {
  const env = { slug: "demo-ofis", office: "Demo Emlak", geo: GEO, nowMs: NOW, count: async () => 4 };
  it("doğal dil → vitrin süzgeci (tam TL)", () => {
    const { filters } = vitrinFiltersFrom("Kadıköy'de 3+1, 10 milyon altı, deniz manzaralı", env);
    expect(filters).toMatchObject({ ilce: "d-kadikoy", il: "p34", oda: "3+1", max: 10_000_000 });
    expect(filters.q).toMatch(/deniz/i);
  });
  it("yanıt sayı + listeleme bağlantısı + talep formuna (ziyaretçi onaylı) yönlendirme", async () => {
    const r = await answerLocalVitrin("Kadıköy 3+1 satılık", env);
    expect(r.answer).toContain("4 ilan");
    expect(r.actions[0]?.href).toMatch(/^\/vitrin\/demo-ofis\?/);
    const contact = r.actions.find((a) => a.kind === "contact");
    expect(contact?.href).toMatch(/#talep-formu$/);
    expect(contact?.confirm).toMatch(/siz yazıp gönderdiğinizde/);
  });
  it("yer gösterme isteği formu açar, Zeka talep göndermez", async () => {
    const r = await answerLocalVitrin("yer göstermesi için danışman arasın", env);
    expect(r.intent).toBe("create");
    expect(r.answer).toMatch(/göndermem/);
    expect(r.actions[0]?.href).toBe("/vitrin/demo-ofis#talep-formu");
  });
});

describe("yönetim yüzeyi (salt okunur)", () => {
  const ctx: AdvisorContext = { tenantsTotal: 120, tenantsActive: 90, tenantsTrial: 20, tenantsPastDue: 3, mrr: 251_100, arpa: 2790, newTenants30: 12, trialsEndingSoon: 5, trialsExpired: 2, openTickets: 7, urgentTickets: 1, members: 640 };
  const kb = new KnowledgeBase([]);
  const links = [{ href: "/admin/tickets", label: "Talepler", description: "Destek talepleri" }];
  it("metrik seçimi", () => {
    expect(pickAdminMetric("MRR ne kadar")?.id).toBe("mrr");
    expect(pickAdminMetric("denemesi biten ofisler")?.id).toBe("trial_ending");
    expect(pickAdminMetric("kaç aktif ofis var")?.id).toBe("active");
  });
  it("MRR tam TL; advisor modülü olmayan personel sayı alamaz", async () => {
    const ok = await answerLocalAdmin("MRR ne kadar", { kb, links, context: async () => ctx });
    expect(ok.answer).toBe("Aylık tekrarlayan gelir (MRR): ₺251.100.");
    const denied = await answerLocalAdmin("MRR ne kadar", { kb, links, context: null });
    expect(denied.answer).toMatch(/yetkiniz yok/);
    expect(JSON.stringify(denied)).not.toContain("251");
  });
  it("sayfa önerisi personelin görebildiği menüden", async () => {
    const r = await answerLocalAdmin("talepler", { kb, links, context: null });
    expect(r.actions[0]?.href).toBe("/admin/tickets");
  });
});
