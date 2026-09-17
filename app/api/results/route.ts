import {
  assessmentService,
  jsonError,
  readSessionId,
} from "../../../lib/route-utils";

export async function GET(request: Request) {
  try {
    const sessionId = readSessionId(request);
    if (!sessionId) return Response.json({ error: "需要有效的测评会话。" }, { status: 401 });
    const result = await assessmentService().getResults(sessionId);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
