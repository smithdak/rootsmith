import { test } from "node:test";
import assert from "node:assert/strict";
import { setDomainField, setTopLevelField, setAllRoles } from "./manifest-edit.js";

const FLOW = `name: acme
status: active
domains:
  - { name: acme.example, registrar: vercel, role: canonical, renews: 2027-03-01, basis: rdap, note: "RDAP wins" }
  - { name: acme-app.example, registrar: vercel, role: redirect,  renews: 2027-03-01, basis: rdap }
deploy: { provider: vercel, project: acme }
dns_policy: observed
`;

const BLOCK = `name: northwind
status: active
domains:
  - name: northwind.example
    registrar: squarespace
    role: canonical
    renews: 2026-09-01
    basis: rdap
    note: >-
      URGENT (example, 2026-07-16): expires soon at the API-less registrar.
      Run runbooks/transfer-in.md emergency lane immediately.
  - name: other.com
    registrar: vercel
    role: redirect
dns_policy: observed
`;

test("flow: replaces an existing field on the right domain only", () => {
  const out = setDomainField(FLOW, "acme.example", "renews", "2028-03-01");
  assert.match(out, /\{ name: acme\.example,.*renews: 2028-03-01/);
  assert.match(out, /acme-app\.example.*renews: 2027-03-01/);
  assert.match(out, /note: "RDAP wins"/); // neighbors untouched
});

test("flow: inserts a missing field before the closing brace", () => {
  const noRenews = `domains:\n  - { name: x.com, registrar: vercel, role: parked }\n`;
  const out = setDomainField(noRenews, "x.com", "renews", "2027-01-01");
  assert.match(out, /\{ name: x\.com, registrar: vercel, role: parked, renews: 2027-01-01 \}/);
});

test("block: replaces an existing field within the entry", () => {
  const out = setDomainField(BLOCK, "northwind.example", "renews", "2027-08-12");
  assert.match(out, /    renews: 2027-08-12/);
  assert.match(out, /URGENT \(example, 2026-07-16\)/); // note block preserved
  assert.doesNotMatch(out, /renews: 2026-09-01/);
});

test("block: inserts a missing field right after the name line", () => {
  const out = setDomainField(BLOCK, "other.com", "renews", "2027-05-05");
  const lines = out.split("\n");
  const i = lines.findIndex((l) => l.includes("name: other.com"));
  assert.equal(lines[i + 1], "    renews: 2027-05-05");
});

test("block: does not bleed edits into the next entry", () => {
  const out = setDomainField(BLOCK, "northwind.example", "basis", "dashboard");
  assert.match(out, /northwind\.example[\s\S]*basis: dashboard[\s\S]*other\.com/);
  assert.doesNotMatch(out, /other\.com[\s\S]*basis: dashboard/);
});

test("unknown domain throws", () => {
  assert.throws(() => setDomainField(FLOW, "nope.com", "renews", "2027-01-01"), /not found/);
});

test("setTopLevelField replaces status without touching nested keys", () => {
  const out = setTopLevelField(BLOCK, "status", "parked");
  assert.match(out, /^status: parked$/m);
  assert.doesNotMatch(out, /status: active/);
});

test("setAllRoles flips every role", () => {
  const out = setAllRoles(FLOW, "parked");
  assert.equal((out.match(/role: parked/g) ?? []).length, 2);
  assert.doesNotMatch(out, /role: (canonical|redirect)/);
});
