import crypto from "crypto";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Payhero-Signature",
};

function parseBody(req: any): { raw: string; json: Record<string, unknown> } {
  if (typeof req.body === "string") {
    try {
      return { raw: req.body, json: JSON.parse(req.body) };
    } catch {
      return { raw: req.body, json: {} };
    }
  }
  if (req.body && typeof req.body === "object") {
    return { raw: JSON.stringify(req.body), json: req.body };
  }
  return { raw: "", json: {} };
}

export default async function handler(req: any, res: any) {
  Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const webhookSecret = process.env.PAYHERO_WEBHOOK_SECRET;
  const { raw, json } = parseBody(req);

  // If secret is set, verify HMAC-SHA256 signature
  if (webhookSecret && webhookSecret.trim()) {
    const signatureHeader =
      (req.headers["x-payhero-signature"] as string) ||
      (req.headers["X-Payhero-Signature"] as string) ||
      "";

    if (!signatureHeader) {
      return res.status(401).json({ message: "Missing X-Payhero-Signature header" });
    }

    const expectedSignature =
      "sha256=" + crypto.createHmac("sha256", webhookSecret).update(raw).digest("hex");

    try {
      const valid = crypto.timingSafeEqual(
        Buffer.from(signatureHeader),
        Buffer.from(expectedSignature)
      );
      if (!valid) {
        return res.status(401).json({ message: "Invalid signature" });
      }
    } catch {
      return res.status(401).json({ message: "Signature verification failed" });
    }
  }

  // PayHero sends status in json.status — map to success
  const rawStatus = String(json.status ?? json.Status ?? "").toUpperCase();
  const isSuccess =
    rawStatus === "SUCCESS" || rawStatus === "COMPLETED" || rawStatus === "PAID" ||
    json.success === true;

  const checkoutRequestId =
    (typeof json.reference === "string" ? json.reference : null) ??
    (typeof json.checkoutId === "string" ? json.checkoutId : null) ??
    (typeof json.CheckoutRequestID === "string" ? json.CheckoutRequestID : null);

  const transactionReceipt =
    (typeof json.provider_reference === "string" ? json.provider_reference : null) ??
    (typeof json.third_party_reference === "string" ? json.third_party_reference : null) ??
    (typeof json.payment_reference === "string" ? json.payment_reference : null);

  // If Supabase server keys exist, update database records
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseKey && isSuccess && checkoutRequestId) {
    try {
      await fetch(
        `${supabaseUrl}/rest/v1/mpesa_payments?checkout_request_id=eq.${encodeURIComponent(checkoutRequestId)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            status: "completed",
            mpesa_receipt_number: transactionReceipt,
          }),
        }
      );
    } catch (dbErr) {
      console.error("Failed to update Supabase in webhook:", dbErr);
    }
  }

  return res.status(200).json({
    received: true,
    success: isSuccess,
    checkoutRequestId,
    receipt: transactionReceipt,
  });
}
