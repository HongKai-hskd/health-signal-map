# pulse/08 · 健康信号地图

一个中文健康测评 Funnel 的全栈实现：用户逐步填写个人目标与身体数据，服务端计算 BMI、建议摄入量和目标日期；中途刷新可恢复进度，结果页先展示脱敏预览，调用模拟支付回调后解锁完整趋势。

## 产品设计

参考 BetterMe 的“全屏单步选择 + 顶部进度 + 结果解锁”节奏，但做了三处改造：

- 每一步都有即时“实时计划预览”，用户能理解为什么继续填写。
- 结果页展示健康信号、可解释洞察和目标窗口，而不是只给一个分数。
- 不强制注册或填写邮箱，匿名 HttpOnly session 负责恢复进度；付款是可重放的演示回调。

## 技术栈

- Next.js App Router + Vinext + TypeScript
- Cloudflare Worker 兼容运行时
- Drizzle ORM + SQLite/D1
- Zod 服务端校验
- Vitest 自动化测试
- 原生 WebMCP 工具：读取进度、保存步骤、完成测评、解锁结果

## 启动

环境要求：Node.js `>=22.13.0`。

```bash
npm install
npm run db:generate   # schema 变化时生成新的 Drizzle migration
npm run build
npm start
```

本地 D1 首次使用时执行：

```bash
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_pulse_initial.sql
```

开发预览也可以用 `npm run dev`；完整 API 验证建议使用 `npm start`，因为它会通过 Wrangler 启动带 D1 的 Worker。

## API

所有写接口都通过 `pulse_session` HttpOnly Cookie 绑定当前测评会话。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/assessment` | 创建或恢复当前 session |
| PATCH | `/api/assessment` | 保存一个步骤，支持乱序和重复提交 |
| POST | `/api/assessment/complete` | 服务端校验完整数据并生成结果 |
| GET | `/api/results` | 会员返回完整数据，非会员不返回 `details/curve` |
| POST | `/api/pay` | 模拟支付回调，将订阅状态改为 active |

### 可重放的 `/pay` 流程

下面的命令会生成一个新的 session。把 `BASE` 改成线上 URL 即可在线演示；`-c/-b` 用来保存和复用会话 Cookie。

```bash
BASE=http://127.0.0.1:8787

curl -sS -c pulse.cookies "$BASE/api/assessment"
curl -sS -b pulse.cookies -H 'Content-Type: application/json' -X PATCH \
  -d '{"step":"identity","data":{"gender":"woman"}}' "$BASE/api/assessment"
curl -sS -b pulse.cookies -H 'Content-Type: application/json' -X PATCH \
  -d '{"step":"goal","data":{"goal":"feel_lighter"}}' "$BASE/api/assessment"
curl -sS -b pulse.cookies -H 'Content-Type: application/json' -X PATCH \
  -d '{"step":"activity","data":{"activityLevel":"steady","exerciseDays":3}}' "$BASE/api/assessment"
curl -sS -b pulse.cookies -H 'Content-Type: application/json' -X PATCH \
  -d '{"step":"body","data":{"age":32,"heightCm":168,"weightKg":76}}' "$BASE/api/assessment"
curl -sS -b pulse.cookies -H 'Content-Type: application/json' -X PATCH \
  -d '{"step":"target","data":{"targetWeightKg":68}}' "$BASE/api/assessment"

# 付款前：access=preview，响应中不包含 details 或 curve
curl -sS -b pulse.cookies -H 'Content-Type: application/json' -X POST \
  -d '{}' "$BASE/api/assessment/complete"
curl -sS -b pulse.cookies "$BASE/api/results"

# 模拟回调后：subscriptionStatus=active，响应中出现完整 details.curve
curl -sS -b pulse.cookies -H 'Content-Type: application/json' -X POST \
  -d '{"plan":"pulse_weekly"}' "$BASE/api/pay"
curl -sS -b pulse.cookies "$BASE/api/results"
```

线上验收时，首次 `GET /api/assessment` 的响应会给出 `session.id`；完成上述流程后，这个值就是可对比的已支付测试 `sessionId`。

## 数据模型

```text
users 1 ──────── N assessment_sessions 1 ──────── N assessment_steps
                         │
                         ├──────── 1 health_results
                         └──────── 1 subscriptions
```

- `assessment_steps` 以 `(session_id, step_key)` 唯一约束保存增量数据，是进度恢复和并发更新的事实来源。
- `assessment_sessions.current_step` 只做快速展示，使用 `max(current_step, incoming_step)`，不会因乱序提交倒退。
- `health_results` 保存服务器计算结果、输入快照和趋势 JSON，`subscriptions` 独立记录权限状态。
- 常用 session 查询和唯一关系都有索引；SQL migration 位于 `drizzle/0000_pulse_initial.sql`。

## 测试覆盖

```bash
npm test
```

当前覆盖 12 个场景：

- BMI、热量、目标日期、趋势曲线的服务端计算
- 年龄、身高、体重的上下界和极端值
- 目标体重范围与“减重目标却填增重”的矛盾输入
- 分步保存、中断恢复、乱序提交、重复提交
- 非会员脱敏，明确断言响应 JSON 不含 `curve`
- `/pay` 状态变化及会员结果从 preview 到 full 的端到端服务闭环

暂未覆盖真实第三方支付签名和生产 D1 网络故障重试，因为本题要求的是可重放的模拟回调；生产化时应为 `/api/pay` 增加 provider 签名校验、幂等键和审计日志。

## AI 使用复盘

AI 协助拆分了实体关系、生成 Zod 边界数据、补齐测试矩阵和整理 API 文档；最终保留了“步骤表为事实来源”的模型，以避免并发保存不同步骤时读改写 `data_json` 造成丢数据。

有一次 AI 生成的初版 `/api/assessment/complete` 直接返回了完整结果，其中包含趋势曲线。这个方案被否决：即使结果页随后再做脱敏，调用者仍可从 complete 接口绕过权限拿到受保护字段。现在 complete 在保存结果后只返回和 `/api/results` 相同的脱敏视图，只有 `/api/pay` 成功后才返回 `details.curve`。
