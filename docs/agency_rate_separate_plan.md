# Set the caregiver's pay and the agency's charge separately: plan

4 Oct 2026. For bookings an admin makes for a **manpower agency**, in the
Pulso app and in the admin booking bot.

## Today

The admin can change the caregiver's pay, but **not** what the agency is
charged. The agency is always charged **pay + ₹100**, worked out by the
server; there is no box for it.

| | Caregiver gets / day | Agency is charged / day | Pulso keeps / day |
|---|---|---|---|
| GDA, 24 h, as set | ₹700 | ₹800 (fixed: pay + ₹100) | ₹100 |
| Pay typed as ₹750 | ₹750 | ₹850 (fixed: pay + ₹100) | ₹100 |

So "caregiver ₹750, agency ₹850" is possible today only because it happens to
be pay + ₹100. "Caregiver ₹750, agency ₹900" is not possible at all.

## What changes

Two boxes, side by side, both filled in for the admin and both changeable:

| Box | Filled with | Can change |
|---|---|---|
| **Caregiver gets / day** | the tier's pay (e.g. ₹700) | yes |
| **Agency is charged / day** | pay + ₹100 (e.g. ₹800) | yes |

Under them, one line that updates as either changes:
**"Pulso keeps ₹100/day · ₹1,000 for 10 days"**.

Example: caregiver **₹750**, agency **₹850** → Pulso keeps ₹100/day.
Caregiver ₹750, agency ₹900 → Pulso keeps ₹150/day.

### The rules (founder, 4 Oct 2026)

| Case | What happens |
|---|---|
| Agency charge equal to the pay or higher (Pulso keeps ₹0 or more) | Allowed. **No reason asked.** |
| Caregiver pay other than the tier's | Allowed. **No reason asked.** |
| Caregiver pay under ₹500 | Refused, as today. |
| Agency charge below the caregiver's pay | Refused: "The agency charge can't be under the caregiver's pay." Pulso would pay the difference. |

No reason box on a manpower booking any more. Per booking only: nothing is
saved on the agency for next time.

### What follows the booking's own figures

Everything that charges or pays reads the two numbers saved on the booking,
never "pay + ₹100" again:

- **The weekly bill** to the agency: agency charge × days in the week.
- **Pulso's share** in the settlement: agency charge − caregiver pay.
- **The agency's app**: shows its charge per day (it never sees the
  caregiver's pay, as today).
- **Extensions** of the booking: extra days at the same agency charge.
- **Recreate booking**: starts from the old booking's two figures.

## In the app (Pulso Hub admin)

**New offline booking → A partner agency → manpower agency**, rates panel:

- **Who should do this work?** Basic · GDA and above · Nurse with no rate
  text under them (founder, 4 Oct 2026). Tapping one **fills both boxes**
  with that tier's suggested rates (pay, and pay + ₹100), replacing what was
  there; the admin then changes either if needed.

- Today it shows "Agency is charged ₹800/day … No family price" as text.
  That text becomes the **Agency is charged / day** box, filled with
  pay + ₹100, and moves with the pay until the admin types in it.
- The "Pulso keeps" line and the summary rows (Agency is charged / Caregiver
  receives / Pulso) read the two boxes.
- No reason box for manpower bookings.

**Notes for this booking:** removed from the form for manpower bookings
(founder, 4 Oct 2026), as in the bot.

Only admins see this. The agency's own app is unchanged.

## In the admin booking bot

Step 11 ("Caregiver pay") becomes **Rates**:

> Caregiver gets **₹700/day** · agency is charged **₹800/day** · Pulso keeps
> ₹100/day.
> [ Keep ] [ Change caregiver pay ] [ Change agency charge ]

- **Change caregiver pay** → type the amount. The agency charge moves to
  pay + ₹100 unless it was already changed.
- **Change agency charge** → type the amount.
- No reason is asked. Under ₹500 pay, or an agency charge under the pay,
  the bot says why and asks for the amount again.
- The summary shows both figures and "Pulso keeps ₹…/day".

## Decided (founder, 4 Oct 2026)

1. Pulso keeps anything from ₹0 upward; no reason needed.
2. A changed caregiver pay needs no reason either.
3. Per booking only.
4. No notes field on manpower bookings.

## Suggested rates: what caregivers are already told

The caregiver onboarding bot (checked 4 Oct, live chats since 3 Oct) tells
caregivers:

| Tier | 8 hours / day | 24 hours / day |
|---|---|---|
| Basic | ₹650 | ₹750 |
| GDA | ₹800 to ₹900 (sample offer ₹800) | ₹900 to ₹1,200 (sample offer ₹1,000) |
| Nurse | ₹1,200 | ₹1,400 |

The booking's suggested pay comes from the tier settings, which are lower
for Basic and GDA:

| Tier | 8 hours / day | 24 hours / day |
|---|---|---|
| Basic | ₹500 | ₹600 |
| GDA | ₹600 | ₹700 |
| Nurse | ₹1,200 | ₹1,400 |

So a caregiver told ₹750 is offered a Basic duty at ₹600.

**Decided (founder, 4 Oct 2026):** the suggested pay becomes what caregivers
are told, GDA at the bottom of its range. One settings change in
`app_config/provider_tiers`, no release:

| Tier | Pay 8 h / 24 h | Agency charge starts at 8 h / 24 h |
|---|---|---|
| Basic | ₹650 / ₹750 | ₹750 / ₹850 |
| GDA | ₹800 / ₹900 | ₹900 / ₹1,000 |
| Nurse | ₹1,200 / ₹1,400 (unchanged) | ₹1,300 / ₹1,500 |

The minimums for other agencies' and direct bookings (`familyFloor8h/24h`)
move with it to pay + ₹100, as the settings note already says they should.
This raises the suggested pay on every booking that reads these settings,
not only manpower ones.

## Order of work

0. Settings: the new pay and minimums in `app_config/provider_tiers`.
1. Server: accept the agency charge on manpower bookings, with the rules,
   and save it. Tests.
2. App: the agency charge box and the "Pulso keeps" line. Release.
3. Bot: the Rates step (part of the admin booking bot build).
4. Check one test booking end to end: the booking, the agency's app, the
   Monday bill, an extension.

## For the developer (Pulso Hub)

- `functions/lib/ops_partner_booking.js` `opsPartnerRateDecision`: for
  `manpower`, take `customerRate` when `isOps` and it is a positive number;
  otherwise keep `provider + markupFor(tierConfig)`. Then
  `agencyCostPerDay = customer` and `platformMarkupPerDay = customer -
  provider` (today both assume the flat markup). Add
  `customAgencyCharge: customer !== provider + markup` to the flat block.
- Checks for a manpower ops booking: refuse `provider < MIN_PROVIDER_PAY_PER_DAY`
  and `customer < provider` (both not overridable, as today); drop
  `pay_off_preset` and `customer_below_floor` for it, so no reason is
  required. Easiest: a `manpower && isOps` branch in `opsPartnerRateDecision`
  that filters those two issue codes out of `tierRateIssues`. Partners and
  agency-style bookings keep today's rules.
- `createOfflineRequest` (index.js ~12286) already copies
  `agencyCostPerDay` / `platformMarkupPerDay` into `bureauRateSnapshot`;
  `customerDailyRate` and `price = customer × days` follow from the decision.
- Readers that must use the snapshot, not the constant: weekly bill
  (`bureau_weekly_billing.js:93`, `agencyCostPerDay`), settlement
  (index.js ~31511, `platformMarkupPerDay`), projection
  (`bureau_projection.js:128/157`), admin request page
  (`request_detail_screen.dart:2830`). All read the snapshot already; confirm
  none recomputes pay + markup. Check extension pricing
  (`requestExtensionAdmin`, ~13001) charges extra days at
  `customerDailyRate`, and Recreate prefill carries both rates.
- App: `offline_booking_screen.dart`. `_partnerCustomerN` returns
  `_partnerAgencyCostN` for manpower (~1018): make it read a new
  `_manpowerAgencyRate` controller, defaulting to `_partnerAgencyCostN` until
  edited (as `_partnerCustomerEdited` does for direct bookings). The panel at
  ~3162 replaces the fixed text with the field; `_partnerReasonNeeded`
  is false for manpower. The payload already sends
  `partnerCustomerRate` (~3001); the server simply stops ignoring it.
- Tests: decision table (preset/custom pay × agency charge at the pay,
  between pay and pay + markup, above, below the pay; pay under ₹500), no
  reason required anywhere for manpower ops; a manpower booking's bill and settlement at a
  custom charge.
