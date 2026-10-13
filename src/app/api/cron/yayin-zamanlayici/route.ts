import { revalidatePath, revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { now } from "@/lib/clock";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { failureNote, heartbeatFor } from "@/lib/cron-heartbeat-status";
import { authorizeCron } from "@/lib/cron-auth";
import { guardCron } from "@/lib/cron-run";
import { logPlatformActivity } from "@/lib/platform-activity";
import { notifyPlatformStaff } from "@/lib/platform-notify";
import { isOpen, runSchedule, type ScheduleAdapters } from "@/lib/publishing/schedule";
import { createBaselineRecorder, runAfterPublish } from "@/lib/publishing/after-publish";
import { commitEntry, freshEntry, readScheduleStrict } from "@/lib/publishing/store";
import { resolveSurface, surfaceById, type PublishSurface } from "@/lib/publishing/surfaces";

/**
 * YAYIN ZAMANLAYICI (5 dakikada bir): yayın masasında zamanlanan taslakları publishAt'te canlıya alır,
 * unpublishAt'te önceki sürüme döndürür. Saf çekirdek `runSchedule` (src/lib/publishing/schedule.ts); burada yalnız
 * gerçek depo, önbellek etiketi (revalidateTag; cron'da updateTag kullanılamaz), bildirim ve denetim izi bağlanır.
 */
export const maxDuration = 120;
const AFTER_PUBLISH_BUDGET_MS = 30_000;

async function run(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  // Okunamazsa fırlatır (guardCron -> 500 + heartbeat error): "okunamadı" "iş yok" sayılmaz.
  const entries = await readScheduleStrict();
  const open = entries.filter(isOpen);
  if (open.length === 0) {
    await recordHeartbeat("yayin-zamanlayici", "ok", "bekleyen kayıt yok · atlandı");
    return NextResponse.json({ ok: true, published: 0, reverted: 0 });
  }

  // Yüzeyler koşu başında çözülür: sabit yüzeyler + rehber yazıları (`guide:<id>`, S5 dikişi). Rehber listesi o an
  // okunamazsa yazı yüzeyi geçici olarak bilinmez: kayıt iptal edilmez, sonraki koşu yeniden dener.
  const resolved = new Map<string, PublishSurface | null>();
  for (const id of new Set(open.map((e) => e.surface))) resolved.set(id, await resolveSurface(id).catch(() => null));
  const surfaceOf = (id: string) => resolved.get(id) ?? surfaceById(id);
  const unknownIsPermanent = (id: string) => !id.startsWith("guide:");

  const touched = new Set<string>();
  // Yayın öncesi taban (elle yayınla aynı gövde özeti): her yüzeyin canlı yolları yazımdan HEMEN önce, koşuda bir kez.
  // Süre sınırlı; alınamazsa yayın yine yapılır, doğrulama tabansız olduğunu söyler.
  const baselines = createBaselineRecorder();
  const captureBaseline = (s: PublishSurface) => baselines.before(s.id, s.livePaths.map((p) => p.path));
  const adapters: ScheduleAdapters = {
    fresh: (id) => freshEntry(id),
    commit: (entry) => commitEntry(entry, entry.by),
    async readLive(surface) {
      const s = surfaceOf(surface);
      if (!s) throw new Error(`bilinmeyen yüzey: ${surface}`);
      // Sıkı okuma: hata fırlar -> runSchedule 'failed' sayar, sonraki koşu yeniden dener. Gevşek okuma (hata = null)
      // yayında prevLive'ı kalıcı olarak "kod varsayılanı" yakalar, bitişte kaydı yanlışlıkla "araya elle yayın girdi" iptal ederdi.
      return s.readLiveStrict();
    },
    async publish(surface, cfg, entry, kind) {
      const s = surfaceOf(surface);
      if (!s) return { ok: false, error: "Bilinmeyen yüzey.", permanent: unknownIsPermanent(surface) };
      const label = kind === "yayin" ? `Zamanlı yayın: ${entry.label}` : `Zamanlı yayın bitti: ${entry.label}`;
      await captureBaseline(s);
      return s.publish(cfg, entry.by, label, entry.byName || "Yayın zamanlayıcı", { keepDraft: true });
    },
    async resetToDefault(surface, entry) {
      const s = surfaceOf(surface);
      if (!s) return { ok: false, error: "Bilinmeyen yüzey.", permanent: unknownIsPermanent(surface) };
      await captureBaseline(s);
      return s.resetToDefault(entry.by, entry.byName || "Yayın zamanlayıcı", { keepDraft: true });
    },
    revalidate(surface) {
      const s = surfaceOf(surface);
      if (!s) return;
      touched.add(s.id);
      // Bayat içerik sunulmasın: bir sonraki istek taze okur (statik ana sayfa 60 sn içinde kaynaktan yeniler).
      revalidateTag(s.cacheTag, { expire: 0 });
      for (const p of s.livePaths) revalidatePath(p.path, p.type);
      revalidatePath("/admin/site");
    },
    async notify(entry, kind) {
      const s = surfaceOf(entry.surface);
      await notifyPlatformStaff({
        title: kind === "yayin" ? "Zamanlı yayın yapılamadı" : "Zamanlı yayın bitişinde geri dönülmedi",
        body: `${s?.label ?? entry.surface} · "${entry.label}": ${entry.note}. Canlı sürüm olduğu gibi bırakıldı.`,
        href: "/admin/site",
        kind: "warning",
        roles: ["super_admin"],
        meta: { scheduled_id: entry.id, surface: entry.surface },
      });
    },
    async log(entry, kind, detail) {
      await logPlatformActivity({
        actorId: entry.by,
        action: "publishing.scheduled_publish",
        entityType: entry.surface,
        entityId: entry.id,
        meta: { kind, label: entry.label, status: entry.status, cfgHash: entry.cfgHash, ...(detail ? { detail } : {}) },
      });
    },
  };

  const r = await runSchedule(open, now(), adapters);
  // Yayın sonrası zinciri: canlısı değişen her yüzey için await + süre sınırı (zincir asla fırlatmaz; heartbeat'i etkilemez).
  if (touched.size > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(
        [...touched].map((id) => {
          const s = surfaceOf(id);
          return s ? runAfterPublish({ surface: s.id, kind: "publish", livePaths: s.livePaths.map((p) => p.path), actorId: null, source: "cron", beforeDigests: baselines.get(s.id) }) : null;
        }),
      ),
      new Promise((resolve) => {
        timer = setTimeout(resolve, AFTER_PUBLISH_BUDGET_MS);
      }),
    ]);
    clearTimeout(timer);
  }
  await recordHeartbeat(
    "yayin-zamanlayici",
    heartbeatFor({ failed: r.failed }),
    `${open.length} açık kayıt, ${r.published} yayın, ${r.reverted} geri dönüş, ${r.cancelled} iptal` + failureNote({ failed: r.failed }),
  );
  return NextResponse.json({ ok: true, ...r });
}

export const GET = guardCron("yayin-zamanlayici", run);
