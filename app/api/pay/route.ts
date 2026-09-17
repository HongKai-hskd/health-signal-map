import { z } from "zod";
import {
  assessmentService,
  jsonError,
  readJson,
  readSessionId,
} from "../../../lib/route-utils";

const paymentPayloadSchema = z.object({ plan: z.literal("pulse_weekly") }).strict();

export async function POST(request: Request) {
  try {
    const sessionId = readSessionId(request);
    if (!sessionId) return Response.json({ error: "需要有效的测评会话。" }, { status: 401 });
    const payload = paymentPayloadSchema.parse(await readJson(request));
    const result = await assessmentService().pay(sessionId);
    return Response.json(
      { payment: { status: "confirmed", provider: "pulse_demo", plan: payload.plan }, result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonError(error);
  }
}
