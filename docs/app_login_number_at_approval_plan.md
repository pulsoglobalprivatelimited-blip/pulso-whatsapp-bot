# Pulso app login number at approval: plan

14 Oct 2026. Founder: "When we approve the certificate or review, create an
option for reviewer to edit or leave the prefilled mobile number as the login
number."

## The problem today

A caregiver's Pulso app account is matched to her **WhatsApp number**. The bot
tells her: "log in to the Pulso app with the same number you used on
WhatsApp".

Many caregivers use WhatsApp on one number and their SIM (where the OTP
comes) on another, or on a family member's phone. If she logs in with a
different number, the app does not recognise her: no duty offers, and the
desk keeps showing "app activation pending".

Of the 745 caregivers who finished joining:
- 333 are linked to the app
- 227 have never been linked
- 42 asked for help, 14 of them for "login / OTP problem"

## What changes

### 1. On the desk (Approve certificate)

The Approve window gets one more line, already filled in:

> **App login number:** +91 79940 46775   [ Change ]

- If you do nothing, her WhatsApp number stays her login number (as today).
- Tap **Change**, type the other 10-digit number, and approve. The bot checks
  it is a valid Indian mobile number before saving.

### 2. On WhatsApp (Approve button in the review alert): NOT DONE (founder, 14 Oct: "Only in desk")

WhatsApp approvals stay exactly as today. The section below is kept only as a record.

#### (dropped)

After you tap **Approve**, the bot asks you one more thing:

> Login number for Veena Mohan: **+91 79940 46775**
> **[ Keep this number ]  [ Change number ]**

- **Keep this number**: approval goes ahead as today.
- **Change number**: the bot asks you to type the number, shows it back for
  one confirm, then approves.

The same applies to Afiq's approvals (No certificate, students, above 50).

### 2b. The caregiver is asked herself, before review (founder, 14 Oct: yes)

Right after she picks her district, before the "check your details" message:

> Pulso app-ൽ login ചെയ്യാൻ ഏത് mobile number ആണ് ഉപയോഗിക്കുക?
> Login ചെയ്യുമ്പോൾ OTP ഈ number-ലേക്ക് ആണ് വരുക.
> **[ ഈ WhatsApp number ]  [ വേറെ number ]**

> Which mobile number will you use to log in to the Pulso app?
> The login OTP will come to this number.
> **[ This WhatsApp number ]  [ Another number ]**

- **This WhatsApp number**: nothing to type; the chat goes on.
- **Another number**: "ദയവായി 10 അക്ക mobile number type ചെയ്യുക." She types it;
  a wrong number is asked again.
- The details check shows it as one more line, **App login number**, so she
  can change it there like the other details.
- The desk Approve window then shows her own answer, and you can still
  change it.

### 3. What the caregiver is told

Her closing message names the number she must use:

> Pulso app install ചെയ്ത് **98XXX XXXXX** എന്ന number ഉപയോഗിച്ച് login ചെയ്യുക.

(Today it says "the same number you used on WhatsApp".)

### 4. In the Pulso app

When she logs in with the login number, the app links her to her WhatsApp
record, exactly as it does today for the WhatsApp number. Her offers, pay
and profile come across as usual. WhatsApp messages still go to her WhatsApp
number.

### 5. Changing it later

Her record on the desk shows **App login number** with a **Change** button,
for when she says "OTP is not coming" after joining.

## What does not change

- Her WhatsApp number stays her ID in the bot and on the desk.
- Nobody's existing login is touched. The new number only matters when it
  is different and she has not linked yet.
- A number that already belongs to another caregiver's or a family's app
  account is refused, with a message saying whose it is.

## Your decisions

1. **WhatsApp approvals**: decided 14 Oct: **only on the desk**. WhatsApp approvals unchanged.
2. **Caregiver's own choice**: decided 14 Oct: **yes**, asked after the
   district (section 2b). Wording above is a draft for your approval.
3. **The 227 never linked**: after this is live, send them a message asking
   which number they log in with?

## Steps

1. Store the login number on her record (default: WhatsApp number) and send
   it to the Pulso app with her other details.
2. Pulso app: link her account when she logs in with the login number.
3. Desk: the line in the Approve window, and Change on her record.
4. The bot asks her the login number after the district, and shows it in
   the details check.
5. Her closing message names the number.
6. Tests, then live: bot first, then the Pulso app server functions.

## For the developer

- Bot: new `providers/{phone}.appLoginPhone` (12-digit `91…`, default = doc id);
  sent in `buildProviderSyncPayload` (`src/services/pulsoHubSyncService.js`).
  Desk approve: `POST /admin/providers/:phone/approve` body gains
  `appLoginPhone`; validate with the same 10-digit rule as the bot's phone
  parsing. WhatsApp: new `REVIEW_ACTIONS` stage after approve tap
  (`review_login_keep_` / `review_login_change_`), reviewer types the number,
  one confirm; allowed for the second reviewer too.
- Closing copy: `MESSAGES` lines that say "WhatsApp onboarding-ൽ ഉപയോഗിച്ച അതേ
  phone number" become a template with `{{loginPhone}}`.
- Hub: `syncProviderOnboardingFromBot` stores the mirror under
  `botOnboarding/{whatsappPhone}` as now, plus an alias doc
  `botOnboardingLoginPhones/{loginPhone} → { whatsappPhone }`. In
  `reconcileBotOnboardingForPhone`, `findUsersByPhone` also tries the login
  phone; on app sign-in, look up the alias when no `botOnboarding/{phone}`
  exists. Refuse an alias whose phone already has a non-provider user
  (`getUserByPhoneNumber`).
- Hub deploy: `syncProviderOnboardingFromBot` and the sign-in reconcile path;
  check the live source of each function before deploying (other sessions
  deploy these too).
