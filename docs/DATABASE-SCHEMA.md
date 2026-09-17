# 数据库 Schema

## 关系图

```mermaid
erDiagram
  users ||--o{ assessment_sessions : owns
  assessment_sessions ||--o{ assessment_steps : records
  assessment_sessions ||--o| health_results : produces
  assessment_sessions ||--o| subscriptions : unlocks

  users {
    text id PK
    text anonymous_key UK
    text created_at
  }
  assessment_sessions {
    text id PK
    text user_id FK
    text status
    integer current_step
    text created_at
    text updated_at
  }
  assessment_steps {
    integer id PK
    text session_id FK
    text step_key
    text payload_json
    text updated_at
  }
  health_results {
    integer id PK
    text session_id FK UK
    integer bmi
    text bmi_exact
    text bmi_category
    integer calorie_target
    text target_date
    integer score
    text insight
    text curve_json
    text input_json
    text created_at
  }
  subscriptions {
    integer id PK
    text session_id FK UK
    text status
    text plan_code
    text paid_at
    text updated_at
  }
```

## 表职责

| 表 | 职责 | 关键约束 |
| --- | --- | --- |
| `users` | 保存匿名用户主体，不要求注册 | `anonymous_key` 唯一 |
| `assessment_sessions` | 保存一次测评的生命周期和进度 | `status` 为 `in_progress` 或 `completed` |
| `assessment_steps` | 保存分步输入，是恢复进度和合并数据的事实来源 | `(session_id, step_key)` 唯一 |
| `health_results` | 保存服务端计算结果和输入快照 | 每个 session 最多一条结果 |
| `subscriptions` | 保存模拟订阅状态和方案 | 每个 session 最多一条订阅 |

## 关键设计判断

1. 分步数据不直接覆盖 session 的整块 JSON，而是按步骤单独 upsert。这样不同步骤并发保存时不会发生整块数据的丢失。
2. `assessment_sessions.current_step` 只用于快速恢复 UI，真实数据由 `assessment_steps` 合并得到；乱序请求通过 `max(current_step, incoming_step)` 防止进度倒退。
3. `health_results.input_json` 保存计算输入快照，结果生成后 session 进入 `completed`，后续修改会被拒绝，避免结果和输入不一致。
4. `subscriptions` 与结果表分离，结果接口根据订阅状态决定返回 preview 还是 full，不把权限判断交给前端。
5. `bmi` 保留整数展示字段，同时使用 `bmi_exact` 保留一位小数，兼顾查询和展示。

## 源码与验证路径

- Drizzle schema：`db/schema.ts`
- 初始 migration：`drizzle/0000_pulse_initial.sql`
- D1 存储实现：`lib/d1-store.ts`
- 本地 D1 流程：`scripts/test-d1-http.mjs`
- Schema 图和字段说明：本文档

## 证据链

| 结论 | 证据 | 路径 |
| --- | --- | --- |
| 分步保存可恢复 | 读取 session 时按步骤行合并 payload | `lib/d1-store.ts` 的 `getSession` |
| 同一步重复提交可覆盖 | 使用 `(session_id, step_key)` 冲突更新 | `lib/d1-store.ts` 的 `saveStep` |
| 结果与订阅一对一 | 两张表均有 session 唯一索引 | `db/schema.ts`、`drizzle/0000_pulse_initial.sql` |
| 三张核心关系可落地 | migration 中存在外键与索引 | `drizzle/0000_pulse_initial.sql` |
