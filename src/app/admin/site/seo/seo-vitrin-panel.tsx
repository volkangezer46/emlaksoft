"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField, FormTextarea } from "@/components/ui/form-controls";
import { saveVitrinNeverIndex } from "@/app/actions/seo-admin";
import { LockedNote, SeoForm, SubmitButton } from "./seo-ui";

/**
 * Vitrin kalıcı noindex listesi düzenleyicisi (`seo.vitrin.never_index`). Varsayılan slug'lar her zaman geçerlidir ve
 * burada salt okunur gösterilir; textarea yalnız EK slug'ları taşır. Kaydetme süper admin işidir.
 */
export function NeverIndexForm({ defaults, extra, canEdit }: { defaults: readonly string[]; extra: readonly string[]; canEdit: boolean }) {
  return (
    <SeoForm action={saveVitrinNeverIndex}>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Kalıcı noindex listesi</CardTitle>
            <CardDescription>
              Bu listedeki ofislerin vitrin, ilan ve danışman sayfaları, ofis arama onayı verse bile her zaman “noindex” döner ve sitemap’e girmez. Örnek veri yüklü ofisler listeden bağımsız olarak zaten kapsanır.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canEdit ? <LockedNote>Listeyi yalnız süper admin değiştirebilir (listeden çıkarmak bir ofisi arama motorlarına açabilir).</LockedNote> : null}
          <p className="text-sm text-text-muted">
            Her zaman listede (değiştirilemez): <span className="font-mono text-ink-950">{defaults.join(", ")}</span>
          </p>
          <fieldset disabled={!canEdit}>
            <FormField label="Ek ofis adresleri (slug)" htmlFor="slugs" hint="Satır başına ya da virgülle ayrılmış ofis slug’ı (/vitrin/<slug>). Geçersiz bir değer varsa kayıt yapılmaz.">
              <FormTextarea id="slugs" name="slugs" rows={5} defaultValue={extra.join("\n")} />
            </FormField>
          </fieldset>
          {canEdit ? <SubmitButton>Listeyi kaydet</SubmitButton> : null}
        </CardContent>
      </Card>
    </SeoForm>
  );
}
