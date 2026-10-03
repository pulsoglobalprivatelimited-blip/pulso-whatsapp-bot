# Call (Basic) button, and applicants above 50 as Basic: plan

3 Oct 2026. Part 1 approved ("build"). Part 2 waits for two answers.

## Part 1 — Call (Basic) on certificate alerts (approved)

**The problem.** Someone picks GDA / HCA / GNM and sends a paper that is not
that certificate. You cannot approve her as GDA. After a call you may take her
on as Basic. Today there is no button for that.

**What changes**
1. Under every certificate alert to you, the bot sends one small message:
   "Certificate not valid? Call and take her on as Basic." with one button,
   **Call (Basic)**. It sits right under Approve / Reject / Request doc.
   (Mohamed does not get it: he only sees "No certificate" and students.)
2. Tap **Call (Basic)**:
   - she is sent nothing;
   - she moves into **"Needs a call"** on the desk, marked
     "Certificate not valid · claimed HCA";
   - the bot replies with her **Call her** link and **Approve (Basic)** /
     **Reject**.
3. You call her, then tap Approve (Basic) (one more tap: Confirm approve) or
   Reject. Either takes her out of "Needs a call". So does Request doc.
4. **On the desk**: the filter "No certificate / student" becomes
   **"Needs a call"** and holds all three kinds: No certificate, nursing
   student, certificate not valid. Each row says which. Her page gets a
   **Call (Basic)** button too.
5. **Cold alerts**: if you have not written to the bot in 24 hours, WhatsApp
   delivers that small message only as an approved template. A one-button
   template is submitted to Meta; until approval it appears whenever your chat
   is open.

## Part 2 — Above 50: Basic and sent for review (needs your answers)

**Today.** Age 51+ is stopped: "we cannot proceed with applicants above 50",
with "Correct age" / "Stop here". She never reaches review.

**What changes**
1. She is not stopped. She is told: "For caregivers above 50, Pulso offers
   duties at the Basic rate" with the Basic pay (the same notice 46–50 already
   get today).
2. The chat continues as normal: qualification, duty hours, duties,
   certificate (if she has one), name, sex, district.
3. The review alert says at the top **"Age 56 — Basic rate (age above 50)"**,
   and goes into **"Needs a call"** on the desk. Approve puts her on Basic
   with the reason "age above the limit".

**Your two answers**
1. **Upper limit?** Should there still be a hard stop at some age, say 65 or
   70, or no limit at all?
2. **Who reviews?** Should these go to Mohamed as well (call-based, like No
   certificate), or to you only (she may have a real certificate to check)?

## Order of work

1. Part 1 (now): button + template, the action, the desk filter and button,
   tests, live.
2. Part 2 (after your answers): remove the stop, the notice, the review flag,
   tests, live.

## For the developer

- Part 1: `REVIEW_ACTIONS.CALL_BASIC = 'review_call_basic_'`; after
  `notifyCertificateUploaded` (non-call-review path) send each full reviewer
  `sendButtons(...)` with one button, or the UTILITY template
  `certificate_call_basic` when `CERTIFICATE_CALL_BASIC_TEMPLATE_ENABLED`.
  Handler (full reviewers only) writes `verification.needsCall`,
  `needsCallAt`, `needsCallBy`, `needsCallReason: 'certificate_not_valid'`, and
  replies with `buildNoCertificateReviewButtons` + `buildCallLink`. Desk:
  `matchesQualificationFilter('no_certificate')` also accepts
  `verification.needsCall` while pending; admin route
  `POST /admin/providers/:phone/needs-call`.
- Part 2: `handleAge` (`onboardingFlow.js`) `age > 50` branch; notice
  `basicTierAgeNotice` already exists for > threshold; alert line from
  `provider.age > threshold`; the `ageAboveLimit` buttons stay only for the
  upper limit if one is chosen.
