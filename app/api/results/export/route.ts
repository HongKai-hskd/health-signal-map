import { assessmentService, jsonError, readSessionId } from "../../../../lib/route-utils";
import { renderMarkdownReport } from "../../../../lib/domain";

export async function GET(request: Request) {
  try {
    const sessionId = readSessionId(request);
    if (!sessionId) return Response.json({ error: "需要有效的测评会话。" }, { status: 401 });
    const result = await assessmentService().getResults(sessionId);
    return new Response(renderMarkdownReport(result), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": 'attachment; filename="pulse-08-health-report.md"',
        "Content-Type": "text/markdown; charset=utf-8",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
