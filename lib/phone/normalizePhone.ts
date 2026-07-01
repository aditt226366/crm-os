export type NormalizedPhone = {
  raw: string;
  e164: string;
  digits: string;
  waId: string;
  last10: string;
  countryCode: string;
};

function compactPhone(input: string) {
  return input
    .trim()
    .replace(/^whatsapp:/i, "")
    .replace(/[\s().-]+/g, "");
}

function countryCodeFromDigits(digits: string, defaultCountry: string) {
  if (defaultCountry.toUpperCase() === "IN" && digits.length === 12 && digits.startsWith("91")) {
    return "91";
  }
  if (digits.length > 10) {
    return digits.slice(0, -10);
  }
  return defaultCountry.toUpperCase() === "IN" ? "91" : "";
}

export function normalizePhone(input: string, defaultCountry = "IN"): NormalizedPhone {
  const raw = String(input ?? "");
  const compact = compactPhone(raw);
  const explicitPlus = compact.startsWith("+");
  const inputDigits = compact.replace(/\D/g, "");
  let digits = inputDigits;
  let countryCode = countryCodeFromDigits(digits, defaultCountry);

  if (defaultCountry.toUpperCase() === "IN") {
    if (digits.length === 10) {
      countryCode = "91";
      digits = `91${digits}`;
    } else if (digits.length === 11 && digits.startsWith("0")) {
      countryCode = "91";
      digits = `91${digits.slice(1)}`;
    } else if (digits.length === 12 && digits.startsWith("91")) {
      countryCode = "91";
    } else if (explicitPlus && digits.length === 10) {
      countryCode = "91";
      digits = `91${digits}`;
    }
  }

  if (!digits && inputDigits) {
    digits = inputDigits;
  }

  if (!countryCode) {
    countryCode = countryCodeFromDigits(digits, defaultCountry);
  }

  const e164 = digits ? `+${digits}` : "";
  const last10 = digits.slice(-10);

  return {
    raw,
    e164,
    digits,
    waId: digits,
    last10,
    countryCode
  };
}

export function normalizePhoneE164(input: string, defaultCountry = "IN") {
  return normalizePhone(input, defaultCountry).e164;
}

export function isValidNormalizedPhone(phone: NormalizedPhone) {
  return /^\+\d{7,15}$/.test(phone.e164);
}
