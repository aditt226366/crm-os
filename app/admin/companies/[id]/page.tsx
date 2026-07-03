import { CompanyWorkspace } from "@/components/admin/CompanyWorkspace";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CompanyWorkspace companyId={id} />;
}
