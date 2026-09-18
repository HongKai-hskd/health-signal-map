import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  assessmentSessions,
  assessmentSteps,
  healthResults,
  paymentOrders,
  subscriptions,
  users,
} from "../db/schema";
import {
  createActionPlan,
  createAdjustmentGuide,
  createPhasePlan,
  mergeAssessmentData,
  type AssessmentData,
  type HealthAssessment,
  type HealthInput,
  type StepKey,
} from "./domain";
import {
  AssessmentError,
  type AssessmentStore,
  type SessionSnapshot,
  type SubscriptionStatus,
} from "./assessment-service";
import type {
  PaymentOrder,
  PaymentOrderStore,
} from "./payment-service";

export class D1AssessmentStore implements AssessmentStore, PaymentOrderStore {
  private readonly db = getDb();

  async createSession(): Promise<SessionSnapshot> {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const userId = crypto.randomUUID();
    await this.db.batch([
      this.db.insert(users).values({ id: userId, anonymousKey: userId }),
      this.db.insert(assessmentSessions).values({
        id,
        userId,
        status: "in_progress",
        currentStep: 0,
        createdAt: now,
        updatedAt: now,
      }),
      this.db.insert(subscriptions).values({ sessionId: id, status: "inactive" }),
    ]);
    return {
      id,
      userId,
      status: "in_progress",
      currentStep: 0,
      data: {},
      createdAt: now,
      updatedAt: now,
    };
  }

  async getSession(sessionId: string): Promise<SessionSnapshot | null> {
    const [session] = await this.db
      .select()
      .from(assessmentSessions)
      .where(eq(assessmentSessions.id, sessionId))
      .limit(1);
    if (!session) return null;

    const rows = await this.db
      .select()
      .from(assessmentSteps)
      .where(eq(assessmentSteps.sessionId, sessionId))
      .orderBy(asc(assessmentSteps.id));
    const data = mergeAssessmentData(
      rows.map((row) => JSON.parse(row.payloadJson) as AssessmentData),
    );
    return {
      id: session.id,
      userId: session.userId,
      status: session.status,
      currentStep: session.currentStep,
      data,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  async saveStep(sessionId: string, step: StepKey, data: AssessmentData) {
    const now = new Date().toISOString();
    const stepIndex = ["identity", "goal", "activity", "body", "target"].indexOf(step) + 1;
    const [session] = await this.db
      .select({ id: assessmentSessions.id, status: assessmentSessions.status })
      .from(assessmentSessions)
      .where(eq(assessmentSessions.id, sessionId))
      .limit(1);
    if (!session) throw new AssessmentError("找不到测评会话。", 404);
    if (session.status === "completed") {
      throw new AssessmentError("这份测评已经完成，请重新开始新的测评。", 409);
    }

    await this.db.batch([
      this.db
        .insert(assessmentSteps)
        .values({ sessionId, stepKey: step, payloadJson: JSON.stringify(data), updatedAt: now })
        .onConflictDoUpdate({
          target: [assessmentSteps.sessionId, assessmentSteps.stepKey],
          set: { payloadJson: JSON.stringify(data), updatedAt: now },
        }),
      this.db
        .update(assessmentSessions)
        .set({
          currentStep: sql`max(${assessmentSessions.currentStep}, ${stepIndex})`,
          updatedAt: now,
        })
        .where(eq(assessmentSessions.id, sessionId)),
    ]);
    return (await this.getSession(sessionId))!;
  }

  async saveResult(sessionId: string, result: HealthAssessment) {
    const now = new Date().toISOString();
    const [session] = await this.db
      .select({ id: assessmentSessions.id })
      .from(assessmentSessions)
      .where(eq(assessmentSessions.id, sessionId))
      .limit(1);
    if (!session) throw new AssessmentError("找不到测评会话。", 404);

    await this.db.batch([
      this.db
        .insert(healthResults)
        .values({
          sessionId,
          bmi: Math.round(result.bmi),
          bmiExact: result.bmi.toFixed(1),
          bmiCategory: result.bmiCategory,
          calorieTarget: result.calorieTarget,
          targetDate: result.targetDate,
          score: result.score,
          insight: result.insight,
          curveJson: JSON.stringify(result.curve),
          inputJson: JSON.stringify(result.input),
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: healthResults.sessionId,
          set: {
            bmi: Math.round(result.bmi),
            bmiExact: result.bmi.toFixed(1),
            bmiCategory: result.bmiCategory,
            calorieTarget: result.calorieTarget,
            targetDate: result.targetDate,
            score: result.score,
            insight: result.insight,
            curveJson: JSON.stringify(result.curve),
            inputJson: JSON.stringify(result.input),
          },
        }),
      this.db
        .update(assessmentSessions)
        .set({ status: "completed", currentStep: 5, updatedAt: now })
        .where(eq(assessmentSessions.id, sessionId)),
    ]);
  }

  async getResult(sessionId: string): Promise<HealthAssessment | null> {
    const [row] = await this.db
      .select()
      .from(healthResults)
      .where(eq(healthResults.sessionId, sessionId))
      .limit(1);
    if (!row) return null;
    const input = JSON.parse(row.inputJson) as HealthInput;
    const curve = JSON.parse(row.curveJson) as HealthAssessment["curve"];
    return {
      bmi: Number(row.bmiExact),
      bmiCategory: row.bmiCategory as HealthAssessment["bmiCategory"],
      calorieTarget: row.calorieTarget,
      targetDate: row.targetDate,
      score: row.score,
      insight: row.insight,
      curve,
      actionPlan: createActionPlan(input, curve.at(-1)?.week ?? 6),
      phasePlan: createPhasePlan(input, curve.at(-1)?.week ?? 6),
      adjustmentGuide: createAdjustmentGuide(),
      input,
    };
  }

  async getSubscriptionStatus(sessionId: string): Promise<SubscriptionStatus> {
    const [row] = await this.db
      .select({ status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.sessionId, sessionId))
      .limit(1);
    return (row?.status as SubscriptionStatus | undefined) ?? "inactive";
  }

  async activateSubscription(sessionId: string) {
    const now = new Date().toISOString();
    await this.db
      .insert(subscriptions)
      .values({ sessionId, status: "active", paidAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: subscriptions.sessionId,
        set: { status: "active", paidAt: now, updatedAt: now },
      });
  }

  async createPaymentOrder(order: PaymentOrder) {
    await this.db.insert(paymentOrders).values({
      id: order.id,
      sessionId: order.sessionId,
      orderNo: order.orderNo,
      provider: order.provider,
      planCode: order.plan,
      amountFen: order.amountFen,
      status: order.status,
      checkoutToken: order.checkoutToken,
      expiresAt: order.expiresAt,
      paidAt: order.paidAt,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    });
    return order;
  }

  async getLatestPendingPaymentOrder(sessionId: string) {
    const [row] = await this.db
      .select()
      .from(paymentOrders)
      .where(and(eq(paymentOrders.sessionId, sessionId), eq(paymentOrders.status, "pending")))
      .orderBy(desc(paymentOrders.createdAt))
      .limit(1);
    return row ? this.toPaymentOrder(row) : null;
  }

  async getPaymentOrder(sessionId: string, orderId: string) {
    const [row] = await this.db
      .select()
      .from(paymentOrders)
      .where(and(eq(paymentOrders.sessionId, sessionId), eq(paymentOrders.id, orderId)))
      .limit(1);
    return row ? this.toPaymentOrder(row) : null;
  }

  async getPaymentOrderByCheckoutToken(checkoutToken: string) {
    const [row] = await this.db
      .select()
      .from(paymentOrders)
      .where(eq(paymentOrders.checkoutToken, checkoutToken))
      .limit(1);
    return row ? this.toPaymentOrder(row) : null;
  }

  async expirePaymentOrder(orderId: string, updatedAt: string) {
    await this.db
      .update(paymentOrders)
      .set({ status: "expired", updatedAt })
      .where(and(eq(paymentOrders.id, orderId), eq(paymentOrders.status, "pending")));
    return this.getPaymentOrderById(orderId);
  }

  async confirmPaymentOrder(orderId: string, paidAt: string) {
    const order = await this.getPaymentOrderById(orderId);
    if (!order) return null;
    if (order.status === "pending") {
      await this.db.batch([
        this.db
          .update(paymentOrders)
          .set({ status: "paid", paidAt, updatedAt: paidAt })
          .where(and(eq(paymentOrders.id, orderId), eq(paymentOrders.status, "pending"))),
        this.db
          .insert(subscriptions)
          .values({ sessionId: order.sessionId, status: "active", paidAt, updatedAt: paidAt })
          .onConflictDoUpdate({
            target: subscriptions.sessionId,
            set: { status: "active", paidAt, updatedAt: paidAt },
          }),
      ]);
    }
    return this.getPaymentOrderById(orderId);
  }

  private async getPaymentOrderById(orderId: string) {
    const [row] = await this.db
      .select()
      .from(paymentOrders)
      .where(eq(paymentOrders.id, orderId))
      .limit(1);
    return row ? this.toPaymentOrder(row) : null;
  }

  private toPaymentOrder(row: typeof paymentOrders.$inferSelect): PaymentOrder {
    return {
      id: row.id,
      sessionId: row.sessionId,
      orderNo: row.orderNo,
      provider: "wechat_mock",
      plan: "pulse_weekly",
      amountFen: row.amountFen,
      status: row.status as PaymentOrder["status"],
      checkoutToken: row.checkoutToken,
      expiresAt: row.expiresAt,
      paidAt: row.paidAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
