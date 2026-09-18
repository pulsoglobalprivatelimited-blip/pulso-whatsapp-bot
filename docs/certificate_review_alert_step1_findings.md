# Step 1 result: what actually happened to the 18 Sep certificate alert

Read on 18 Sep 2026 from the bot's own Firestore (`pulso-whatsapp-onboarding`), not from the
Render logs — the Render CLI token on this machine has expired. Firestore turned out to be the
better source: the delivery webhooks are stored there, and they show what the server log could
not, because all three sends *succeeded* at the API and only two of them failed afterwards.

Provider `919000000156` (Test Caregiver B), `certificate_verification_pending` since
13:52:12 UTC (19:22 IST).

## The three messages

| # | Message | Meta accepted | Final delivery status |
|---|---------|---------------|-----------------------|
| 1 | template `certificate_review_alert` | yes | **read** at 13:52:24 UTC (19:22 IST) |
| 2 | interactive buttons | yes | **failed** — 131047 re-engagement (24 h window) |
| 3 | certificate image (signed archive URL) | yes | **failed** — 131047 re-engagement (24 h window) |

So the reviewer's phone *did* get message 1, and someone opened it. What it said, in full:

> New provider certificate is pending review. Reply REVIEW to open the latest review.

No name, no phone, no qualification, no district, no certificate, no buttons. Messages 2 and 3 —
the ones carrying all of that — were rejected by WhatsApp for being outside the 24-hour window,
exactly as the plan predicted.

## Three things the plan did not have

**The archive was fine.** The plan's third suspect, `app_media_without_archive_url`, did not
happen. The in-app upload was archived to cloud storage and message 3 went out as a signed link;
WhatsApp accepted it and then refused it on the window. Step 3 is still worth doing as a guard,
but it was not today's cause.

**The bot's own record says all three were sent.** `provider.verification.notificationAttempts`
has `ok: true` on all three, because `ok` is set from the API's accept, not from delivery. The
failure webhooks did arrive and are sitting in the `whatsappMessageStatuses` collection, but
nothing joins them back to the provider. That is why the dashboard shows this alert as green,
and it is the reason Step 4's "red alert-failed badge" needs the join to exist first.

**The one message that got through asked for something the bot ignores.** The template says
"Reply REVIEW". There is no `REVIEW` keyword handler. It would have worked by accident —
any unrecognised reviewer text falls through to `resendLatestPendingCertificateReview`, and the
reply itself opens the 24-hour window, so the buttons and the file would then have gone — but
nothing in the bot or the template tells the reviewer that, and the wording ("open the latest
review") promises a screen that does not exist.

## Account facts found along the way

- WABA for the bot number +91 77361 67744 (`1133197949878315`) is **`940659845043119`**
  (business "Pulso Global Pvt Ltd", `497839044573319`). The token reads and writes its
  templates. Needed for Step 2; the plan had it as unknown.
- The reviewer number **+91 94466 00809 is itself registered on WABA `2027114068144502`** as an
  ON_PREMISE number, `DISCONNECTED` / `NOT_VERIFIED`, with no app subscribed. A dead
  registration — the read receipt on message 1 shows the number still works as an ordinary
  WhatsApp account — but worth clearing up so it can never start swallowing the alerts.
- The same WABA already has two **approved** UTILITY templates of exactly the shape Step 2
  needs: `partner_document_review_file` (DOCUMENT header) and `partner_document_review_image`
  (IMAGE header), both with 4 body variables and Approve / Ask again quick replies. Meta
  approves this shape for this account.

## What this means for Step 2

The plan says "Header: document (or image)". It has to be **two templates**, not one: a
template's header format is fixed at creation, so a JPG certificate cannot be sent through a
DOCUMENT-header template. The partner flow above already splits them the same way, and the bot
already knows each attachment's type (`attachment.type === 'image'`), so picking between them at
send time is one line.

---

# What was built (steps 2–6)

## Step 2 — the alert that stands on its own

Two Utility templates submitted to WABA `940659845043119` on 18 Sep:
`certificate_review_v2_file` (DOCUMENT header, id `28622772730692913`, **approved**) and
`certificate_review_v2_image` (IMAGE header, id `1372149968332883`, pending at the time of
writing). Body: "New caregiver certificate to review. {{1}} · {{2}} · {{3}} · {{4}}. Approve,
reject, or ask for another document." Quick replies: Approve · Reject · Ask again.

The bot picks the template from `attachment.type` and sends one per certificate, with the
archived link in the header and the caregiver in the body. The button payloads are the same
`review_approve_<phone>` ids the interactive buttons already used, so a tap on a template button
and a tap inside the 24-hour window land on the same handler — `parseReviewerAction` now reads
`message.button.payload` as well as `interactive.button_reply`.

Off until both templates are approved: `CERTIFICATE_REVIEW_V2_ENABLED`. While it is off, and for
any certificate whose archive link is missing, the old template + buttons + file path still runs,
per recipient, so nothing gets worse in the meantime.

## Step 3 — a certificate we cannot show is not a certificate we have

`uploadBufferToFirebaseStorage` retries once. `addCertificate` now requires a real archived link
before the caregiver is told "sent for verification"; a local disk copy alone no longer passes,
because neither an app upload (no Meta media id) nor a month-old WhatsApp upload (expired id) can
be shown to a reviewer without it. A caregiver whose upload did not archive is asked to send the
file again — copy that already existed.

Ops uploads from the dashboard were archived to local disk only, with `id: null`, so they could
never reach a reviewer at all. They now go to cloud storage too, and `sendReviewMediaTo` will
send an attachment that has a link but no media id.

## Step 4 — telling somebody when WhatsApp will not

The join that was missing. Every message id the alert produces is written to
`reviewAlertMessages/{id}`; every status webhook is looked up against it and folded into
`provider.verification.reviewAlert`. Delivery is judged only on the messages a reviewer can act
on — the new template, or the old interactive buttons — so the 18 Sep case, where the bare
template was read and everything else was refused, now reads as *not delivered*.

On failure the bot posts the caregiver to the hub's `syncProviderOnboardingFromBot` with
`certificateReviewAlertFailed` and a summary of the error. The dashboard shows a red "Alert
failed" badge in the list and a "Reviewer alert" line in the details.

**Still to do on the Pulso side:** `buildBotOnboardingMirror` must carry
`certificateReviewAlertFailed` through, and `reconcileBotOnboardingForPhone` must raise
`createAdminAlertForOps({ testOnly: isTestSandboxPhone(phone) })` on it. Roughly fifteen lines in
`functions/index.js`, plus one functions deploy. Until that lands the failure is recorded and
badged in the bot, but no push reaches the admin app.

## Step 5 — the catch-up job

`certificateReviewCatchUp.js`: every 30 minutes, any caregiver pending review whose alert has not
been delivered and whose last attempt is more than 15 minutes old gets the alert again, three
tries maximum. Both windows are settable. It replaced the boot-time reconcile, which only looked
for providers with no `notificationSentAt` at all — a set that never included today's incident,
because that send succeeded.

## Step 6 — tests

`test/certificateReviewAlert.test.js`, 14 tests, including the 18 Sep case as a regression: a
bare template being read does not count as the alert getting through. Both send paths were
dry-run checked — with archive links, two v2 templates and no legacy messages; without one, the
v2 attempt fails with `attachment_without_archive_url` and the old path runs.

Not yet done: the live test from the plan — an upload from the app with no prior chat from the
reviewer, then a tap on Approve.
