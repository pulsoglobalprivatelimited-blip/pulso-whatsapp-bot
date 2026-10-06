# Invite the rejected people back as Basic caregivers: WhatsApp broadcast plan

6 Oct 2026, for sending on **Wed 7 Oct, 10:00 am**. Replaces the sending
part of `age_rejected_recontact_plan.md`.

## Who gets it: 24 people in Kerala

From the list in `Downloads/pulso_rejected_lists/kerala_rejected_age_and_nursing_2026-10-04.csv`,
checked live on 6 Oct (nobody on it has written to us since 4 Oct):

| Group | Who | People |
|---|---|---|
| **Age** | Turned away for age, age on file 55 or under (founder, 4 Oct: limit 55, include those with 50 or under on file) | **21** |
| **Nursing** | Rejected for no completed GNM / BSc certificate | **3** |
| Not sent | Turned away for age, 56 and over | 8 |

Sent from the caregiver bot, **+91 77361 67744**, the number they applied
on.

## The two messages (Malayalam, approved templates)

Their last chat with us is days old, so each must be a Meta-approved
**Marketing** template. One per group, because the reason they were turned
away differs. Under ₹1 each; about ₹25 for all 24.

**Age group** (`basic_invite_age_ml`):

> നമസ്കാരം 🙏
>
> മുമ്പ് 50 വയസ്സിന് മുകളിലായതിനാൽ Pulso-യിൽ ചേരാൻ കഴിയില്ലെന്ന് ഞങ്ങൾ
> അറിയിച്ചിരുന്നു. ഇപ്പോൾ 50 വയസ്സ് കഴിഞ്ഞവർക്കും Pulso Basic Caregiver
> ആയി ജോലി ചെയ്യാം.
>
> ✔️ സ്വന്തം ജില്ലയിൽ ഹോം കെയർ ഡ്യൂട്ടി
> ✔️ ദിവസേന പേയ്മെന്റ്
> ✔️ രജിസ്ട്രേഷൻ ഫീസ് ഇല്ല
>
> താൽപര്യമുണ്ടെങ്കിൽ താഴെയുള്ള button അമർത്തുക.

**Nursing group** (`basic_invite_nursing_ml`):

> നമസ്കാരം 🙏
>
> GNM / BSc Nursing കോഴ്സ് സർട്ടിഫിക്കറ്റ് ഇല്ലാത്തതിനാൽ മുമ്പ് താങ്കളുടെ
> അപേക്ഷ തുടരാൻ കഴിഞ്ഞില്ല. ഇപ്പോൾ സർട്ടിഫിക്കറ്റ് ഇല്ലാതെ തന്നെ Pulso Basic
> Caregiver ആയി ജോലി ചെയ്യാം. കോഴ്സ് പൂർത്തിയായി സർട്ടിഫിക്കറ്റ് ലഭിച്ചാൽ
> Nurse നിരക്കിലേക്ക് മാറാം.
>
> ✔️ സ്വന്തം ജില്ലയിൽ ഹോം കെയർ ഡ്യൂട്ടി
> ✔️ ദിവസേന പേയ്മെന്റ്
> ✔️ രജിസ്ട്രേഷൻ ഫീസ് ഇല്ല
>
> താൽപര്യമുണ്ടെങ്കിൽ താഴെയുള്ള button അമർത്തുക.

Buttons on both: **താൽപര്യമുണ്ട്** (Interested) · **വേണ്ട** (No thanks).

No pay figure in the template: the bot shows the live Basic pay on the next
screen (today ₹750 for a 24-hour duty), so a rate change never makes the
template wrong. No name: most of the age group has none on file.

## What happens when they tap

- **Interested**:
  - The old rejection is cleared and noted in their history.
  - **Age group:** the bot asks their age again (the age on file may be
    wrong). Over 50 → the Basic rate and the call review, as the bot does
    today for everyone; no upper limit (founder, 7 Oct).
  - **Nursing group:** they go straight on as **Basic Caregiver** (no
    certificate needed), then the normal chat.
  - At the end they reach the usual call review ("Needs a call"), marked
    **"came back from the Basic invite"**, for you and Afiq.
- **No thanks**: "ശരി, നന്ദി. ഇനി ഇതിനെക്കുറിച്ച് ഞങ്ങൾ message അയക്കില്ല."
  Never sent again.
- **No reply**: nothing more. One message only.

## Timeline

| When | What |
|---|---|
| **Today (6 Oct)** | Submit both templates to Meta (Marketing templates are usually approved within hours). Build the Interested / No thanks handling and the send script. Test on a test number. |
| **Tomorrow 9:30 am** | Check both templates are approved. Refresh the list from live data (drop anyone who came back or finished on their own). Dry run: print the 24 numbers and which message each gets. |
| **Tomorrow 10:00 am** | Send, a few seconds apart. |
| **Tomorrow evening** | Count: sent, delivered, read, Interested, No thanks. |
| **Fri 9 Oct** | Final count: who finished onboarding and reached the call review. |

If a template is not approved by 9:30 am, that group waits until it is.

## Decided (founder, 7 Oct 2026)

1. No 55 stop: the bot stays as it is (no upper age limit). The age message
   says "over 50 can now join", not "up to 55". The 21 invited are still
   those with 55 or under on file.
2. Nursing group: the 3 who were rejected. The 13 who said "not completed"
   but were never reviewed are not sent for now (can be added later).
3. Send at 10:00 am on 7 Oct.

Templates `basic_invite_age_ml` and `basic_invite_nursing_ml` submitted to
Meta at 00:02 on 7 Oct (Marketing, Malayalam).

## For the developer

- Templates: script `src/scripts/createBasicInviteTemplates.js` (as
  `createCoordinatorReviewTemplate.js`), WABA 940659845043119, MARKETING,
  `ml`, two quick replies with payloads `basic_invite_yes` /
  `basic_invite_no` (set per message).
- Send: `src/scripts/sendBasicInvite.js` from the CSV (or a live re-query),
  dry run by default, `--send`, throttle 3 s, group per row, skip anyone with
  `basic_invite_sent` or `basic_invite_declined` in history, or whose status
  is no longer a rejected/stuck one. Log
  `appendHistory({ type: 'system', event: 'basic_invite_sent', group })`.
- Handler in `onboardingFlow.js`: route the two payloads before the status
  switch (statuses `age_rejected`, `needs_human_review`,
  `certificate_rejected_permanent`, `awaiting_certificate`). Yes → clear
  `verification` rejection, set `basicInviteAt`; age group → status
  `AWAITING_AGE`, `ageQuestion`; nursing group → `qualification:
  'no_certificate'`, continue to the next onboarding step. No →
  `basic_invite_declined`, reply, no status change.
- Review alert: add the "came back from the Basic invite" line when
  `basicInviteAt` is set.
- Tests: both payloads for each group, decline, double-send guard.
