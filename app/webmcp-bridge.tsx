"use client";

import { useEffect } from "react";

type ModelContext = {
  registerTool: (
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: Record<string, unknown>;
      annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
      execute: (input: unknown) => unknown | Promise<unknown>;
    },
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};

type SessionPayload = {
  session: { id: string; currentStep: number; data: Record<string, unknown> };
  resultReady: boolean;
};
type StepPayload = { session: { id: string; currentStep: number } };
type CompletePayload = { sessionId: string; result: { access: string; sessionId: string } };
type PayPayload = { payment: { status: string }; result: { access: string; sessionId: string } };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    credentials: "same-origin",
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "请求没有完成。");
  return payload;
}

export function WebMcpBridge() {
  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const refreshVisibleState = () => window.location.reload();

    void Promise.resolve(context.registerTool({
      name: "read_pulse_session",
      title: "读取 pulse 会话",
      description: "读取当前浏览器会话中的 pulse/08 健康地图答案和进度。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      async execute() {
        const payload = await request<SessionPayload>("/api/assessment");
        return { sessionId: payload.session.id, currentStep: payload.session.currentStep, data: payload.session.data, resultReady: payload.resultReady };
      },
    }, { signal: lifecycle.signal })).catch(console.error);

    void Promise.resolve(context.registerTool({
      name: "save_pulse_step",
      title: "保存 pulse 步骤",
      description: "保存一个经过校验的 pulse/08 测评步骤，并更新当前页面。",
      inputSchema: {
        type: "object",
        properties: {
          step: { type: "string", enum: ["identity", "goal", "activity", "body", "target"] },
          data: { type: "object" },
        },
        required: ["step", "data"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        const payload = input as { step: string; data: Record<string, unknown> };
        const result = await request<StepPayload>("/api/assessment", { method: "PATCH", body: JSON.stringify(payload) });
        refreshVisibleState();
        return { saved: true, sessionId: result.session.id, currentStep: result.session.currentStep };
      },
    }, { signal: lifecycle.signal })).catch(console.error);

    void Promise.resolve(context.registerTool({
      name: "complete_pulse_assessment",
      title: "完成 pulse 测评",
      description: "运行服务端健康计算，并展示受保护的结果预览。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute() {
        const result = await request<CompletePayload>("/api/assessment/complete", { method: "POST", body: "{}" });
        refreshVisibleState();
        return { completed: true, access: result.result.access, sessionId: result.sessionId };
      },
    }, { signal: lifecycle.signal })).catch(console.error);

    void Promise.resolve(context.registerTool({
      name: "unlock_pulse_map",
      title: "解锁 pulse 地图",
      description: "运行 pulse/08 演示支付回调，展示当前会话的完整趋势。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute() {
        const result = await request<PayPayload>("/api/pay", { method: "POST", body: JSON.stringify({ plan: "pulse_weekly" }) });
        refreshVisibleState();
        return { paymentStatus: result.payment.status, access: result.result.access, sessionId: result.result.sessionId };
      },
    }, { signal: lifecycle.signal })).catch(console.error);

    return () => lifecycle.abort();
  }, []);

  return null;
}
