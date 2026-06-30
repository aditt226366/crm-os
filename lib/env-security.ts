const publicSecretPattern = /(DATABASE|DIRECT_URL|SERVICE_ROLE|ENCRYPTION|JWT|SECRET|TOKEN|API_KEY|PRIVATE_KEY|PASSWORD)/i;

export const serverOnlySecretEnvNames = [
  "DATABASE_URL",
  "DIRECT_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ENCRYPTION_KEY",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "WHATSAPP_ACCESS_TOKEN",
  "META_ACCESS_TOKEN",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_PRIVATE_KEY"
] as const;

export function publicSecretEnvNames(source: NodeJS.ProcessEnv = process.env) {
  return Object.keys(source)
    .filter((name) => name.startsWith("NEXT_PUBLIC_"))
    .filter((name) => publicSecretPattern.test(name.replace(/^NEXT_PUBLIC_/, "")))
    .sort();
}

export function assertNoPublicSecretEnv(source: NodeJS.ProcessEnv = process.env) {
  const exposedNames = publicSecretEnvNames(source);
  if (exposedNames.length) {
    throw new Error(
      `Server-only secrets must not use NEXT_PUBLIC_: ${exposedNames.join(", ")}`
    );
  }
}
