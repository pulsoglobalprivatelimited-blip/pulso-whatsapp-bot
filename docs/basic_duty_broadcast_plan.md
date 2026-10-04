# Duty broadcast to Basic caregivers on WhatsApp: plan

4 Oct 2026. Founder: the caregivers' answers go to **8714105333 on WhatsApp,
and nowhere else**.

## What it does

When a duty needs a Basic caregiver, ops sends one WhatsApp message to the
approved Basic caregivers in that district. Each caregiver answers with one
tap. Her answer reaches **only 8714105333**, as a WhatsApp message.

## What the caregiver gets

From the caregiver bot number, +91 77361 67744:

> **New duty for you:** 24-hour care, Kakkanad, Ernakulam
> Starts: 6 Oct · 10 days · Pay: ₹750/day
> **[ I'm interested ]  [ Call Pulso ]  [ Not now ]**

(Call Pulso dials 8714105333. Malayalam first for Malayalam caregivers, English for English, the same as the
onboarding chat.)

## What 8714105333 gets

Only when a caregiver taps **I'm interested**:

> **Interested in the Kakkanad duty (6 Oct, 24h, 10 days)**
> Sindhu Sajeev · 70258 33854 · Basic · Ernakulam
> **[ Call her ]**

**Call her** opens the dialler with her number. That is the whole message.

## What is NOT done (your rule)

- No alert to your number 9446600809, to Afiq, or to anyone else.
- Nothing on the desk, no Pulso app alert, no email.
- "Not now" sends nothing anywhere; it is only noted on her record, so she is
  not asked about the same duty again.
- If she types a message instead of tapping, the bot answers her as today and
  forwards her words to 8714105333 only.

## How a broadcast is sent: from the booking (founder, 4 Oct 2026)

A button on the booking page in the admin panel, right below **Recreate
booking**: **Send broadcast**.

1. Ops opens the booking that needs a caregiver and taps **Send broadcast**.
2. A small window opens, already filled from the booking. Nothing is typed:
   - Place and district (from the family's address)
   - 8-hour or 24-hour duty
   - Start date and number of days
   - **The caregiver's pay per day** (never what the family pays)
   - "Goes to **7** Basic caregivers in Ernakulam"
   - The exact message they will see, as a preview
3. Ops taps **Send to 7 caregivers**. Each gets the message once.
4. The booking page then shows: **"Broadcast sent 9:12 am to 7 caregivers ·
   2 interested · 1 not now"**. The button changes to **Send again**, which
   reaches only those who have not answered, so nobody is messaged twice for
   the same booking.
5. When a caregiver taps **I'm interested**, only 8714105333 gets the WhatsApp,
   now naming the booking: "Interested in Amma Test's booking, Kakkanad".
   Sanju calls her and assigns her to the booking as usual.

**When the button shows**: only while the booking has no caregiver
(unassigned or waiting for offers), and only to admins. It is hidden once a
caregiver is assigned, and for cancelled or finished bookings.

**If nobody is eligible**: the window says "No Basic caregivers in Ernakulam
yet" and the Send button stays off.

## What has to be in place

- **Two templates approved by Meta**: the duty message to caregivers, and the
  "Interested" message to 8714105333 (so it reaches that number even if it has
  not written to the bot in 24 hours). A few hours to a day each.
- **8714105333 must have WhatsApp** and should write "Hi" to +91 77361 67744
  once, so its chat is open.
- **Cost**: Meta charges per message to caregivers, roughly under ₹1 each.
- **Care**: only Basic caregivers in that district, only real duties, and a
  "Stop" reply that takes her off the list. Blocks and reports lower the bot
  number's rating, and that number also runs onboarding.

## Decisions so far (4 Oct 2026)

- **Who gets the WhatsApp: the same caregivers the booking's app offer was
  pushed to** (the "push to online providers" batch for that booking), not a
  separate list by district.
- **Basic only**: the Send broadcast button is for Basic bookings, and the
  message goes to the Basic caregivers in that batch.

- 8714105333 is Sanju Mohan: **yes**.
- "Call Pulso" button for caregivers, dialling 8714105333: **yes**.
- Where a broadcast is sent from: **a Send broadcast button on the booking page, below Recreate booking** (admin panel).
- Wording: drafts sent, waiting for approval.

## Your decisions (as first asked)

1. **8714105333 is Sanju Mohan's number** (ops admin on the list). Confirm
   that is the right person.
2. **"Call Pulso" button for the caregiver**: leave it out (the plan above), or
   add one that dials 8714105333?
3. **Where ops sends a broadcast from**: a small form on the desk (simplest),
   or by sending a command from 8714105333 on WhatsApp?
4. **The exact words** of both messages, in Malayalam and English. I will send
   a draft; your words are used exactly.

## Order of work

1. The two templates, submitted to Meta (after decision 4).
2. Who is eligible: approved Basic caregivers, by district, minus "Stop".
3. The **Send broadcast** button and its window on the booking page (admin
   app and admin website); the booking shows the sent / interested counts.
4. Her tap: "I'm interested" → the message to 8714105333 only; "Not now" →
   noted; "Stop" → off the list.
5. Tests with test numbers, then one real duty.

## For the developer

- Button: Pulso app `lib/screens/admin/request_detail_screen.dart`, right below
  the `Recreate booking` action (~3035); visible to admins while the request is
  unassigned/pending and not cancelled/done. Window prefilled from the request:
  `addressSummary`/`city`, `shiftType` (8h/24h), `desiredStart`, `days`,
  `providerDailyRate` (caregiver pay; never `price` or the customer rate).
- Hub callable `sendDutyBroadcast({requestId})` (admin claim) builds the duty
  and POSTs it to the bot (`/internal/duty-broadcast`) signed with the shared
  `BOT_ONBOARDING_SYNC_SECRET`; the bot owns the WhatsApp number, templates and
  recipients, and answers `{sent, eligible}`. A second callable reads the counts
  for the booking page (or the bot writes them back to `requests/{id}.dutyBroadcast`
  through the same secret).
- Needs a Pulso app build (admin screen) + a functions deploy + the bot deploy.


- Recipients (founder, 4 Oct): the booking's app offer batch — Pulso app
  `offers` where `requestId == <booking>` → `caregiverId` → user phone — kept
  to Basic caregivers (`careTier == 'basic'`). Older note, superseded:
  eligibility from bot `providers` with `qualification == 'basic_caregiver'`,
  `status == 'completed'`, `district` match, `broadcastOptOut != true`.
  Cross-check the Pulso app account is active.
- Templates (UTILITY): `basic_duty_offer` (ML + EN; body: area, district,
  hours, start, days, pay; quick replies `duty_interest_<dutyId>`,
  `duty_notnow_<dutyId>`), `duty_interest_ops` (body: duty line, name, phone,
  district; URL button to the signed `/call/<token>` page).
- Store: `dutyBroadcasts/{dutyId}` with the duty and per-phone
  `sentAt/answer/answeredAt`; a phone gets one message per duty.
- Routing: a new `DUTY_INTEREST_PHONE=918714105333` setting; the interest
  handler sends ONLY to it (no `notifyOps…`, no hub alert, no desk write
  beyond the broadcast record).
- Inbound from caregivers is handled in `processIncomingMessage` before the
  onboarding switch when the payload starts with `duty_`.
