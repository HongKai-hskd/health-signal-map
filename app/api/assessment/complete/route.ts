import {
  assessmentService,
  jsonError,
  readSessionId,
} from "../../../../lib/route-utils";

export async function POST(request: Request) {
  try {
    const sessionId = readSessionId(request);
    if (!sessionId) return Response.json({ error: "需要有效的测评会话。" }, { status: 401 });
    const service = assessmentService();
    await service.complete(sessionId);
    const result = await service.getResults(sessionId);
    return Response.json(
      { sessionId, result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonError(error);
  }
}
