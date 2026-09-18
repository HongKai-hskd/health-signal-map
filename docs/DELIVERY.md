# 全栈挑战交付文档

## 交付说明

本文是本项目的主交付文档，按《需求.txt》的交付物和评分点整理。所有交付相关说明统一放在 `docs/` 目录；本文作为入口，专题文档作为明细和证据。

当前版本已完成本地开发、接口闭环、数据库建模、测试和文档整理。按照当前任务范围，公网部署、GitHub 公网链接和线上已支付 sessionId 暂不执行，待上线阶段补齐。

## 一、交付内容总览

| 需求项 | 当前状态 | 交付证据 |
| --- | --- | --- |
| 测评漏斗与分步保存 | 已完成 | `app/api/assessment/route.ts`、`lib/d1-store.ts` |
| 中断恢复、重复提交、乱序更新 | 已完成 | `lib/assessment-service.ts`、`tests/health-assessment.test.ts` |
| 服务端 BMI、热量、目标日期计算 | 已完成 | `lib/domain.ts`、`app/api/assessment/complete/route.ts` |
| 结果持久化 | 已完成 | `health_results` 表、D1 store |
| 非会员/会员差异化结果 | 已完成 | `app/api/results/route.ts`、`tests/api-routes.test.ts` |
| 模拟扫码支付与回调 | 已完成 | `payment_orders`、`app/api/pay/*`、`app/pay/mock/page.tsx` |
| 数据校验与错误响应 | 已完成 | Zod schemas、API route tests |
| 自动化测试与 CI | 已完成 | `tests/`、`.github/workflows/ci.yml`、[测试说明](./TESTING.md) |
| 数据库 Schema 图 | 已完成 | [数据库 Schema](./DATABASE-SCHEMA.md) |
| API 文档 | 已完成 | [API 参考](./API.md) |
| AI 使用复盘 | 已完成 | [AI 使用复盘](./AI-RETROSPECTIVE.md) |
| 公网部署与线上演示 | 待上线 | 本次明确不执行部署 |

## 二、如何运行和验收

### 本地启动

```bash
npm install
npm start
```

启动后访问：`http://127.0.0.1:8787/`

### 一键测试

```bash
npm test
npm run lint
npx tsc --noEmit
npm run test:d1
npm run build
```

本次验收结果：

- Vitest：22/22 通过
- API route 测试：通过
- D1 HTTP smoke：通过，覆盖创建、分步保存、完成、preview、二维码订单、模拟回调、full 和 reset
- TypeScript：通过
- ESLint：通过
- Production build：通过

### 端到端验收路径

1. 打开首页，获取或恢复 `pulse_session`。
2. 依次提交性别、目标、运动频率、身体数据和目标日期。
3. 调用 `POST /api/assessment/complete`，服务端计算并持久化结果。
4. 调用 `GET /api/results`，未支付时只能得到 preview。
5. 调用 `POST /api/pay` 创建 15 分钟有效的待支付订单，展示本地生成的二维码。
6. 扫码打开 `/pay/mock?token=...`，点击“确认模拟支付”；不会产生真实扣款。
7. 模拟回调将订单设为 paid 并激活订阅，桌面端轮询后自动得到完整结果。
8. 调用 reset 创建新的测评 session，旧 session 数据保留。

`/pay` 可重放方式：

```bash
curl -X POST http://127.0.0.1:8787/api/pay \
  -H "Content-Type: application/json" \
  -H "Cookie: pulse_session=<sessionId>" \
  -d '{"plan":"pulse_weekly"}'
```

响应中的 `payment.checkoutUrl` 是二维码载荷。演示确认可调用 `POST /api/pay/mock` 并传入该 URL 的 `token`；完整请求体、响应体、状态码和权限边界见 [API 参考](./API.md)。

## 三、接口与权限契约

| 方法 | 路径 | 用途 | 访问边界 |
| --- | --- | --- | --- |
| `GET` | `/api/assessment` | 创建或恢复当前 session | 无 Cookie 时创建并下发 Cookie |
| `PATCH` | `/api/assessment` | 增量保存一个步骤 | 必须有 `pulse_session` |
| `POST` | `/api/assessment/complete` | 服务端计算并完成测评 | 必须有 Cookie，完成后不可继续写入 |
| `GET` | `/api/results` | 获取 preview 或 full 结果 | 必须有 Cookie；订阅决定字段范围 |
| `POST` | `/api/pay` | 创建模拟扫码订单 | 必须有 Cookie，返回 pending 和 checkoutUrl |
| `GET` | `/api/pay?orderId=<uuid>` | 轮询订单状态 | 必须有 Cookie，订单必须属于当前 session |
| `GET/POST` | `/api/pay/mock` | 读取/确认模拟收银台订单 | 使用短时 checkout token，无需桌面 Cookie |
| `POST` | `/api/assessment/reset` | 创建新的测评 session | 特殊例外：不要求旧 Cookie |
| `GET` | `/api/results/export` | 导出结果 Markdown | 必须有 Cookie，并遵守订阅边界 |

统一约定：

- `400`：请求体不是合法 JSON 或缺少必要字段。
- `401`：缺少或无效的 `pulse_session`。
- `404`：订单、session 或扫码 token 不存在。
- `409`：session 已完成、重复完成、二维码过期或状态冲突。
- `422`：字段结构、枚举或数值边界不合法。
- `200`：成功；结果接口根据订阅状态返回 preview/full。

非会员结果不会返回具体预测曲线、完整行动路线等受保护字段；前端只负责展示，权限判断在服务端完成。

## 四、数据库交付摘要

当前关系模型由六张表组成：

| 表 | 作用 | 关键约束 |
| --- | --- | --- |
| `users` | 匿名用户主体 | `id` 主键，`anonymous_key` 唯一 |
| `assessment_sessions` | 一次测评的生命周期和进度 | `user_id` 外键，状态和当前步骤 |
| `assessment_steps` | 分步输入事实 | `(session_id, step_key)` 唯一，支持 upsert |
| `health_results` | 服务端计算结果和输入快照 | `session_id` 唯一 |
| `subscriptions` | 模拟订阅状态 | `session_id` 唯一 |
| `payment_orders` | 模拟扫码订单与回调状态 | 订单号和扫码 token 唯一；同一 session 最多一个 pending |

主要设计决定：

- 分步数据拆成 `assessment_steps`，避免后续步骤覆盖前面步骤。
- `current_step` 只用于快速恢复 UI，真实输入以步骤表合并结果为准。
- 结果表保存输入快照，完成后禁止再修改步骤，避免结果与输入不一致。
- 订阅与结果分离，由服务端根据订阅状态控制 preview/full。
- 支付订单和订阅分离；订单必须从 pending 经模拟收银台确认到 paid，才会激活订阅。
- BMI 同时保存整数展示值和一位小数的精确值。

完整 ER 图、字段清单、约束分层和生产化扩展建议见 [数据库 Schema](./DATABASE-SCHEMA.md)。

## 五、测试覆盖

| 测试范围 | 已覆盖内容 |
| --- | --- |
| 算法单元测试 | BMI、热量、目标日期、边界值、非法值、目标体重关系 |
| 分步保存 | 首次保存、重复提交、乱序提交、进度恢复 |
| 状态一致性 | 已完成 session 拒绝后续写入，重复完成返回冲突 |
| 鉴权 | 未登录、无效 Cookie、未支付 preview、已支付 full |
| 数据保护 | 非会员响应不包含 `details` 和 `curve` |
| 支付闭环 | pending 订单经扫码模拟确认后，结果由 preview 变为 full |
| D1 smoke | 真实 HTTP 路由和本地 D1 持久化链路 |

测试选择、已知边界和 CI 说明见 [TESTING.md](./TESTING.md)。

## 六、技术选型说明与风险边界

### 当前实现

- TypeScript
- Next.js App Router 兼容路由形态 / Vinext runtime
- Drizzle ORM
- SQLite / Cloudflare D1
- Vitest
- Zod

### 与原始需求的差异

原始需求在技术要求中举例 `Supabase / Prisma + PostgreSQL`。当前实现使用 `Drizzle + D1/SQLite`，关系模型、外键、唯一索引、服务端校验和持久化流程已经完成，但并非 PostgreSQL 技术栈。

如果评审严格要求 PostgreSQL，需要在上线前将 Drizzle schema 迁移为 PostgreSQL dialect，替换 D1 adapter，并重新跑 migration、D1 smoke 对应的 PostgreSQL 集成测试。这个差异已经明确记录，不应在提交说明中假装两者完全等价。

### 当前不属于本次范围的生产化增强

- 正式账号体系和跨设备身份绑定：当前是匿名 `pulse_session`。
- 真实支付 provider、签名验签、金额核验和 webhook 事件表：当前为不接外部资金的 `wechat_mock`。
- 更完整的数据库级 enum/check 约束：当前已有核心状态、步骤、金额和方案 CHECK；JSON 业务字段仍由 Zod 和 domain service 保证。
- 多实例下更强的乐观锁版本号：当前已避免整块 JSON 覆盖，但生产部署仍可增加 `version`/CAS。
- 算法版本字段：当前行动计划在读取时由输入重新生成，生产报告应保存算法版本以保证历史复现。

## 七、提交前清单

- [x] 根目录 README 已提供启动命令、API 概览、测试命令和 `/pay` 调用方式。
- [x] 本 `docs/DELIVERY.md` 作为主交付文档。
- [x] `docs/API.md` 已提供接口级请求、响应和错误契约。
- [x] `docs/DATABASE-SCHEMA.md` 已提供 ER 图、字段和约束说明。
- [x] `docs/TESTING.md` 已提供测试矩阵和 CI 说明。
- [x] `docs/AI-RETROSPECTIVE.md` 已提供 AI 协作复盘和被否决方案。
- [x] 本地测试、lint、类型检查、D1 smoke 和 build 已通过。
- [ ] 公网 URL、GitHub URL、线上已支付 sessionId：部署后补齐。

## 八、相关交付文件

- [README](../README.md)
- [API 参考](./API.md)
- [数据库 Schema](./DATABASE-SCHEMA.md)
- [测试说明](./TESTING.md)
- [AI 使用复盘](./AI-RETROSPECTIVE.md)
- [交付清单](./DELIVERY-CHECKLIST.md)
