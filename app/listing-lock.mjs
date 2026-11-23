// One eBay write per listing at a time (F10, review 21 Nov): a second click or a second admin during the eBay call gets
// 409 instead of writing twice. Approve, Approve all and Undo share one lock (server.mjs, mitSperre). Its own module so
// that the overlap can be tested with a slow writer (test-listing-lock.mjs).
export const BUSY_MESSAGE = "This listing is being changed on eBay right now. Wait a moment and reload.";

export function createListingLock() {
  const running = new Set();
  async function withLock(number, task) {
    if (running.has(number)) throw Object.assign(new Error(BUSY_MESSAGE), { status: 409 });
    running.add(number);
    try { return await task(); } finally { running.delete(number); }
  }
  withLock.isBusy = (number) => running.has(number);
  return withLock;
}
