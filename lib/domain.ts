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

export type ActionPlanItem = {
  week: number;
  title: string;
  description: string;
  focus: string;
};

export type ReportPhase = {
  phase: number;
  startWeek: number;
  endWeek: number;
  title: string;
  purpose: string;
  movement: string;
  nutrition: string;
  checkIn: string;
};

export type AdjustmentGuide = {
  signal: string;
  response: string;
  guardrail: string;
};

export type HealthAssessment = {
  bmi: number;
  bmiCategory: "low" | "balanced" | "high";
  calorieTarget: number;
  targetDate: string;
  score: number;
  curve: CurvePoint[];
  actionPlan: ActionPlanItem[];
  phasePlan: ReportPhase[];
  adjustmentGuide: AdjustmentGuide[];
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
    totalWeeks: number;
    message: string;
  };
  details?: {
    targetWeightKg: number;
    curve: CurvePoint[];
    checkpoints: Array<{ week: number; label: string; weightKg: number }>;
    actionPlan: ActionPlanItem[];
    phasePlan: ReportPhase[];
    adjustmentGuide: AdjustmentGuide[];
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

export function createActionPlan(input: HealthInput, weeks: number): ActionPlanItem[] {
  const middleWeek = Math.max(2, Math.round(weeks / 2));
  const movementAnchor =
    input.exerciseDays <= 1
      ? "每周先安排 2 次 10–20 分钟的轻量活动"
      : `保留每周 ${input.exerciseDays} 天的活动节奏`;
  const goalTitle =
    input.goal === "feel_lighter"
      ? "把轻盈感放进日常"
      : input.goal === "get_stronger"
        ? "给力量留出位置"
        : "让稳定变成默认选项";

  return [
    {
      week: 1,
      title: "先建立最低可行节奏",
      description: `这一周只做一件事：${movementAnchor}，同时观察睡眠、精力和饥饿感。`,
      focus: "稳定出现",
    },
    {
      week: middleWeek,
      title: goalTitle,
      description: "把已经能重复的动作再加一点点难度，不追求一次做到完美。",
      focus: "逐步增加",
    },
    {
      week: weeks,
      title: "回看并重新校准",
      description: `在第 ${weeks} 周复盘身体反馈与生活安排，再决定下一段节奏，而不是被单一数字牵着走。`,
      focus: "复盘调整",
    },
  ].filter(
    (item, index, items) =>
      items.findIndex((candidate) => candidate.week === item.week) === index,
  );
}

export function createPhasePlan(input: HealthInput, weeks: number): ReportPhase[] {
  const phaseEnds = [...new Set([
    Math.max(1, Math.round(weeks * 0.22)),
    Math.max(2, Math.round(weeks * 0.5)),
    Math.max(3, Math.round(weeks * 0.78)),
    weeks,
  ])].sort((left, right) => left - right);
  const movementAnchor =
    input.activityLevel === "new"
      ? "每周 2 次 10–20 分钟轻量活动"
      : `围绕每周 ${input.exerciseDays} 天活动安排`;
  const nutritionAnchor =
    input.goal === "feel_lighter"
      ? "每餐先安排一份蛋白质和至少一种蔬菜"
      : input.goal === "get_stronger"
        ? "活动日优先保证一顿完整、规律的餐食"
        : "固定一份最容易重复的早餐或加餐组合";
  const phaseCopy = [
    {
      title: "建立基线",
      purpose: "先让计划进入生活，不追求一次做得很满。",
      movement: `${movementAnchor}，把完成作为唯一标准。`,
      nutrition: `${nutritionAnchor}，先从最容易重复的一餐开始。`,
      checkIn: "记录睡眠、精力和完成度，周末只调整一个变量。",
    },
    {
      title: "叠加节奏",
      purpose: "在已经能重复的动作上增加一点点结构。",
      movement: "从已有动作里选一个，增加 5 分钟或一组，不同时增加两项。",
      nutrition: "提前准备一个简单选项，减少忙碌时临时做决定的次数。",
      checkIn: "如果完成度低于一半，先缩小动作，不用补偿性加码。",
    },
    {
      title: "保留弹性",
      purpose: "给忙碌和波动留出空间，让计划不会因一次偏离而中断。",
      movement: "保留一次低强度恢复，活动和休息都算计划的一部分。",
      nutrition: "允许一到两次弹性选择，回到下一顿的正常节奏即可。",
      checkIn: "看连续两周的趋势，不用用单日体感给自己下结论。",
    },
    {
      title: "巩固与复盘",
      purpose: "挑出真正值得长期保留的习惯，为下一轮校准做准备。",
      movement: "挑出最值得长期保留的两项动作，准备下一轮复盘。",
      nutrition: "保留最省力的饮食结构，把复杂规则删到最低。",
      checkIn: "复盘完成度、精力和生活安排，再决定下一段节奏。",
    },
  ];
  let startWeek = 1;
  return phaseEnds.map((endWeek, index) => {
    const copy = phaseCopy[Math.min(index, phaseCopy.length - 1)];
    const phase = {
      phase: index + 1,
      startWeek,
      endWeek,
      ...copy,
    };
    startWeek = endWeek + 1;
    return phase;
  });
}

export function createAdjustmentGuide(): AdjustmentGuide[] {
  return [
    {
      signal: "本周完成度低于一半",
      response: "把下周最重要的动作缩小到原来的一半，先恢复出现的频率。",
      guardrail: "不要用临时加量补偿，稳定比补课更重要。",
    },
    {
      signal: "连续两周都觉得吃力",
      response: "保持当前阶段，不再增加新目标，只保留最容易完成的一项。",
      guardrail: "先观察睡眠、精力和生活安排，再决定是否推进。",
    },
    {
      signal: "出现持续不适或异常反馈",
      response: "暂停当前计划，优先寻求合格专业人士的建议。",
      guardrail: "这份报告是健康教育估算，不替代医疗判断。",
    },
  ];
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
  const curve = createCurve(parsed, weeks);

  return {
    bmi,
    bmiCategory: category,
    calorieTarget,
    targetDate: targetDateFrom(asOf, weeks),
    score,
    curve,
    actionPlan: createActionPlan(parsed, weeks),
    phasePlan: createPhasePlan(parsed, weeks),
    adjustmentGuide: createAdjustmentGuide(),
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
    const totalWeeks = assessment.curve.at(-1)?.week ?? 6;
    return {
      sessionId,
      access: "preview",
      subscriptionStatus,
      summary,
      protected: {
        locked: true,
        totalWeeks,
        message: `解锁完整的 ${totalWeeks} 周路径、每周检查点和趋势变化。`,
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
      actionPlan: assessment.actionPlan,
      phasePlan: assessment.phasePlan,
      adjustmentGuide: assessment.adjustmentGuide,
    },
  };
}

export function renderMarkdownReport(result: PublicHealthResult) {
  const lines = [
    "# pulse/08 健康信号报告",
    "",
    `> 会话：${result.sessionId}`,
    `> 报告状态：${result.access === "full" ? "完整报告" : "预览报告"}`,
    "",
    "## 基线摘要",
    "",
    `- BMI：${result.summary.bmi.toFixed(1)}（${result.summary.bmiCategory === "balanced" ? "平衡区间" : result.summary.bmiCategory === "low" ? "能量优先区间" : "循序推进区间"}）`,
    `- 每日能量目标：${result.summary.calorieTarget.toLocaleString("zh-CN")} 千卡 / 天`,
    `- 目标窗口：${result.summary.targetDate}`,
    `- 准备度评分：${result.summary.score} / 100`,
    `- 洞察：${result.summary.insight}`,
  ];

  if (result.access !== "full" || !result.details) {
    lines.push(
      "",
      "## 当前可见范围",
      "",
      result.protected?.message ?? "完整报告内容尚未解锁。",
      "",
      "完整报告将在解锁后包含四阶段行动路线、每周检查点和状态调整规则。",
    );
  } else {
    lines.push(
      "",
      "## 目标路径",
      "",
      `- 目标体重：${result.details.targetWeightKg} kg`,
      `- 预计路径：${result.details.phasePlan.at(-1)?.endWeek ?? result.details.curve.at(-1)?.week ?? 6} 周`,
      "",
      "## 三条核心动作",
      "",
      ...result.details.actionPlan.flatMap((item) => [
        `### 第 ${item.week} 周 · ${item.title}`,
        `- 重点：${item.focus}`,
        `- ${item.description}`,
        "",
      ]),
      "## 四阶段行动路线",
      "",
      ...result.details.phasePlan.flatMap((phase) => [
        `### 阶段 ${phase.phase}｜第 ${phase.startWeek}–${phase.endWeek} 周：${phase.title}`,
        `- 目的：${phase.purpose}`,
        `- 活动：${phase.movement}`,
        `- 饮食结构：${phase.nutrition}`,
        `- 检查点：${phase.checkIn}`,
        "",
      ]),
      "## 每周检查点",
      "",
      ...result.details.checkpoints.map((checkpoint) => `- 第 ${checkpoint.week} 周（${checkpoint.label}）：${checkpoint.weightKg} kg 信号`),
      "",
      "## 状态调整规则",
      "",
      ...result.details.adjustmentGuide.flatMap((guide) => [
        `### ${guide.signal}`,
        `- 怎么做：${guide.response}`,
        `- 注意：${guide.guardrail}`,
        "",
      ]),
    );
  }

  lines.push(
    "## 说明",
    "",
    "本报告由 pulse/08 根据本次测评输入生成，仅供健康教育和自我观察参考，不替代医疗建议。",
    "",
  );
  return lines.join("\n");
}

export function mergeAssessmentData(parts: AssessmentData[]) {
  return parts.reduce<AssessmentData>((merged, part) => ({ ...merged, ...part }), {});
}
