import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../lib/prisma";

function splitStatements(sql: string) {
  return sql
    .replace(/\r\n/g, "\n")
    .split(/;\n/)
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => (statement.endsWith(";") ? statement.slice(0, -1).trim() : statement));
}

async function main() {
  const file = resolve(process.cwd(), "artifacts/schema-from-empty.sql");
  const sql = readFileSync(file, "utf8");
  const statements = splitStatements(sql);

  for (const [index, statement] of statements.entries()) {
    const label = statement.split("\n").find((line) => line.trim() && !line.trim().startsWith("--"))?.slice(0, 90);
    console.log(`[${index + 1}/${statements.length}] ${label}`);
    await prisma.$executeRawUnsafe(statement);
  }

  console.log(`Applied ${statements.length} schema statements.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
