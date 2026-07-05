import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function retentionDate(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function main() {
  const auditRetentionDays = Number(process.env.AUDIT_LOG_RETENTION_DAYS ?? 90);
  const before = retentionDate(Number.isFinite(auditRetentionDays) ? auditRetentionDays : 90);
  const deletedAuditLogs = await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: before } }
  });

  console.log("[cleanup.logs]", {
    auditRetentionDays,
    auditBefore: before.toISOString(),
    deletedAuditLogs: deletedAuditLogs.count
  });
}

main()
  .catch((error) => {
    console.error("[cleanup.logs] failed", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
