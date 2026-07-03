import { NextRequest } from "next/server";
import { ApiError, errorResponse, json } from "@/lib/api";
import { requireFeature } from "@/lib/guards";
import { resolveContactForPhone } from "@/lib/contact-identity";
import { isValidNormalizedPhone, normalizePhone } from "@/lib/phone/normalizePhone";
import { ensureLeadWorkspaceSchema } from "@/lib/lead-workspace-schema";
import { safeCreateAuditLog } from "@/lib/audit";

type SubmittedContact = {
  name?: unknown;
  phone?: unknown;
  optIn?: unknown;
  source?: unknown;
  tags?: unknown;
};

function toBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    return ["true", "yes", "y", "1", "opted in", "opt-in"].includes(value.trim().toLowerCase());
  }
  return true;
}

function normalizeTags(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 12);
  }
  if (typeof value === "string") {
    return value.split(/[|;,]/).map((item) => item.trim()).filter(Boolean).slice(0, 12);
  }
  return [];
}

function validPhone(phone: string) {
  return isValidNormalizedPhone(normalizePhone(phone));
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireFeature(request, "CONTACTS");
    const tenantId = user.tenantId!;
    await ensureLeadWorkspaceSchema();

    const body = (await request.json()) as { contacts?: SubmittedContact[]; fileName?: unknown };
    const rows = Array.isArray(body.contacts) ? body.contacts : [];
    if (!rows.length) {
      throw new ApiError(400, "CSV_EMPTY", "No CSV contacts were submitted.");
    }
    if (rows.length > 5000) {
      throw new ApiError(413, "CSV_TOO_LARGE", "Import up to 5000 contacts at a time.");
    }

    const result = {
      imported: 0,
      updated: 0,
      skipped: 0,
      invalid: 0,
      optedOut: 0
    };
    const seen = new Set<string>();

    for (const row of rows) {
      const rawPhone = String(row.phone ?? "").trim();
      if (!rawPhone) {
        result.invalid += 1;
        result.skipped += 1;
        continue;
      }

      const phoneIdentity = normalizePhone(rawPhone);
      const phone = phoneIdentity.e164;
      if (!validPhone(phone)) {
        result.invalid += 1;
        result.skipped += 1;
        continue;
      }
      if (seen.has(phone)) {
        result.skipped += 1;
        continue;
      }
      seen.add(phone);

      const optIn = toBoolean(row.optIn);
      if (!optIn) result.optedOut += 1;
      const resolved = await resolveContactForPhone({
        tenantId,
        phone: rawPhone,
        name: String(row.name ?? "").trim() || phone,
        source: "MANUAL",
        optIn,
        tags: normalizeTags(row.tags),
        customFields: {
          importSource: "contacts_csv",
          importedFileName: typeof body.fileName === "string" ? body.fileName : null,
          sourceLabel: typeof row.source === "string" ? row.source : "CSV"
        }
      });

      if (!resolved.created) result.updated += 1;
      else result.imported += 1;
    }

    void safeCreateAuditLog({
      request,
      actorUserId: user.id,
      tenantId,
      action: "contacts.csv_imported",
      entityType: "Contact",
      newValue: result
    });

    return json({
      ok: true,
      result,
      message: `${result.imported} contacts imported, ${result.updated} updated, ${result.skipped} skipped.`
    });
  } catch (error) {
    return errorResponse(error);
  }
}
