import { describe, expect, it } from "vitest";
import {
  calculateHealthAssessment,
  healthInputSchema,
  type HealthInput,
} from "../lib/domain";
import {
  AssessmentService,
  InMemoryAssessmentStore,
  type SessionSnapshot,
} from "../lib/assessment-service";

const validInput: HealthInput = {
  gender: "woman",
  goal: "feel_lighter",
  activityLevel: "steady",
  exerciseDays: 3,
  age: 32,
  heightCm: 168,
  weightKg: 76,
  targetWeightKg: 68,
};

describe("health assessment algorithm", () => {
  it("calculates BMI, calorie target and a dated curve server-side", () => {
    const result = calculateHealthAssessment(validInput, new Date("2026-01-01T00:00:00.000Z"));

    expect(result.bmi).toBe(26.9);
    expect(result.calorieTarget).toBeGreaterThanOrEqual(1200);
    expect(result.calorieTarget).toBeLessThanOrEqual(3200);
    expect(result.targetDate).toBe("2026-05-07");
    expect(result.curve[0].weightKg).toBe(76);
    expect(result.curve.at(-1)?.weightKg).toBe(68);
    expect(result.actionPlan).toHaveLength(3);
    expect(result.actionPlan[0].title).toContain("最低可行");
  });

  it.each([
    ["age below minimum", { age: 15 }],
    ["age above maximum", { age: 91 }],
    ["height too short", { heightCm: 119 }],
    ["height too tall", { heightCm: 231 }],
    ["weight too low", { weightKg: 34 }],
    ["weight too high", { weightKg: 251 }],
  ])("rejects %s", (_label, override) => {
    expect(() => healthInputSchema.parse({ ...validInput, ...override })).toThrow();
  });

  it("rejects an unsafe target and a contradictory lighter goal", () => {
    expect(() => healthInputSchema.parse({ ...validInput, targetWeightKg: 30 })).toThrow(/合理范围/);
    expect(() => healthInputSchema.parse({ ...validInput, targetWeightKg: 80 })).toThrow(/更轻盈/);
  });

  it("keeps calorie estimates within safe application bounds at extremes", () => {
    const result = calculateHealthAssessment({
      ...validInput,
      gender: "man",
      goal: "get_stronger",
      age: 90,
      heightCm: 230,
      weightKg: 250,
      targetWeightKg: 250,
      activityLevel: "frequent",
      exerciseDays: 7,
    });
    expect(result.calorieTarget).toBe(3200);
  });
});

describe("assessment persistence and access", () => {
  async function setup() {
    const store = new InMemoryAssessmentStore();
    const service = new AssessmentService(store);
    const { session } = await service.getOrCreateSession();
    return { store, service, session };
  }

  it("resumes a session after out-of-order and duplicate step saves", async () => {
    const { service, session } = await setup();
    await service.saveStep(session.id, "body", { age: 32, heightCm: 168, weightKg: 76 });
    await service.saveStep(session.id, "identity", { gender: "woman" });
    await service.saveStep(session.id, "body", { age: 32, heightCm: 168, weightKg: 74 });
    const resumed = await service.getOrCreateSession(session.id);

    expect(resumed.created).toBe(false);
    expect(resumed.session.data).toMatchObject({ gender: "woman", weightKg: 74 });
    expect(resumed.session.currentStep).toBe(4);
  });

  it("keeps every step when different steps are saved concurrently", async () => {
    const { service, session } = await setup();
    await Promise.all([
      service.saveStep(session.id, "identity", { gender: validInput.gender }),
      service.saveStep(session.id, "goal", { goal: validInput.goal }),
      service.saveStep(session.id, "activity", { activityLevel: validInput.activityLevel, exerciseDays: validInput.exerciseDays }),
      service.saveStep(session.id, "body", { age: validInput.age, heightCm: validInput.heightCm, weightKg: validInput.weightKg }),
      service.saveStep(session.id, "target", { targetWeightKg: validInput.targetWeightKg }),
    ]);

    const resumed = await service.getOrCreateSession(session.id);
    expect(resumed.session.data).toMatchObject(validInput);
    expect(resumed.session.currentStep).toBe(5);
  });

  it("returns a redacted preview that never contains the protected curve", async () => {
    const { service, session } = await setup();
    await service.saveStep(session.id, "identity", { gender: validInput.gender });
    await service.saveStep(session.id, "goal", { goal: validInput.goal });
    await service.saveStep(session.id, "activity", { activityLevel: validInput.activityLevel, exerciseDays: validInput.exerciseDays });
    await service.saveStep(session.id, "body", { age: validInput.age, heightCm: validInput.heightCm, weightKg: validInput.weightKg });
    await service.saveStep(session.id, "target", { targetWeightKg: validInput.targetWeightKg });
    await service.complete(session.id);

    const preview = await service.getResults(session.id);
    expect(preview.access).toBe("preview");
    expect(preview.protected?.locked).toBe(true);
    expect(preview.protected?.message).toContain("18 周");
    expect(preview).not.toHaveProperty("details");
    expect(JSON.stringify(preview)).not.toContain("curve");
  });

  it("changes the result from preview to full after the payment callback", async () => {
    const { service, session } = await setup();
    await service.saveStep(session.id, "identity", { gender: validInput.gender });
    await service.saveStep(session.id, "goal", { goal: validInput.goal });
    await service.saveStep(session.id, "activity", { activityLevel: validInput.activityLevel, exerciseDays: validInput.exerciseDays });
    await service.saveStep(session.id, "body", { age: validInput.age, heightCm: validInput.heightCm, weightKg: validInput.weightKg });
    await service.saveStep(session.id, "target", { targetWeightKg: validInput.targetWeightKg });
    await service.complete(session.id);

    const paid = await service.pay(session.id);
    expect(paid.access).toBe("full");
    expect(paid.subscriptionStatus).toBe("active");
    expect(paid.details?.curve.length).toBeGreaterThan(1);
    expect(paid.details?.targetWeightKg).toBe(68);
    expect(paid.details?.actionPlan).toHaveLength(3);
  });

  it("keeps a completed result idempotent and rejects stale writes", async () => {
    const { service, session } = await setup();
    await service.saveStep(session.id, "identity", { gender: validInput.gender });
    await service.saveStep(session.id, "goal", { goal: validInput.goal });
    await service.saveStep(session.id, "activity", { activityLevel: validInput.activityLevel, exerciseDays: validInput.exerciseDays });
    await service.saveStep(session.id, "body", { age: validInput.age, heightCm: validInput.heightCm, weightKg: validInput.weightKg });
    await service.saveStep(session.id, "target", { targetWeightKg: validInput.targetWeightKg });

    const first = await service.complete(session.id);
    const second = await service.complete(session.id);

    expect(second).toEqual(first);
    await expect(service.saveStep(session.id, "body", { age: 33, heightCm: 168, weightKg: 75 })).rejects.toMatchObject({ status: 409 });
  });

  it("starts a fresh session instead of reusing a completed assessment", async () => {
    const { service, session } = await setup();
    await service.saveStep(session.id, "identity", { gender: validInput.gender });
    await service.saveStep(session.id, "goal", { goal: validInput.goal });
    await service.saveStep(session.id, "activity", { activityLevel: validInput.activityLevel, exerciseDays: validInput.exerciseDays });
    await service.saveStep(session.id, "body", { age: validInput.age, heightCm: validInput.heightCm, weightKg: validInput.weightKg });
    await service.saveStep(session.id, "target", { targetWeightKg: validInput.targetWeightKg });
    await service.complete(session.id);

    const fresh = await (service as AssessmentService & { startFreshSession: () => Promise<SessionSnapshot> }).startFreshSession();

    expect(fresh.id).not.toBe(session.id);
    expect(fresh.status).toBe("in_progress");
    expect(fresh.currentStep).toBe(0);
    expect(fresh.data).toEqual({});
  });
});
