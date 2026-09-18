CREATE TABLE IF NOT EXISTS `users` (
  `id` text PRIMARY KEY NOT NULL,
  `anonymous_key` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_users_anonymous_key` ON `users` (`anonymous_key`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `assessment_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `status` text DEFAULT 'in_progress' NOT NULL,
  `current_step` integer DEFAULT 0 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CHECK (`status` IN ('in_progress', 'completed')),
  CHECK (`current_step` BETWEEN 0 AND 5),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_assessment_sessions_user_id` ON `assessment_sessions` (`user_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `assessment_steps` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `session_id` text NOT NULL,
  `step_key` text NOT NULL,
  `payload_json` text NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CHECK (`step_key` IN ('identity', 'goal', 'activity', 'body', 'target')),
  FOREIGN KEY (`session_id`) REFERENCES `assessment_sessions`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_assessment_steps_session_step` ON `assessment_steps` (`session_id`,`step_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_assessment_steps_session_id` ON `assessment_steps` (`session_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `health_results` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `session_id` text NOT NULL,
  `bmi` integer NOT NULL,
  `bmi_exact` text NOT NULL,
  `bmi_category` text NOT NULL,
  `calorie_target` integer NOT NULL,
  `target_date` text NOT NULL,
  `score` integer NOT NULL,
  `insight` text NOT NULL,
  `curve_json` text NOT NULL,
  `input_json` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CHECK (`bmi_category` IN ('low', 'balanced', 'high')),
  CHECK (`calorie_target` > 0),
  CHECK (`score` BETWEEN 0 AND 100),
  FOREIGN KEY (`session_id`) REFERENCES `assessment_sessions`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_health_results_session_id` ON `health_results` (`session_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `subscriptions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `session_id` text NOT NULL,
  `status` text DEFAULT 'inactive' NOT NULL,
  `plan_code` text DEFAULT 'pulse_weekly' NOT NULL,
  `paid_at` text,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CHECK (`status` IN ('inactive', 'active')),
  CHECK (`plan_code` = 'pulse_weekly'),
  FOREIGN KEY (`session_id`) REFERENCES `assessment_sessions`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_subscriptions_session_id` ON `subscriptions` (`session_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `payment_orders` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `order_no` text NOT NULL,
  `provider` text NOT NULL,
  `plan_code` text NOT NULL,
  `amount_fen` integer NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `checkout_token` text NOT NULL,
  `expires_at` text NOT NULL,
  `paid_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CHECK (`provider` = 'wechat_mock'),
  CHECK (`plan_code` = 'pulse_weekly'),
  CHECK (`status` IN ('pending', 'paid', 'expired')),
  CHECK (`amount_fen` > 0),
  FOREIGN KEY (`session_id`) REFERENCES `assessment_sessions`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_payment_orders_order_no` ON `payment_orders` (`order_no`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_payment_orders_checkout_token` ON `payment_orders` (`checkout_token`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_payment_orders_session_status` ON `payment_orders` (`session_id`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_payment_orders_session_pending`
  ON `payment_orders` (`session_id`) WHERE `status` = 'pending';
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_assessment_steps_in_progress_insert`
BEFORE INSERT ON `assessment_steps`
WHEN NOT EXISTS (
  SELECT 1 FROM `assessment_sessions`
  WHERE `id` = NEW.`session_id` AND `status` = 'in_progress'
)
BEGIN
  SELECT RAISE(ABORT, 'assessment session is not writable');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_assessment_steps_in_progress_update`
BEFORE UPDATE OF `session_id`, `step_key`, `payload_json` ON `assessment_steps`
WHEN NOT EXISTS (
  SELECT 1 FROM `assessment_sessions`
  WHERE `id` = NEW.`session_id` AND `status` = 'in_progress'
)
BEGIN
  SELECT RAISE(ABORT, 'assessment session is not writable');
END;
