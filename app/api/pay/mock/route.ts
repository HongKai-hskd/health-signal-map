import { z } from "zod";
import {
  jsonError,
  paymentService,
  readJson,
} from "../../../../lib/route-utils";

const checkoutTokenSchema = z.string().uuid();
const confirmationSchema = z.object({ checkoutToken: checkoutTokenSchema }).strict();

export async function GET(request: Request) {
  try {
    const checkoutToken = checkoutTokenSchema.parse(new URL(request.url).searchParams.get("token"));
    const payment = await paymentService().getPayerCheckout(checkoutToken);
    return Response.json(
      { payment },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { checkoutToken } = confirmationSchema.parse(await readJson(request));
    const payment = await paymentService().confirmCheckout(checkoutToken);
    return Response.json(
      { payment: {
        orderNo: payment.orderNo,
        provider: payment.provider,
        plan: payment.plan,
        amountFen: payment.amountFen,
        status: payment.status,
        expiresAt: payment.expiresAt,
        paidAt: payment.paidAt,
      } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonError(error);
  }
}
