# Caregiver checks her name, age, sex, district and qualification before review: plan

8 Oct 2026. Caregiver onboarding bot, **+91 77361 67744**.

## Today

The chat asks the questions one by one: qualification, age, duty hours,
certificate, name, sex, district. The moment she picks her **district**, the
review alert goes to you (and to Afiq for No certificate / call reviews) and
she reads "we are verifying". She never sees her answers together, so a
typo in her name, a wrong age or a wrong district reaches the review as it
is, and the reviewer has to call or ask again.

## What changes

After the district, before anything goes to review, one message shows her
answers and asks her to check them.

> **താങ്കൾ നൽകിയ വിവരങ്ങൾ ഒന്ന് പരിശോധിക്കുക:**
>
> പേര്: Sindhu Sajeev
> വയസ്: 34
> സ്ത്രീ / പുരുഷൻ: സ്ത്രീ
> ജില്ല: Ernakulam
> യോഗ്യത: GDA
>
> **[ ശരിയാണ് ]  [ മാറ്റണം ]**

(English chat: "Please check your details: Name / Age / Male or female /
District / Qualification. [ Correct ] [ Change ]")

- **ശരിയാണ് (Correct)** → the certificate goes to review exactly as today,
  with today's "we are verifying" message.
- **മാറ്റണം (Change)** → a list: **പേര് · വയസ് · സ്ത്രീ / പുരുഷൻ · ജില്ല ·
  യോഗ്യത** (Name · Age · Male or female · District · Qualification). She picks one; the bot asks that one
  question again, the same way as before (the district list, the
  qualification list), then shows the check message again. She can change
  as many as she needs before tapping Correct.

### When a change has a knock-on effect

The same rules as the first time apply to the new answer:

| She changes | What follows |
|---|---|
| **Name** | Nothing else. |
| **Age** to over 45 or over 50 | The Basic rate notice she would have seen, then back to the check. Over 50 also goes to a call review, as today. |
| **Male or female** | Nothing else. |
| **District** | Nothing else. |
| **Qualification** to another certificate (e.g. GDA → GNM) | She is asked for **that** certificate ("Please send your GNM certificate"), because the one she sent was for the old choice. Her earlier files are kept on her record. Then back to the check. |
| **Qualification** to No certificate or Nursing student | No certificate needed; the Basic rate notice as today; back to the check. |

### The reviewer sees it was checked

The review alert gets one line: **"Details checked by her ✓"**, or
**"Changed: age 43 → 53, district"** when she corrected something.

## Decided (8 Oct 2026)

- Male or female is on the check (founder).
- She never taps (default chosen when the founder said "do all the
  steps"): one reminder after 2 hours; after 24 hours the certificate goes
  to review anyway, marked **"Details not checked by her"**.
- Certificate sent again: straight to review when her details were already
  checked once (`detailsConfirmedAt` set); the check first when they never
  were (applicants from before this change).

## Order of work

1. The check message, Correct and Change, the four re-asks and the knock-on
   rules; Malayalam and English.
2. The "checked / changed" line on the review alerts.
3. The reminder (and the 24-hour send, if answer 1 is B).
4. Tests; push; watch the first day's applicants.

## For the developer

- New status `AWAITING_DETAILS_CONFIRMATION` (step 13; `VERIFICATION_PENDING`
  stays 13 or moves to 14 — keep `currentStep` ordering consistent with the
  desk). In `handleDistrict` (`onboardingFlow.js` ~2781), instead of
  `VERIFICATION_PENDING` + `notifyCertificateUploaded`, save the district,
  set `AWAITING_DETAILS_CONFIRMATION` and send the check message. Move the
  review part (status, `notifyCertificateUploaded`, notification patch,
  `recordReviewAlertSend`, `verificationPendingMessageFor`) into one
  `sendForReview(phone)` used by Correct and by
  `finalizeCertificateCollection` (~2263, the "profile already complete"
  path) — the latter shows the check first only if answer 2 says so.
- Change: `detailsEditing` field on the provider (`name|age|sex|district|
  qualification`); route the next answer through the existing handlers
  (`handleName`, `handleAge`, `handleDistrict`, `handleQualification`) with a
  flag so each returns to the check instead of moving on (`handleSex` for
  male/female). Age keeps its
  rules (Basic notice over 45, call review over 50). Qualification to a
  certificate type sets `AWAITING_CERTIFICATE` with the certificate request
  for the new type and, after upload, returns to the check (not to the name).
- History: `details_confirmed` with any changes `{ field, from, to }`;
  `detailsConfirmedAt` and `detailsChanged` on the provider for the alert
  line (certificate alert, call-review alert, template body values where the
  template has a free line; otherwise the session text only).
- Reminder: reuse the existing stuck-step reminder pattern
  (`resumeStuckCertificateProviders` / sweep), one reminder at 2 h.
- Tests: Correct sends for review once; each of the four changes returns to
  the check (five fields); age change across 45/50; qualification change to a certificate
  type asks for the new certificate; to No certificate does not; English
  flow; buttons within WhatsApp limits; the re-upload path per answer 2.
