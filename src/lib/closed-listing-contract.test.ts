import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OPEN_LISTING_OR_FILTER, isClosedListing, withClosedFlag } from "./closed-listing";

describe("closed-listing", () => {
  it("yalnız boolean true / 'true' kapalı sayılır; bayrak yoksa açık", () => {
    expect(isClosedListing({ closed_listing: true })).toBe(true);
    expect(isClosedListing({ closed_listing: "true" })).toBe(true);
    expect(isClosedListing({ closed_listing: false })).toBe(false);
    expect(isClosedListing({})).toBe(false);
    expect(isClosedListing(null)).toBe(false);
    expect(isClosedListing([true])).toBe(false);
  });
  it("withClosedFlag diğer anahtarları korur, açarken anahtarı siler", () => {
    const on = withClosedFlag({ rooms: "3+1", description: "x" }, true);
    expect(on).toEqual({ rooms: "3+1", description: "x", closed_listing: true });
    expect(withClosedFlag(on, false)).toEqual({ rooms: "3+1", description: "x" });
  });
  it("PostgREST süzgeci NULL'ı da açık sayar", () => {
    expect(OPEN_LISTING_OR_FILTER).toBe("features->>closed_listing.is.null,features->>closed_listing.neq.true");
  });
});

/** Public yüzeyler kapalı portföyü süzmek ZORUNDA (yeni public sorgu eklenirse bu listeye girer). */
const PUBLIC_SURFACES = [
  "src/app/vitrin/[slug]/page.tsx",
  "src/app/vitrin/[slug]/[id]/page.tsx",
  "src/app/vitrin/[slug]/opengraph-image.tsx",
  "src/app/vitrin/[slug]/[id]/opengraph-image.tsx",
  "src/app/api/vitrin-favoriler/route.ts",
  "src/app/danisman/[slug]/page.tsx",
  "src/app/api/cron/vitrin-eslesme/route.ts",
  "src/app/actions/vitrin-alerts.ts",
  "src/lib/seo/sitemap-data.ts",
  "src/app/actions/customer-portal.ts",
];

describe("public yüzeyler kapalı portföyü süzer", () => {
  for (const f of PUBLIC_SURFACES) {
    it(f, () => {
      const src = readFileSync(f, "utf8");
      expect(src).toContain("OPEN_LISTING_OR_FILTER");
    });
  }
  it("public görsel ucu kapalı portföy görselini servis etmez", () => {
    expect(readFileSync("src/app/api/property-media/[id]/route.ts", "utf8")).toContain("isClosedListing");
  });
  it("portal yayın eylemleri kapalı portföyü reddeder", () => {
    expect(readFileSync("src/app/actions/portal-publish.ts", "utf8")).toContain("closedListingBlock");
    expect(readFileSync("src/app/actions/portal-listings.ts", "utf8")).toContain("closedListingBlock");
  });
});
