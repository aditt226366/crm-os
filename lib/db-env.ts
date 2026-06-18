function maskValue(value: string) {
  if (!value) return null;
  if (value.length <= 6) return `${value.slice(0, 2)}...`;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function maskHost(host: string) {
  const parts = host.split(".").filter(Boolean);
  if (parts.length >= 3) {
    return `${parts[0].slice(0, 6)}...${parts.slice(-2).join(".")}`;
  }
  return maskValue(host);
}

export function databaseEnvCheck() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    return {
      hasDatabaseUrl: false,
      databaseHostMasked: null,
      databaseUserMasked: null
    };
  }

  try {
    const parsed = new URL(databaseUrl);
    const username = decodeURIComponent(parsed.username || "");

    return {
      hasDatabaseUrl: true,
      databaseHostMasked: parsed.hostname ? maskHost(parsed.hostname) : null,
      databaseUserMasked: username ? maskValue(username) : null
    };
  } catch {
    return {
      hasDatabaseUrl: true,
      databaseHostMasked: "invalid-url",
      databaseUserMasked: null
    };
  }
}
