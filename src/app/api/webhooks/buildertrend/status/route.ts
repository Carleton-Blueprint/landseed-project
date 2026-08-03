/**
 * API Route: /api/webhooks/buildertrend/status
 * POST: Inbound BuilderTrend work-order status callback.
 *
 * Auth: HMAC-SHA256 signature over the raw request body, verified against
 * BUILDERTREND_WEBHOOK_SECRET. Header: X-BuilderTrend-Signature: sha256=<hex>.
 * There is no user session on this route — it's called by BuilderTrend, not
 * a signed-in browser.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  BuilderTrendStatusCallbackError,
  processBuilderTrendStatusCallback,
} from "@/backend/integrations/buildertrend";

function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.BUILDERTREND_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) {
    return false;
  }

  const provided = signatureHeader.startsWith("sha256=") ? signatureHeader.slice(7) : signatureHeader;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(provided, "hex");
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  if (!verifySignature(rawBody, request.headers.get("x-buildertrend-signature"))) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { externalReference, status, workOrderUrl } = (payload ?? {}) as Record<string, unknown>;

  if (typeof externalReference !== "string" || !externalReference.trim()) {
    return Response.json({ error: "externalReference is required" }, { status: 400 });
  }
  if (typeof status !== "string" || !status.trim()) {
    return Response.json({ error: "status is required" }, { status: 400 });
  }

  try {
    const result = await processBuilderTrendStatusCallback({
      externalReference,
      status,
      workOrderUrl: typeof workOrderUrl === "string" ? workOrderUrl : null,
      rawPayload: payload,
    });

    return Response.json(
      {
        received: true,
        matched: true,
        mapped: result.mapped,
        projectStatus: result.newProjectStatus ?? result.previousProjectStatus,
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof BuilderTrendStatusCallbackError) {
      // Acknowledge receipt even when we can't match it to a transfer, so
      // BuilderTrend doesn't treat this as a delivery failure and retry
      // indefinitely — the mismatch is already logged.
      return Response.json({ received: true, matched: false, error: error.message }, { status: 200 });
    }

    console.error("BuilderTrend status callback error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
