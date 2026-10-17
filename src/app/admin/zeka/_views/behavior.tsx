import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { getSettings } from "@/lib/settings/read";
import { ZEKA_LANGUAGE_OPTIONS, ZEKA_SETTING_KEYS, ZEKA_SURFACE_LABELS } from "@/lib/settings/registry/zeka";
import { ZEKA_CENTER_GROUPS, ZEKA_SURFACE_SHORT } from "@/lib/ai/zeka/center";
import { ZEKA_SURFACES } from "@/lib/ai/zeka/types";
import { saveZekaSettings } from "../actions";
import { ZekaActionForm } from "../_ui";
import { SettingsHistoryCard, fieldClass, labelClass } from "./shared";

/**
 * Davranış: kişilik/ton, yüzey istemi ekleri, yasaklı konular, yanıt dili. Metinler SUNUCUDA kalır ve yalnız GPT sistem
 * istemine ayrı, etiketli blok olarak girer (`policy.ts composeSystemPrompt`); güvenlik ve kapsam kuralları her zaman
 * sonra ve öncelikli tekrar edilir. Yasaklı konu yerel motorda da uygulanır (soru hiç işlenmez).
 */
export async function BehaviorView({ canWrite }: { canWrite: boolean }) {
  const keys = ZEKA_CENTER_GROUPS.davranis;
  const v = await getSettings(keys).catch(() => ({}) as Record<string, unknown>);
  const str = (k: string) => String(v[k] ?? "");
  return (
    <div className="space-y-6">
      <ZekaActionForm action={saveZekaSettings} readOnly={!canWrite} submitLabel="Davranışı kaydet">
        <input type="hidden" name="group" value="davranis" />
        <Card>
          <CardHeader>
            <CardTitle>Kişilik ve ton</CardTitle>
            <CardDescription>Tüm yüzeylerde GPT yanıtlarının üslubu. Örnek: &quot;Sıcak ve profesyonel; kısa cümleler; önce sonucu söyle.&quot;</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_16rem]">
            <label className={labelClass}>
              <span className="font-semibold">Asistan kişiliği</span>
              <Textarea name={ZEKA_SETTING_KEYS.persona} defaultValue={str(ZEKA_SETTING_KEYS.persona)} maxLength={800} rows={4} />
            </label>
            <label className={labelClass}>
              <span className="font-semibold">Yanıt dili</span>
              <select name={ZEKA_SETTING_KEYS.language} defaultValue={str(ZEKA_SETTING_KEYS.language) || "tr"} className={fieldClass}>
                {ZEKA_LANGUAGE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <span className="text-xs text-text-muted">Yerel zeka her zaman Türkçe yanıtlar.</span>
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Yüzeye özel ek talimatlar</CardTitle>
            <CardDescription>Her yüzeyin GPT sistem istemine eklenir (en çok 1.500 karakter). Kayıt yazdırma, başka ofisin verisi ya da yetki dışı istekler yok sayılır.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            {ZEKA_SURFACES.map((s) => (
              <label key={s} className={labelClass}>
                <span className="font-semibold">{ZEKA_SURFACE_SHORT[s]}</span>
                <Textarea name={ZEKA_SETTING_KEYS.prompt(s)} defaultValue={str(ZEKA_SETTING_KEYS.prompt(s))} maxLength={1500} rows={4} aria-describedby={`zk-p-${s}`} />
                <span id={`zk-p-${s}`} className="text-xs text-text-muted">
                  {ZEKA_SURFACE_LABELS[s]}
                </span>
              </label>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Yasaklı konular</CardTitle>
            <CardDescription>Her satıra bir konu ya da sözcük. Soru bunlardan birini içerirse Zeka (yerel ve GPT) yanıt vermez ve nazikçe reddeder; sorgu kayıtlarında &quot;yasaklı konu&quot; olarak görünür.</CardDescription>
          </CardHeader>
          <CardContent>
            <label className={labelClass}>
              <span className="sr-only">Yasaklı konular</span>
              <Textarea name={ZEKA_SETTING_KEYS.bannedTopics} defaultValue={str(ZEKA_SETTING_KEYS.bannedTopics)} maxLength={2000} rows={5} placeholder={"siyaset\nkripto para\nkumar"} />
            </label>
          </CardContent>
        </Card>
      </ZekaActionForm>
      <SettingsHistoryCard keys={keys} />
    </div>
  );
}
