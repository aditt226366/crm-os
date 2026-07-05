console.log("[cleanup.webhook-events]", {
  skipped: true,
  reason: "No WebhookEvent table exists in prisma/schema.prisma. Webhook payloads are stored compactly on Message records."
});
