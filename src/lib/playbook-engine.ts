import type { SupabaseClient } from "@supabase/supabase-js";
import { DAY_MS } from "@/lib/clock";

/**
 * İş akışı (playbook) motoru — "bu olay olunca ŞU GÖREV LİSTESİ açılsın".
 *
 * `automation-engine.ts` ile FARKI:
 *   automations → olay başına TEKİL aksiyon (tek görev, tek SMS, tek bildirim)
 *   playbooks   → olay başına ÇOK ADIMLI, SIRALI, GÖRELİ VADELİ görev paketi
 *
 * Örnek (yeni satılık portföy):
 *   +0g  Tapu fotokopisi iste
 *   +2g  Profesyonel fotoğraf çek
 *   +3g  Portallara yükle
 *   +5g  Komşulara haber ver
 *   +14g İlk fiyat değerlendirmesi
 *
 * TASARIM NOTLARI
 * ---------------
 * 1. MODÜL GRAFİĞİ SAF TUTULDU: bu dosyanın tepesinde çalışma zamanına inen
 *    tek import yok (`SupabaseClient` yalnız tip, `DAY_MS` sabit). Supabase
 *    admin client ÇAĞIRAN tarafından parametre olarak veriliyor, `notifyTenant`
 *    ise fonksiyon içinde dinamik import ediliyor. Böylece saf yardımcılar
 *    (`matchesPlaybookFilter`, `stepDueAt`, `resolveStepAssignee`,
 *    `buildPlaybookTaskRows`) vitest altında sunucu bağımlılığı yüklemeden
 *    test edilebiliyor.
 *
 * 2. ASLA THROW ETMEZ: `runPlaybooksForEvent` bir kayıt açma akışının en
 *    sonunda çağrılıyor. Playbook hatası müşteri/portföy kaydını bozamaz —
 *    tüm gövde try/catch içinde, hata `console.error` ile yutuluyor.
 *
 * 3. MÜKERRER FRENİ "ÖNCE YER KAP": `playbook_runs` üzerinde
 *    unique(playbook_id, entity_id) var. Motor önce BOŞ run satırını insert
 *    ederek yeri kapar (yarışta ikinci istek 23505 alıp sessizce çıkar),
 *    sonra görevleri açar, en son `created_task_ids`'i doldurur. Görev insert'i
 *    başarısız olursa kapılan yer geri bırakılır (run satırı silinir) ki bir
 *    sonraki denemede akış yeniden çalışabilsin.
 */

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

/** Türkçe olay sözlüğü — `playbooks.trigger_event` check kısıtıyla birebir. */
export type PlaybookTriggerEvent =
  | "yeni_musteri"
  | "yeni_portfoy"
  | "anlasma_kazanildi"
  | "kira_sozlesmesi"
  | "talep_olusturuldu";

/** Türkçe etiketler `src/lib/playbook-labels.ts` içinde (istemci paketi temiz kalsın). */

/** `playbook_steps.assign_to` sözlüğü. */
export type PlaybookAssignTo = "owner" | "creator" | "specific";

export type PlaybookStep = {
  id?: string;
  sort_order: number;
  title: string;
  kind: string;
  priority: string;
  offset_days: number;
  assign_to: PlaybookAssignTo | string;
  assignee_id: string | null;
  note: string | null;
};

export type PlaybookRecord = {
  id: string;
  tenant_id: string;
  name: string;
  trigger_event: string;
  filter: unknown;
};

/**
 * Olayın konusu olan kayıt. `fields` filtre eşleşmesinde kullanılan ham
 * alanlardır (ör. `{ transaction_type: "Satılık" }`).
 */
export type PlaybookEntity = {
  type: "customer" | "property" | "deal" | "demand" | "contract";
  id: string;
  label?: string | null;
  /** Kaydın sorumlusu (assigned_to) — `assign_to='owner'` bunu kullanır */
  ownerId?: string | null;
  customerId?: string | null;
  propertyId?: string | null;
  dealId?: string | null;
  fields?: Record<string, unknown>;
};

export type PlaybookRunSummary = {
  playbooksMatched: number;
  tasksCreated: number;
  skippedDuplicates: number;
};

/** Görev tablosuna yazılacak satırın motor tarafından üretilen hâli. */
export type PlaybookTaskRow = {
  tenant_id: string;
  title: string;
  notes: string | null;
  kind: string;
  priority: string;
  status: "open";
  due_at: string | null;
  assigned_to: string | null;
  customer_id: string | null;
  property_id: string | null;
  deal_id: string | null;
  created_by: string | null;
};

/** Motorun tek çalışmada açabileceği en fazla görev — patlama önleme. */
export const MAX_STEPS_PER_RUN = 25;

const TASK_KINDS = ["followup", "call", "visit", "document", "other"];
const TASK_PRIORITIES = ["low", "normal", "high"];

// ---------------------------------------------------------------------------
// Saf yardımcılar (test edilebilir)
// ---------------------------------------------------------------------------

/** Türkçe duyarlı, kırpılmış, küçük harfe indirgenmiş karşılaştırma anahtarı. */
function foldValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value).trim().toLocaleLowerCase("tr-TR");
}

/**
 * `playbooks.filter` eşleşmesi — BASİT anahtar/değer EŞİTLİĞİ.
 *
 * Otomasyonlardaki `conditions` dizisinden bilinçli olarak daha dar: operatör
 * yok, yalnız eşitlik. Kullanıcı bu ekranda "sadece Satılık portföylerde
 * çalışsın" demek istiyor, ifade dili kurmak istemiyor.
 *
 * Kurallar:
 *  - null / boş nesne / nesne olmayan filtre → EŞLEŞİR (filtresiz playbook).
 *  - Filtre değeri dizi ise "herhangi biri" (any-of) semantiği.
 *  - Filtrede olup entity'de OLMAYAN alan → EŞLEŞMEZ (fail-CLOSED).
 *    Otomasyon motorundaki fail-open'ın tersi ve bilinçli: burada eşleşmenin
 *    bedeli 5 görevlik bir paket açmak. "Sadece Satılık" diyen bir akışın
 *    alan eksikliğinde Kiralık portföyde de çalışması kabul edilemez.
 *  - Karşılaştırma metin bazlı, Türkçe küçük harf + trim (Satılık = satılık).
 */
export function matchesPlaybookFilter(
  filter: unknown,
  fields: Record<string, unknown> | undefined | null,
): boolean {
  if (!filter || typeof filter !== "object" || Array.isArray(filter)) return true;
  const entries = Object.entries(filter as Record<string, unknown>);
  if (entries.length === 0) return true;

  const source = fields ?? {};
  return entries.every(([key, expected]) => {
    // Boş filtre değeri = "bu alanı umursama"
    if (expected === null || expected === undefined || expected === "") return true;
    if (!(key in source)) return false;
    const actual = foldValue(source[key]);
    if (Array.isArray(expected)) {
      return expected.some((v) => foldValue(v) === actual);
    }
    return foldValue(expected) === actual;
  });
}

/**
 * Adımın vadesi: tetikleme anı + offset_days.
 * `from` epoch ms olarak DIŞARIDAN verilir — motor `Date.now()`'ı tek yerde
 * okur, test sabit bir "şimdi" ile çalışır.
 */
export function stepDueAt(offsetDays: number | null | undefined, from: number): string {
  const n = Number(offsetDays);
  const days = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  return new Date(from + days * DAY_MS).toISOString();
}

/**
 * Adımın atanacağı kullanıcı.
 *   owner    → kaydın sorumlusu (customers/properties.assigned_to)
 *   creator  → işlemi yapan kullanıcı
 *   specific → adımda seçilen kişi
 *
 * Çözülemezse (ör. owner boş) sırayla creator → owner'a düşer; ikisi de yoksa
 * null (görev atanmamış açılır, sahipsiz kalmaz çünkü tenant listesinde görünür).
 */
export function resolveStepAssignee(
  step: Pick<PlaybookStep, "assign_to" | "assignee_id">,
  ctx: { ownerId?: string | null; actorId?: string | null },
): string | null {
  const owner = ctx.ownerId ?? null;
  const actor = ctx.actorId ?? null;
  switch (step.assign_to) {
    case "specific":
      return step.assignee_id ?? owner ?? actor ?? null;
    case "creator":
      return actor ?? owner ?? null;
    case "owner":
    default:
      return owner ?? actor ?? null;
  }
}

/**
 * Adımlardan `tasks` satırlarını üretir (insert edilmeye hazır).
 * Sıralama `sort_order`, sonra `offset_days`. Boş başlıklı adım atlanır.
 */
export function buildPlaybookTaskRows(input: {
  tenantId: string;
  playbook: Pick<PlaybookRecord, "id" | "name">;
  steps: PlaybookStep[];
  entity: PlaybookEntity;
  actorId?: string | null;
  now: number;
}): PlaybookTaskRow[] {
  const { tenantId, playbook, entity, actorId, now } = input;
  const ordered = [...(input.steps ?? [])]
    .filter((s) => String(s?.title ?? "").trim().length > 0)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.offset_days ?? 0) - (b.offset_days ?? 0))
    .slice(0, MAX_STEPS_PER_RUN);

  return ordered.map((step) => {
    const kind = TASK_KINDS.includes(String(step.kind)) ? String(step.kind) : "followup";
    const priority = TASK_PRIORITIES.includes(String(step.priority)) ? String(step.priority) : "normal";
    const title = String(step.title).trim();
    return {
      tenant_id: tenantId,
      title: entity.label ? `${title} · ${entity.label}` : title,
      // İzlenebilirlik: görev listesinde hangi akıştan geldiği okunabilsin.
      notes: [`İş akışı: ${playbook.name}`, step.note?.trim() || null].filter(Boolean).join(" — "),
      kind,
      priority,
      status: "open" as const,
      due_at: stepDueAt(step.offset_days, now),
      assigned_to: resolveStepAssignee(step, { ownerId: entity.ownerId, actorId }),
      customer_id: entity.customerId ?? (entity.type === "customer" ? entity.id : null),
      property_id: entity.propertyId ?? (entity.type === "property" ? entity.id : null),
      deal_id: entity.dealId ?? (entity.type === "deal" ? entity.id : null),
      created_by: actorId ?? null,
    };
  });
}

/** Özet bildirim metni — "📋 {playbook}: {N} görev oluşturuldu". */
export function runSummaryMessage(playbookName: string, taskCount: number): string {
  return `📋 ${playbookName}: ${taskCount} görev oluşturuldu`;
}

// ---------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------

/**
 * Olay için tenant'ın AKTİF playbook'larını çalıştırır.
 * ASLA throw etmez — çağıran server action'ın başarısını etkileyemez.
 */
export async function runPlaybooksForEvent(input: {
  admin: SupabaseClient;
  tenantId: string;
  event: PlaybookTriggerEvent;
  entity: PlaybookEntity;
  actorId?: string | null;
}): Promise<PlaybookRunSummary> {
  const summary: PlaybookRunSummary = { playbooksMatched: 0, tasksCreated: 0, skippedDuplicates: 0 };
  const { admin, tenantId, event, entity, actorId } = input;

  try {
    if (!tenantId || !entity?.id) return summary;

    const { data: playbookRows, error: pbError } = await admin
      .from("playbooks")
      .select("id, tenant_id, name, trigger_event, filter")
      .eq("tenant_id", tenantId)
      .eq("trigger_event", event)
      .eq("is_active", true)
      .limit(10);

    if (pbError || !playbookRows || playbookRows.length === 0) return summary;

    // Filtre eşleşmesi ÖNCE — eşleşmeyen playbook için hiç sorgu atılmaz.
    const matched = (playbookRows as PlaybookRecord[]).filter((pb) =>
      matchesPlaybookFilter(pb.filter, entity.fields),
    );
    if (matched.length === 0) return summary;

    // Adımları TEK sorguda çek (playbook başına N+1 yok).
    const { data: stepRows } = await admin
      .from("playbook_steps")
      .select("id, playbook_id, sort_order, title, kind, priority, offset_days, assign_to, assignee_id, note")
      .eq("tenant_id", tenantId)
      .in("playbook_id", matched.map((p) => p.id))
      .order("sort_order", { ascending: true });

    const stepsByPlaybook = new Map<string, PlaybookStep[]>();
    for (const row of (stepRows ?? []) as (PlaybookStep & { playbook_id: string })[]) {
      const list = stepsByPlaybook.get(row.playbook_id) ?? [];
      list.push(row);
      stepsByPlaybook.set(row.playbook_id, list);
    }

    const now = Date.now();

    for (const pb of matched) {
      const steps = stepsByPlaybook.get(pb.id) ?? [];
      if (steps.length === 0) continue; // adımsız playbook = yapacak iş yok

      const rows = buildPlaybookTaskRows({
        tenantId,
        playbook: pb,
        steps,
        entity,
        actorId,
        now,
      });
      if (rows.length === 0) continue;

      // --- Mükerrer freni: önce yeri kap (unique(playbook_id, entity_id)) ---
      const { data: runRow, error: claimError } = await admin
        .from("playbook_runs")
        .insert({
          tenant_id: tenantId,
          playbook_id: pb.id,
          entity_type: entity.type,
          entity_id: entity.id,
          created_task_ids: [],
        })
        .select("id")
        .single();

      if (claimError || !runRow) {
        // 23505 = bu playbook bu kayıt için zaten çalışmış
        summary.skippedDuplicates += 1;
        continue;
      }

      const { data: taskRows, error: taskError } = await admin.from("tasks").insert(rows).select("id");

      if (taskError || !taskRows) {
        // Kapılan yeri geri bırak — bir sonraki denemede akış tekrar çalışsın
        await admin.from("playbook_runs").delete().eq("id", runRow.id);
        console.error("runPlaybooksForEvent tasks insert", pb.id, taskError?.message);
        continue;
      }

      await admin
        .from("playbook_runs")
        .update({ created_task_ids: taskRows.map((t) => t.id) })
        .eq("id", runRow.id);

      summary.playbooksMatched += 1;
      summary.tasksCreated += taskRows.length;

      // Sorumluya TEK özet bildirim (adım başına bildirim spam'i YOK).
      try {
        const { notifyTenant } = await import("@/lib/notify");
        await notifyTenant({
          tenantId,
          userId: entity.ownerId ?? actorId ?? null,
          title: runSummaryMessage(pb.name, taskRows.length),
          body: entity.label ? `${entity.label} için görev listesi açıldı.` : "Görev listesi açıldı.",
          href: "/app/gorevler",
          kind: "info",
        });
      } catch (e) {
        console.error("runPlaybooksForEvent notify", e instanceof Error ? e.message : e);
      }
    }
  } catch (e) {
    // Sessiz log — kayıt açma akışı ASLA bozulmamalı
    console.error("runPlaybooksForEvent", input.event, e instanceof Error ? e.message : e);
  }

  return summary;
}
