const requiredAuthEnv = ["DATABASE_URL", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"] as const;

export function validateAuthEnv() {
  const missing = requiredAuthEnv.filter((key) => !process.env[key]?.trim());

  if (missing.length > 0) {
    console.error("[auth.env] Missing required auth env", { missing });
    return {
      ok: false,
      missing
    };
  }

  return {
    ok: true,
    missing: []
  };
}
