// Retry a DB op a few times with backoff — absorbs transient Supabase blips.
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  attempts = 3,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
  console.error(`[howdy/chat] ${label} failed after ${attempts} attempts`, lastErr);
  throw lastErr;
}
