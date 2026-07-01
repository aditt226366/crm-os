ALTER TABLE public."Contact" ADD COLUMN IF NOT EXISTS "phoneRaw" TEXT;
ALTER TABLE public."Contact" ADD COLUMN IF NOT EXISTS "phoneNormalized" TEXT;
ALTER TABLE public."Contact" ADD COLUMN IF NOT EXISTS "waId" TEXT;
ALTER TABLE public."Contact" ADD COLUMN IF NOT EXISTS "last10" TEXT;
ALTER TABLE public."Contact" ADD COLUMN IF NOT EXISTS "countryCode" TEXT;

CREATE INDEX IF NOT EXISTS "Contact_tenantId_waId_idx" ON public."Contact"("tenantId", "waId");
CREATE INDEX IF NOT EXISTS "Contact_tenantId_phoneNormalized_idx" ON public."Contact"("tenantId", "phoneNormalized");
CREATE INDEX IF NOT EXISTS "Contact_tenantId_last10_idx" ON public."Contact"("tenantId", "last10");
