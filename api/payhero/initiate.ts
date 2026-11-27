const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const PAYHERO_BASE_URL = "https://backend.payhero.co.ke";

function parseBody(req: { body?: unknown }): Record<string, unknown> {
  const raw = req.body;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

type PhoneValidationResult = {
  isValid: boolean;
  error?: string;
  normalized?: string;
};

function validateAndNormalizePhone(phone: string | undefined | null): PhoneValidationResult {
  if (!phone || !String(phone).trim()) {
    return { isValid: false, error: "Please enter your phone number" };
  }

  const raw = String(phone).trim();
  const cleaned = raw.replace(/\D/g, "");

  if (!cleaned) {
    return { isValid: false, error: "Phone number must contain digits only" };
  }

  // Handle +2540... or 2540... (13 digits: e.g. +25407... or +25401...)
  if (cleaned.startsWith("2540")) {
    if (cleaned.length < 13) {
      return {
        isValid: false,
        error: `Phone number is too short (${cleaned.length}/13 digits for 2540 format). Expected complete Kenyan number.`,
      };
    }
    if (cleaned.length > 13) {
      return {
        isValid: false,
        error: `Phone number is too long (${cleaned.length}/13 digits). Please check the digits entered.`,
      };
    }
    const prefix = cleaned.charAt(4);
    if (prefix !== "7" && prefix !== "1") {
      return {
        isValid: false,
        error: "Invalid phone prefix. Kenyan mobile numbers start with 07 or 01 (e.g. 07... or 01...).",
      };
    }
    return { isValid: true, normalized: "254" + cleaned.slice(4) };
  }

  // Handle international format starting with 254 (12 digits, e.g. 2547XXXXXXXX or 2541XXXXXXXX)
  if (cleaned.startsWith("254")) {
    if (cleaned.length === 11) {
      return { isValid: true, normalized: cleaned };
    }
    if (cleaned.length < 12) {
      return {
        isValid: false,
        error: `Phone number is too short (${cleaned.length}/12 digits for 254 format). Expected 12 digits (e.g. 2547XXXXXXXX or 2541XXXXXXXX).`,
      };
    }
    if (cleaned.length > 12) {
      return {
        isValid: false,
        error: `Phone number is too long (${cleaned.length}/12 digits for 254 format). Please check the digits entered.`,
      };
    }
    const prefix = cleaned.charAt(3);
    if (prefix !== "7" && prefix !== "1") {
      return {
        isValid: false,
        error: "Invalid prefix after 254. Kenyan mobile numbers must start with 2547... or 2541...",
      };
    }
    return { isValid: true, normalized: cleaned };
  }

  // Handle local format starting with 0 (10 digits, e.g. 07XXXXXXXX or 01XXXXXXXX)
  if (cleaned.startsWith("0")) {
    const secondDigit = cleaned.charAt(1);
    if (secondDigit !== "7" && secondDigit !== "1") {
      return {
        isValid: false,
        error: "Invalid prefix. Kenyan mobile numbers must start with 07 or 01 (e.g. 07XXXXXXXX or 01XXXXXXXX).",
      };
    }
    if (cleaned.length < 10) {
      return {
        isValid: false,
        error: `Phone number is too short (${cleaned.length}/10 digits). Standard mobile numbers have 10 digits (e.g. 07XXXXXXXX or 01XXXXXXXX).`,
      };
    }
    if (cleaned.length > 10) {
      return {
        isValid: false,
        error: `Phone number is too long (${cleaned.length}/10 digits). Standard mobile numbers have 10 digits (e.g. 07XXXXXXXX or 01XXXXXXXX).`,
      };
    }
    return { isValid: true, normalized: "254" + cleaned.slice(1) };
  }

  // Handle 9-digit format without leading 0 (e.g. 7XXXXXXXX or 1XXXXXXXX)
  if (cleaned.startsWith("7") || cleaned.startsWith("1")) {
    if (cleaned.length < 9) {
      return {
        isValid: false,
        error: `Phone number is too short (${cleaned.length}/9 digits). Standard format is 7XXXXXXXX or 1XXXXXXXX (or 07... / 01...).`,
      };
    }
    if (cleaned.length > 9) {
      return {
        isValid: false,
        error: `Phone number is too long (${cleaned.length}/9 digits). Please check the digits entered.`,
      };
    }
    return { isValid: true, normalized: "254" + cleaned };
  }

  return {
    isValid: false,
    error: "Invalid phone format. Kenyan phone numbers must start with 07, 01, 254, or +254 (e.g. 0712345678 or 0180640161).",
  };
}

// Hardcoded PayHero credentials for channel 15855. Env vars take precedence.
const PAYHERO_AUTH_HEADER =
  process.env.PAYHERO_AUTH_TOKEN ||
  "Basic QkdjckhSTDEzTlQzWWU0UElvb0o6WFREM3VQMDRIY1hTS0VrMjNkY3loc2M5M0cza0d5QlhpbkxtMnRTRw==";
const PAYHERO_CHANNEL_ID = Number(process.env.PAYHERO_CHANNEL_ID) || 15855;

function getAuthHeader(): string {
  return PAYHERO_AUTH_HEADER;
}

function getChannelId(): number {
  return PAYHERO_CHANNEL_ID;
}

function extractReference(data: Record<string, unknown>): string | null {
  const direct =
    data.reference ??
    data.Reference ??
    data.checkoutId ??
    data.checkoutRequestId ??
    data.CheckoutRequestID;

  if (typeof direct === "string" && direct.trim()) return direct;

  const nested = data.data;
  if (nested && typeof nested === "object") {
    const nestedObj = nested as Record<string, unknown>;
    const nestedRef =
      nestedObj.reference ??
      nestedObj.Reference ??
      nestedObj.checkoutId ??
      nestedObj.checkoutRequestId ??
      nestedObj.CheckoutRequestID;
    if (typeof nestedRef === "string" && nestedRef.trim()) return nestedRef;
  }

  return null;
}

export default async function handler(req: any, res: any) {
  Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const authHeader = getAuthHeader();
  const channelId = getChannelId();

  if (!authHeader || !channelId) {
    return res.status(500).json({
      success: false,
      message:
        "PayHero is not configured. Set PAYHERO_AUTH_TOKEN (or PAYHERO_API_USERNAME + PAYHERO_API_PASSWORD) and PAYHERO_CHANNEL_ID.",
    });
  }

  try {
    const body = parseBody(req);
    const rawPhone =
      (typeof body.phone === "string" ? body.phone : undefined) ??
      (typeof body.phoneNumber === "string" ? body.phoneNumber : undefined) ??
      (typeof body.phone_number === "string" ? body.phone_number : undefined) ??
      (typeof body.msisdn === "string" ? body.msisdn : undefined);

    const phoneValidation = validateAndNormalizePhone(rawPhone);
    if (!phoneValidation.isValid) {
      return res.status(400).json({ success: false, message: phoneValidation.error });
    }
    const normalizedPhone = phoneValidation.normalized!;

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: "Invalid amount" });
    }

    const referencePrefix =
      typeof body.referencePrefix === "string" ? body.referencePrefix : "SURVEYKE";
    const externalReference =
      typeof body.reference === "string"
        ? body.reference
        : `${referencePrefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const payload = {
      amount: Math.round(amount),
      phone_number: normalizedPhone,
      channel_id: channelId,
      provider: "m-pesa",
      external_reference: externalReference,
      customer_name: typeof body.customer_name === "string" ? body.customer_name : undefined,
      description:
        typeof body.description === "string" ? body.description : "Survey unlock payment",
    };

    const payheroRes = await fetch(`${PAYHERO_BASE_URL}/api/v2/payments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(payload),
    });

    const data = (await payheroRes.json().catch(() => null)) as Record<string, unknown> | null;

    if (!payheroRes.ok || !data) {
      return res.status(payheroRes.status || 500).json({
        success: false,
        message:
          (typeof data?.error_message === "string" ? data.error_message : null) ??
          (typeof data?.message === "string" ? data.message : null) ??
          (typeof data?.error === "string" ? data.error : null) ??
          "Payment initiation failed",
        raw: data,
      });
    }

    const checkoutId = extractReference(data);
    const success =
      data.success === true ||
      String(data.status ?? "").toLowerCase() === "success" ||
      Boolean(checkoutId);

    if (!success || !checkoutId) {
      return res.status(400).json({
        success: false,
        message:
          (typeof data.message === "string" ? data.message : null) ??
          "Payment initiation failed",
        raw: data,
      });
    }

    return res.status(200).json({
      success: true,
      checkoutId,
      checkoutRequestId: checkoutId,
      reference: externalReference,
      normalizedPhone: normalizedPhone,
      message: typeof data.message === "string" ? data.message : "STK push initiated",
      raw: data,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Payment initiation failed";
    return res.status(500).json({ success: false, message });
  }
}
