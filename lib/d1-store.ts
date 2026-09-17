import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  assessmentSessions,
  assessmentSteps,
  healthResults,
  subscriptions,
  users,
} from "../db/schema";
import {
  createActionPlan,
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

export class D1AssessmentStore implements AssessmentStore {
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
      .select({ id: assessmentSessions.id })
      .from(assessmentSessions)
      .where(eq(assessmentSessions.id, sessionId))
      .limit(1);
    if (!session) throw new AssessmentError("找不到测评会话。", 404);

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
}
