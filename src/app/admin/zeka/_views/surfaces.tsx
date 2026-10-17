import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { getSettings } from "@/lib/settings/read";
import { ZEKA_MODE_OPTIONS, ZEKA_OFFICE_LIMIT_SURFACES, ZEKA_SETTING_KEYS, ZEKA_SURFACE_LABELS } from "@/lib/settings/registry/zeka";
import { ZEKA_CENTER_GROUPS, ZEKA_SURFACE_SHORT } from "@/lib/ai/zeka/center";
import { ZEKA_SURFACES } from "@/lib/ai/zeka/types";
import { saveZekaSettings } from "../actions";
import { ZekaActionForm } from "../_ui";
import { SettingsHistoryCard, fieldClass, labelClass } from "./shared";

/** Dakikalık hız sınırları (kodda; kötüye kullanım koruması). Günlük sınırlar bunların üstüne yönetimden eklenir. */
const MINUTE_LIMITS: Record<(typeof ZEKA_SURFACES)[number], string> = {
  app: "Kullanıcı başına 20 yanıt / dk",
  public: "IP başına 20 yanıt / 10 dk",
  vitrin: "IP başına 30 yanıt / 10 dk, ofis başına 600 / saat",
  admin: "Personel başına 20 yanıt / dk",
};

/** Yüzeyler: aç/kapa, kip (otomatik / yerel / GPT), kişi ve ofis başına günlük soru sınırı, jeton üst sınırı. */
export async function SurfacesView({ canWrite }: { canWrite: boolean }) {
  const keys = ZEKA_CENTER_GROUPS.yuzeyler;
  const v = await getSettings(keys).catch(() => ({}) as Record<string, unknown>);
  const num = (k: string) => String(v[k] ?? "");
  return (
    <div className="space-y-6">
      <ZekaActionForm action={saveZekaSettings} readOnly={!canWrite} submitLabel="Yüzey ayarlarını kaydet">
        <input type="hidden" name="group" value="yuzeyler" />
        <div className="grid gap-4 lg:grid-cols-2">
          {ZEKA_SURFACES.map((s) => {
            const enabledKey = ZEKA_SETTING_KEYS.enabled(s);
            const officeKey = (ZEKA_OFFICE_LIMIT_SURFACES as readonly string[]).includes(s) ? ZEKA_SETTING_KEYS.dailyOffice(s as (typeof ZEKA_OFFICE_LIMIT_SURFACES)[number]) : null;
            return (
              <Card key={s}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle>{ZEKA_SURFACE_SHORT[s]}</CardTitle>
                      <CardDescription>{ZEKA_SURFACE_LABELS[s]}</CardDescription>
                    </div>
                    <Switch name={enabledKey} defaultChecked={v[enabledKey] !== false} aria-label={`${ZEKA_SURFACE_SHORT[s]} yüzeyinde Zeka açık`} />
                  </div>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  <label className={`${labelClass} sm:col-span-2`}>
                    <span className="font-semibold">Motor (kip)</span>
                    <select name={ZEKA_SETTING_KEYS.mode(s)} defaultValue={String(v[ZEKA_SETTING_KEYS.mode(s)] ?? "auto")} className={fieldClass}>
                      {ZEKA_MODE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={labelClass}>
                    <span className="font-semibold">{s === "public" || s === "vitrin" ? "Ziyaretçi başına günlük soru" : "Kişi başına günlük soru"}</span>
                    <Input name={ZEKA_SETTING_KEYS.dailyUser(s)} type="number" min={0} max={100000} inputMode="numeric" defaultValue={num(ZEKA_SETTING_KEYS.dailyUser(s))} />
                  </label>
                  {officeKey ? (
                    <label className={labelClass}>
                      <span className="font-semibold">Ofis başına günlük soru</span>
                      <Input name={officeKey} type="number" min={0} max={999999} inputMode="numeric" defaultValue={num(officeKey)} />
                    </label>
                  ) : null}
                  <label className={labelClass}>
                    <span className="font-semibold">Yanıt üst sınırı (jeton)</span>
                    <Input name={ZEKA_SETTING_KEYS.surfaceMaxTokens(s)} type="number" min={0} max={2000} inputMode="numeric" defaultValue={num(ZEKA_SETTING_KEYS.surfaceMaxTokens(s))} />
                    <span className="text-xs text-text-muted">0 = genel üst sınır</span>
                  </label>
                  <p className="m-0 text-xs text-text-muted sm:col-span-2">0 = sınırsız. Ayrıca sabit koruma: {MINUTE_LIMITS[s]}.</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Genel yanıt üst sınırı</CardTitle>
            <CardDescription>Yüzeyde ayrı sınır yoksa (0) GPT yanıtı en çok bu kadar jeton olur (100–2000).</CardDescription>
          </CardHeader>
          <CardContent>
            <label className={`${labelClass} max-w-xs`}>
              <span className="font-semibold">Jeton</span>
              <Input name={ZEKA_SETTING_KEYS.maxTokens} type="number" min={100} max={2000} inputMode="numeric" defaultValue={num(ZEKA_SETTING_KEYS.maxTokens)} />
            </label>
          </CardContent>
        </Card>
      </ZekaActionForm>
      <SettingsHistoryCard keys={keys} />
    </div>
  );
}
