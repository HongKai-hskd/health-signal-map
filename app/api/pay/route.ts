import { z } from "zod";
import {
  jsonError,
  paymentService,
  readJson,
  readSessionId,
} from "../../../lib/route-utils";
import { toPublicPaymentOrder } from "../../../lib/payment-service";

const paymentPayloadSchema = z.object({ plan: z.literal("pulse_weekly") }).strict();
const orderIdSchema = z.string().uuid();

export async function POST(request: Request) {
  try {
    const sessionId = readSessionId(request);
    if (!sessionId) return Response.json({ error: "需要有效的测评会话。" }, { status: 401 });
    const payload = paymentPayloadSchema.parse(await readJson(request));
    const checkout = await paymentService().createCheckout(sessionId);
    const checkoutUrl = new URL("/pay/mock", request.url);
    checkoutUrl.searchParams.set("token", checkout.checkoutToken);
    return Response.json(
      {
        payment: {
          ...toPublicPaymentOrder(checkout),
          plan: payload.plan,
          checkoutUrl: checkoutUrl.toString(),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET(request: Request) {
  try {
    const sessionId = readSessionId(request);
    if (!sessionId) return Response.json({ error: "需要有效的测评会话。" }, { status: 401 });
    const orderId = orderIdSchema.parse(new URL(request.url).searchParams.get("orderId"));
    const payment = await paymentService().getCheckout(sessionId, orderId);
    return Response.json(
      { payment: toPublicPaymentOrder(payment) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonError(error);
  }
}
