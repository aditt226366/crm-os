export const SCRAP_DORMANT_TAG = "SCRAP_DORMANT";
export const SCRAP_FOLLOW_UP_ADAPTER = "scrap-follow-up";

export type ScrapFollowUpState = {
  followUpsSent?: number;
  followUp1SentAt?: string;
  followUp2SentAt?: string;
  dormantAt?: string;
  stoppedReason?: string;
  failures?: number;
  lastFailedAt?: string;
  lastFailureReason?: string;
  lastSkippedAt?: string;
  lastSkipReason?: string;
};

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function readScrapFollowUpState(customFields: unknown): ScrapFollowUpState {
  const value = asRecord(customFields).scrapFollowUp;
  return asRecord(value) as ScrapFollowUpState;
}

export function withScrapFollowUpState(customFields: unknown, state: ScrapFollowUpState) {
  return {
    ...asRecord(customFields),
    scrapFollowUp: state
  };
}

export function withoutScrapDormantTag(tags: string[]) {
  return tags.filter((tag) => tag !== SCRAP_DORMANT_TAG);
}

export function withScrapDormantTag(tags: string[]) {
  return Array.from(new Set([...tags, SCRAP_DORMANT_TAG]));
}
