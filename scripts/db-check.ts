import { prisma } from "../lib/prisma";

async function main() {
  const schemaRows = await prisma.$queryRawUnsafe<Array<{ schema: string | null }>>(
    "select current_schema() as schema"
  );
  const schema = schemaRows[0]?.schema ?? "public";
  const tables = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
    `select table_name from information_schema.tables where table_schema = '${schema}' order by table_name`
  );
  console.log(JSON.stringify({ schema, tables }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
