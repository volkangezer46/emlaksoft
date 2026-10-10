/**
 * Ofis Merkezi giriş doğrulayıcıları (zod; sunucu eylemleri ve istemci formları ortak).
 * Telefon/e-posta `@/lib/validation/contact` ve `parsePhoneStrict` ile sunucuda ayrıca doğrulanır (createTeamMember).
 */
import { z } from "zod";
import { SLA_OPTIONS_MIN } from "@/lib/response-time/core";
import { ASSIGNABLE_ROLES } from "@/lib/team/assignable-roles";
import { HANDOFF_REASON_MAX, HANDOFF_REASON_MIN } from "@/lib/team/handoff";

export const uuidSchema = z.string().uuid("Kimlik geçersiz.");
const reasonSchema = z.string().trim().max(500, "Gerekçe en fazla 500 karakter olabilir.");

export const quickInviteSchema = z.object({
  fullName: z.string().trim().min(2, "Ad soyad en az 2 karakter olmalı.").max(120, "Ad soyad en fazla 120 karakter olabilir."),
  email: z.string().trim().min(3, "E-posta zorunlu."),
  phone: z.string().trim().max(32).optional().default(""),
  title: z.string().trim().min(2, "Unvan zorunlu.").max(80, "Unvan en fazla 80 karakter olabilir."),
  role: z.string().refine((r) => (ASSIGNABLE_ROLES as readonly string[]).includes(r), "Geçerli bir rol seçin."),
  branchId: z.string().trim().optional().default(""),
});
export type QuickInviteInput = z.infer<typeof quickInviteSchema>;

export const updateAdvisorSchema = z
  .object({
    advisorId: uuidSchema,
    role: z.string().trim().optional(),
    branchId: z.string().trim().optional(),
    teamId: z.string().trim().optional(),
  })
  .refine((v) => v.role !== undefined || v.branchId !== undefined || v.teamId !== undefined, { message: "Değiştirilecek alan yok." });
export type UpdateAdvisorInput = z.infer<typeof updateAdvisorSchema>;

export const deactivateAdvisorSchema = z
  .object({
    advisorId: uuidSchema,
    handoffTo: z.string().trim().optional().default(""),
    reason: z.string().trim().max(HANDOFF_REASON_MAX, `Gerekçe en fazla ${HANDOFF_REASON_MAX} karakter olabilir.`).optional().default(""),
  })
  .refine((v) => !v.handoffTo || v.reason.length >= HANDOFF_REASON_MIN, {
    message: `Devir için gerekçe zorunludur (en az ${HANDOFF_REASON_MIN} karakter).`,
    path: ["reason"],
  })
  .refine((v) => !v.handoffTo || v.handoffTo !== v.advisorId, { message: "İş yükü aynı danışmana devredilemez.", path: ["handoffTo"] });
export type DeactivateAdvisorInput = z.infer<typeof deactivateAdvisorSchema>;

export const assignFromPoolSchema = z.object({
  propertyId: uuidSchema,
  advisorId: uuidSchema,
  method: z.enum(["manual", "smart"]),
  reason: reasonSchema.optional().default(""),
});
export type AssignFromPoolInput = z.infer<typeof assignFromPoolSchema>;

export const cancelAssignmentSchema = z.object({
  assignmentId: uuidSchema,
  reason: reasonSchema.min(3, "İptal gerekçesi zorunlu (en az 3 karakter)."),
});

export const reassignSchema = z.object({
  assignmentId: uuidSchema,
  advisorId: uuidSchema,
  reason: reasonSchema.optional().default(""),
});

/** Tanımlamalar sekmesi — her alan registry sınırlarıyla aynı (definitions.ts eşlemesi). */
export const slaDefinitionSchema = z.object({
  leadFirstResponseMin: z.number().int().refine((m) => (SLA_OPTIONS_MIN as readonly number[]).includes(m), "Geçersiz süre seçeneği."),
  unassignedSlaHours: z.number().int().min(1).max(168),
});

export const commissionDefinitionSchema = z.object({
  defaultRate: z.number().min(0.1).max(20),
  splitAdvisorShare: z.number().min(0).max(100),
  simulatorRate: z.number().min(0.1).max(20),
  simulatorAdvisorShare: z.number().min(0).max(100),
});

export const alertThresholdSchema = z.object({
  dealStaleDays: z.number().int().min(3).max(180),
  demandAgingDays: z.number().int().min(7).max(365),
  unassignedPoolCount: z.number().int().min(1).max(500),
  customerQuietDays: z.number().int().min(7).max(90),
  listingStaleDays: z.number().int().min(14).max(180),
  dormantDays: z.number().int().min(30).max(365),
});

export const notificationChannelSchema = z.record(z.string().regex(/^[a-zA-Z_]{2,40}$/), z.boolean());

export const weightsSchema = z.object({
  workload: z.number().int().min(0).max(100),
  specialty: z.number().int().min(0).max(100),
  region: z.number().int().min(0).max(100),
  performance: z.number().int().min(0).max(100),
  availability: z.number().int().min(0).max(100),
});

export const moduleToggleSchema = z.object({
  moduleKey: z.string().trim().min(2).max(40),
  enabled: z.boolean(),
  cascade: z.boolean().optional().default(false),
});

/** zod hatasını kullanıcıya dönük tek satıra indirger. */
export function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Geçersiz giriş.";
}
