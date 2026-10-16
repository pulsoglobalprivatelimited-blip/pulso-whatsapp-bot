# Late button taps, and the photo that comes twice: plan

16 Oct 2026. Founder: "How do we fix the late tap after tapping another
option?" … "Should the bot ask change to." … "Include a plan to fix why full
length photos uploaded comes twice the same pic."

## Part 1: a late tap on an older message

### The problem

Sandra James (+91 98464 31250) chose **"❌ വേണ്ട"** (no cooking) on 15 Oct. At
2:00 pm, after sending her details, she tapped **"✅ അതെ, പാചകം ചെയ്യാം"** on
that earlier message. The bot read it as an answer to its *current* question,
found it did not fit, and said "your certificate is under verification". Her
record still says **no cooking**.

### What changes

Old buttons are of two kinds.

**Preferences**: cooking yes/no, duty hours (8 hour / 24 hour / Both), the
agency question, the app login number. A late tap on one of these is a change
of mind. **The bot asks before changing** (founder, 16 Oct):

> പാചകം കൂടിയുള്ള ഡ്യൂട്ടി വേണമെന്ന് മാറ്റണോ?
> **[ അതെ, മാറ്റുക ]  [ വേണ്ട ]**

> Change to: duties with cooking?
> **[ Yes, change ]  [ No ]**

- **അതെ, മാറ്റുക**: saved; "ശരി 👍 മാറ്റി."; sent to the Pulso app if she has
  joined; the chat carries on where she was.
- **വേണ്ട**: nothing changes; the chat carries on where she was.
- Duty hours: "Duty hour '24 hour' ആക്കി മാറ്റണോ?", and the same for the others.
- This works at any point: while joining, while waiting for review, and after
  she has joined.

**Steps**: interested, sample duty, "ready for the duties", details correct,
terms. A late tap on one of these changes nothing; she gets her **current**
question again. "താൽപര്യമില്ല" still stops the chat (founder, 10 Oct).

### After it is live

Sandra's last tap was "yes, cooking". Send her the "മാറ്റണോ?" question only if
the founder says so (it messages her).

## Part 2: the full-length photo comes twice

### The problem

When a caregiver uploads her full-length photo (now in the Pulso app), the
review alert with the photo reaches **9446600809 twice**. Checked for Sandra:
at 9:53 am on 16 Oct, two separate messages with the same photo were
delivered to that number in the same minute, both read.

### Why

The photo alert is sent to "every reviewer phone", a list made of two
settings: the agent-help number and the owner number. **Both are
9446600809**, and this list (unlike the certificate alerts' list) does not
remove a number that appears twice. So the same photo is sent to the same
phone twice. The certificate alerts are not affected; they already remove the
repeat.

### The fix

Send the photo once per phone: remove the repeated number before sending.
Nothing else changes: same template, same Accept / New photo buttons, same
people. The second review number (8714105666) does not get photo alerts today, and this
does not change that.

## Part 3: the reviewer sends a sample photo with the note

### Today

On the photo review alert, the reviewer taps **New photo**, types a short note,
and the caregiver gets only text:

> ദയവായി ഒരു പുതിയ full photo (തല മുതൽ കാൽ വരെ) അയയ്ക്കുക.
> Reviewer note: <the note>

Words alone often do not show what "full length, standing, daylight" looks
like.

### What changes

After **New photo**, the bot asks the reviewer:

> Send a note for Sandra James. You can also send a sample photo:
> send the photo with your note written as its caption.
> **[ Use our sample ]  [ Note only ]**

The reviewer can do any one of these:

1. **Send a photo with a caption.** The caregiver gets that photo, then the
   caption as the reviewer's note.
2. **Tap "Use our sample".** The bot asks for the note, and the caregiver gets
   Pulso's standard sample photo with it. That photo is one good full-length
   picture you send to the bot once (it can be replaced any time).
3. **Tap "Note only", or just type.** As today, text only.

What the caregiver sees (when a sample is sent):

> *(the sample photo)*
> ഇതുപോലെ ഒരു full photo അയയ്ക്കുക: നിന്നുകൊണ്ട്, തല മുതൽ കാൽ വരെ, നല്ല വെളിച്ചത്തിൽ.
> Reviewer note: <the note>

### One problem to solve at the same time

Photos are now uploaded in the Pulso app, so the caregiver may not have
written on WhatsApp in the last 24 hours. Outside those 24 hours WhatsApp
delivers only an approved template, so today's text request can **silently
fail**. A template "caregiver_photo_retake" (photo + note) is submitted to Meta
and used when she is outside the 24 hours; inside them, the plain messages go
as above.

### Your decisions

1. **The standard sample photo**: decided 16 Oct: the founder's photo (a
   caregiver in the blue uniform, standing, head to toe, plain wall), saved as
   docs/assets/profile_photo_sample.png.
2. **The Pulso app**: decided 16 Oct: **yes**, see Part 4.

## Part 4: the sample photo inside the Pulso app (founder, 16 Oct)

### Today

In the app, the caregiver reads only words: "Full-length: standing, head to
toe, facing the camera. Plain background, good light…". When Pulso asks for a
new photo, her profile shows "Pulso's note: …" as text.

### What changes

The sample photo (the blue-uniform example, not a real person) is shown in
three places, with **"ഇതുപോലെ" / "Like this"** under it. Tapping it opens it
full screen.

1. **The camera / gallery choice**, above the instructions, every time she
   adds a photo.
2. **The joining step "Your profile photo"**, next to the instructions.
3. **My Profile, when Pulso asks for a new photo**: the reviewer's note, and
   under it the photo the reviewer sent; if the reviewer sent none, the
   standard sample.

The standard sample is built into the app, so it shows at once, even on a weak
connection. A reviewer's own photo comes from the link saved with her photo
record (step 10).

### What this needs

- An app release on Play Store and App Store. The admin website is not affected.
- The Pulso app server passes the reviewer's sample link on to her app, next to
  the note it already passes.

## Steps (15)

1. Mark which old buttons are preferences and which are steps.
2. The "മാറ്റണോ?" question with its two buttons, Malayalam and English.
3. Yes saves, confirms and syncs to the Pulso app; No leaves it; the chat
   carries on either way.
4. A late step button shows her current question again.
5. The photo alert goes once per phone.
6. After "New photo", the reviewer is offered: photo with caption, "Use our
   sample", or "Note only".
7. A reviewer's photo is passed on to the caregiver, with the note.
8. "Use our sample": store the standard sample photo (docs/assets/profile_photo_sample.png).
9. Template "caregiver_photo_retake" (photo + note) submitted to Meta, used
   outside her 24 hours; plain messages inside them.
10. The sample link saved with her photo record, for the app (decision 2).
11. Tests, then the bot goes live.
12. App: the sample photo built in, shown on the camera / gallery choice and the
    joining photo step, with "ഇതുപോലെ / Like this" and full-screen on tap.
13. App: My Profile shows the reviewer's photo (or the standard sample) under
    "Pulso's note" when a new photo is asked for.
14. Pulso app server: pass the reviewer's sample link to her app with the note.
15. Tests, then the app release (stores) and the server deploy.

## For the developer

- Late taps: in `processIncomingMessage` (`src/services/onboardingFlow.js`),
  before the status switch, classify `getInteractiveReplyId(message)`:
  preference ids `COOKING_YES/NO`, `DUTY_HOUR_8/24/BOTH`, the agency yes/no ids,
  `LOGIN_PHONE_SAME`; when the id does not belong to the current status's own
  question, store `pendingPreferenceChange: { field, value, askedAt }` and send
  the confirm buttons (`pref_change_yes` / `pref_change_no`). On yes: write the
  field (`cookingOptIn`, `dutyHourPreference`, `worksWithAgency`,
  `appLoginPhone`), `syncProviderToPulsoHub` if `termsAccepted`, then
  `sendPromptForCurrentStatus`. Step ids (`INTEREST_YES`, `SAMPLE_DUTY_*`,
  `EXPECTED_DUTIES_YES`, `DETAILS_CORRECT`, `TERMS_ACCEPT`) out of their own
  status → `sendPromptForCurrentStatus`. `stopIfNotInterested` stays first.
  The cooking-question duty-hour handling (`handleCookingPreference`, 15 Oct)
  becomes a case of the same rule.
- Sample photo: `awaiting_photo_note` (reviewer workflow in
  `handleReviewerMessage`) also accepts an incoming image: download it with the
  media id (as the certificate archive does), upload to Meta `/media`, send to
  the caregiver as `image` with the localized "ഇതുപോലെ…" caption, then the note.
  Buttons `review_photo_sample_<phone>` / `review_photo_noteonly_<phone>`.
  Standard sample: one image in Storage, path in config `PROFILE_PHOTO_SAMPLE_URL`
  (send by link). Template `caregiver_photo_retake`: image header + body
  {{1}} note; use when `!isInsideFreeWindow(provider)`. Save
  `profilePhoto.sampleUrl` and sync it, so the app can show it.
- App: bundle the sample as `assets/images/profile_photo_sample.jpg` (resize
  the 1024×1536 PNG to ~600 px JPEG); show it in `ProfilePhotoFlow` (the
  camera/gallery sheet, `ppPhotoInstructions` block, ~line 165–183 of
  `lib/screens/provider/profile_photo_flow.dart`), the step screen (~239–309),
  and `my_profile_screen.dart` photo card (~975) under `ppPhotoReviewerNote`
  when the status is retake, using `Image.network(sampleUrl)` with the asset as
  fallback. New strings `ppPhotoSampleCaption` ("Like this" / "ഇതുപോലെ") in
  both ARB files. Hub: carry `profilePhoto.sampleUrl` from the bot mirror to
  wherever the note reaches the user doc today (check the field the card reads).
- Double photo: `notifyProfilePhotoReview` (`src/services/opsNotifications.js`)
  loops over `getReviewerPhones()`, which returns
  `[agentHelpWhatsappNumber, ownerNotificationPhone]` (both 919446600809) with
  no de-duplication. Use `uniquePhones(getReviewerPhones())`. Confirmed in
  `whatsappMessageStatuses`: two messages to 919446600809 at 04:23 UTC on
  16 Oct 2026.
