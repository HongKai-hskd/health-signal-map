import { describe, expect, it } from "vitest";
import {
  AssessmentService,
  InMemoryAssessmentStore,
} from "../lib/assessment-service";
import { MockPaymentService } from "../lib/payment-service";

async function completedSession() {
  const store = new InMemoryAssessmentStore();
  const assessments = new AssessmentService(store);
  const { session } = await assessments.getOrCreateSession();

  await assessments.saveStep(session.id, "identity", { gender: "woman" });
  await assessments.saveStep(session.id, "goal", { goal: "feel_lighter" });
  await assessments.saveStep(session.id, "activity", { activityLevel: "steady", exerciseDays: 3 });
  await assessments.saveStep(session.id, "body", { age: 32, heightCm: 168, weightKg: 76 });
  await assessments.saveStep(session.id, "target", { targetWeightKg: 68 });
  await assessments.complete(session.id);

  return { store, assessments, session };
}

describe("mock QR payment flow", () => {
  it("reuses one pending order when checkout creation races", async () => {
    const { store, session } = await completedSession();
    const payments = new MockPaymentService(store);

    const checkouts = await Promise.all([
      payments.createCheckout(session.id, new Date("2026-09-18T10:00:00.000Z")),
      payments.createCheckout(session.id, new Date("2026-09-18T10:00:00.001Z")),
    ]);

    expect(checkouts[0].id).toBe(checkouts[1].id);
    expect((await store.getLatestPendingPaymentOrder(session.id))?.id).toBe(checkouts[0].id);
  });

  it("creates a pending checkout and unlocks the report only after an idempotent payer confirmation", async () => {
    const { store, assessments, session } = await completedSession();
    const payments = new MockPaymentService(store);

    const checkout = await payments.createCheckout(session.id, new Date("2026-09-18T10:00:00.000Z"));
    expect(checkout.status).toBe("pending");
    expect(checkout.amountFen).toBe(990);
    expect(checkout.plan).toBe("pulse_weekly");
    expect(checkout.expiresAt).toBe("2026-09-18T10:15:00.000Z");
    expect((await assessments.getResults(session.id)).access).toBe("preview");

    const payerView = await payments.getPayerCheckout(checkout.checkoutToken, new Date("2026-09-18T10:01:00.000Z"));
    expect(payerView.orderNo).toBe(checkout.orderNo);
    expect(payerView.status).toBe("pending");
    expect(payerView.amountFen).toBe(990);

    const paid = await payments.confirmCheckout(checkout.checkoutToken, new Date("2026-09-18T10:02:00.000Z"));
    expect(paid.status).toBe("paid");
    expect(paid.paidAt).toBe("2026-09-18T10:02:00.000Z");
    expect((await assessments.getResults(session.id)).access).toBe("full");

    const repeated = await payments.confirmCheckout(checkout.checkoutToken, new Date("2026-09-18T10:03:00.000Z"));
    expect(repeated.status).toBe("paid");
    expect(repeated.paidAt).toBe("2026-09-18T10:02:00.000Z");
  });

  it("expires a stale QR code without unlocking the report and creates a fresh checkout", async () => {
    const { store, assessments, session } = await completedSession();
    const payments = new MockPaymentService(store);
    const createdAt = new Date("2026-09-18T10:00:00.000Z");
    const checkout = await payments.createCheckout(session.id, createdAt);

    const expiredAt = new Date("2026-09-18T10:16:00.000Z");
    expect((await payments.getPayerCheckout(checkout.checkoutToken, expiredAt)).status).toBe("expired");
    await expect(payments.confirmCheckout(checkout.checkoutToken, expiredAt)).rejects.toMatchObject({ status: 409 });
    expect((await assessments.getResults(session.id)).access).toBe("preview");

    const replacement = await payments.createCheckout(session.id, expiredAt);
    expect(replacement.id).not.toBe(checkout.id);
    expect(replacement.status).toBe("pending");
  });
});
