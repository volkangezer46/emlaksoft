import type { MetadataRoute } from "next";

import { getBaseUrl } from "@/lib/base-url";
const BASE_URL = getBaseUrl();

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/app/",
          "/admin/",
          "/api/",
          "/odeme-link/",
          // Token'lı kişiye özel portallar — zaten noindex; tarama da kapatılır.
          "/malik-portali/",
          "/musteri-portali/",
          "/randevu-teyit/",
          "/randevu-al/",
          "/paylas/",
          "/sunum/",
          "/tavsiye/",
          "/imza/",
          "/degerleme-raporu/",
          "/anket/",
          "/lead/",
          "/acik-ev-kayit/",
          "/vitrin/*/favoriler",
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
