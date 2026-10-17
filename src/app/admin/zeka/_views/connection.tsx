import Link from "@/components/ui/smart-link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { OpenAiKeyForm } from "@/components/admin/openai-key-form";
import { getSettings } from "@/lib/settings/read";
import { getOpenAiChatModel } from "@/lib/ai/openai-client";
import { ZEKA_SETTING_KEYS } from "@/lib/settings/registry/zeka";
import { ZEKA_CENTER_GROUPS, ZEKA_MODEL_SUGGESTIONS } from "@/lib/ai/zeka/center";
import { readZekaConfig, zekaKeyStatus } from "@/lib/ai/zeka/settings";
import { saveZekaSettings, testZekaConnection } from "../actions";
import { ZekaActionForm, ZekaTestButton } from "../_ui";
import { SettingsHistoryCard, labelClass } from "./shared";

/** Bağlantı: OpenAI anahtarı DURUMU (değer asla), model seçimi, bağlantı testi. */
export async function ConnectionView({ canWrite }: { canWrite: boolean }) {
  const [key, values, cfg] = await Promise.all([zekaKeyStatus(), getSettings([ZEKA_SETTING_KEYS.model]).catch(() => ({}) as Record<string, unknown>), readZekaConfig("app")]);
  const model = String(values[ZEKA_SETTING_KEYS.model] ?? "");
  const platformDefault = getOpenAiChatModel();
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>OpenAI anahtarı</CardTitle>
          <CardDescription>
            {key.configured
              ? `Tanımlı (${key.source === "db" ? "panelden, şifreli" : "sunucu ortam değişkeninden"}). Kip "otomatik" olan yüzeyler GPT ile yanıtlar.`
              : "Tanımlı değil. Zeka şu an yerel zeka ile çalışıyor (harici çağrı yok). Anahtarı aşağıya girip kaydedin; kod değişikliği gerekmez."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-text-muted">Durum</dt>
              <dd className={`m-0 font-semibold ${key.configured ? "text-success-700" : "text-ink-950"}`}>{key.configured ? "Tanımlı" : "Tanımlı değil"}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Kaynak</dt>
              <dd className="m-0 font-semibold text-ink-950">{key.source === "db" ? "Panel (şifreli)" : key.source === "env" ? "Sunucu ortamı (OPENAI_API_KEY)" : "—"}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Parmak izi</dt>
              <dd className="m-0 font-mono text-ink-950">{key.fingerprint ?? "—"}</dd>
            </div>
          </dl>
          <OpenAiKeyForm configured={key.configured} source={key.source} masked={key.fingerprint} canEdit={canWrite} />
          <p className="m-0 text-xs text-text-muted">
            Aynı anahtar <Link href="/admin/sistem?sekme=entegrasyonlar#anahtar-openai" className="font-semibold text-brand-700 hover:underline">Entegrasyon merkezi</Link>&apos;nde de görünür; değer hiçbir ekranda gösterilmez.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Model</CardTitle>
          <CardDescription>Boş bırakılırsa platform varsayılanı kullanılır: {platformDefault}. Şu an kullanılan: {cfg.model}.</CardDescription>
        </CardHeader>
        <CardContent>
          <ZekaActionForm action={saveZekaSettings} readOnly={!canWrite}>
            <input type="hidden" name="group" value="baglanti" />
            <label className={labelClass}>
              <span className="font-semibold">GPT modeli</span>
              <Input name={ZEKA_SETTING_KEYS.model} defaultValue={model} maxLength={60} list="zeka-models" placeholder={platformDefault} autoComplete="off" />
            </label>
            <datalist id="zeka-models">
              {ZEKA_MODEL_SUGGESTIONS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <p className="m-0 text-xs text-text-muted">Kredi maliyeti modele göre değişir (AI kullanımı &gt; maliyet tablosu). Değişiklik bir sonraki sorudan itibaren geçerlidir.</p>
          </ZekaActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bağlantıyı test et</CardTitle>
          <CardDescription>Seçili modelle tek ve en küçük çağrıyı yapar (platform AI kotasından düşer). Yanıt içeriği gösterilmez; yalnız sonuç ve süre.</CardDescription>
        </CardHeader>
        <CardContent>
          <ZekaTestButton action={testZekaConnection} disabled={!canWrite || !key.configured} />
          {!key.configured ? <p className="mt-2 text-xs text-text-muted">Test için önce anahtarı kaydedin.</p> : null}
        </CardContent>
      </Card>

      <div className="lg:col-span-2">
        <SettingsHistoryCard keys={[...ZEKA_CENTER_GROUPS.baglanti, "openai_api_key"]} />
      </div>
    </div>
  );
}
