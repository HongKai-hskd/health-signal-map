import { assessmentService, jsonError, readSessionId } from "../../../../lib/route-utils";

export async function GET(request: Request) {
  try {
    const sessionId = readSessionId(request);
    if (!sessionId) return Response.json({ error: "需要有效的测评会话。" }, { status: 401 });
    const result = await assessmentService().getResults(sessionId);
    return new Response(`${JSON.stringify(result, null, 2)}\n`, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": 'attachment; filename="pulse-08-health-report.json"',
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
