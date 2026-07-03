import { Suspense } from "react";
import { LeadManagementPage } from "@/components/app/leads/LeadManagementPage";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function Page({ searchParams }: { searchParams?: PageSearchParams }) {
  const params = await searchParams;
  const initialSearch = firstParam(params?.search) || firstParam(params?.q);

  return (
    <Suspense key={initialSearch} fallback={<LoadingSkeleton rows={8} />}>
      <LeadManagementPage initialSearch={initialSearch} />
    </Suspense>
  );
}
