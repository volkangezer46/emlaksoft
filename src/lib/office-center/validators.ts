/**
 * Ofis Merkezi giriş doğrulayıcıları
 */

import { z } from "zod";

export const addAdvisorSchema = z.object({
  fullName: z.string().min(2, "Ad en az 2 karakter olmalı"),
  phone: z.string().optional(),
  email: z.string().email("Geçerli e-posta yazın"),
  role: z.enum(["advisor", "team_lead", "branch_manager"]),
  branchId: z.string().optional(),
});

export type AddAdvisorInput = z.infer<typeof addAdvisorSchema>;

export const updateAdvisorSchema = z.object({
  fullName: z.string().min(2).optional(),
  role: z.string().optional(),
  isActive: z.boolean().optional(),
});

export type UpdateAdvisorInput = z.infer<typeof updateAdvisorSchema>;

export const assignFromPoolSchema = z.object({
  propertyIds: z.array(z.string()).min(1, "En az 1 portföy seçin"),
  advisorId: z.string().uuid(),
  assignmentRuleId: z.string().optional(),
});

export type AssignFromPoolInput = z.infer<typeof assignFromPoolSchema>;

export const slaDefinitionSchema = z.object({
  assignmentSLAHours: z.number().min(1).max(168), // 1 saat - 1 hafta
  escalationSLAHours: z.number().min(1).max(168),
  closureSLADays: z.number().min(1).max(365),
});

export type SLADefinitionInput = z.infer<typeof slaDefinitionSchema>;

export const commissionDefinitionSchema = z.object({
  advisorCommissionPercent: z.number().min(0).max(100),
  officeCommissionPercent: z.number().min(0).max(100),
  specialtyBonuses: z.record(z.string(), z.number()).optional(),
});

export type CommissionDefinitionInput = z.infer<typeof commissionDefinitionSchema>;

export const alertThresholdSchema = z.object({
  unassignedPropertyCount: z.number().min(1).max(1000),
  slaBreach: z.number().min(1).max(24),
  noActivityDays: z.number().min(1).max(90),
});

export type AlertThresholdInput = z.infer<typeof alertThresholdSchema>;
