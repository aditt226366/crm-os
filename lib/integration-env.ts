const requiredMetaEmbeddedSignupEnv = [
  "NEXT_PUBLIC_META_APP_ID",
  "NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID",
  "META_APP_SECRET",
  "META_GRAPH_VERSION",
  "APP_URL",
  "WHATSAPP_VERIFY_TOKEN"
] as const;

export function validateMetaEmbeddedSignupEnv() {
  const missing = requiredMetaEmbeddedSignupEnv.filter((key) => !process.env[key]?.trim());

  if (missing.length > 0) {
    console.error("[integration.env] Missing required Meta Embedded Signup env", { missing });
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
