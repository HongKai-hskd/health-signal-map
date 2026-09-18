# 自动化测试与质量保障

## 一键验证

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

完整 D1 HTTP 验证：

```bash
npm run db:local:seed
npm start
npm run test:d1
```

## 测试分层

| 层级 | 文件或命令 | 覆盖内容 |
| --- | --- | --- |
| Domain 单元测试 | `tests/health-assessment.test.ts` | BMI、能量目标、目标日期、趋势、四阶段路线、非法边界 |
| Service 集成测试 | `tests/health-assessment.test.ts` | 恢复、乱序、重复、`Promise.all` 并发、完成幂等、旧会话写保护 |
| Route 集成测试 | `tests/api-routes.test.ts` | Cookie、HTTP 状态码、非法 JSON、非法字段、preview/full、支付和 Markdown 导出 |
| D1 HTTP smoke | `npm run test:d1` | 真实 Worker、D1 持久化、Cookie 恢复、支付、reset 和结果权限 |
| CI | `.github/workflows/ci.yml` | Node 22、类型检查、lint、测试、构建、D1 smoke |

当前 `npm test` 共 19 个测试：15 个健康评估与服务测试，4 个 API Route 测试。

## 关键场景矩阵

| 场景 | 预期 | 验证位置 |
| --- | --- | --- |
| 没有 Cookie 访问结果或支付 | `401` | `tests/api-routes.test.ts` |
| 非法 JSON | `400`，返回中文错误 | `tests/api-routes.test.ts` |
| PATCH 顶层未知字段 | `422`，拒绝未声明输入 | `tests/api-routes.test.ts` |
| 未知步骤 | `400` | `tests/api-routes.test.ts` |
| 年龄、身高、体重越界 | `422` | 两个测试文件 |
| 未知字段或数组 data | `422` | `tests/api-routes.test.ts` |
| 目标体重不合理 | 校验失败 | `tests/health-assessment.test.ts` |
| 不同步骤并发保存 | 所有步骤保留 | `tests/health-assessment.test.ts` |
| 完成后继续修改 | `409` | `tests/api-routes.test.ts`、D1 smoke |
| Store 层绕过 Service 写入已完成 session | `409` | `tests/health-assessment.test.ts` |
| preview 读取趋势 | 不返回 `details/curve` | 两个测试文件 |
| 支付后读取结果 | 返回完整 `details` | `tests/api-routes.test.ts`、D1 smoke |
| 重复支付 | 保持 active，不重复创建订阅 | `tests/api-routes.test.ts` |
| 重新测评 | 返回新 session | `tests/api-routes.test.ts`、D1 smoke |
| 导出报告 | preview/full 遵守同一权限边界 | `tests/api-routes.test.ts` |

## CI 流程

GitHub Actions 位于 `.github/workflows/ci.yml`，顺序如下：

1. Node.js 22 安装依赖。
2. 执行 TypeScript 类型检查。
3. 执行 ESLint。
4. 执行 Vitest 单元与 Route 测试。
5. 执行生产构建。
6. 初始化本地 D1，启动 Worker。
7. 执行真实 HTTP smoke 测试。

这样 CI 不只验证内存 Store，也会验证 Worker + D1 的实际链路。

## 已知边界

以下内容属于生产化扩展，不是本题模拟订阅要求的一部分：

- 真实支付 provider 的签名校验和事件审计表
- 生产 D1 网络故障、限流和重试策略
- 公网部署后的浏览器跨网络 E2E 测试

## 证据链

| 结论 | 证据 | 路径 |
| --- | --- | --- |
| 核心算法有边界测试 | 极端年龄、身高、体重和目标体重测试 | `tests/health-assessment.test.ts` |
| API 有异常路径测试 | 状态码和响应内容断言 | `tests/api-routes.test.ts` |
| D1 真实链路可复现 | cURL 等价的 fetch smoke 流程 | `scripts/test-d1-http.mjs` |
| CI 覆盖构建与 Worker | GitHub Actions 步骤 | `.github/workflows/ci.yml` |
