/**
 * Otomasyon sihirbazı eylem listesi — SAF yardımcılar (istemci ve test ortak).
 *
 * Kural en çok MAX_AUTOMATION_ACTIONS eylem taşır ve eylemler sırayla çalışır (ör. "danışmana ata → görev aç →
 * WhatsApp şablonu gönder"). Sunucu eylemi (`parseWizardForm`) aynı alanları yeniden doğrular; buradaki kontrol yalnız
 * kullanıcıya erken geri bildirim içindir.
 */

export type DraftAction = {
  uid: string;
  type: string;
  title: string;
  priority: string;
  dueDays: string;
  message: string;
  assigneeId: string;
  tag: string;
  targetStatus: string;
  templateName: string;
  language: string;
  bodyParam: string;
  subject: string;
  body: string;
};

const TEMPLATE_NAME_RE = /^[a-z0-9_]{1,512}$/;
const TEMPLATE_LANGUAGE_RE = /^[a-z]{2,3}(?:_[A-Z]{2})?$/;

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

export function emptyDraft(uid: string, type = ""): DraftAction {
  return {
    uid,
    type,
    title: "",
    priority: "normal",
    dueDays: "",
    message: "",
    assigneeId: "",
    tag: "",
    targetStatus: "",
    templateName: "",
    language: "tr",
    bodyParam: "",
    subject: "",
    body: "",
  };
}

/** Kayıtlı eylemi (jsonb) düzenlenebilir taslağa çevirir. Eski serbest metinli WhatsApp eylemi şablonsuz gelir. */
export function draftFromAction(uid: string, action: { type?: string; config?: Record<string, unknown> }): DraftAction {
  const cfg = action.config ?? {};
  return {
    ...emptyDraft(uid, str(action.type)),
    title: str(cfg.title),
    priority: str(cfg.priority) || "normal",
    dueDays: str(cfg.due_days),
    message: str(cfg.template) || str(cfg.message),
    assigneeId: str(cfg.assignee_id),
    tag: str(cfg.tag),
    targetStatus: str(cfg.target_status),
    templateName: str(cfg.template_name),
    language: str(cfg.language) || "tr",
    bodyParam: str(cfg.body_param),
    subject: str(cfg.subject),
    body: str(cfg.body),
  };
}

/** Taslak eksiksiz mi? (boş tür, zorunlu alan, geçersiz şablon adı/dili = geçersiz) */
export function draftValid(d: DraftAction): boolean {
  switch (d.type) {
    case "create_task":
      return d.title.trim().length > 0;
    case "send_sms":
    case "notify_manager":
    case "send_notification":
      return d.message.trim().length > 0;
    case "send_whatsapp":
      return TEMPLATE_NAME_RE.test(d.templateName.trim()) && TEMPLATE_LANGUAGE_RE.test(d.language.trim());
    case "send_email":
      return d.subject.trim().length > 0 && d.body.trim().length > 0;
    case "assign_to_staff":
      return d.assigneeId.length > 0;
    case "add_tag":
      return d.tag.trim().length > 0;
    case "change_status":
      return d.targetStatus.length > 0;
    default:
      return false;
  }
}

/** Taslağı sunucuya gidecek `{type, config}` biçimine çevirir (yalnız o türün alanları). */
export function draftToAction(d: DraftAction): { type: string; config: Record<string, unknown> } {
  switch (d.type) {
    case "create_task": {
      const config: Record<string, unknown> = { title: d.title.trim(), priority: d.priority || "normal" };
      const due = Number(d.dueDays);
      if (Number.isFinite(due) && due >= 1) config.due_days = Math.round(due);
      return { type: d.type, config };
    }
    case "send_sms":
      return { type: d.type, config: { template: d.message.trim() } };
    case "notify_manager":
    case "send_notification":
      return { type: d.type, config: { message: d.message.trim() } };
    case "send_whatsapp": {
      const config: Record<string, unknown> = { template_name: d.templateName.trim(), language: d.language.trim() };
      if (d.bodyParam.trim()) config.body_param = d.bodyParam.trim();
      return { type: d.type, config };
    }
    case "send_email":
      return { type: d.type, config: { subject: d.subject.trim(), body: d.body.trim() } };
    case "assign_to_staff":
      return { type: d.type, config: { assignee_id: d.assigneeId } };
    case "add_tag":
      return { type: d.type, config: { tag: d.tag.trim() } };
    case "change_status":
      return { type: d.type, config: { target_status: d.targetStatus } };
    default:
      return { type: d.type, config: {} };
  }
}

/** Listede bir öğeyi yukarı/aşağı taşır (sınırda değişmez). */
export function moveDraft<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}
