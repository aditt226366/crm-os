import { z } from "zod";
import {
  FEATURE_KEYS,
  INTEGRATION_TYPES,
  PLANS,
  TENANT_STATUSES,
  type FeatureKey,
  type IntegrationType
} from "@/lib/constants";
import { normalizeIntegrationType } from "@/lib/integrations/types";
import {
  COMPANY_LOGIN_PASSWORD_MAX_LENGTH,
  COMPANY_LOGIN_PASSWORD_MAX_MESSAGE,
  COMPANY_LOGIN_PASSWORD_MESSAGE,
  COMPANY_LOGIN_USERNAME_MESSAGE,
  COMPANY_LOGIN_USERNAME_PATTERN,
  isCompanyLoginPasswordValid
} from "@/lib/credential-policy";

const companySlugSchema = z
  .string()
  .min(2, "Company slug must be at least 2 characters.")
  .max(80, "Company slug must be 80 characters or fewer.")
  .regex(/^[a-z0-9-]+$/, "Company slug can use lowercase letters, numbers, and hyphens only.");

const loginUsernameSchema = z
  .string()
  .min(1, "Login Username is required")
  .max(120, "Login Username must be 120 characters or fewer.")
  .regex(COMPANY_LOGIN_USERNAME_PATTERN, COMPANY_LOGIN_USERNAME_MESSAGE);

const optionalCompanyPasswordSchema = z
  .string()
  .max(COMPANY_LOGIN_PASSWORD_MAX_LENGTH, COMPANY_LOGIN_PASSWORD_MAX_MESSAGE)
  .refine((value) => value === "" || isCompanyLoginPasswordValid(value), COMPANY_LOGIN_PASSWORD_MESSAGE)
  .optional();

export const loginSchema = z
  .object({
    username: z.string().trim().min(1).max(160).optional(),
    identifier: z.string().trim().min(1).max(160).optional(),
    password: z.string().min(1).max(200)
  })
  .transform((data, ctx) => {
    const username = (data.username ?? data.identifier ?? "").trim();
    if (!username) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["username"],
        message: "Username is required"
      });
    }

    return {
      username,
      password: data.password
    };
  });

export const companyCreateSchema = z
  .object({
    companyName: z.string().min(2).max(120),
    slug: companySlugSchema,
    ownerName: z.string().min(2).max(120).optional(),
    loginUsername: loginUsernameSchema.optional(),
    adminName: z.string().min(2).max(120).optional(),
    adminEmail: loginUsernameSchema.optional(),
    temporaryPassword: optionalCompanyPasswordSchema,
    phoneNumber: z.string().max(40).optional().or(z.literal("")),
    plan: z.enum(PLANS),
    status: z.enum(TENANT_STATUSES)
  })
  .transform((data, ctx) => {
    const ownerName = (data.ownerName ?? data.adminName ?? "").trim();
    const loginUsername = (data.loginUsername ?? data.adminEmail ?? "").trim();

    if (ownerName.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ownerName"],
        message: "Owner Name is required"
      });
    }

    if (!loginUsername) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["loginUsername"],
        message: "Login Username is required"
      });
    }

    return {
      ...data,
      ownerName,
      loginUsername
    };
  });

export const companyPatchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  slug: companySlugSchema.optional(),
  plan: z.enum(PLANS).optional(),
  status: z.enum(TENANT_STATUSES).optional()
});

export const resetPasswordSchema = z.object({
  temporaryPassword: z.string().min(1).max(120).optional().or(z.literal(""))
});

export const featureToggleSchema = z.object({
  enabled: z.boolean()
});

export const integrationPatchSchema = z.object({
  status: z.enum(["CONNECTED", "NOT_CONNECTED", "ERROR", "PARTIALLY_CONNECTED"]).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  maskedDisplay: z.record(z.string(), z.unknown()).optional()
});

export const manualReplySchema = z.object({
  body: z.string().trim().min(1).max(4096)
});

export const templateReplySchema = z.object({
  templateId: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(4096),
  variables: z.record(z.string(), z.unknown()).optional()
});

export const assignConversationSchema = z.object({
  userId: z.string().trim().min(1).max(160).nullable().optional()
});

export const humanTakeoverSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().trim().max(280).optional()
});

export const conversationNoteSchema = z.object({
  body: z.string().trim().min(1).max(2000)
});

export const whatsappWebhookMessageSchema = z.object({
  tenantId: z.string().optional(),
  from: z.string().min(6).max(40),
  name: z.string().max(160).optional(),
  body: z.string().min(1).max(4096),
  messageId: z.string().max(240).optional(),
  source: z.enum(["BROADCAST", "CAMPAIGN", "AD", "ORGANIC", "GOOGLE_SHEET", "MANUAL"]).optional(),
  sourceId: z.string().max(160).optional()
});

export function parseFeatureKey(value: string): FeatureKey {
  return z.enum(FEATURE_KEYS).parse(value);
}

export function parseIntegrationType(value: string): IntegrationType {
  return normalizeIntegrationType(value);
}
