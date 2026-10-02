import { z } from "zod";

export const CLIENT_ERROR_LIMITS = {
  message: 500,
  digest: 160,
  stack: 4_000,
  path: 300,
} as const;

export function sanitizeClientErrorPath(value: string): string | null {
  const trimmed = value.trim();
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(trimmed)
  ) {
    return null;
  }
  const pathOnly = trimmed.split(/[?#]/, 1)[0];
  return pathOnly.slice(0, CLIENT_ERROR_LIMITS.path) || "/";
}

const pathSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .refine((value) => sanitizeClientErrorPath(value) !== null, "Geçersiz hata yolu.")
  .transform((value) => sanitizeClientErrorPath(value)!);

const clientErrorReportSchema = z
  .object({
    message: z.string().trim().min(1).max(CLIENT_ERROR_LIMITS.message),
    digest: z.string().trim().min(1).max(CLIENT_ERROR_LIMITS.digest).optional(),
    stack: z.string().trim().min(1).max(CLIENT_ERROR_LIMITS.stack).optional(),
    path: pathSchema.optional(),
  })
  .strict();

export type ClientErrorReport = z.infer<typeof clientErrorReportSchema>;

export function parseClientErrorReport(input: unknown): ClientErrorReport | null {
  const parsed = clientErrorReportSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
