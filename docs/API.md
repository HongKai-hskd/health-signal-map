# API 参考

## 认证与会话

系统使用匿名 `pulse_session` HttpOnly Cookie 绑定一次测评会话。除 `POST /api/assessment/reset` 外，写入和结果接口都要求该 Cookie；唯一例外是扫码后的 `/api/pay/mock`，它使用随机的 `checkoutToken` 表示模拟付款方。reset 是“开始新测评”的入口，即使没有旧 Cookie 也会创建新 session 并下发 Cookie。

服务端不会信任前端传入的用户 ID、订阅状态或计算结果。所有结果都通过当前 Cookie 解析 session，再从 D1 读取。

## 状态码约定

| 状态码 | 含义 |
| --- | --- |
| `200` | 请求成功 |
| `400` | JSON 无效、缺少基础字段或步骤名为空 |
| `401` | 缺少有效 `pulse_session` Cookie |
| `404` | 当前 session、支付订单或二维码 token 不存在 |
| `409` | 当前状态不允许该操作，例如未完成就查看结果、完成后继续写入或二维码过期 |
| `422` | Zod 校验失败、越界值、未知字段或不支持的支付方案 |
| `500` | 未预期的服务端错误 |

校验失败响应统一包含中文错误信息；Zod 错误还会包含 `issues` 数组：

```json
{
  "error": "有些信息需要调整。",
  "issues": [
    { "path": ["age"], "message": "Number must be greater than or equal to 16" }
  ]
}
```

## GET `/api/assessment`

创建或恢复当前匿名 session。

首次访问会返回 `Set-Cookie: pulse_session=...`；已有有效 Cookie 时返回同一个 session。无效 Cookie 会被视为新会话并重新下发 Cookie。

响应：

```json
{
  "session": {
    "id": "session-uuid",
    "userId": "user-uuid",
    "status": "in_progress",
    "currentStep": 2,
    "data": {
      "gender": "woman",
      "goal": "feel_lighter"
    },
    "createdAt": "2026-09-18T00:00:00.000Z",
    "updatedAt": "2026-09-18T00:00:00.000Z"
  },
  "resultReady": false
}
```

## PATCH `/api/assessment`

保存一个经过服务端校验的测评步骤。每个步骤独立 upsert，支持中断恢复、乱序提交和同一步重复提交。

请求头：`Content-Type: application/json`

请求体：

```json
{
  "step": "body",
  "data": {
    "age": 32,
    "heightCm": 168,
    "weightKg": 76
  }
}
```

可用步骤和字段：

| `step` | `data` 字段 |
| --- | --- |
| `identity` | `gender`: `woman`、`man`、`nonbinary`、`prefer_not_to_say` |
| `goal` | `goal`: `feel_lighter`、`get_stronger`、`build_consistency` |
| `activity` | `activityLevel`: `new`、`steady`、`frequent`；`exerciseDays`: `0–7` 的整数 |
| `body` | `age`: `16–90`；`heightCm`: `120–230`；`weightKg`: `35–250` |
| `target` | `targetWeightKg`: `35–250`，且必须符合当前体重比例和目标方向 |

响应：`{ "session": <SessionSnapshot> }`。

未知步骤返回 `400`；未知字段、数组 data、缺失字段和越界值返回 `422`；没有 Cookie 返回 `401`；完成后的 session 返回 `409`。

## POST `/api/assessment/complete`

读取当前 session 的完整步骤，在服务端计算 BMI、每日能量目标、目标日期、趋势和行动计划，并把结果持久化。接口返回的是 preview，不会因为调用 complete 而泄露受保护的趋势数据。

请求体可使用 `{}`。

响应：

```json
{
  "sessionId": "session-uuid",
  "result": {
    "sessionId": "session-uuid",
    "access": "preview",
    "subscriptionStatus": "inactive",
    "summary": {
      "bmi": 26.9,
      "bmiCategory": "high",
      "calorieTarget": 1864,
      "targetDate": "2027-01-21",
      "score": 78,
      "insight": "保持稳定节奏，能让你不必经历极端波动，也能持续向前。"
    },
    "protected": {
      "locked": true,
      "totalWeeks": 18,
      "message": "解锁完整的 18 周路径、每周检查点和趋势变化。"
    }
  }
}
```

数据不完整返回 `422`；没有 Cookie 返回 `401`；结果不存在或无法查看返回 `409`。

## GET `/api/results`

根据当前 session 的订阅状态返回结果。

- `inactive`：返回 `summary` 和 `protected`，不包含 `details`、`curve`、`actionPlan`、`phasePlan` 或 `adjustmentGuide`。
- `active`：返回完整 `details`，包括趋势、目标体重、检查点和行动路线。

结果未生成返回 `409`，没有 Cookie 返回 `401`。

## POST `/api/pay`

创建一笔 `wechat_mock` 待支付订单，不会立即解锁订阅。服务端返回一个携带一次性 `checkoutToken` 的扫码地址；该 token 是模拟付款方进入收银台的能力凭证，不会在桌面端订单状态接口中返回。

这是演示支付，不会调用微信、银行卡或真实转账接口。

请求体：

```json
{ "plan": "pulse_weekly" }
```

响应：

```json
{
  "payment": {
    "id": "order-uuid",
    "orderNo": "PULSE-ABC123DEF456",
    "provider": "wechat_mock",
    "plan": "pulse_weekly",
    "amountFen": 990,
    "status": "pending",
    "expiresAt": "2026-09-18T10:15:00.000Z",
    "checkoutUrl": "https://example.com/pay/mock?token=checkout-token-uuid"
  }
}
```

不支持的 plan 或未知字段返回 `422`；未完成测评或已解锁的 session 返回 `409`；没有 Cookie 返回 `401`。重复创建会复用尚未过期的 pending 订单。

## GET `/api/pay?orderId=<uuid>`

桌面端轮询当前 session 的订单状态。必须携带创建该订单时的 `pulse_session` Cookie，响应不会包含 `checkoutToken`。

```json
{
  "payment": {
    "id": "order-uuid",
    "status": "pending",
    "amountFen": 990,
    "expiresAt": "2026-09-18T10:15:00.000Z"
  }
}
```

订单超过 15 分钟会在本次读取时切换为 `expired`。订单不属于当前 session 返回 `404`。

## GET `/api/pay/mock?token=<uuid>`

扫码后的模拟收银台读取订单。该接口不依赖桌面端 Cookie，但只返回付款方所需的金额、状态、订单号和过期时间，不暴露 sessionId、健康结果或完整报告。

## POST `/api/pay/mock`

模拟付款渠道的成功回调。请求体：

```json
{ "checkoutToken": "checkout-token-uuid" }
```

成功后原子地将订单设为 `paid` 并激活该订单对应 session 的订阅；重复确认保持第一次的 `paidAt`，不会重复扣款或创建第二个订阅。二维码过期返回 `409`，未知 token 返回 `404`。

```json
{
  "payment": {
    "orderNo": "PULSE-ABC123DEF456",
    "provider": "wechat_mock",
    "amountFen": 990,
    "status": "paid",
    "paidAt": "2026-09-18T10:02:00.000Z"
  }
}
```

## POST `/api/assessment/reset`

创建一个全新的 `in_progress` session，并通过 `Set-Cookie` 切换当前浏览器会话。旧 session 和旧结果保留在数据库中，但不会再被当前 Cookie 复用。

请求体可省略。响应结构与 GET `/api/assessment` 相同，且 `resultReady` 固定为 `false`。

## GET `/api/results/export`

下载当前 session 可见范围内的 Markdown 报告。

- preview 状态只导出基线摘要和解锁提示。
- active 状态额外导出目标路径、三条核心动作、四阶段路线、检查点和状态调整规则。

响应头：

```text
Content-Type: text/markdown; charset=utf-8
Content-Disposition: attachment; filename="pulse-08-health-report.md"
```

权限判断复用 `/api/results`，不会通过导出接口绕过 preview/full 边界。
