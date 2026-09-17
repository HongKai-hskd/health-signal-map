import {
  appendSessionCookie,
  assessmentService,
  jsonError,
} from "../../../../lib/route-utils";

export async function POST(request: Request) {
  try {
    const session = await assessmentService().startFreshSession();
    const headers = new Headers({ "Cache-Control": "no-store" });
    appendSessionCookie(headers, session.id, request);
    return Response.json(
      { session, resultReady: false },
      { headers },
    );
  } catch (error) {
    return jsonError(error);
  }
}
