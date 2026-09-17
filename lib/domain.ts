import { z } from "zod";

export const STEP_KEYS = ["identity", "goal", "activity", "body", "target"] as const;
export type StepKey = (typeof STEP_KEYS)[number];

export const genderSchema = z.enum([
  "woman",
  "man",
  "nonbinary",
  "prefer_not_to_say",
]);
export const goalSchema = z.enum([
  "feel_lighter",
  "get_stronger",
  "build_consistency",
]);
export const activityLevelSchema = z.enum(["new", "steady", "frequent"]);

export const healthInputSchema = z
  .object({
    gender: genderSchema,
    goal: goalSchema,
    activityLevel: activityLevelSchema,
    exerciseDays: z.number().int().min(0).max(7),
    age: z.number().int().min(16).max(90),
    heightCm: z.number().min(120).max(230),
    weightKg: z.number().min(35).max(250),
    targetWeightKg: z.number().min(35).max(250),
  })
  .superRefine((input, ctx) => {
    const minimum = input.weightKg * 0.55;
    const maximum = input.weightKg * 1.3;
    if (input.targetWeightKg < minimum || input.targetWeightKg > maximum) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetWeightKg"],
        message: "目标体重需要处在当前体重的合理范围内。",
      });
    }
    if (input.goal === "feel_lighter" && input.targetWeightKg >= input.weightKg) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetWeightKg"],
        message: "如果目标是更轻盈，目标体重需要低于当前体重。",
      });
    }
  });

export type HealthInput = z.infer<typeof healthInputSchema>;

export const stepSchemas: Record<StepKey, z.ZodType<Record<string, unknown>>> = {
  identity: z.object({ gender: genderSchema }).strict(),
  goal: z.object({ goal: goalSchema }).strict(),
  activity: z
    .object({
      activityLevel: activityLevelSchema,
      exerciseDays: z.number().int().min(0).max(7),
    })
    .strict(),
  body: z
    .object({
      age: z.number().int().min(16).max(90),
      heightCm: z.number().min(120).max(230),
      weightKg: z.number().min(35).max(250),
    })
    .strict(),
  target: z.object({ targetWeightKg: z.number().min(35).max(250) }).strict(),
};

export type AssessmentData = Partial<HealthInput>;

export type CurvePoint = {
  week: number;
  weightKg: number;
};

export type HealthAssessment = {
  bmi: number;
  bmiCategory: "low" | "balanced" | "high";
  calorieTarget: number;
  targetDate: string;
  score: number;
  curve: CurvePoint[];
  insight: string;
  input: HealthInput;
};

export type ResultAccess = "preview" | "full";

export type PublicHealthResult = {
  sessionId: string;
  access: ResultAccess;
  subscriptionStatus: "inactive" | "active";
  summary: Pick<
    HealthAssessment,
    "bmi" | "bmiCategory" | "calorieTarget" | "targetDate" | "score" | "insight"
  >;
  protected?: {
    locked: true;
    message: string;
  };
  details?: {
    targetWeightKg: number;
    curve: CurvePoint[];
    checkpoints: Array<{ week: number; label: string; weightKg: number }>;
  };
};

function bmiCategory(bmi: number): HealthAssessment["bmiCategory"] {
  if (bmi < 18.5) return "low";
  if (bmi <= 24.9) return "balanced";
  return "high";
}

function activityFactor(input: HealthInput) {
  const base = { new: 1.2, steady: 1.375, frequent: 1.55 }[input.activityLevel];
  return base + Math.min(input.exerciseDays, 5) * 0.015;
}

function goalAdjustment(goal: HealthInput["goal"]) {
  return { feel_lighter: -250, get_stronger: 180, build_consistency: 0 }[goal];
}

function targetWeeks(input: HealthInput) {
  const delta = Math.abs(input.weightKg - input.targetWeightKg);
  if (delta < 0.1) return 6;
  return Math.max(6, Math.ceil(delta / 0.45));
}

function targetDateFrom(asOf: Date, weeks: number) {
  const date = new Date(asOf);
  date.setUTCDate(date.getUTCDate() + weeks * 7);
  return date.toISOString().slice(0, 10);
}

function createCurve(input: HealthInput, weeks: number): CurvePoint[] {
  const points: CurvePoint[] = [];
  for (let week = 0; week <= weeks; week += Math.max(1, Math.ceil(weeks / 6))) {
    const progress = Math.min(1, week / weeks);
    const eased = 1 - (1 - progress) ** 1.35;
    points.push({
      week,
      weightKg: Number(
        (input.weightKg + (input.targetWeightKg - input.weightKg) * eased).toFixed(1),
      ),
    });
  }
  if (points.at(-1)?.week !== weeks) {
    points.push({ week: weeks, weightKg: Number(input.targetWeightKg.toFixed(1)) });
  }
  return points;
}

export function calculateHealthAssessment(input: HealthInput, asOf = new Date()): HealthAssessment {
  const parsed = healthInputSchema.parse(input);
  const heightM = parsed.heightCm / 100;
  const bmi = Number((parsed.weightKg / (heightM * heightM)).toFixed(1));
  const genderOffset =
    parsed.gender === "man" ? 5 : parsed.gender === "woman" ? -161 : -78;
  const bmr = 10 * parsed.weightKg + 6.25 * parsed.heightCm - 5 * parsed.age + genderOffset;
  const calorieTarget = Math.round(
    Math.min(3200, Math.max(1200, bmr * activityFactor(parsed) + goalAdjustment(parsed.goal))),
  );
  const weeks = targetWeeks(parsed);
  const score = Math.round(
    Math.min(
      98,
      Math.max(55, 82 - Math.abs(bmi - 22) * 2 + Math.min(parsed.exerciseDays, 5) * 2),
    ),
  );
  const category = bmiCategory(bmi);

  return {
    bmi,
    bmiCategory: category,
    calorieTarget,
    targetDate: targetDateFrom(asOf, weeks),
    score,
    curve: createCurve(parsed, weeks),
    insight:
      category === "balanced"
        ? "你的身体基线处在稳定区间，小而持续的进步会真正带来变化。"
        : category === "low"
          ? "你的计划应该先保护能量，再用舒服的节奏逐步建立动力。"
          : "保持稳定节奏，能让你不必经历极端波动，也能持续向前。",
    input: parsed,
  };
}

export function redactHealthAssessment(
  sessionId: string,
  assessment: HealthAssessment,
  subscriptionStatus: "inactive" | "active",
): PublicHealthResult {
  const summary = {
    bmi: assessment.bmi,
    bmiCategory: assessment.bmiCategory,
    calorieTarget: assessment.calorieTarget,
    targetDate: assessment.targetDate,
    score: assessment.score,
    insight: assessment.insight,
  };
  if (subscriptionStatus !== "active") {
    return {
      sessionId,
      access: "preview",
      subscriptionStatus,
      summary,
      protected: {
        locked: true,
        message: "解锁完整的 12 周路径、每周检查点和趋势变化。",
      },
    };
  }

  const checkpoints = assessment.curve
    .filter((point) => point.week > 0)
    .slice(0, 3)
    .map((point) => ({
      ...point,
      label: point.week === assessment.curve.at(-1)?.week ? "目标窗口" : `第 ${point.week} 周`,
    }));

  return {
    sessionId,
    access: "full",
    subscriptionStatus,
    summary,
    details: {
      targetWeightKg: assessment.input.targetWeightKg,
      curve: assessment.curve,
      checkpoints,
    },
  };
}

export function mergeAssessmentData(parts: AssessmentData[]) {
  return parts.reduce<AssessmentData>((merged, part) => ({ ...merged, ...part }), {});
}
