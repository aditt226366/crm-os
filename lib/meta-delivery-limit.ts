const META_DELIVERY_LIMIT_RETRY_MS = 24 * 60 * 60 * 1000;
const META_DELIVERY_LIMIT_CODE = "131049";
const META_DELIVERY_LIMIT_STATUS = "META_DELIVERY_LIMITED";
const META_DELIVERY_LIMIT_DISPLAY = "Meta delivery-limited";

export type MetaDeliveryLimit = {
  status: typeof META_DELIVERY_LIMIT_STATUS;
  displayStatus: typeof META_DELIVERY_LIMIT_DISPLAY;
  temporarilyBlockedByMeta: true;
  retryAfter: string;
  detectedAt: string;
  reasonCode: typeof META_DELIVERY_LIMIT_CODE;
  reason: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function collectText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(collectText).join(" ");
  if (typeof value === "object") return Object.values(value).map(collectText).join(" ");
  return "";
}

export function isMetaDeliveryLimitError(value: unknown) {
  const text = collectText(value).toLowerCase();
  return text.includes(META_DELIVERY_LIMIT_CODE) || text.includes("healthy ecosystem engagement");
}

export function metaDeliveryLimitRetryAfter(base = new Date()) {
  return new Date(base.getTime() + META_DELIVERY_LIMIT_RETRY_MS);
}

export function createMetaDeliveryLimit({
  retryAfter = metaDeliveryLimitRetryAfter(),
  detectedAt = new Date(),
  reason
}: {
  retryAfter?: Date;
  detectedAt?: Date;
  reason?: string | null;
} = {}): MetaDeliveryLimit {
  return {
    status: META_DELIVERY_LIMIT_STATUS,
    displayStatus: META_DELIVERY_LIMIT_DISPLAY,
    temporarilyBlockedByMeta: true,
    retryAfter: retryAfter.toISOString(),
    detectedAt: detectedAt.toISOString(),
    reasonCode: META_DELIVERY_LIMIT_CODE,
    reason: reason?.trim() || "This message was not delivered to maintain healthy ecosystem engagement."
  };
}

export function withMetaDeliveryLimitMetadata(metadata: unknown, limit: MetaDeliveryLimit) {
  return {
    ...asRecord(metadata),
    metaDeliveryLimit: limit
  };
}

export function withContactMetaDeliveryLimit(customFields: unknown, limit: MetaDeliveryLimit, sourceMessageId?: string | null) {
  return {
    ...asRecord(customFields),
    metaDeliveryLimit: {
      ...limit,
      sourceMessageId: sourceMessageId ?? null
    }
  };
}

export function readMetaDeliveryLimit(metadata: unknown): MetaDeliveryLimit | null {
  const value = asRecord(asRecord(metadata).metaDeliveryLimit);
  if (value.status !== META_DELIVERY_LIMIT_STATUS || typeof value.retryAfter !== "string") {
    return null;
  }

  return {
    status: META_DELIVERY_LIMIT_STATUS,
    displayStatus: META_DELIVERY_LIMIT_DISPLAY,
    temporarilyBlockedByMeta: true,
    retryAfter: value.retryAfter,
    detectedAt: typeof value.detectedAt === "string" ? value.detectedAt : new Date().toISOString(),
    reasonCode: META_DELIVERY_LIMIT_CODE,
    reason: typeof value.reason === "string" ? value.reason : "Meta delivery-limited."
  };
}

export function activeMetaDeliveryLimit(metadata: unknown, now = new Date()) {
  const limit = readMetaDeliveryLimit(metadata);
  if (!limit) return null;
  return new Date(limit.retryAfter) > now ? limit : null;
}

export function activeMetaDeliveryLimitFromMessage(
  message: { metadata?: unknown; failureReason?: string | null; updatedAt?: Date; createdAt?: Date } | null | undefined,
  now = new Date()
) {
  if (!message) return null;

  const metadataLimit = activeMetaDeliveryLimit(message.metadata, now);
  if (metadataLimit) return metadataLimit;

  if (!isMetaDeliveryLimitError(message.failureReason)) return null;
  const base = message.updatedAt ?? message.createdAt ?? now;
  const retryAfter = metaDeliveryLimitRetryAfter(base);
  return retryAfter > now
    ? createMetaDeliveryLimit({
        retryAfter,
        detectedAt: base,
        reason: message.failureReason
      })
    : null;
}

export function metaDeliveryLimitReason(limit: MetaDeliveryLimit) {
  return `${META_DELIVERY_LIMIT_DISPLAY}. Retry after ${limit.retryAfter}.`;
}

export { META_DELIVERY_LIMIT_CODE, META_DELIVERY_LIMIT_DISPLAY, META_DELIVERY_LIMIT_STATUS };
