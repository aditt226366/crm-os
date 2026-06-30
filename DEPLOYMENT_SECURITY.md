# Deployment Security

This CRM uses Next.js API routes with a Prisma backend. The frontend must never query Supabase tables directly. All reads and writes must go through authenticated backend API routes so tenant checks, feature guards, audit logging, encryption, and rate limits remain enforceable.

## Server-Only Secrets

Do not expose these values to browser code:

- `DATABASE_URL`
- `DIRECT_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ENCRYPTION_KEY`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- WhatsApp, Meta, Google, OpenAI, Anthropic, or other API tokens and private keys

No secret env var may start with `NEXT_PUBLIC_`. `NEXT_PUBLIC_` values are bundled for the browser. Public variables may only contain non-secret identifiers or display configuration.

The app includes a startup safety check that fails when a `NEXT_PUBLIC_` env var name looks like a secret, token, key, password, database URL, or private key.

## Supabase RLS Baseline

Enable Row Level Security on every table in the `public` schema:

```sql
ALTER TABLE public."Tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TenantFeature" ENABLE ROW LEVEL SECURITY;
-- Repeat for every public table created by Prisma migrations.
```

Revoke direct table access from Supabase browser roles:

```sql
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
```

Do not create allow-all policies such as `USING (true)` or `WITH CHECK (true)`. This application is designed for backend-only data access through Prisma, not direct Supabase client access from the frontend.

## New Table Checklist

Every new database table must have RLS enabled in the same migration that creates it:

```sql
CREATE TABLE public."Example" (...);
ALTER TABLE public."Example" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."Example" FROM anon, authenticated;
```

Before deploying a migration, confirm:

- RLS is enabled for the new table.
- `anon` and `authenticated` have no direct grants.
- No allow-all policies were created.
- The frontend uses API routes, not Supabase table queries.

## Admin Diagnostic

Platform admins can inspect the current Supabase RLS posture with:

```http
GET /api/admin/security/supabase-rls
```

The endpoint returns metadata only:

- public tables with RLS disabled
- whether `anon` or `authenticated` have table grants
- names of any `NEXT_PUBLIC_` env vars that look like secrets

It never returns secret values, database URLs, service-role keys, JWT secrets, encryption keys, or API tokens.

## Docker Runtime

Keep the production container command as:

```dockerfile
CMD ["npm", "start"]
```

Do not replace it with a command that exposes build-time secrets or runs ad-hoc migration/debug scripts at container startup.
