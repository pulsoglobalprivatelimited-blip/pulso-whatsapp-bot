# Admin booking bot on WhatsApp: plan

4 Oct 2026. An admin books care for a **manpower agency** from WhatsApp, with
the same steps, rules and result as **New offline booking → A partner agency**
in the Pulso app.

## What it is

The same booking the app makes, typed in a chat. The bot asks the app's
questions in the app's order, shows a summary, and on **Create booking** calls
the very function the app calls (`createOfflineRequest`). So every rule the app
enforces (service area, minimum days, age 45+, tier floors, weekly billing for
manpower) applies unchanged, and the booking appears in the admin panel and the
agency's app exactly as if it was made in the app. Caregiver offers go out the
same way too.

## Which number

**+91 77361 29809, the support bot** (founder, 4 Oct 2026). Admins are
recognised by their phone and get the booking bot; every caregiver and agency
keeps today's chat, unchanged. 9633108778 is not used, so the IVR link stays
as it is.

## The chat, step by step (as in the app)

An admin writes **book** (or taps **New booking** in the admin menu).

1. **Agency.** "Which agency?" A list of manpower agencies that can take
   bookings (pilot or active). More than ten: type part of the name. If the
   agency has no phone on file, the bot asks for the owner's WhatsApp number
   (10+ digits) and saves it, as the app does. A new agency is still added in
   the app. (The app also offers "prospect" agencies, but the server refuses
   them; the bot does not list them.)
2. **Client.** "Manpower supply. The patient stays the agency's client; Pulso
   provides the caregiver." The bot opens the agency's client record itself
   (as **Continue** does in the app).
3. **Patient.** The agency's patients as a list ("Patient 1", "Patient 2",
   with the agency's own name for them if it gave one), plus **New patient**.
   A new patient is named "Patient N" automatically, as in the app; the
   agency can name them in its app. Then: **age in years** (founder,
   4 Oct 2026: age, not date of birth) and gender.
4. **Patient details.** Weight (kg); then Yes / No buttons for: bedridden,
   feeding tube (Ryles), urine tube (catheter), stoma, tracheostomy. Stoma
   or tracheostomy: "This needs a nurse, so the tier is set to Nurse." Age
   18–110; under 45 the admin types a reason (5+ characters), as in the app.
5. **Service.** 8 hours/day or 24 hours/day.
6. **Caregiver gender.** Any · Male · Female.
7. **Start date.** Tomorrow · Day after · type a date. Senior care starts at
   8 am. A same-day 8-hour start needs a reason and a start time between 8 am
   and 4 pm, as in the app.
8. **Days.** Type a number, at least 5.
9. **Location.** Only a **WhatsApp location pin** (founder, 4 Oct 2026): no
   address line, no landmark, no pincode, no saved-address choice. The pin
   gives the exact map point the app asks for; the area name WhatsApp sends
   with it (or, if none, the area found from the point) becomes the
   booking's address. Outside a service area: "We do not serve this location
   yet. Send another pin."
10. **Who should do this work?** Basic · GDA and above · Nurse, as plain
    buttons with no rates beside them (founder, 4 Oct 2026). Nothing is
    pre-chosen.
11. **Rates.** The choice fills in the suggested rates: "Suggested rates for
    GDA, per day: caregiver ₹700 · agency ₹800 · Pulso keeps ₹100" with
    Keep · Change caregiver pay · Change agency charge. No reason asked; the
    agency charge can't be under the pay, the pay can't be under ₹500
    (`agency_rate_separate_plan.md`). (Until that ships in the app, only the
    pay can change and the agency is charged pay + ₹100.)
12. **After creation.** Push online (offers go to caregivers now) · Assign
    manually. With Push online: all caregivers and nurses, or nurses only.
    Assign manually: the created message carries the link to assign her in
    the admin panel (the app opens its assign window at this point).
13. **Summary**, one message: agency, patient, service, gender, start, days,
    location, tier, agency charge per day and in total, caregiver pay per
    day, Pulso keeps, "Payment: the agency pays week by week",
    after-creation choice.
    Buttons: **Create booking** · **Change something** · **Cancel**.
14. **Created.** "Booking created for <agency> · <patient> · starts 6 Oct",
    the booking number and a link to it in the admin panel. If the app's
    function refuses (an overlapping booking, a blocked agency), the bot shows
    the same reason the app would and goes back to that step.

No notes step (founder, 4 Oct 2026).

At any point: **back** goes one step back; **cancel** drops the draft. An
unfinished draft is kept for 24 hours.

Left out of the first version: attaching documents, referral code, notes,
typed address details, direct Pulso (non-agency) bookings, non-senior-care
services. These stay in the app.

## Who can use it

Only these three phones (founder, 4 Oct 2026): **8714105666, 9446600809,
7736108778**.

Each admin is known by **mobile number**, the same way they sign in to the
Pulso admin app with a mobile OTP (founder, 4 Oct 2026). WhatsApp has already
proved the number, so the bot asks for nothing more. Pulso Hub finds the
login that belongs to that number and checks it is still an admin; the
booking shows **created by** that person, as in the app. If the number has
no admin login, or loses its admin role, the bot refuses.

## Before it can work

- **Manpower agencies must be live in the app.** The manpower agency mode is
  built on the `agency-manpower` branch of Pulso Hub (4 Oct) but its plan says
  "undeployed". The bot uses that mode, so that branch goes live first.
- **Prospect agencies:** the app lets ops pick one, but the server refuses
  it ("Not signed up yet"), before the auto-activation can promote it. Worth
  fixing in Pulso Hub; the bot lists only pilot and active.
- Possible bug seen there, worth a look while deploying:
  `createOfflineFamily` reads `gate.allowed` but the check returns `ok`, so
  creating an agency family through it may always fail. The bot does not use
  it (it uses the client record, as the app's manpower path does).

## Order of work

1. Check each of the three numbers signs in to the admin app (mobile OTP).
2. Pulso Hub: the `adminBookingFromBot` endpoint and the admin list.
3. This server: the admin branch on 77361 29809.
4. Steps 1–8, then 9–15, each tested against a **test agency** with
   `isTestBooking` so no real caregiver gets an offer.
5. One real booking made side by side with the app; compare the two records
   field by field.
6. Live for the three admins.

## Decided

Number 77361 29809; admins 8714105666, 9446600809, 7736108778, known by
mobile number (OTP login); no documents, referral code or notes; location pin
only; age, not date of birth (founder, 4 Oct 2026).

## For the developer

- Home: this server (`pulso-whatsapp-bot`). Route: on the support number,
  before the "who are you" gate, a sender on the admin list goes to a new
  `adminBookingFlow.js`. If 9633108778 is chosen instead, route by its
  `phone_number_id` and send with `options.phoneNumberId`.
- Admin list: `app_config/admin_booking_bot.phones` in pulso-hub (the three
  numbers); the bot reads it to route, the endpoint resolves the login and
  checks the role.
- Calling the app's booking code: **a new Pulso Hub endpoint,
  `adminBookingFromBot`** (`onRequest`), protected by the bot's shared secret
  in `x-pulso-bot-secret`, the same pattern as `syncProviderOnboardingFromBot`
  and `partnerReviewFromBot`. The bot sends `{ adminPhone, action, data }`.
  The endpoint checks the phone is in `app_config/admin_booking_bot.phones`,
  finds the login with `admin.auth().getUserByPhoneNumber('+91…')` (phone
  OTP accounts), checks its claims are still ops (`isOperationsAdminClaims`), and runs the **same handler** as
  `createOfflineRequest` with `req.auth = { uid, token: claims }`, so
  `createdByAdminId` and `admin_actions` are the real admin. Actions:
  `listAgencies`, `setAgencyPhone`, `ensureClient`, `listPatients`,
  `addPatient`, `listAddresses`, `rates`, `create`.
  Why not sign in as the admin from the bot: the bot's service account has no
  access to Pulso Hub's Firebase Auth (checked 4 Oct: "insufficient
  permission"), and minting tokens would need a wider role than this needs.
- What each action wraps, all existing in Pulso Hub: agency list (the query behind
  `_OfflineAgencyPickerScreen`, `BOOKABLE_BUREAU_STATUSES`, `mode ==
  'manpower'`), `ensureBureauClientRecord({ bureauId })`, the client's members
  and saved addresses, `createOfflineFamilyMember` for a new patient, the
  quote / tier figures (`app_config/provider_tiers`, the same
  `agencyCost`/`payout` the rates panel shows), and `createOfflineRequest`.
- `createOfflineRequest` payload: build it exactly as
  `offline_booking_screen.dart:2948-3069` does for `_isManpower`
  (`bureauId`, `providerTier`, `partnerCustomerRate`, `partnerProviderRate`,
  `partnerRateOverrideReason`, `service` `senior_care_8h|24h`, `days`,
  `desiredStartMillis`, `caregiverGender`, `offlinePostCreateAction`,
  `paymentChoice: 'pay_later'`, address fields with `addressLat`/`addressLng`
  from the location pin and `addressSummary` from the pin's name/address
  (reverse-geocoded to the locality when WhatsApp sends none), no
  `notes`, member fields and medical flags, age override
  reason). Add `bookedVia: 'admin_whatsapp_bot'` only if Pulso Hub keeps
  unknown fields; otherwise log it in `internalTimeline` from the bot.
- New patient: `createOfflineFamilyMember` requires `dobMillis`; the bot
  sends today minus the typed age (in years) with `dobIsApproximate: true`
  (already supported), `fullName: "Patient N"`, `gender`. The booking
  carries `memberAgeYears` = the typed age.
- Draft per admin in Firestore (`adminBookingDrafts/{phone}`), 24-hour expiry;
  every step stores its answer so **back** and **Change something** reopen
  one field.
- Tests: the payload builder against a fixture copied from the app's payload
  for the same answers (field-by-field equality); refusal messages; non-admin
  routing unchanged.
