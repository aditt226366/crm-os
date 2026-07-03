import { FEATURE_DEFINITIONS, INTEGRATION_DEFINITIONS, type FeatureKey, type IntegrationType } from "@/lib/constants";

type DecimalLike = {
  toNumber?: () => number;
  toString: () => string;
};

export function money(value: DecimalLike | number) {
  if (typeof value === "number") {
    return value;
  }
  return value.toNumber ? value.toNumber() : Number(value.toString());
}

export function serializeFeature(feature: {
  id: string;
  featureKey: string;
  enabled: boolean;
  updatedAt: Date;
  updatedBy?: { name: string; email: string } | null;
}) {
  const key = feature.featureKey as FeatureKey;
  const definition = FEATURE_DEFINITIONS[key];
  return {
    id: feature.id,
    featureKey: key,
    name: definition.name,
    description: definition.description,
    navLabel: definition.navLabel,
    route: definition.route,
    enabled: feature.enabled,
    updatedAt: feature.updatedAt.toISOString(),
    updatedBy: feature.updatedBy
      ? { name: feature.updatedBy.name, email: feature.updatedBy.email }
      : null
  };
}

export function serializeIntegration(integration: {
  id: string;
  type: string;
  status: string;
  maskedDisplay: unknown;
  metadata?: unknown;
  lastVerifiedAt: Date | null;
  lastVerificationError: string | null;
  createdBy?: { name: string; email: string } | null;
  updatedBy?: { name: string; email: string } | null;
  updatedAt: Date;
  createdAt: Date;
}) {
  const type = integration.type as IntegrationType;
  const definition = INTEGRATION_DEFINITIONS[type];
  return {
    id: integration.id,
    type,
    name: definition.name,
    provider: definition.provider,
    description: definition.description,
    status: integration.status,
    maskedDisplay: integration.maskedDisplay,
    metadata: integration.metadata ?? null,
    lastVerifiedAt: integration.lastVerifiedAt?.toISOString() ?? null,
    lastVerificationError: integration.lastVerificationError,
    createdBy: integration.createdBy
      ? { name: integration.createdBy.name, email: integration.createdBy.email }
      : null,
    updatedBy: integration.updatedBy
      ? { name: integration.updatedBy.name, email: integration.updatedBy.email }
      : null,
    updatedAt: integration.updatedAt.toISOString(),
    createdAt: integration.createdAt.toISOString()
  };
}
