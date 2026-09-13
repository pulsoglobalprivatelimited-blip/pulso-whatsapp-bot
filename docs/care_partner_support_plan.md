# Care partner help in the provider support bot

Plan and build record for the second audience on **+91 77361 29809**.
Screens: `docs/mockups/`. Built 13 September 2026.

## The decision that shapes everything

The number used to serve one audience, so it could open with "which region are
you in?". It now serves two, so it opens by asking **who you are** — Caregiver /
Nurse, or Home care agency — before anything else. Founder's call: ask first,
then chat.

Two consequences follow, and both are the point:

- A caregiver's conversation is unchanged, one tap later.
- A verified agency never reads a word of provider copy, because the lookup that
  identifies them runs before the region question, not after a menu tap.

## Who counts as a care partner

A home care agency with a record in the **pulso-hub** project — `bureaus`, the
same collection the partner console reads. Status decides the branch, using the
hub's own vocabulary:

| `bureaus.status` | Branch |
| --- | --- |
| `pilot`, `active` | Partner Support menu, greeted by brand name |
| `prospect` | Held: "still being set up", partner team alerted once, menu still offered |
| `terminated`, no match, lookup failed | Join link, with two one-tap escapes |

An unmatched agency is **pitched, never dead-ended**. The pitch is a link to
`admin.pulso.co.in/join`, which opens the existing four-piece partner deck on
+91 77361 01039 with the `PARTNER ENQUIRY` text pre-filled. No pitch logic is
duplicated in this bot, and the lead lands in the `partnerEnquiries` pipeline
ops already watches.

## Identifying the number

`bureaus.phone` is free text in the hub (`putStr('phone', 20)` in
`upsertBureau`), so an equality query on it is unreliable. The cascade therefore
starts with the keys that *are* normalised:

1. `bureauInvites/{phone}` — doc id is `91XXXXXXXXXX`, exactly what WhatsApp
   sends as `message.from`. Gives `bureauId` and the invited `role`.
2. `users` where `phone` matches a candidate → that user's `bureauId`.
3. `bureaus` where `phone` matches — best effort, accepted to miss.

Cached on the session for 24 hours. A failed lookup is never cached, so an
outage does not persist as "not a partner".

Worth doing in pulso-hub later, not done here: have `upsertBureau` write a
normalised `phoneDigits` field, which makes route 3 reliable.

## What the partner menu answers

| Row | Behaviour |
| --- | --- |
| Payout & settlement | Answered from `billingDay`, `partnerPct`, `gstRegistered` on their own record — already fetched by the gate, so no extra read — then a handoff |
| Client & booking status | Points at the partner console, then a handoff for a specific client |
| Console / app login | Sub-menu: console link, login issue, OTP, request support |
| Caregiver / duty issue | Straight to a human. The urgent one: a caregiver missing from a client's home |
| Talk to partner manager | Straight to a human |
| I am a caregiver | Escape hatch to the provider branch |

## Two things that changed for everyone

**Per-reason cooldown.** `canRequestSupportHelp` used one timestamp per session,
so any handoff muted every other one for 12 hours. It is now keyed by reason
(`supportHelpRequests`), with the old single field read as a fallback for
sessions written before the change. A payout question in the morning can no
longer swallow a caregiver emergency in the evening.

**Audience-aware alerts.** Partner handoffs go to `PARTNER_HELP_WHATSAPP_NUMBER`
(falling back to the existing ops chain, so they are never undeliverable) and
say *care partner*, with agency, bureau id, partner status, role and district
attached.

## Files

| File | Role |
| --- | --- |
| `src/services/hubStorage.js` | Shared pulso-hub Firestore handle, lifted out of `bookingAdminService` |
| `src/services/carePartnerService.js` | Lookup cascade, status classification, caching |
| `src/services/carePartnerFlow.js` | Partner menus, topics, pitch, EN + ML copy |
| `src/services/providerSupportFlow.js` | Audience question, dispatch, per-reason cooldown |
| `src/services/providerSupportNotifications.js` | `notifyCarePartnerHelpRequested` |
| `src/public/admin/provider-support.html`, `assets/provider-support-dashboard.js` | Audience filter, agency column, care-partner metric |
| `src/scripts/dryRunCarePartnerSupport.js` | 12 conversations, 41 assertions, no credentials needed |
| `src/scripts/checkCarePartnerHubAccess.js` | Does this deployment's service account reach the hub collections |
| `src/scripts/backfillSupportAudience.js` | Stamps `audience` on pre-existing sessions |

The partner flow takes its `sendAndLog` / `updateSession` / `requestHumanSupport`
/ `switchToProvider` as injected deps rather than importing the support flow
back, which keeps the cycle out and lets the dry run drive it with fakes.

## Rollout

`PARTNER_HELP_ENABLED=false` ships today's behaviour exactly — no audience
question, no partner branch — and is asserted as such in the dry run.

1. `npm run partner:dry-run` — no credentials, no network
2. `npm run partner:hub-check -- <partner phone>` — with production credentials.
   **The one thing that cannot be verified from a laptop**: the Render service
   account has only ever read `whatsappBookingChats` from the hub, so `bureaus`,
   `bureauInvites` and `users` access needs confirming here first.
3. `npm run support:audience:backfill -- --write`
4. Set `PARTNER_HELP_ENABLED=true`, `PARTNER_HELP_WHATSAPP_NUMBER=<manager>`
5. Live smoke test from a known partner number and from an unknown one

## The dashboard distinction worth keeping

The queue shows **declared** audience (what they tapped) and **verified** partner
status (what the hub returned) separately, and has an "Unverified agency" filter
for the gap between them. That gap is not noise — it is a list of agencies who
came to a partner support line and are not on the books.
