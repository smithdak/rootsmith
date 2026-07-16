import { test } from "node:test";
import assert from "node:assert/strict";
import { appendToRegistry, claimedRepos, registryEntryLine } from "./repos.js";

test("appendToRegistry creates the file with header when absent", () => {
  const out = appendToRegistry(undefined, { name: "me/thing", disposition: "unassigned", note: "observed 2026-07-16" });
  assert.match(out, /^# GitHub repo registry/);
  assert.match(out, /^repos:$/m);
  assert.match(out, /- \{ name: me\/thing, disposition: unassigned, note: "observed 2026-07-16" \}/);
});

test("appendToRegistry inserts after repos: and is idempotent per name", () => {
  const base = appendToRegistry(undefined, { name: "me/a", disposition: "keep" });
  const two = appendToRegistry(base, { name: "me/b", disposition: "archive" });
  assert.match(two, /repos:\n  - \{ name: me\/b, disposition: archive \}\n  - \{ name: me\/a, disposition: keep \}/);
  assert.equal(appendToRegistry(two, { name: "me/b", disposition: "unassigned" }), two); // already present — untouched
});

test("registryEntryLine swaps double quotes out of notes", () => {
  assert.doesNotMatch(registryEntryLine({ name: "a/b", disposition: "keep", note: 'says "hi"' }).slice(30), /"hi"/);
});

test("claimedRepos parses github.com URLs and skips placeholders", () => {
  const mk = (name: string, repo?: string) => ({
    file: `ventures/${name}.yaml`,
    venture: { name, status: "active" as const, domains: [{ name: `${name}.com`, registrar: "vercel" as const, role: "canonical" as const }], repo },
  });
  const claims = claimedRepos([
    mk("a", "github.com/me/a-repo"),
    mk("b", "https://github.com/me/b.repo"),
    mk("c", "github.com/<owner>/c"), // provision placeholder — not yet a claim
    mk("d"),
  ]);
  assert.deepEqual(claims, [
    { venture: "a", fullName: "me/a-repo" },
    { venture: "b", fullName: "me/b.repo" },
  ]);
});
