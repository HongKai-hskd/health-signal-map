import {
  appendSessionCookie,
  assessmentService,
  jsonError,
  readJson,
  readSessionId,
} from "../../../lib/route-utils";

export async function GET(request: Request) {
  try {
    const service = assessmentService();
    const { session, created } = await service.getOrCreateSession(readSessionId(request));
    const headers = new Headers({ "Cache-Control": "no-store" });
    if (created) appendSessionCookie(headers, session.id, request);
    return Response.json(
      { session, resultReady: session.status === "completed" },
      { headers },
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const sessionId = readSessionId(request);
    if (!sessionId) return Response.json({ error: "需要有效的测评会话。" }, { status: 401 });
    const payload = (await readJson(request)) as {
      step?: string;
      data?: Record<string, unknown>;
    };
    if (!payload.step || !payload.data || typeof payload.data !== "object") {
      return Response.json({ error: "step 和 data 都是必填项。" }, { status: 400 });
    }
    const session = await assessmentService().saveStep(sessionId, payload.step, payload.data);
    return Response.json({ session }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
