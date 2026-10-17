import { z } from "zod";
import type { AnySettingDef } from "../types";
import { defineString } from "./define";
import { VITRIN_NEVER_INDEX_KEY, parseNeverIndexInput } from "@/lib/vitrin-seo/never-index";

/**
 * Vitrin kalıcı noindex listesi (`seo.vitrin.never_index`). Okuyucu: src/lib/vitrin-seo/store.ts (SEO önbellek etiketi).
 * Yazma YALNIZ SEO merkezi "Vitrin" sekmesinden (köprü: saveVitrinNeverIndex), süper admin; listeden çıkarmak bir
 * ofisi arama motorlarına açabileceği için yüksek risk. Depo biçimi: ek slug'ların JSON dizisi (varsayılanlar saklanmaz,
 * her zaman geçerlidir). Okuyucu eski düz metin biçimini de kabul eder.
 */
const base = defineString({
  key: VITRIN_NEVER_INDEX_KEY,
  default: "",
  maxLength: 40_000,
  multiline: true,
  category: "gorunum",
  label: "Vitrin kalıcı noindex listesi",
  description: "Ofis arama onayından bağımsız olarak vitrin, ilan ve danışman sayfaları her zaman noindex olan ofis slug'ları (varsayılanlar ayrıca hep geçerli).",
  impact: "Listedeki ofislerin sayfaları arama motorlarına kapanır ve sitemap'ten çıkar; listeden çıkarılan ofis kendi onayı varsa indekslenebilir hâle gelir.",
  risk: "high",
  editMode: "bridge",
  editHref: "/admin/site/seo?sekme=sayfalar&bolum=vitrin",
  permission: { platformModule: "seo", superAdminOnly: true },
});

export const VITRIN_SEO_SETTING_DEFS: AnySettingDef[] = [
  {
    ...base,
    schema: z
      .string()
      .superRefine((v, ctx) => {
        const r = parseNeverIndexInput(v);
        if (!r.ok) ctx.addIssue({ code: "custom", message: r.error });
      })
      .transform((v) => {
        const r = parseNeverIndexInput(v);
        return r.ok ? JSON.stringify(r.slugs) : v;
      }),
  } as AnySettingDef,
];
