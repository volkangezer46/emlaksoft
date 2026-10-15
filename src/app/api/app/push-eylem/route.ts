import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { checkRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { completeTask } from "@/app/actions/tasks";
import { logActivity } from "@/lib/activity";
import { now } from "@/lib/clock";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" } as const;
/** Service worker'ın gönderdiği özel başlık: düz HTML formu ya da başka köken (CORS ön uçuşu olmadan) bu ucu çağıramaz. */
const PUSH_ACTION_HEADER = "x-emlaksoft-push";

const bodySchema = z.object({
  action: z.enum(["done", "snooze"]),
  entity: z.object({ type: z.literal("task"), id: z.string().uuid() }),
});

function sameOrigin(req: Request): boolean {
  if (req.headers.get(PUSH_ACTION_HEADER) !== "1") return false;
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") === "same-origin";
  try {
    const host = new URL(req.url).host;
    const forwarded = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? host;
    const o = new URL(origin).host;
    return o === host || o === forwarded;
  } catch {
    return false;
  }
}

/** Yarın 09:00 (Türkiye saati, UTC+3) ISO. */
function tomorrowNineTr(nowMs: number): string {
  const tr = new Date(nowMs + 3 * 3_600_000);
  const utc = Date.UTC(tr.getUTCFullYear(), tr.getUTCMonth(), tr.getUTCDate() + 1, 9 - 3, 0, 0);
  return new Date(utc).toISOString();
}

/**
 * POST /api/app/push-eylem — anlık bildirimdeki "Tamamla" / "Yarına ertele" düğmesi (MP3 / GA-15).
 * Çağıran YALNIZ service worker'dır (public/sw.js `notificationclick`): kullanıcının açık oturum çereziyle, aynı kökenden,
 * özel başlıkla. Yetki uygulama içindekiyle aynıdır (`tasks:edit` + RLS); bildirim yükü yalnız hangi düğmenin
 * gösterileceğini belirler, yetki vermez. Oturum yoksa 401 döner; service worker o zaman kaydı tarayıcıda açar.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, error: "origin" }, { status: 403, headers: NO_STORE });
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ ok: false, error: "session" }, { status: 401, headers: NO_STORE });
  const limit = await checkRateLimit(`push-action:${user.id}`, { limit: 30, windowSec: 60, failurePolicy: "deny" });
  if (!limit.allowed) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429, headers: NO_STORE });

  let body: z.infer<typeof bodySchema>;
  try {
    const raw = await request.text();
    if (raw.length > 1_000) return NextResponse.json({ ok: false, error: "too_large" }, { status: 413, headers: NO_STORE });
    body = bodySchema.parse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400, headers: NO_STORE });
  }

  const gate = await requirePermission("tasks", "edit");
  if (!gate.ok) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403, headers: NO_STORE });

  const supabase = await createClient();
  const { data: task } = await supabase
    .from("tasks")
    .select("id, status, kind")
    .eq("id", body.entity.id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!task) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404, headers: NO_STORE });
  // Kapanmış görev: işlem yok ama başarı (iki cihazdan aynı düğmeye basılabilir).
  if (task.status !== "open") return NextResponse.json({ ok: true, already: true }, { headers: NO_STORE });
  // EİDS kaldırma görevi yalnız kontrol listesinden kapanır: kullanıcı kaydı açmalı.
  if (task.kind === "eids_takedown") return NextResponse.json({ ok: false, error: "open_required" }, { status: 409, headers: NO_STORE });

  if (body.action === "done") {
    const fd = new FormData();
    fd.set("id", task.id);
    await completeTask(fd);
    return NextResponse.json({ ok: true, message: "Görev tamamlandı" }, { headers: NO_STORE });
  }

  const due = tomorrowNineTr(now());
  const { error } = await supabase
    .from("tasks")
    .update({ due_at: due })
    .eq("id", task.id)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "open");
  if (error) return NextResponse.json({ ok: false, error: "update_failed" }, { status: 500, headers: NO_STORE });
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "task.update", entityType: "task", entityId: task.id, newValue: { due_at: due, via: "push" } });
  revalidatePath("/app/gorevler");
  return NextResponse.json({ ok: true, message: "Görev yarın 09:00'a ertelendi" }, { headers: NO_STORE });
}
