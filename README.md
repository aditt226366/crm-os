# WhatsApp AI CRM OS

Premium multi-tenant WhatsApp AI CRM SaaS scaffold with a dark neon landing page, animated auth flow, platform admin console, tenant feature controls, integration metadata, and API usage tracking.

## Current Scope

- Next.js App Router, TypeScript, Tailwind CSS, Framer Motion, React Three Fiber.
- Landing page with one continuous scroll-synced blue particle orb in `components/visuals/ScrollOrbScene.tsx`.
- Animated `/login` page with separate Platform Admin and Company/User login flows.
- Role-aware auth foundation with httpOnly cookies, short access tokens, refresh token rotation, bcrypt password hashing, Zod validation, rate-limited login, audit logging, and secure headers.
- Prisma/PostgreSQL models for users, tenants, tenant features, integrations, usage logs, audit logs, and refresh tokens.
- Platform admin routes:
  - `/admin`
  - `/admin/companies`
  - `/admin/features`
  - `/admin/integrations`
  - `/admin/billing`
  - `/admin/audit-logs`
  - `/admin/settings`
- Company placeholder route at `/app/dashboard` that only shows backend-enabled features.
- Backend feature guards for `/api/ads`, `/api/bulk-messaging`, `/api/campaigns`, `/api/workflows`, and `/api/leads`.

## Setup

```bash
npm install
copy .env.example .env
```

Set real values in `.env`, especially:

```bash
DATABASE_URL=
DIRECT_URL=
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
ENCRYPTION_KEY=
PLATFORM_ADMIN_EMAIL=
PLATFORM_ADMIN_PASSWORD=
APP_URL=
CORS_ORIGIN=
```

If using Supabase, `DATABASE_URL` can be the pooled/runtime URL, but `DIRECT_URL` must be the direct Supabase DB URL from Supabase -> Connect -> Direct connection. If direct connection is unreachable from the host, use the Supabase session pooler as a fallback, not the transaction pooler.

Then initialize Prisma:

```bash
npm run prisma:generate
npm run db:push
npm run db:seed
```

The seed creates one platform admin from `.env`, three sample companies, default plan-based feature settings, sample integrations, usage logs, and audit logs.

## Run Locally

```bash
npm run dev
```

Open `http://127.0.0.1:3000`.

On this Windows machine, `npm.ps1` may be blocked by execution policy. Use `cmd /c npm ...` if needed:

```bash
cmd /c npm run dev
cmd /c npm run build
```

## Production Check

```bash
cmd /c npm run typecheck
cmd /c npm run lint
cmd /c npm run build
cmd /c npm run start -- --hostname 127.0.0.1 --port 3000
```

## Security Notes

- Company-created temporary passwords are shown once in the UI and only password hashes are stored.
- Raw integration secrets are encrypted at rest and never returned from admin APIs.
- Tenant deactivation blocks company login, refresh rotation, active tenant API access, and feature-protected routes.
- Feature toggles are enforced in both the workspace UI and backend middleware.
