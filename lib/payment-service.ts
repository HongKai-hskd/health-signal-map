import {
  AssessmentError,
  type AssessmentStore,
} from "./assessment-service";

export const PAYMENT_PLAN = "pulse_weekly" as const;
export const PAYMENT_AMOUNT_FEN = 990;
export const PAYMENT_CHECKOUT_TTL_MS = 15 * 60 * 1000;

export type PaymentPlan = typeof PAYMENT_PLAN;
export type PaymentOrderStatus = "pending" | "paid" | "expired";

export type PaymentOrder = {
  id: string;
  sessionId: string;
  orderNo: string;
  provider: "wechat_mock";
  plan: PaymentPlan;
  amountFen: number;
  status: PaymentOrderStatus;
  checkoutToken: string;
  expiresAt: string;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicPaymentOrder = Omit<PaymentOrder, "checkoutToken" | "sessionId">;
export type PayerPaymentOrder = Pick<
  PaymentOrder,
  "orderNo" | "provider" | "plan" | "amountFen" | "status" | "expiresAt" | "paidAt"
>;

export type PaymentOrderStore = {
  createPaymentOrder(order: PaymentOrder): Promise<PaymentOrder>;
  getLatestPendingPaymentOrder(sessionId: string): Promise<PaymentOrder | null>;
  getPaymentOrder(sessionId: string, orderId: string): Promise<PaymentOrder | null>;
  getPaymentOrderByCheckoutToken(checkoutToken: string): Promise<PaymentOrder | null>;
  expirePaymentOrder(orderId: string, updatedAt: string): Promise<PaymentOrder | null>;
  confirmPaymentOrder(orderId: string, paidAt: string): Promise<PaymentOrder | null>;
};

type MockPaymentStore = Pick<
  AssessmentStore,
  "getResult" | "getSubscriptionStatus" | "activateSubscription"
> & PaymentOrderStore;

export function toPublicPaymentOrder(order: PaymentOrder): PublicPaymentOrder {
  return {
    id: order.id,
    orderNo: order.orderNo,
    provider: order.provider,
    plan: order.plan,
    amountFen: order.amountFen,
    status: order.status,
    expiresAt: order.expiresAt,
    paidAt: order.paidAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

export function toPayerPaymentOrder(order: PaymentOrder): PayerPaymentOrder {
  const { orderNo, provider, plan, amountFen, status, expiresAt, paidAt } = order;
  return { orderNo, provider, plan, amountFen, status, expiresAt, paidAt };
}

export class MockPaymentService {
  constructor(private readonly store: MockPaymentStore) {}

  async createCheckout(sessionId: string, now = new Date()): Promise<PaymentOrder> {
    const result = await this.store.getResult(sessionId);
    if (!result) throw new AssessmentError("请先完成测评，再创建支付订单。", 409);

    const subscriptionStatus = await this.store.getSubscriptionStatus(sessionId);
    if (subscriptionStatus === "active") {
      throw new AssessmentError("完整地图已经解锁，无需重复支付。", 409);
    }

    const current = await this.store.getLatestPendingPaymentOrder(sessionId);
    if (current) {
      const normalized = await this.normalizeStatus(current, now);
      if (normalized.status === "pending") return normalized;
    }

    const createdAt = now.toISOString();
    return this.store.createPaymentOrder({
      id: crypto.randomUUID(),
      sessionId,
      orderNo: `PULSE-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
      provider: "wechat_mock",
      plan: PAYMENT_PLAN,
      amountFen: PAYMENT_AMOUNT_FEN,
      status: "pending",
      checkoutToken: crypto.randomUUID(),
      expiresAt: new Date(now.getTime() + PAYMENT_CHECKOUT_TTL_MS).toISOString(),
      paidAt: null,
      createdAt,
      updatedAt: createdAt,
    });
  }

  async getCheckout(sessionId: string, orderId: string, now = new Date()) {
    const order = await this.store.getPaymentOrder(sessionId, orderId);
    if (!order) throw new AssessmentError("找不到当前会话的支付订单。", 404);
    return this.normalizeStatus(order, now);
  }

  async getPayerCheckout(checkoutToken: string, now = new Date()): Promise<PayerPaymentOrder> {
    const order = await this.store.getPaymentOrderByCheckoutToken(checkoutToken);
    if (!order) throw new AssessmentError("支付二维码无效或已经失效。", 404);
    return toPayerPaymentOrder(await this.normalizeStatus(order, now));
  }

  async confirmCheckout(checkoutToken: string, now = new Date()) {
    const order = await this.store.getPaymentOrderByCheckoutToken(checkoutToken);
    if (!order) throw new AssessmentError("支付二维码无效或已经失效。", 404);

    const normalized = await this.normalizeStatus(order, now);
    if (normalized.status === "expired") {
      throw new AssessmentError("该模拟支付二维码已过期，请回到桌面端重新生成。", 409);
    }
    if (normalized.status === "paid") return normalized;

    const confirmed = await this.store.confirmPaymentOrder(normalized.id, now.toISOString());
    if (!confirmed) throw new AssessmentError("支付订单不存在。", 404);
    return confirmed;
  }

  private async normalizeStatus(order: PaymentOrder, now: Date): Promise<PaymentOrder> {
    if (order.status !== "pending" || Date.parse(order.expiresAt) > now.getTime()) return order;
    return (await this.store.expirePaymentOrder(order.id, now.toISOString())) ?? order;
  }
}
