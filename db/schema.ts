import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    anonymousKey: text("anonymous_key").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("uq_users_anonymous_key").on(table.anonymousKey)],
);

export const assessmentSessions = sqliteTable(
  "assessment_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    status: text("status", { enum: ["in_progress", "completed"] })
      .notNull()
      .default("in_progress"),
    currentStep: integer("current_step").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_assessment_sessions_user_id").on(table.userId)],
);

export const assessmentSteps = sqliteTable(
  "assessment_steps",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => assessmentSessions.id),
    stepKey: text("step_key").notNull(),
    payloadJson: text("payload_json").notNull(),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("uq_assessment_steps_session_step").on(
      table.sessionId,
      table.stepKey,
    ),
    index("idx_assessment_steps_session_id").on(table.sessionId),
  ],
);

export const healthResults = sqliteTable(
  "health_results",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => assessmentSessions.id),
    bmi: integer("bmi").notNull(),
    bmiExact: text("bmi_exact").notNull(),
    bmiCategory: text("bmi_category").notNull(),
    calorieTarget: integer("calorie_target").notNull(),
    targetDate: text("target_date").notNull(),
    score: integer("score").notNull(),
    insight: text("insight").notNull(),
    curveJson: text("curve_json").notNull(),
    inputJson: text("input_json").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("uq_health_results_session_id").on(table.sessionId)],
);

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => assessmentSessions.id),
    status: text("status", { enum: ["inactive", "active"] })
      .notNull()
      .default("inactive"),
    planCode: text("plan_code").notNull().default("pulse_weekly"),
    paidAt: text("paid_at"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("uq_subscriptions_session_id").on(table.sessionId)],
);

export const paymentOrders = sqliteTable(
  "payment_orders",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => assessmentSessions.id),
    orderNo: text("order_no").notNull(),
    provider: text("provider", { enum: ["wechat_mock"] }).notNull(),
    planCode: text("plan_code", { enum: ["pulse_weekly"] }).notNull(),
    amountFen: integer("amount_fen").notNull(),
    status: text("status", { enum: ["pending", "paid", "expired"] })
      .notNull()
      .default("pending"),
    checkoutToken: text("checkout_token").notNull(),
    expiresAt: text("expires_at").notNull(),
    paidAt: text("paid_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("uq_payment_orders_order_no").on(table.orderNo),
    uniqueIndex("uq_payment_orders_checkout_token").on(table.checkoutToken),
    index("idx_payment_orders_session_status").on(table.sessionId, table.status),
  ],
);
