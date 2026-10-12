// Error reporting for the Edge Functions (spec 004, E.4). A no-op unless
// SENTRY_DSN is set; then errors go to Sentry through the Deno SDK.
//
// Following Supabase's Sentry guide: default integrations are off, because the
// SDK can't separate scopes between requests that share one Edge Functions
// worker, so each capture carries its own context instead. The SDK is loaded
// on the first capture, so functions without a DSN never load it.
//
// Context is for ids and error details (function, request id, job id, org id).
// Never put lead names, phone numbers or message text in it. Lead data stays
// in India and Sentry is not, so as a backstop every event is scrubbed of
// Indian mobile numbers (a provider error may quote the recipient) before it
// leaves the function.

export type MonitoringContext = Record<string, string | number | boolean | null | undefined>;

/** The parts of `@sentry/deno` this module uses. */
export type SentryLike = {
  init(options: {
    dsn: string;
    environment?: string;
    defaultIntegrations: false;
    tracesSampleRate: number;
    sendDefaultPii: false;
    beforeSend: <E>(event: E) => E;
  }): unknown;
  captureException(
    err: unknown,
    hint: { tags: Record<string, string>; contexts: { flow: Record<string, unknown> } },
  ): string;
  flush(timeoutMs?: number): Promise<boolean>;
};

export type MonitorOptions = {
  env: (k: string) => string | undefined;
  load: () => Promise<SentryLike>;
  /** How long a capture waits for Sentry before giving up. */
  flushTimeoutMs?: number;
};

export type CaptureException = (err: unknown, context?: MonitoringContext) => Promise<void>;

// An Indian mobile as people write it: 10 digits starting 6-9, optionally
// grouped with single spaces or hyphens, optionally after +91, 0091, 91 or 0.
// Not when it is part of a longer token, such as a UUID's last group or a
// longer number. An escape like \n counts as a boundary: this runs on JSON text.
const INDIAN_MOBILE = /(?:(?<![\w-])|(?<=\\[nrt]))(?:(?:\+|00)\s?91[\s-]?|91[\s-]?|0)?[6-9](?:[\s-]?\d){9}(?!\d)/g;

/** Replaces Indian mobile numbers anywhere in a JSON-safe value with "[phone]". */
export function scrubPhones<T>(value: T): T {
  return JSON.parse(JSON.stringify(value).replace(INDIAN_MOBILE, "[phone]"));
}

/** Loads the Sentry Deno SDK. Typed against SentryLike, so `deno check` catches an SDK change. */
export const loadSentry = async (): Promise<SentryLike> =>
  // Full specifier, as with supabase-js (see ingest-form/index.ts).
  // deno-lint-ignore no-import-prefix
  await import("npm:@sentry/deno@10");

/**
 * Builds captureException. It never throws: a broken monitor must not turn a
 * handled error into an unhandled one.
 */
export function createMonitor(opts: MonitorOptions): CaptureException {
  let client: Promise<SentryLike | null> | null = null;

  const getClient = (dsn: string) => {
    client ??= opts.load().then((sentry) => {
      sentry.init({
        dsn,
        environment: opts.env("SENTRY_ENVIRONMENT") || undefined,
        defaultIntegrations: false,
        tracesSampleRate: 0,
        sendDefaultPii: false,
        beforeSend: scrubPhones,
      });
      return sentry;
    }).catch((err) => {
      console.error(JSON.stringify({ fn: "monitoring", sentry_load_failed: String(err) }));
      return null;
    });
    return client;
  };

  return async (err, context = {}) => {
    const dsn = opts.env("SENTRY_DSN");
    if (!dsn) return;
    try {
      const sentry = await getClient(dsn);
      if (!sentry) return;
      const tags: Record<string, string> = {};
      if (typeof context.fn === "string") tags.function = context.fn;
      const region = opts.env("SB_REGION");
      if (region) tags.region = region;
      sentry.captureException(err, { tags, contexts: { flow: { ...context } } });
      // Edge Functions can stop right after the response; send before that.
      await sentry.flush(opts.flushTimeoutMs ?? 2000);
    } catch (e) {
      console.error(JSON.stringify({ fn: "monitoring", capture_failed: String(e) }));
    }
  };
}

/** Reports an error to Sentry when SENTRY_DSN is set; does nothing otherwise. */
export const captureException: CaptureException = createMonitor({
  env: (k) => Deno.env.get(k),
  load: loadSentry,
});
