// deno-lint-ignore no-import-prefix -- test-only std dep; no shared deno.json by design
import { assert, assertEquals } from "jsr:@std/assert@1";
import { createMonitor, loadSentry, scrubPhones, type SentryLike } from "./monitoring.ts";

function envOf(vars: Record<string, string>) {
  return (k: string) => vars[k];
}

class RecordingSentry implements SentryLike {
  inits: unknown[] = [];
  captures: { err: unknown; hint: unknown }[] = [];
  flushes = 0;
  init(options: unknown) {
    this.inits.push(options);
  }
  captureException(err: unknown, hint: unknown) {
    this.captures.push({ err, hint });
    return "event-id";
  }
  flush() {
    this.flushes++;
    return Promise.resolve(true);
  }
}

Deno.test("monitoring: a no-op without SENTRY_DSN, and never loads the SDK", async () => {
  let loads = 0;
  const capture = createMonitor({
    env: envOf({}),
    load: () => {
      loads++;
      return Promise.reject(new Error("must not load"));
    },
  });
  await capture(new Error("boom"), { fn: "test" });
  assertEquals(loads, 0);
});

Deno.test("monitoring: with SENTRY_DSN, inits once without default integrations, captures with context, flushes", async () => {
  const sentry = new RecordingSentry();
  let loads = 0;
  const capture = createMonitor({
    env: envOf({
      SENTRY_DSN: "https://key@o1.ingest.sentry.io/1",
      SENTRY_ENVIRONMENT: "production",
      SB_REGION: "ap-south-1",
    }),
    load: () => {
      loads++;
      return Promise.resolve(sentry);
    },
  });
  const err = new Error("boom");
  await capture(err, { fn: "run-jobs", job_id: "j1" });
  await capture(new Error("again"));

  assertEquals(loads, 1);
  assertEquals(sentry.inits, [{
    dsn: "https://key@o1.ingest.sentry.io/1",
    environment: "production",
    defaultIntegrations: false,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: scrubPhones,
  }]);
  assertEquals(sentry.captures.length, 2);
  assertEquals(sentry.captures[0], {
    err,
    hint: {
      tags: { function: "run-jobs", region: "ap-south-1" },
      contexts: { flow: { fn: "run-jobs", job_id: "j1" } },
    },
  });
  assertEquals(sentry.flushes, 2);
});

Deno.test("monitoring: never throws, even when the SDK fails to load or to capture", async () => {
  const quiet = console.error;
  console.error = () => {};
  try {
    const failingLoad = createMonitor({
      env: envOf({ SENTRY_DSN: "https://key@o1.ingest.sentry.io/1" }),
      load: () => Promise.reject(new Error("no network")),
    });
    await failingLoad(new Error("boom"));

    const sentry = new RecordingSentry();
    sentry.captureException = () => {
      throw new Error("sdk bug");
    };
    const failingCapture = createMonitor({
      env: envOf({ SENTRY_DSN: "https://key@o1.ingest.sentry.io/1" }),
      load: () => Promise.resolve(sentry),
    });
    await failingCapture(new Error("boom"));
  } finally {
    console.error = quiet;
  }
});

Deno.test("monitoring: events are scrubbed of Indian mobile numbers, ids are kept", () => {
  const id = "00000000-0000-4000-8000-912345678901";
  assertEquals(
    scrubPhones({
      message: "send failed: +919812345678 is not on WhatsApp; 98123 45678 and 9812345678 too",
      extra: { to: "+91 9812345678", job_id: id, n: 1 },
    }),
    {
      message: "send failed: [phone] is not on WhatsApp; [phone] and [phone] too",
      extra: { to: "[phone]", job_id: id, n: 1 },
    },
  );
});

Deno.test("monitoring: phone numbers are scrubbed in the ways people write them", () => {
  for (
    const written of [
      "9812345678",
      "98123 45678",
      "98123-45678",
      "981 234 5678",
      "+919812345678",
      "+91 98123 45678",
      "+91-98123-45678",
      "919812345678",
      "09812345678",
      "0091 9812345678",
    ]
  ) {
    assertEquals(scrubPhones({ e: `to ${written}: failed` }), { e: "to [phone]: failed" }, written);
  }
  assertEquals(scrubPhones({ e: "line one\n9812345678" }), { e: "line one\n[phone]" });
});

Deno.test("monitoring: ids, times and other numbers are left alone", () => {
  const kept = {
    job_id: "00000000-0000-4000-8000-912345678901",
    at: "2026-10-11T21:30:38.263Z",
    ms: 1791758047000,
    big: "98123456789012",
    attempts: "3 of 5",
    short: "98123 456",
  };
  assertEquals(scrubPhones(kept), kept);
});

// The real SDK, sending to a local server that stands in for Sentry.
Deno.test({
  name: "monitoring: the real Sentry SDK delivers the error to the DSN's host",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const received: string[] = [];
    const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, async (req) => {
      received.push(`${new URL(req.url).pathname}\n${await req.text()}`);
      return new Response("{}", { headers: { "content-type": "application/json" } });
    });
    try {
      const capture = createMonitor({
        env: envOf({ SENTRY_DSN: `http://publickey@127.0.0.1:${server.addr.port}/42` }),
        load: loadSentry,
        flushTimeoutMs: 5000,
      });
      await capture(new Error("monitoring test error for +919812345678"), { fn: "monitoring-test", job_id: "job-123" });
      assertEquals(received.length, 1, "one envelope sent");
      assert(received[0].startsWith("/api/42/envelope/"), received[0].slice(0, 80));
      assert(received[0].includes("monitoring test error"));
      assert(received[0].includes("job-123"));
      assert(!received[0].includes("9812345678"), "the phone number never leaves");
      assert(received[0].includes("[phone]"));
    } finally {
      await server.shutdown();
    }
  },
});
