"use client";

import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  Dumbbell,
  Flame,
  Gauge,
  HeartPulse,
  LockKeyhole,
  Moon,
  RefreshCw,
  Scale,
  Sparkles,
  Target,
  UserRound,
  UsersRound,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { WebMcpBridge } from "./webmcp-bridge";
import type { HealthInput, PublicHealthResult } from "../lib/domain";
import type { SessionSnapshot } from "../lib/assessment-service";

type Screen = "assessment" | "results";
type FormState = Partial<HealthInput>;
type ApiSessionResponse = { session: SessionSnapshot; resultReady: boolean };

type ChoiceProps = {
  label: string;
  description?: string;
  icon: typeof UserRound;
  selected?: boolean;
  onClick: () => void;
};

const STEP_COUNT = 6;

async function api<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    credentials: "same-origin",
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "发生了一点问题。");
  return payload;
}

function ChoiceCard({ label, description, icon: Icon, selected, onClick }: ChoiceProps) {
  return (
    <button type="button" className={`choice-card ${selected ? "choice-card-selected" : ""}`} onClick={onClick} aria-pressed={selected}>
      <span className="choice-icon"><Icon size={21} strokeWidth={1.7} /></span>
      <span className="choice-copy"><span className="choice-label">{label}</span>{description ? <span className="choice-description">{description}</span> : null}</span>
      <span className="choice-indicator" aria-hidden="true">{selected ? <Check size={16} /> : null}</span>
    </button>
  );
}

function MiniMetric({ label, value, accent = "mint" }: { label: string; value: string; accent?: "mint" | "coral" }) {
  return <div className="mini-metric"><span className={`metric-dot metric-dot-${accent}`} /><span className="mini-metric-label">{label}</span><span className="mini-metric-value">{value}</span></div>;
}

function Field({ label, value, onChange, min, max, suffix }: { label: string; value: number | undefined; onChange: (value: number | undefined) => void; min: number; max: number; suffix: string }) {
  return <label className="field-shell"><span className="field-label">{label}</span><span className="field-control"><input type="number" min={min} max={max} value={value ?? ""} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : undefined)} required /><span>{suffix}</span></span></label>;
}

function InsightPanel({ form, stepIndex }: { form: FormState; stepIndex: number }) {
  const liveBmi = useMemo(() => {
    if (!form.heightCm || !form.weightKg) return null;
    return (form.weightKg / ((form.heightCm / 100) ** 2)).toFixed(1);
  }, [form.heightCm, form.weightKg]);
  const insight = liveBmi ? Number(liveBmi) < 18.5 ? "先把能量保护好。" : Number(liveBmi) <= 24.9 ? "你的基础很稳，适合继续往上叠加。" : "在这里，坚持比极端更有效。" : stepIndex < 2 ? "你的回答会逐步变成一份真正属于你的计划。" : "你的私人基线会保存在这次会话里。";
  return <aside className="insight-panel" aria-label="实时计划预览"><div className="panel-orbit orbit-one" /><div className="panel-orbit orbit-two" /><div className="panel-kicker"><span className="live-dot" /> 实时计划预览</div><div className="signal-badge"><HeartPulse size={17} /><span>信号 {String(stepIndex + 1).padStart(2, "0")}</span></div><h2>{insight}</h2><p>我们会按你的节奏调整下一步，不套用模板。</p><div className="metric-stack"><MiniMetric label="身体基线" value={liveBmi ? `${liveBmi} BMI` : "正在读取"} /><MiniMetric label="计划风格" value={form.goal === "get_stronger" ? "变强" : form.goal === "feel_lighter" ? "轻盈" : "稳定"} accent="coral" /><MiniMetric label="保存位置" value="当前会话" /></div><div className="privacy-note"><LockKeyhole size={14} /> 无需账号，也不用填写邮箱</div></aside>;
}

function ProgressHeader({ stepIndex, onBack }: { stepIndex: number; onBack: () => void }) {
  return <header className="app-header"><div className="brand-lockup"><span className="brand-mark"><HeartPulse size={19} /></span><span className="brand-word">pulse<span>/08</span></span></div><div className="step-status"><span>你的健康地图</span><strong>{String(Math.min(stepIndex + 1, STEP_COUNT)).padStart(2, "0")} <em>/ {String(STEP_COUNT).padStart(2, "0")}</em></strong></div><button type="button" className="header-help" onClick={() => window.alert("你的每一步答案都会自动保存到当前会话中。")}><CircleHelp size={17} /><span>了解测评</span></button>{stepIndex > 0 ? <button type="button" className="mobile-back" onClick={onBack} aria-label="返回上一步"><ArrowLeft size={19} /></button> : null}</header>;
}

function TextInputStep({ form, setForm }: { form: FormState; setForm: (next: FormState) => void }) {
  return <div className="step-body-grid"><Field label="年龄" value={form.age} onChange={(age) => setForm({ ...form, age })} min={16} max={90} suffix="岁" /><Field label="身高" value={form.heightCm} onChange={(heightCm) => setForm({ ...form, heightCm })} min={120} max={230} suffix="cm" /><Field label="当前体重" value={form.weightKg} onChange={(weightKg) => setForm({ ...form, weightKg })} min={35} max={250} suffix="kg" /></div>;
}

function linePath(points: Array<{ week: number; weightKg: number }>, width = 520, height = 210) {
  if (!points.length) return "";
  const values = points.map((point) => point.weightKg);
  const min = Math.min(...values) - 1;
  const max = Math.max(...values) + 1;
  return points.map((point, index) => { const x = (index / Math.max(points.length - 1, 1)) * width; const y = height - ((point.weightKg - min) / Math.max(max - min, 1)) * height; return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`; }).join(" ");
}

function ResultsView({ result, paying, onPay, onRestart }: { result: PublicHealthResult; paying: boolean; onPay: () => void; onRestart: () => void }) {
  const details = result.access === "full" ? result.details : undefined;
  const path = details ? linePath(details.curve) : "M0 174 L80 145 L160 155 L240 106 L320 122 L400 74 L520 44";
  const finalWeek = details?.curve.at(-1)?.week ?? 12;
  const targetDate = new Date(result.summary.targetDate).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  return <main className="results-page"><div className="results-noise" /><header className="app-header results-header"><div className="brand-lockup"><span className="brand-mark"><HeartPulse size={19} /></span><span className="brand-word">pulse<span>/08</span></span></div><div className="results-state"><span className="live-dot" /> {details ? "完整地图已解锁" : "地图预览"}</div><button type="button" className="header-help" onClick={onRestart}><RefreshCw size={16} /><span>重新测评</span></button></header><section className="results-shell"><div className="results-intro"><p className="eyebrow"><Sparkles size={14} /> 你的健康信号报告</p><h1>{details ? "你的身体基线已经绘制完成。" : "你的第一组信号已经就位。"}</h1><p className="results-lead">{details ? "这是一条真正可以坚持的节奏，下面是你的身体已经准备好的路径。" : "你离一份真正适合自己的计划更近了。解锁完整节奏，不再照搬通用清单。"}</p></div><div className="result-grid"><article className="score-card result-card"><div className="card-topline"><span>准备度评分</span><Gauge size={17} /></div><div className="score-value">{result.summary.score}<span>/100</span></div><div className="score-track"><span style={{ width: `${result.summary.score}%` }} /></div><p>基于你能重复的节奏，而不是纸面上看起来多努力。</p></article><article className="result-card stat-card"><div className="card-topline"><span>身体基线 BMI</span><Activity size={17} /></div><strong>{result.summary.bmi.toFixed(1)}</strong><span className="stat-label">{result.summary.bmiCategory === "balanced" ? "平衡区间" : result.summary.bmiCategory === "low" ? "能量优先区间" : "循序推进区间"}</span><p>{result.summary.insight}</p></article><article className="result-card stat-card coral-card"><div className="card-topline"><span>每日能量目标</span><Flame size={17} /></div><strong>{result.summary.calorieTarget.toLocaleString("zh-CN")}</strong><span className="stat-label">千卡 / 天</span><p>给身体足够结构继续前进，不把食物变成敌人。</p></article></div><article className="curve-card result-card"><div className="curve-heading"><div><div className="card-topline"><span>你的体重节奏</span><Target size={17} /></div><h2>{details ? `一条 ${finalWeek} 周的可行路径` : "为你的节奏定制的路径"}</h2></div><div className="target-date"><span>目标窗口</span><strong>{targetDate}</strong></div></div><div className={`chart-wrap ${details ? "chart-visible" : "chart-locked"}`}><svg viewBox="0 0 520 240" role="img" aria-label={details ? "预计体重变化节奏" : "已锁定的预计体重变化节奏"} preserveAspectRatio="none"><defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#93f7cb" stopOpacity=".28" /><stop offset="100%" stopColor="#93f7cb" stopOpacity="0" /></linearGradient></defs><path d="M0 210 H520" className="chart-axis" /><path d="M0 140 H520" className="chart-axis" /><path d="M0 70 H520" className="chart-axis" /><path d={`${path} L520 230 L0 230 Z`} fill="url(#chartFill)" /><path d={path} className="chart-line" /></svg>{!details ? <div className="chart-lock"><span className="lock-circle"><LockKeyhole size={18} /></span><strong>解锁完整趋势</strong><span>查看每周检查点和你的目标体重节奏。</span></div> : null}</div><div className="chart-labels"><span>现在</span><span>{details ? `第 ${Math.round(finalWeek / 2)} 周` : "第 6 周"}</span><span>目标</span></div></article><div className="results-bottom"><div className="checkpoint-list"><div className="card-topline"><span>你将获得</span><Zap size={17} /></div>{details ? details.checkpoints.map((checkpoint) => <div className="checkpoint" key={checkpoint.week}><span className="checkpoint-week">{String(checkpoint.week).padStart(2, "0")}</span><span><strong>{checkpoint.label}</strong><small>{checkpoint.weightKg} kg 信号</small></span><Check size={15} /></div>) : <><div className="checkpoint muted-checkpoint"><span className="checkpoint-week">01</span><span><strong>每周检查点</strong><small>一条可以看见、可以调整的路径</small></span><LockKeyhole size={15} /></div><div className="checkpoint muted-checkpoint"><span className="checkpoint-week">02</span><span><strong>个人节奏</strong><small>围绕你的真实能量水平设计</small></span><LockKeyhole size={15} /></div></>}</div><div className="unlock-card"><span className="unlock-kicker">{details ? "已加入" : "只差一步"}</span><h2>{details ? "让这组信号继续流动。" : "让你的地图真正可执行。"}</h2><p>{details ? "完整结果已经准备好，随时可以回来重新校准。" : "一次演示解锁，即可查看受保护的趋势和每周检查点。"}</p>{details ? <div className="paid-badge"><Check size={15} /> 演示订阅已生效</div> : <Button className="unlock-button" onClick={onPay} disabled={paying}><LockKeyhole size={16} /> {paying ? "正在解锁…" : "解锁完整地图 · ￥9.90"}</Button>}</div></div><p className="results-footnote">会话 {result.sessionId.slice(0, 8)} · 仅供教育参考，不替代医疗建议。</p></section></main>;
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>("assessment");
  const [stepIndex, setStepIndex] = useState(0);
  const [form, setForm] = useState<FormState>({});
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [result, setResult] = useState<PublicHealthResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void (async () => { try { const payload = await api<ApiSessionResponse>("/api/assessment"); setSession(payload.session); setForm(payload.session.data); setStepIndex(Math.min(payload.session.currentStep, STEP_COUNT - 1)); if (payload.resultReady) { const resultPayload = await api<PublicHealthResult>("/api/results"); setResult(resultPayload); setScreen("results"); } } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "暂时无法开始测评。"); } finally { setLoading(false); } })(); }, []);

  const saveStep = async (step: string, data: Record<string, unknown>) => { setSaving(true); setError(null); try { const payload = await api<{ session: SessionSnapshot }>("/api/assessment", { method: "PATCH", body: JSON.stringify({ step, data }) }); setSession(payload.session); setForm(payload.session.data); return true; } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "这一步保存失败了，请再试一次。"); return false; } finally { setSaving(false); } };
  const choose = async (step: string, data: Record<string, unknown>) => { const saved = await saveStep(step, data); if (saved) setStepIndex((current) => Math.min(current + 1, STEP_COUNT - 1)); };
  const goNext = async () => { if (stepIndex === 3) { if (!form.age || !form.heightCm || !form.weightKg) return setError("请填写年龄、身高和当前体重后继续。"); if (form.age < 16 || form.age > 90 || form.heightCm < 120 || form.heightCm > 230 || form.weightKg < 35 || form.weightKg > 250) return setError("请使用每个输入框标注范围内的数值。"); if (await saveStep("body", { age: form.age, heightCm: form.heightCm, weightKg: form.weightKg })) setStepIndex(4); return; } if (stepIndex === 4) { if (!form.targetWeightKg) return setError("请填写目标体重后继续。"); if (await saveStep("target", { targetWeightKg: form.targetWeightKg })) setStepIndex(5); } };
  const complete = async () => { setSaving(true); setError(null); try { const payload = await api<{ result: PublicHealthResult }>("/api/assessment/complete", { method: "POST" }); setResult(payload.result); setScreen("results"); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "请先补全缺少的信息。"); } finally { setSaving(false); } };
  const pay = async () => { setPaying(true); setError(null); try { const payload = await api<{ result: PublicHealthResult }>("/api/pay", { method: "POST", body: JSON.stringify({ plan: "pulse_weekly" }) }); setResult(payload.result); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "演示支付没有完成，请再试一次。"); } finally { setPaying(false); } };

  if (loading) return <main className="loading-screen"><span className="brand-mark"><HeartPulse size={20} /></span><span>正在校准你的专属会话…</span></main>;
  if (screen === "results" && result) return <ResultsView result={result} paying={paying} onPay={pay} onRestart={() => window.location.reload()} />;
  if (!session) return <main className="loading-screen"><span>{error ?? "暂时无法开始测评。"}</span></main>;

  const choiceStep = (content: ReactNode, eyebrow: string, title: string, description: string) => <><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="step-description">{description}</p><div className="choice-list">{content}</div></>;
  let content: ReactNode;
  if (stepIndex === 0) content = choiceStep(<><ChoiceCard label="女性" icon={UserRound} selected={form.gender === "woman"} onClick={() => void choose("identity", { gender: "woman" })} /><ChoiceCard label="男性" icon={UserRound} selected={form.gender === "man"} onClick={() => void choose("identity", { gender: "man" })} /><ChoiceCard label="非二元" icon={UsersRound} selected={form.gender === "nonbinary"} onClick={() => void choose("identity", { gender: "nonbinary" })} /><ChoiceCard label="不方便透露" icon={Moon} selected={form.gender === "prefer_not_to_say"} onClick={() => void choose("identity", { gender: "prefer_not_to_say" })} /></>, "01 / 你的基础", "先从你自己开始。", "几个真实信号就够了，你的回答会决定接下来的节奏和适合你的支持方式。");
  else if (stepIndex === 1) content = choiceStep(<><ChoiceCard label="感觉更轻盈" description="让日常身体状态更松弛" icon={Scale} selected={form.goal === "feel_lighter"} onClick={() => void choose("goal", { goal: "feel_lighter" })} /><ChoiceCard label="变得更强壮" description="建立能力，而不只是追逐数字" icon={Dumbbell} selected={form.goal === "get_stronger"} onClick={() => void choose("goal", { goal: "get_stronger" })} /><ChoiceCard label="建立稳定习惯" description="找到可以不断重复的节奏" icon={RefreshCw} selected={form.goal === "build_consistency"} onClick={() => void choose("goal", { goal: "build_consistency" })} /></>, "02 / 你的目标", "什么会让你觉得真的有收获？", "这里没有标准答案，重要的是选一个在忙碌的周二也依然值得坚持的方向。");
  else if (stepIndex === 2) content = choiceStep(<><ChoiceCard label="我正要重新开始" description="每周运动 0–1 天" icon={Sparkles} selected={form.activityLevel === "new"} onClick={() => void choose("activity", { activityLevel: "new", exerciseDays: 1 })} /><ChoiceCard label="我有自己的节奏" description="每周运动 2–3 天" icon={Activity} selected={form.activityLevel === "steady"} onClick={() => void choose("activity", { activityLevel: "steady", exerciseDays: 3 })} /><ChoiceCard label="我经常运动" description="每周运动 4 天以上" icon={Zap} selected={form.activityLevel === "frequent"} onClick={() => void choose("activity", { activityLevel: "frequent", exerciseDays: 5 })} /></>, "03 / 你的节奏", "现在的你，通常多久动一次？", "我们会把你当下的节奏作为起点，而不是拿它来给你打分。");
  else if (stepIndex === 3) content = <><p className="eyebrow">04 / 你的身体</p><h1>给我们一个起点坐标。</h1><p className="step-description">只用于让估算更贴近你，私密、实用，也不会保存到公开资料。</p><TextInputStep form={form} setForm={setForm} /><div className="step-actions"><Button variant="ghost" onClick={() => setStepIndex(2)}><ArrowLeft size={16} /> 返回</Button><Button className="primary-button" onClick={() => void goNext()} disabled={saving}>保存基础数据 <ArrowRight size={16} /></Button></div></>;
  else if (stepIndex === 4) content = <><p className="eyebrow">05 / 你的目标</p><h1>你想把自己带到哪里？</h1><p className="step-description">目标是方向，不是截止日期。我们会把路径保持在现实可行的范围内。</p><div className="target-input-wrap"><Field label="目标体重" value={form.targetWeightKg} onChange={(targetWeightKg) => setForm({ ...form, targetWeightKg })} min={35} max={250} suffix="kg" /><div className="target-readout"><Target size={18} /><span>{form.weightKg && form.targetWeightKg ? `${Math.abs(form.weightKg - form.targetWeightKg).toFixed(1)} kg 的变化，按你的节奏来` : "填写后，这里会出现你的节奏"}</span></div></div><div className="step-actions"><Button variant="ghost" onClick={() => setStepIndex(3)}><ArrowLeft size={16} /> 返回</Button><Button className="primary-button" onClick={() => void goNext()} disabled={saving}>预览我的地图 <ArrowRight size={16} /></Button></div></>;
  else content = <><p className="eyebrow">06 / 你的地图</p><h1>准备好看看身体信号了吗？</h1><p className="step-description">我们会在服务端计算你的身体基线，在任何内容锁定前，先展示第一层结果。</p><div className="review-grid"><MiniMetric label="目标" value={form.goal === "feel_lighter" ? "感觉更轻盈" : form.goal === "get_stronger" ? "变得更强壮" : "建立稳定习惯"} /><MiniMetric label="节奏" value={`${form.exerciseDays ?? "—"} 天 / 周`} accent="coral" /><MiniMetric label="目标体重" value={form.targetWeightKg ? `${form.targetWeightKg} kg` : "—"} /></div><div className="review-note"><LockKeyhole size={16} /><span>报告只会为当前会话生成，不需要填写邮箱。</span></div><div className="step-actions"><Button variant="ghost" onClick={() => setStepIndex(4)}><ArrowLeft size={16} /> 返回</Button><Button className="primary-button" onClick={() => void complete()} disabled={saving}>{saving ? "正在读取信号…" : "查看我的初步信号"} <ArrowRight size={16} /></Button></div></>;

  return <main className="pulse-app"><WebMcpBridge /><ProgressHeader stepIndex={stepIndex} onBack={() => setStepIndex(Math.max(0, stepIndex - 1))} /><div className="progress-wrap"><Progress value={((stepIndex + 1) / STEP_COUNT) * 100} /><span>{saving ? "保存中" : "已自动保存"}</span></div><section className="assessment-layout"><div className="assessment-main"><div className="step-panel">{content}</div>{error ? <p className="error-message" role="alert">{error}</p> : null}<p className="legal-copy"><LockKeyhole size={13} /> 你的回答会保存在当前会话中。继续即表示你同意接受一份私密的健康教育估算。</p></div><InsightPanel form={form} stepIndex={stepIndex} /></section><footer className="app-footer"><span>pulse/08 健康地图</span><span>献给生活依然很忙、但想照顾好自己的你。</span><span>会话 {session.id.slice(0, 8)}</span></footer></main>;
}
