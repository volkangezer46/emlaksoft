import { createAdminClient } from "@/lib/supabase/admin";
import {
  runPlaybooksForEvent,
  type PlaybookEntity,
  type PlaybookTriggerEvent,
} from "@/lib/playbook-engine";

/**
 * Tetikleme noktalarının tek satırlık girişi.
 *
 * `playbook-engine.ts` bilinçli olarak Supabase client'ı PARAMETRE alıyor
 * (modül grafiği saf kalsın, vitest sunucu bağımlılığı yüklemesin). Bu ince
 * sarmalayıcı admin client'ı üretme işini üstlenir ki çağıran server action'lar
 * tek `import` + tek `await` ile yetinsin.
 *
 * ASLA throw etmez: kayıt zaten yazılmış oluyor, iş akışı hatası o kaydın
 * açılışını geri alamaz.
 */
export async function triggerPlaybooks(input: {
  tenantId: string | null | undefined;
  event: PlaybookTriggerEvent;
  entity: PlaybookEntity;
  actorId?: string | null;
}): Promise<void> {
  if (!input.tenantId) return;
  try {
    await runPlaybooksForEvent({
      admin: createAdminClient(),
      tenantId: input.tenantId,
      event: input.event,
      entity: input.entity,
      actorId: input.actorId ?? null,
    });
  } catch (e) {
    console.error("triggerPlaybooks", input.event, e instanceof Error ? e.message : e);
  }
}
