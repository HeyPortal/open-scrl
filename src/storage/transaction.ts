// IndexedDB aborts on request errors, but a synchronous exception while
// scheduling a request (for example DataCloneError) also needs an explicit abort.
export async function completeTransaction<T>(
  tx: { done: Promise<void>; abort: () => void },
  action: () => Promise<T>,
): Promise<T> {
  void tx.done.catch(() => undefined);
  try {
    const result = await action();
    await tx.done;
    return result;
  } catch (error) {
    try { tx.abort(); } catch { /* transaction already finished */ }
    await tx.done.catch(() => undefined);
    throw error;
  }
}
