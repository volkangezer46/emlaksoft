import { validateJsonLd, type LdNode } from "./jsonld";

/**
 * YAPILANDIRILMIŞ VERİ DERİN DOĞRULAYICISI (SAF). `validateJsonLd` zorunlu alanları ve yasak puan/yorum verisini
 * denetler (hata); burası ayrıca Google zengin sonuç belgelerindeki ÖNERİLEN alanları uyarı olarak verir ve sayfa
 * türüne göre beklenen türün basılıp basılmadığını söyler. Rich Results Test'in yerini tutmaz.
 */

export type StructuredDataReport = { errors: string[]; warnings: string[]; types: string[] };

const isNonEmpty = (v: unknown) => (typeof v === "string" ? v.trim().length > 0 : Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null);

function typesOf(node: LdNode): string[] {
  const t = node["@type"];
  return Array.isArray(t) ? t.map(String) : t ? [String(t)] : [];
}

/** Kökten (ve @graph'tan) tüm düğümler; iç içe nesneler de taranır (Offer, PostalAddress...). */
function allNodes(root: unknown, out: LdNode[] = [], depth = 0): LdNode[] {
  if (depth > 8 || !root || typeof root !== "object") return out;
  if (Array.isArray(root)) {
    for (const r of root) allNodes(r, out, depth + 1);
    return out;
  }
  const node = root as LdNode;
  if (node["@type"]) out.push(node);
  for (const [k, v] of Object.entries(node)) if (k !== "@context" && v && typeof v === "object") allNodes(v, out, depth + 1);
  return out;
}

const asList = (v: unknown): LdNode[] => (Array.isArray(v) ? (v as LdNode[]) : v && typeof v === "object" ? [v as LdNode] : []);

function checkOffer(o: LdNode, label: string, errors: string[], warnings: string[]) {
  if (!isNonEmpty(o.price) && !isNonEmpty(o.priceSpecification)) errors.push(`${label}: 'price' eksik.`);
  else if (isNonEmpty(o.price) && !/^\d+(\.\d+)?$/.test(String(o.price))) errors.push(`${label}: 'price' sayısal olmalı (para birimi işareti ve nokta ayıracı olmadan).`);
  if (isNonEmpty(o.price) && !isNonEmpty(o.priceCurrency)) errors.push(`${label}: 'priceCurrency' eksik (TRY/USD/EUR).`);
  if (!isNonEmpty(o.availability)) warnings.push(`${label}: 'availability' önerilir.`);
}

function checkAddress(a: unknown, label: string, warnings: string[]) {
  const addr = asList(a)[0];
  if (!addr) {
    warnings.push(`${label}: 'address' önerilir (en az ilçe/il ve ülke).`);
    return;
  }
  if (!isNonEmpty(addr.addressCountry)) warnings.push(`${label}: 'address.addressCountry' önerilir (TR).`);
  if (!isNonEmpty(addr.addressLocality) && !isNonEmpty(addr.addressRegion)) warnings.push(`${label}: 'address' içinde ilçe ya da il önerilir.`);
}

export function validateStructuredData(input: unknown): StructuredDataReport {
  const errors = validateJsonLd(input);
  const warnings: string[] = [];
  const nodes = allNodes(input);
  const types = [...new Set(nodes.flatMap(typesOf))];

  for (const node of nodes) {
    for (const type of typesOf(node)) {
      switch (type) {
        case "Organization":
          if (!isNonEmpty(node.logo)) warnings.push("Organization: 'logo' önerilir (bilgi paneli ve marka tutarlılığı).");
          if (!isNonEmpty(node.sameAs)) warnings.push("Organization: 'sameAs' önerilir (resmî sosyal profiller; varlık tutarlılığı).");
          break;
        case "WebSite": {
          const actions = asList(node.potentialAction).filter((a) => typesOf(a).includes("SearchAction"));
          for (const a of actions) {
            const target = typeof a.target === "string" ? a.target : (asList(a.target)[0]?.urlTemplate as string | undefined);
            if (!target || !target.includes("{search_term_string}")) errors.push("SearchAction: 'target' {search_term_string} yer tutucusunu içermeli.");
            if (!isNonEmpty(a["query-input"])) errors.push("SearchAction: 'query-input' eksik.");
          }
          break;
        }
        case "RealEstateListing": {
          const offers = asList(node.offers);
          if (offers.length === 0) warnings.push("RealEstateListing: 'offers' (fiyat) önerilir.");
          offers.forEach((o, i) => checkOffer(o, `RealEstateListing.offers[${i}]`, errors, warnings));
          if (!isNonEmpty(node.image)) warnings.push("RealEstateListing: 'image' önerilir.");
          if (!isNonEmpty(node.datePosted)) warnings.push("RealEstateListing: 'datePosted' önerilir.");
          checkAddress(node.address, "RealEstateListing", warnings);
          break;
        }
        case "RealEstateAgent":
        case "LocalBusiness":
          if (!isNonEmpty(node.url)) warnings.push(`${type}: 'url' önerilir.`);
          if (!isNonEmpty(node.telephone)) warnings.push(`${type}: 'telephone' önerilir.`);
          if (!isNonEmpty(node.image) && !isNonEmpty(node.logo)) warnings.push(`${type}: 'image' ya da 'logo' önerilir.`);
          checkAddress(node.address, type, warnings);
          break;
        case "Place":
          checkAddress(node.address, "Place", warnings);
          break;
        case "CollectionPage":
          if (!isNonEmpty(node.name)) errors.push("CollectionPage: 'name' zorunlu alanı eksik.");
          if (!isNonEmpty(node.url)) errors.push("CollectionPage: 'url' zorunlu alanı eksik.");
          break;
        case "ItemList": {
          const items = asList(node.itemListElement);
          if (items.length === 0) errors.push("ItemList: 'itemListElement' boş.");
          items.forEach((it, i) => {
            if (!isNonEmpty(it.position)) errors.push(`ItemList[${i}]: 'position' eksik.`);
            if (!isNonEmpty(it.url) && !isNonEmpty(it.item)) errors.push(`ItemList[${i}]: 'url' eksik.`);
          });
          break;
        }
        case "Article":
          if (!isNonEmpty(node.headline)) errors.push("Article: 'headline' zorunlu alanı eksik.");
          if (!isNonEmpty(node.datePublished)) warnings.push("Article: 'datePublished' önerilir.");
          if (!isNonEmpty(node.author)) warnings.push("Article: 'author' önerilir.");
          break;
        default:
          break;
      }
    }
  }
  return { errors, warnings: [...new Set(warnings)], types };
}

/** Sayfa yoluna göre beklenen yapılandırılmış veri türleri (en az biri bulunmalı). Bilinmeyen sayfa: beklenti yok. */
export function expectedTypesFor(path: string): { types: string[]; label: string } | null {
  const p = path.replace(/[?#].*$/, "").replace(/\/+$/, "") || "/";
  if (p === "/") return { types: ["Organization", "WebSite"], label: "Kuruluş ve site (Organization, WebSite)" };
  const segs = p.slice(1).split("/");
  if (segs[0] === "vitrin") {
    if (segs.length === 2) return { types: ["RealEstateAgent", "LocalBusiness"], label: "Emlak ofisi (RealEstateAgent)" };
    if (segs.length === 3 && segs[2] !== "degerleme") return { types: ["RealEstateListing"], label: "İlan (RealEstateListing + Offer)" };
    return null;
  }
  if (segs[0] === "danisman") return { types: ["RealEstateAgent"], label: "Danışman (RealEstateAgent)" };
  if (segs[0] === "emlak") return { types: ["CollectionPage", "ItemList"], label: "İlan listesi (CollectionPage + ItemList)" };
  if (segs[0] === "rehber" && segs.length === 2) return { types: ["Article"], label: "Rehber yazısı (Article)" };
  return { types: ["BreadcrumbList"], label: "İçerik yolu (BreadcrumbList)" };
}
