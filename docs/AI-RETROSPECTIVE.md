# AI 使用复盘

## 协作方式

本项目把 AI 当作协作工程师使用，流程不是一次性生成页面，而是先根据需求拆出数据流、状态机和验收场景，再逐步实现和验证。

## 数据库建模

AI 参与了以下工作：

- 从 funnel 流程提取 `users`、`assessment_sessions`、`assessment_steps`、`health_results`、`subscriptions` 五个实体。
- 判断分步数据应该按 `(session_id, step_key)` 存储，而不是每次把整个 session JSON 覆盖回去。
- 设计结果快照，让计算结果与完成时的输入保持一致。
- 生成 Drizzle schema、SQLite migration、索引和唯一约束。

最终保留的核心判断是：`assessment_steps` 是恢复进度的事实来源，`current_step` 只是 UI 快速定位字段；订阅状态独立保存，由服务端决定 preview/full 返回边界。

## Mock 数据与核心逻辑

AI 协助生成了可重复的 `HealthInput` 样例和极端边界数据，覆盖：

- 16 岁与 90 岁年龄边界
- 120–230 cm 身高边界
- 35–250 kg 体重边界
- 目标体重过低、过高和与“感觉更轻盈”目标矛盾
- 0–7 天运动频率
- 不同目标和活动水平下的能量目标

核心算法由服务端实现并测试：

- BMI 与区间分类
- 基于 BMR、活动系数和目标的能量估算
- 按目标差值计算周期和目标日期
- 生成趋势曲线、三条行动建议、四阶段路线和状态调整规则

## 测试生成与边界覆盖

AI 协助把需求转换为测试矩阵，并补充了：

- Cookie 会话创建与恢复
- 乱序、重复和 `Promise.all` 并发保存
- 无 Cookie、非法 JSON、未知步骤、未知字段、数组 data
- preview/full 差异化返回，确保非会员拿不到 `details` 或 `curve`
- `/pay` 方案校验、重复回调和支付后 `/api/results` 完整返回
- 已完成 session 的写保护和 reset 新会话
- D1 Worker 的真实 HTTP smoke 流程

## 一次被否决的 AI 方案

初版方案让 `/api/assessment/complete` 在完成测评后直接返回完整的健康结果，其中包含趋势曲线。这个方案被否决，原因是：

1. `complete` 是前端必经接口，直接返回完整结果会绕过订阅权限。
2. 即使页面后续隐藏曲线，调用者仍然可以直接读取 HTTP 响应。
3. 结果权限应该由服务端统一决定，而不是依赖前端展示逻辑。

最终实现是：`complete` 只负责计算和持久化，然后复用结果权限逻辑返回 preview；只有 `/api/pay` 成功后，`/api/results` 和导出接口才返回 full details。

另一个被修正的点是“重新测评”只刷新页面。刷新会复用原 Cookie 和已完成 session，无法真正开始新流程，因此改为调用 `/api/assessment/reset`，生成新的 session 并保留旧结果在数据库中。

## 证据链

| 结论 | 证据 | 路径 |
| --- | --- | --- |
| 数据模型可追踪 | schema、migration 与上下文文档 | `db/schema.ts`、`drizzle/0000_pulse_initial.sql`、`CONTEXT.md` |
| 被否决的完整结果泄露方案已修正 | complete 计算后通过 `getResults` 返回脱敏视图 | `app/api/assessment/complete/route.ts` |
| 测试覆盖由需求推导 | 单元、Route、D1 smoke 三层测试 | `tests/`、`scripts/test-d1-http.mjs` |
| 当前复盘可独立审阅 | 本文档 | `docs/AI-RETROSPECTIVE.md` |
