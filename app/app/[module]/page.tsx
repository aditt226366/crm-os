import { FeatureRoutePlaceholder } from "@/components/app/FeatureRoutePlaceholder";

export default async function Page({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  return <FeatureRoutePlaceholder module={module} />;
}

