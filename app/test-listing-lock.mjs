// One eBay write per listing at a time (F10, issue #70): the lock from listing-lock.mjs, which server.mjs uses for
// Approve, Approve all and Undo. The recorded writer answers at once, so two clicks never overlap there. Here the
// "eBay call" is a promise the test resolves itself, which keeps the first write open while the second one arrives.
import test from "node:test";
import assert from "node:assert/strict";
import { createListingLock, BUSY_MESSAGE } from "./listing-lock.mjs";

// A slow writer: every call is counted and stays open until the test calls finish() (or fail()), which settles all open calls
function slowWriter() {
  const open = [];
  const writer = { calls: 0 };
  writer.write = () => {
    writer.calls++;
    return new Promise((resolve, reject) => open.push({ resolve, reject }));
  };
  writer.finish = () => { for (const c of open.splice(0)) c.resolve("written"); };
  writer.fail = () => { for (const c of open.splice(0)) c.reject(new Error("eBay down")); };
  return writer;
}

test("Lock: a second approval for the same listing during the eBay call gets 409 and does not write", { timeout: 2000 }, async () => {
  const withLock = createListingLock(), ebay = slowWriter();
  const first = withLock("100", () => ebay.write());
  await assert.rejects(withLock("100", () => ebay.write()), (e) => e.status === 409 && e.message === BUSY_MESSAGE);
  assert.equal(ebay.calls, 1, "only the first approval reached eBay");
  ebay.finish();
  assert.equal(await first, "written");
  assert.equal(ebay.calls, 1, "written exactly once");
});

test("Lock: a different listing is not blocked while one is being written", { timeout: 2000 }, async () => {
  const withLock = createListingLock(), a = slowWriter(), b = slowWriter();
  const first = withLock("100", () => a.write());
  const other = withLock("200", () => b.write());
  assert.equal(b.calls, 1, "listing 200 reached eBay while 100 was still open");
  a.finish(); b.finish();
  assert.deepEqual(await Promise.all([first, other]), ["written", "written"]);
});

test("Lock: after the first write is done, the listing is free again", { timeout: 2000 }, async () => {
  const withLock = createListingLock(), ebay = slowWriter();
  const first = withLock("100", () => ebay.write());
  assert.equal(withLock.isBusy("100"), true);
  ebay.finish(); await first;
  assert.equal(withLock.isBusy("100"), false);
  const again = withLock("100", () => ebay.write());
  ebay.finish();
  assert.equal(await again, "written", "a later approval goes through");
  assert.equal(ebay.calls, 2);
});

test("Lock: an error in the eBay call frees the listing as well", { timeout: 2000 }, async () => {
  const withLock = createListingLock(), ebay = slowWriter();
  const first = withLock("100", () => ebay.write());
  ebay.fail();
  await assert.rejects(first, /eBay down/);
  assert.equal(withLock.isBusy("100"), false, "the lock is not stuck after an error");
  const again = withLock("100", () => ebay.write());
  ebay.finish();
  assert.equal(await again, "written");
});
