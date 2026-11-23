// Command line for accounts (app/benutzer.mjs, issue #69): it is started as a child process, as on the server, with
// PM_APPDB pointing to a throwaway database in the temp folder. Passwords go in on stdin, one line each, because the
// tool reads them line by line when there is no terminal. Accepted and rejected actions are both checked.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SKRIPT = path.join(import.meta.dirname, "benutzer.mjs");
const ordner = fs.mkdtempSync(path.join(os.tmpdir(), "pm-benutzer-"));
test.after(() => fs.rmSync(ordner, { recursive: true, force: true }));

// Every test gets its own empty database, so the "first user becomes admin" rule does not depend on the order
let nr = 0;
const neueDb = () => path.join(ordner, `app-${++nr}.db`);
function cli(db, args, eingabe = "") {
  const r = spawnSync(process.execPath, [SKRIPT, ...args], { input: eingabe, encoding: "utf8", env: { ...process.env, PM_APPDB: db } });
  return { code: r.status, aus: r.stdout, fehler: r.stderr };
}
const liste = (db) => cli(db, ["liste"]).aus;
const PW = "geheim-1234"; // 11 characters, the minimum is 10

test("first user becomes admin, the second becomes builder", () => {
  const db = neueDb();
  const a = cli(db, ["anlegen", "erste"], `${PW}\n${PW}\n`);
  assert.equal(a.code, 0, a.fehler);
  assert.match(a.aus, /User created: erste \(role: admin\)/);
  const b = cli(db, ["anlegen", "zweite"], `${PW}\n${PW}\n`);
  assert.equal(b.code, 0, b.fehler);
  assert.match(b.aus, /User created: zweite \(role: builder\)/);
  assert.match(liste(db), /erste \[admin\][\s\S]*zweite \[builder\][\s\S]*2 users/);
});

test("passwords that do not match: exit code 1, no user", () => {
  const db = neueDb();
  const r = cli(db, ["anlegen", "erste"], `${PW}\nanders-1234\n`);
  assert.equal(r.code, 1);
  assert.match(r.fehler, /do not match/);
  assert.match(liste(db), /^0 users/m);
});

test("password shorter than the minimum is refused, no user", () => {
  const db = neueDb();
  const r = cli(db, ["anlegen", "erste"], "kurz\nkurz\n");
  assert.equal(r.code, 1);
  assert.match(r.fehler, /at least 10 characters/);
  assert.match(liste(db), /^0 users/m);
});

test("rolle <name> admin changes the role", () => {
  const db = neueDb();
  cli(db, ["anlegen", "chefin"], `${PW}\n${PW}\n`);
  cli(db, ["anlegen", "helfer"], `${PW}\n${PW}\n`);
  assert.match(liste(db), /helfer \[builder\]/);
  const r = cli(db, ["rolle", "helfer", "admin"]);
  assert.equal(r.code, 0, r.fehler);
  assert.match(r.aus, /Role of helfer: admin/);
  assert.match(liste(db), /helfer \[admin\]/);
});

test("unknown command prints the usage, exit code 1", () => {
  const r = cli(neueDb(), ["loeschen", "erste"]);
  assert.equal(r.code, 1);
  assert.match(r.fehler, /^Usage: npm run benutzer -- anlegen/);
});

test("a name that already exists is not created twice", () => {
  const db = neueDb();
  cli(db, ["anlegen", "erste"], `${PW}\n${PW}\n`);
  const r = cli(db, ["anlegen", "erste"], `${PW}\n${PW}\n`);
  assert.equal(r.code, 1);
  assert.match(r.fehler, /already exists/);
  assert.match(liste(db), /^1 users/m);
});

test("passwort for a user that does not exist is refused", () => {
  const r = cli(neueDb(), ["passwort", "niemand"], `${PW}\n${PW}\n`);
  assert.equal(r.code, 1);
  assert.notEqual(r.fehler.trim(), "");
  assert.doesNotMatch(r.aus, /Password changed/);
});

test("rolle with an unknown role is refused and the role stays", () => {
  const db = neueDb();
  cli(db, ["anlegen", "erste"], `${PW}\n${PW}\n`);
  const r = cli(db, ["rolle", "erste", "chef"]);
  assert.equal(r.code, 1);
  assert.match(r.fehler, /Unknown role/);
  assert.match(liste(db), /erste \[admin\]/);
});
