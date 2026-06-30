import { z } from "zod";
import { assertNoPublicSecretEnv } from "./env-security";

const envSchema = z.object({
  DATABASE_URL: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(24).optional(),
  JWT_REFRESH_SECRET: z.string().min(24).optional(),
  ENCRYPTION_KEY: z.string().min(24).optional(),
  PLATFORM_ADMIN_EMAIL: z.string().email().optional(),
  PLATFORM_ADMIN_PASSWORD: z.string().min(8).optional(),
  APP_URL: z.string().url().default("http://127.0.0.1:3000"),
  CORS_ORIGIN: z.string().default("http://127.0.0.1:3000"),
  NODE_ENV: z.string().optional(),
  NEXT_PHASE: z.string().optional()
});

const productionEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().min(32),
  PLATFORM_ADMIN_EMAIL: z.string().email(),
  PLATFORM_ADMIN_PASSWORD: z.string().min(8),
  APP_URL: z.string().url(),
  CORS_ORIGIN: z.string().min(1)
});

const parsed = envSchema.safeParse(process.env);

assertNoPublicSecretEnv();

const isProductionRuntime =
  process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build";

if (isProductionRuntime) {
  const productionParsed = productionEnvSchema.safeParse(process.env);
  if (!productionParsed.success) {
    throw new Error(`Invalid production environment: ${productionParsed.error.message}`);
  }
}

const fallback = {
  JWT_ACCESS_SECRET: "local-access-secret-change-before-production-32",
  JWT_REFRESH_SECRET: "local-refresh-secret-change-before-production-32",
  ENCRYPTION_KEY: "local-encryption-secret-change-before-production-32",
  PLATFORM_ADMIN_EMAIL: "admin@example.com",
  PLATFORM_ADMIN_PASSWORD: "ChangeMe123!",
  APP_URL: "http://127.0.0.1:3000",
  CORS_ORIGIN: "http://127.0.0.1:3000"
};

export const env = {
  ...fallback,
  ...(parsed.success ? parsed.data : {}),
  isProduction: process.env.NODE_ENV === "production"
};
