// Tiny promise timeout helper. Wraps a fetch / RPC call so the view
// can surface an error state instead of sitting on the loading stub
// forever — Supabase's auth-refresh queue occasionally stalls, and
// once it does, every follow-up request from the same client waits
// behind it. Without a timeout the hydrating view never resolves and
// the user's only recourse is a full page reload (which mints a
// fresh client and clears the queue).
//
// The underlying promise is NOT actually cancelled — JS doesn't have
// a real cancellation primitive for arbitrary promises. This just
// makes the WRAPPER settle, so the caller stops awaiting. If the
// original eventually resolves it becomes a floating value the
// runtime discards.

export function withTimeout(promise, ms, label = 'request') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('タイムアウトしました (' + label + ' / ' + Math.round(ms / 1000) + 's)')),
        ms,
      ),
    ),
  ]);
}
