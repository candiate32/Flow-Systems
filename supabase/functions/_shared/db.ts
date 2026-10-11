// Small helpers for supabase-js results, shared by the Edge Functions.

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

type Result<T> = { data: T; error: { message: string; code?: string } | null };

/** Turns a supabase-js `{ data, error }` result into data or a thrown error. */
export function must<T>(res: Result<T>, what: string): T {
  if (res.error) throw Object.assign(new Error(`${what}: ${res.error.message}`), { code: res.error.code });
  return res.data;
}

/** Like `must`, for queries that must return a row (`.single()`). */
export function mustRow<T>(res: Result<T>, what: string): NonNullable<T> {
  const data = must(res, what);
  if (data === null || data === undefined) throw new Error(`${what}: no row returned`);
  return data;
}
