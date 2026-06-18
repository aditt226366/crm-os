# Deployment Notes

## Recover Failed Integration Migration

If production failed on `20260618120000_fix_integration_vault` with `P3018` and later restarts show `P3009`, mark the failed migration as rolled back once, then redeploy. Do not run `migrate reset`, delete production data, or drop existing tables.

PowerShell:

```powershell
$env:DATABASE_URL="postgresql://postgres.PROJECT_REF:PASSWORD@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=require"
$env:DIRECT_URL="postgresql://postgres.PROJECT_REF:PASSWORD@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=require"
npx prisma migrate resolve --rolled-back 20260618120000_fix_integration_vault
```

After it is marked rolled back, redeploy. The container runs:

```bash
npx prisma migrate deploy
```

and applies the corrected migration.

## Supabase SQL Editor Fallback

If `npx prisma migrate resolve --rolled-back` cannot be run, execute this once in the Supabase SQL Editor, then redeploy:

```sql
UPDATE "_prisma_migrations"
SET "rolled_back_at" = NOW()
WHERE "migration_name" = '20260618120000_fix_integration_vault'
  AND "finished_at" IS NULL
  AND "rolled_back_at" IS NULL;
```

For Supabase, `DATABASE_URL` can be the pooled runtime URL. `DIRECT_URL` must be the direct Supabase DB URL from Supabase -> Connect -> Direct connection. If direct connection is unreachable from the host, use the Supabase session pooler as a fallback, not the transaction pooler.
