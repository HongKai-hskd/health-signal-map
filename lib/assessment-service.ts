import {
  calculateHealthAssessment,
  healthInputSchema,
  mergeAssessmentData,
  redactHealthAssessment,
  STEP_KEYS,
  stepSchemas,
  type AssessmentData,
  type HealthAssessment,
  type PublicHealthResult,
  type StepKey,
} from "./domain";
import type { PaymentOrder, PaymentOrderStore } from "./payment-service";

export type SubscriptionStatus = "inactive" | "active";

export type SessionSnapshot = {
  id: string;
  userId: string;
  status: "in_progress" | "completed";
  currentStep: number;
  data: AssessmentData;
  createdAt: string;
  updatedAt: string;
};

export type AssessmentStore = {
  createSession(): Promise<SessionSnapshot>;
  getSession(sessionId: string): Promise<SessionSnapshot | null>;
  saveStep(sessionId: string, step: StepKey, data: AssessmentData): Promise<SessionSnapshot>;
  saveResult(sessionId: string, result: HealthAssessment): Promise<void>;
  getResult(sessionId: string): Promise<HealthAssessment | null>;
  getSubscriptionStatus(sessionId: string): Promise<SubscriptionStatus>;
};

export class AssessmentError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AssessmentError";
  }
}

export class AssessmentService {
  constructor(private readonly store: AssessmentStore) {}

  async getOrCreateSession(sessionId?: string) {
    if (sessionId) {
      const session = await this.store.getSession(sessionId);
      if (session) return { session, created: false };
    }
    return { session: await this.store.createSession(), created: true };
  }

  async startFreshSession() {
    return this.store.createSession();
  }

  async saveStep(sessionId: string, step: string, data: Record<string, unknown>) {
    if (!STEP_KEYS.includes(step as StepKey)) {
      throw new AssessmentError("未知的测评步骤。", 400);
    }
    const stepKey = step as StepKey;
    const parsed = stepSchemas[stepKey].parse(data);
    const session = await this.store.getSession(sessionId);
    if (!session) throw new AssessmentError("找不到测评会话。", 404);
    if (session.status === "completed") {
      throw new AssessmentError("这份测评已经完成，请重新开始新的测评。", 409);
    }
    return this.store.saveStep(sessionId, stepKey, parsed);
  }

  async complete(sessionId: string) {
    const session = await this.store.getSession(sessionId);
    if (!session) throw new AssessmentError("找不到测评会话。", 404);
    if (session.status === "completed") {
      const existing = await this.store.getResult(sessionId);
      if (existing) return existing;
    }
    const input = healthInputSchema.parse(session.data);
    const result = calculateHealthAssessment(input);
    await this.store.saveResult(sessionId, result);
    return result;
  }

  async getResults(sessionId: string): Promise<PublicHealthResult> {
    const result = await this.store.getResult(sessionId);
    if (!result) throw new AssessmentError("请先完成测评，再查看结果。", 409);
    const subscriptionStatus = await this.store.getSubscriptionStatus(sessionId);
    return redactHealthAssessment(sessionId, result, subscriptionStatus);
  }

}

export class InMemoryAssessmentStore implements AssessmentStore, PaymentOrderStore {
  private readonly sessions = new Map<
    string,
    { session: SessionSnapshot; steps: Map<StepKey, AssessmentData> }
  >();
  private readonly results = new Map<string, HealthAssessment>();
  private readonly subscriptions = new Map<string, SubscriptionStatus>();
  private readonly paymentOrders = new Map<string, PaymentOrder>();

  async createSession() {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const session: SessionSnapshot = {
      id,
      userId: crypto.randomUUID(),
      status: "in_progress",
      currentStep: 0,
      data: {},
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(id, { session, steps: new Map() });
    this.subscriptions.set(id, "inactive");
    return session;
  }

  async getSession(sessionId: string) {
    const entry = this.sessions.get(sessionId);
    if (!entry) return null;
    return this.snapshot(entry);
  }

  async saveStep(sessionId: string, step: StepKey, data: AssessmentData) {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new AssessmentError("找不到测评会话。", 404);
    if (entry.session.status === "completed") {
      throw new AssessmentError("这份测评已经完成，请重新开始新的测评。", 409);
    }
    entry.steps.set(step, data);
    entry.session.currentStep = Math.max(entry.session.currentStep, STEP_KEYS.indexOf(step) + 1);
    entry.session.updatedAt = new Date().toISOString();
    return this.snapshot(entry);
  }

  async saveResult(sessionId: string, result: HealthAssessment) {
    if (!this.sessions.has(sessionId)) throw new AssessmentError("找不到测评会话。", 404);
    this.results.set(sessionId, result);
    const entry = this.sessions.get(sessionId)!;
    entry.session.status = "completed";
    entry.session.currentStep = STEP_KEYS.length;
    entry.session.updatedAt = new Date().toISOString();
  }

  async getResult(sessionId: string) {
    return this.results.get(sessionId) ?? null;
  }

  async getSubscriptionStatus(sessionId: string) {
    return this.subscriptions.get(sessionId) ?? "inactive";
  }

  async createPaymentOrder(order: PaymentOrder) {
    const existing = [...this.paymentOrders.values()].find(
      (entry) => entry.sessionId === order.sessionId && entry.status === "pending",
    );
    if (existing) return { ...existing };
    this.paymentOrders.set(order.id, { ...order });
    return { ...order };
  }

  async getLatestPendingPaymentOrder(sessionId: string) {
    const orders = [...this.paymentOrders.values()]
      .filter((order) => order.sessionId === sessionId && order.status === "pending")
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return orders[0] ? { ...orders[0] } : null;
  }

  async getPaymentOrder(sessionId: string, orderId: string) {
    const order = this.paymentOrders.get(orderId);
    return order?.sessionId === sessionId ? { ...order } : null;
  }

  async getPaymentOrderByCheckoutToken(checkoutToken: string) {
    const order = [...this.paymentOrders.values()].find((entry) => entry.checkoutToken === checkoutToken);
    return order ? { ...order } : null;
  }

  async expirePaymentOrder(orderId: string, updatedAt: string) {
    const order = this.paymentOrders.get(orderId);
    if (!order) return null;
    if (order.status === "pending") {
      order.status = "expired";
      order.updatedAt = updatedAt;
    }
    return { ...order };
  }

  async confirmPaymentOrder(orderId: string, paidAt: string) {
    const order = this.paymentOrders.get(orderId);
    if (!order) return null;
    if (order.status === "pending") {
      if (Date.parse(order.expiresAt) <= Date.parse(paidAt)) {
        order.status = "expired";
        order.updatedAt = paidAt;
        return { ...order };
      }
      order.status = "paid";
      order.paidAt = paidAt;
      order.updatedAt = paidAt;
      this.subscriptions.set(order.sessionId, "active");
    }
    return { ...order };
  }

  private snapshot(entry: { session: SessionSnapshot; steps: Map<StepKey, AssessmentData> }) {
    return {
      ...entry.session,
      data: mergeAssessmentData([...entry.steps.values()]),
    };
  }
}
