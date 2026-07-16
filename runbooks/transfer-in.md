# Runbook: transfer-in (manual, M0.5)

Zero-downtime registrar consolidation into Vercel. This manual runbook is the
dress rehearsal for the PR-gated ones (I3). This public copy is the template;
a real deployment's ops fork carries live lanes with domains, dates, and
decision gates filled in.

The one rule that orders everything: **move DNS hosting and verify resolution
externally *before* transferring registration** — losing-registrar DNS hosting
is not guaranteed to survive a transfer, and email breaks silently.

## EMERGENCY LANE — <domain expiring soon>

For a domain inside ~30 days of expiry at a registrar you're leaving.

- [ ] Day 0: In Vercel, add the DNS zone; recreate every A/CNAME/MX record
      currently served by the losing zone (dig them first; capture MX before
      touching anything).
- [ ] Day 0: At the losing registrar, switch nameservers to Vercel's; verify
      external resolution from two networks.
- [ ] Day 0–1: Unlock (clear clientTransferProhibited), disable WHOIS privacy
      if the registrar requires it, pull the auth code.
- [ ] Day 1: Initiate transfer at Vercel (verify the TLD's transfer-in is
      offered before starting — 30-second dashboard check).
- [ ] Decision gate, Day 10: transfer not confirmed complete -> RENEW AT THE
      LOSING REGISTRAR as the backstop (a year's fee beats losing the domain),
      transfer afterward at leisure. gTLD transfer adds a year to expiry
      either way, so nothing is wasted.

## STANDARD LANE — <domain with no expiry pressure>

Expiry unknown counts as pressure until read — the first step is reading it.

- [ ] Pull expiry + lock status from the losing registrar's dashboard (a
      single read is fine; you are not building the integration).
- [ ] Confirm Vercel offers transfer-in for the TLD.
- [ ] DNS-first: recreate the zone at Vercel, flip NS, verify, then unlock +
      auth code + initiate.

## INVESTIGATION LANE — <domain that does not resolve>

For NXDOMAIN or RDAP-404 findings from the nightly run.

- [ ] RDAP 404 at a working registry endpoint -> high confidence unregistered:
      check the provider dashboard; if lapsed and wanted, re-register today.
- [ ] NXDOMAIN with registration unverifiable (no RDAP for the TLD) -> locate
      the holding account (search old email for registrar receipts);
      registered-but-undelegated vs lapsed.
- [ ] Either way, if the domain is unwanted -> record `status: archived` in
      its manifest with a dated note, and stop tracking. An explicit no beats
      a zombie entry.

## ICANN / ccTLD notes

- A 60-day post-registration/transfer lock applies to gTLDs. RDAP shows
  registration dates before you start.
- ccTLDs (.ai, .io, …) run their own transfer regimes; the standard
  auth-code flow applies to most in practice.
