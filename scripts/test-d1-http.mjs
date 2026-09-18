const baseUrl = (process.env.BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
let cookie = "";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function request(path, { method = "GET", body, useCookie = true, expected } = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const headers = {};
      if (useCookie && cookie) headers.Cookie = cookie;
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      const setCookies = response.headers.getSetCookie?.() ?? [];
      if (setCookies.length > 0) cookie = setCookies[0].split(";", 1)[0];
      const raw = await response.text();
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = { raw };
      }
      if ([502, 503, 504].includes(response.status) && attempt < 2) {
        await sleep(150 * (attempt + 1));
        continue;
      }
      if (expected !== undefined && response.status !== expected) {
        throw new Error(`${method} ${path} expected ${expected}, got ${response.status}: ${raw}`);
      }
      return { response, payload };
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await sleep(150 * (attempt + 1));
        continue;
      }
    }
  }
  throw lastError;
}

try {
  await request("/api/pay", {
    method: "POST",
    body: { plan: "pulse_weekly" },
    useCookie: false,
    expected: 401,
  });

  const created = await request("/api/assessment", { expected: 200 });
  const originalSessionId = created.payload.session.id;
  const steps = [
    ["identity", { gender: "woman" }],
    ["goal", { goal: "feel_lighter" }],
    ["activity", { activityLevel: "steady", exerciseDays: 3 }],
    ["body", { age: 32, heightCm: 168, weightKg: 76 }],
    ["target", { targetWeightKg: 68 }],
  ];

  for (const [step, data] of steps) {
    await request("/api/assessment", {
      method: "PATCH",
      body: { step, data },
      expected: 200,
    });
  }

  const completed = await request("/api/assessment/complete", {
    method: "POST",
    body: {},
    expected: 200,
  });
  assert(completed.payload.result.access === "preview", "complete should return preview access");
  assert(!("details" in completed.payload.result), "complete must not expose protected details");

  const repeatedComplete = await request("/api/assessment/complete", {
    method: "POST",
    body: {},
    expected: 200,
  });
  assert(repeatedComplete.payload.result.summary.targetDate === completed.payload.result.summary.targetDate, "complete must be idempotent");

  const preview = await request("/api/results", { expected: 200 });
  assert(preview.payload.access === "preview", "results should start as preview");
  assert(!("details" in preview.payload), "preview results must hide details");

  await request("/api/pay", {
    method: "POST",
    body: { plan: "invalid_plan" },
    expected: 422,
  });
  const checkout = await request("/api/pay", {
    method: "POST",
    body: { plan: "pulse_weekly" },
    expected: 200,
  });
  assert(checkout.payload.payment.status === "pending", "pay should create a pending checkout");
  assert(checkout.payload.payment.amountFen === 990, "checkout should preserve the expected amount");
  const checkoutToken = new URL(checkout.payload.payment.checkoutUrl).searchParams.get("token");
  assert(checkoutToken, "checkout should return a payer token in the QR URL");

  const desktopStatus = await request(`/api/pay?orderId=${checkout.payload.payment.id}`, { expected: 200 });
  assert(desktopStatus.payload.payment.status === "pending", "desktop should observe the pending order");

  const payerStatus = await request(`/api/pay/mock?token=${checkoutToken}`, {
    useCookie: false,
    expected: 200,
  });
  assert(payerStatus.payload.payment.status === "pending", "payer should observe the pending order");

  const paid = await request("/api/pay/mock", {
    method: "POST",
    body: { checkoutToken },
    useCookie: false,
    expected: 200,
  });
  assert(paid.payload.payment.status === "paid", "mock callback should confirm the payment");

  const fullResult = await request("/api/results", { expected: 200 });
  assert(fullResult.payload.access === "full", "paid checkout should unlock full access");
  assert(fullResult.payload.details?.curve?.length > 1, "full results should include the curve");

  await request("/api/pay/mock", {
    method: "POST",
    body: { checkoutToken },
    useCookie: false,
    expected: 200,
  });
  await request("/api/assessment", {
    method: "PATCH",
    body: { step: "body", data: { age: 33, heightCm: 168, weightKg: 75 } },
    expected: 409,
  });

  const reset = await request("/api/assessment/reset", {
    method: "POST",
    body: {},
    expected: 200,
  });
  assert(reset.payload.session.id !== originalSessionId, "reset should issue a new session");
  assert(reset.payload.resultReady === false, "reset session must not have a result");
  const afterReset = await request("/api/assessment", { expected: 200 });
  assert(afterReset.payload.session.status === "in_progress", "reset session should be in progress");
  assert(afterReset.payload.resultReady === false, "reset session should not restore the old result");

  console.log(JSON.stringify({
    baseUrl,
    originalSessionId,
    resetSessionId: reset.payload.session.id,
    stepsSaved: steps.length,
    previewToFull: true,
    completedWriteBlocked: true,
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
