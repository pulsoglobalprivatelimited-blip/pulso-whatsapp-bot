# "No certificate" applications also go to a second number: plan

3 Oct 2026.

## What happens today

Every certificate alert from the caregiver bot goes to one WhatsApp number,
9446600809 (yours). "No certificate" applications are no different: you get the
alert "No certificate — please call and interview her", and you make the call.

These people have no paper to check. The whole review is a phone call, and
that call can be done by someone in the team.

## What we will change

1. **One more number for "No certificate" alerts only.** When a "No certificate"
   application finishes the chat, the alert goes to your number **and** to the
   second number. Certificate alerts (GDA, GNM, HCA…) stay with you only, and
   so do the "Call (Basic)" people from the other plan (founder, 3 Oct 2026:
   the second number gets "No certificate" applications only).

   **Second number: +91 62383 78859, Mohamed Afiq** (already on the admin list
   as ops admin).

2. **The second number can act, not just read.** The alert carries the same
   buttons. The second person can call, then tap Approve (as Basic) or Reject.
   They do this only for "No certificate" people; any other tap from that
   number is refused with a short message.

   **A Call button on the alert.** "No certificate" alerts get their own
   template with three buttons: **Call her**, **Approve (Basic)**, **Reject**.
   Call her opens the phone's dialler with her number. ("Request doc" is
   dropped from this alert: there is no certificate to ask for.) WhatsApp only
   allows a fixed number in a real call button, so Call her is a link button
   to a Pulso page that opens the dialler with her number. Until Meta approves
   the template, her number in the alert text is already tappable: tap it and
   choose Call.

3. **No double work.** Whoever taps first decides. If the other person taps
   later, the bot replies "Already approved by <name> at 4:12 pm" and does
   nothing. The alert says at the top who else received it.

4. **Who gets the Basic reason question.** Approve as Basic asks the three
   "Why the Basic rate?" buttons; it is asked of whoever tapped Approve.

5. **Easy to change.** The second number is a setting on the server, not in
   the code. Changing or removing it is one setting change, no new release.

## What we need before it works

- **The second number.** It must have chatted with the bot number
  (7736167744) at least once, or the first alert must go as a template. The
  bot already sends alerts as templates, so this works even cold.
- **Their name**, shown on the alert and in "Already approved by …".

## Order of work

1. Setting for the second number and name; sending "No certificate" alerts to
   both numbers, with the new Call / Approve / Reject template.
2. Letting that number approve or reject those people only.
3. "Whoever taps first decides" and the "Already approved by" reply.
4. Test with a test caregiver and a test second number, then switch on.

## What I need from you

- Done: number and name given; "No certificate" only.

## For the developer

- Recipients: `getCertificateReviewPhones()` in `src/services/opsNotifications.js`
  (~75) returns owner + agent-help numbers. Add
  `config.noCertificateReviewerPhone` / `noCertificateReviewerName` (env
  `NO_CERTIFICATE_REVIEWER_PHONE`, `_NAME`) and include it in
  `notifyCertificateUploaded` (~717) only when
  `provider.qualification === 'no_certificate'` (not needsCall).
- New UTILITY template `certificate_review_no_cert` (body: the nine summary
  lines; buttons: URL `https://whatsapp.pulso.co.in/call/{{1}}` + quick replies
  Approve / Reject with the same payload prefixes). Add route `GET /call/:phone`
  in `src/server.js` that validates the number against a pending provider and
  302s to `tel:+<phone>`; the alert link carries a short signed token so the
  page cannot be used to dial arbitrary numbers.
- Permission: reviewer taps are gated by `isReviewerPhone` (~82, used in
  `onboardingFlow.js` ~3605). Add a scoped check: that number may run
  approve / reject / basic-reason actions only for no-certificate providers.
- First tap wins: approval already has an idempotency guard
  (`hasAlreadyBeenApproved`, `approveCertificateIdempotency.test.js`); extend the
  reply to name who acted (`verification.reviewedBy`) and do the same for
  reject.
- Delivery tracking: the catch-up sweep and `recordReviewAlertSend` record
  attempts per recipient already; the second number is one more recipient.
- Env on Render is not blueprint-synced: set it with the Render API, then
  trigger a deploy (an env change alone does not redeploy).
