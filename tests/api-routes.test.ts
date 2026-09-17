import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AssessmentService,
  InMemoryAssessmentStore,
} from "../lib/assessment-service";

const routeState = vi.hoisted(() => ({ service: null as AssessmentService | null }));

vi.mock("../lib/route-utils", async () => {
  const { AssessmentError } = await vi.importActual<typeof import("../lib/assessment-service")>("../lib/assessment-service");
  return {
    SESSION_COOKIE: "pulse_session",
    assessmentService: () => {
      if (!routeState.service) throw new Error("测试服务尚未初始化。");
      return routeState.service;
    },
    readSessionId: (request: Request) => {
      const match = (request.headers.get("cookie") ?? "").match(/(?:^|;\s*)pulse_session=([a-f0-9-]{20,})/i);
      return match?.[1];
    },
    appendSessionCookie: (headers: Headers, sessionId: string, request: Request) => {
      const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
      headers.append("Set-Cookie", `pulse_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`);
    },
    readJson: async (request: Request) => {
      try {
        return await request.json();
      } catch {
        throw new AssessmentError("请求内容必须是有效的 JSON。", 400);
      }
    },
    jsonError: (error: unknown) => {
      if (error instanceof AssessmentError) return Response.json({ error: error.message }, { status: error.status });
      if (error && typeof error === "object" && "issues" in error) {
        const issues = (error as { issues: Array<{ path: unknown[]; message: string }> }).issues;
        return Response.json({ error: "有些信息需要调整。", issues }, { status: 422 });
      }
      return Response.json({ error: "发生了一点问题，请再试一次。" }, { status: 500 });
    },
  };
});

type RouteHandler = (request: Request) => Promise<Response>;
let assessmentGet: RouteHandler;
let assessmentPatch: RouteHandler;
let complete: RouteHandler;
let reset: RouteHandler;
let results: RouteHandler;
let exportResults: RouteHandler;
let pay: RouteHandler;

beforeAll(async () => {
  ({ GET: assessmentGet, PATCH: assessmentPatch } = await import("../app/api/assessment/route"));
  ({ POST: complete } = await import("../app/api/assessment/complete/route"));
  ({ POST: reset } = await import("../app/api/assessment/reset/route"));
  ({ GET: results } = await import("../app/api/results/route"));
  ({ GET: exportResults } = await import("../app/api/results/export/route"));
  ({ POST: pay } = await import("../app/api/pay/route"));
});

function request(
  path: string,
  options: { method?: string; cookie?: string; body?: unknown | string } = {},
) {
  const headers = new Headers();
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  const body = typeof options.body === "string" ? options.body : options.body === undefined ? undefined : JSON.stringify(options.body);
  return new Request(`http://test.local${path}`, { method: options.method ?? "GET", headers, body });
}

async function readJson<T>(response: Response) {
  return (await response.json()) as T;
}

function cookieFrom(response: Response) {
  const value = response.headers.get("set-cookie");
  expect(value).toBeTruthy();
  return value!.split(";", 1)[0];
}

async function saveStep(cookie: string, step: string, data: Record<string, unknown>) {
  return assessmentPatch(request("/api/assessment", {
    method: "PATCH",
    cookie,
    body: { step, data },
  }));
}

describe("assessment API routes", () => {
  beforeEach(() => {
    routeState.service = new AssessmentService(new InMemoryAssessmentStore());
  });

  it("creates and resumes a cookie-bound session", async () => {
    const created = await assessmentGet(request("/api/assessment"));
    expect(created.status).toBe(200);
    const cookie = cookieFrom(created);
    const first = await readJson<{ session: { id: string }; resultReady: boolean }>(created);

    const resumed = await assessmentGet(request("/api/assessment", { cookie }));
    const second = await readJson<{ session: { id: string }; resultReady: boolean }>(resumed);

    expect(resumed.status).toBe(200);
    expect(second.session.id).toBe(first.session.id);
    expect(second.resultReady).toBe(false);
  });

  it("returns Chinese validation errors for missing cookie, malformed JSON and invalid step data", async () => {
    expect((await assessmentPatch(request("/api/assessment", { method: "PATCH", body: {} }))).status).toBe(401);
    expect((await exportResults(request("/api/results/export"))).status).toBe(401);

    const created = await assessmentGet(request("/api/assessment"));
    const cookie = cookieFrom(created);
    const malformed = await assessmentPatch(request("/api/assessment", { method: "PATCH", cookie, body: "{bad" }));
    expect(malformed.status).toBe(400);
    expect((await readJson<{ error: string }>(malformed)).error).toContain("JSON");

    const nullPayload = await assessmentPatch(request("/api/assessment", { method: "PATCH", cookie, body: "null" }));
    expect(nullPayload.status).toBe(400);

    const unknownStep = await saveStep(cookie, "unknown", {});
    expect(unknownStep.status).toBe(400);

    const invalidNumber = await saveStep(cookie, "body", { age: 15, heightCm: 168, weightKg: 76 });
    expect(invalidNumber.status).toBe(422);

    const missingField = await saveStep(cookie, "body", { age: 32, heightCm: 168 });
    expect(missingField.status).toBe(422);

    const unknownField = await saveStep(cookie, "body", { age: 32, heightCm: 168, weightKg: 76, debug: true });
    expect(unknownField.status).toBe(422);

    const arrayData = await assessmentPatch(request("/api/assessment", {
      method: "PATCH",
      cookie,
      body: { step: "body", data: [] },
    }));
    expect(arrayData.status).toBe(422);
  });

  it("keeps preview fields redacted, validates payment plans and blocks completed writes", async () => {
    expect((await results(request("/api/results"))).status).toBe(401);
    expect((await complete(request("/api/assessment/complete", { method: "POST", body: {} }))).status).toBe(401);

    const created = await assessmentGet(request("/api/assessment"));
    const cookie = cookieFrom(created);
    await saveStep(cookie, "identity", { gender: "woman" });
    await saveStep(cookie, "goal", { goal: "feel_lighter" });
    await saveStep(cookie, "activity", { activityLevel: "steady", exerciseDays: 3 });
    await saveStep(cookie, "body", { age: 32, heightCm: 168, weightKg: 76 });
    await saveStep(cookie, "target", { targetWeightKg: 68 });

    const completed = await complete(request("/api/assessment/complete", { method: "POST", cookie, body: {} }));
    expect(completed.status).toBe(200);
    const preview = await readJson<{ result: { access: string; details?: unknown; protected?: { locked: boolean; totalWeeks: number } } }>(completed);
    expect(preview.result.access).toBe("preview");
    expect(preview.result.details).toBeUndefined();
    expect(preview.result.protected?.locked).toBe(true);
    expect(preview.result.protected?.totalWeeks).toBe(18);

    const previewExport = await exportResults(request("/api/results/export", { cookie }));
    expect(previewExport.status).toBe(200);
    expect((await readJson<{ details?: unknown }>(previewExport)).details).toBeUndefined();

    const completedWrite = await saveStep(cookie, "body", { age: 33, heightCm: 168, weightKg: 75 });
    expect(completedWrite.status).toBe(409);

    const invalidPlan = await pay(request("/api/pay", { method: "POST", cookie, body: { plan: "not-a-plan" } }));
    expect(invalidPlan.status).toBe(422);

    const paid = await pay(request("/api/pay", { method: "POST", cookie, body: { plan: "pulse_weekly" } }));
    expect(paid.status).toBe(200);
    const full = await readJson<{ payment: { plan: string }; result: { access: string; details?: { curve: unknown[]; actionPlan: unknown[] } } }>(paid);
    expect(full.payment.plan).toBe("pulse_weekly");
    expect(full.result.access).toBe("full");
    expect(full.result.details?.curve.length).toBeGreaterThan(1);
    expect(full.result.details?.actionPlan.length).toBe(3);

    const repeatedPay = await pay(request("/api/pay", { method: "POST", cookie, body: { plan: "pulse_weekly" } }));
    expect(repeatedPay.status).toBe(200);
    expect((await readJson<{ result: { access: string } }>(repeatedPay)).result.access).toBe("full");

    const exported = await exportResults(request("/api/results/export", { cookie }));
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-disposition")).toContain("pulse-08-health-report.json");
    const exportedPayload = await readJson<{ access: string; details?: { actionPlan: unknown[] } }>(exported);
    expect(exportedPayload.access).toBe("full");
    expect(exportedPayload.details?.actionPlan.length).toBe(3);
  });

  it("creates a new cookie-bound session when resetting", async () => {
    const created = await assessmentGet(request("/api/assessment"));
    const oldCookie = cookieFrom(created);
    const oldSession = (await readJson<{ session: { id: string } }>(created)).session.id;

    const resetResponse = await reset(request("/api/assessment/reset", { method: "POST", cookie: oldCookie, body: {} }));
    const newCookie = cookieFrom(resetResponse);
    const resetPayload = await readJson<{ session: { id: string; status: string; currentStep: number }; resultReady: boolean }>(resetResponse);

    expect(resetPayload.session.id).not.toBe(oldSession);
    expect(resetPayload.session.status).toBe("in_progress");
    expect(resetPayload.session.currentStep).toBe(0);
    expect(resetPayload.resultReady).toBe(false);
    expect(newCookie).not.toBe(oldCookie);
  });
});
