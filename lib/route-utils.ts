import { z } from "zod";
import { AssessmentError, AssessmentService } from "./assessment-service";
import { D1AssessmentStore } from "./d1-store";
import { MockPaymentService } from "./payment-service";

export const SESSION_COOKIE = "pulse_session";

export function assessmentService() {
  return new AssessmentService(new D1AssessmentStore());
}

export function paymentService() {
  return new MockPaymentService(new D1AssessmentStore());
}

export function readSessionId(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([a-f0-9-]{20,})`, "i"),
  );
  return match?.[1];
}

export function appendSessionCookie(headers: Headers, sessionId: string, request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`,
  );
}

export function jsonError(error: unknown) {
  if (error instanceof AssessmentError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return Response.json(
      {
        error: "有些信息需要调整。",
        issues: error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
      },
      { status: 422 },
    );
  }
  console.error(error);
  return Response.json({ error: "发生了一点问题，请再试一次。" }, { status: 500 });
}

export async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new AssessmentError("请求内容必须是有效的 JSON。", 400);
  }
}
