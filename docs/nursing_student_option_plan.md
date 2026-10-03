# "Nursing student" as a choice in the caregiver chat: plan

3 Oct 2026.

## What you asked

Add **Nursing student** to the qualification list in the caregiver chat.
Treat a nursing student as a **Basic caregiver**: Basic pay, Basic duties, and
she can be approved as Basic after a call.

## What happens today

The list has GDA, GNM, ANM, HCA, BSc Nursing, Other, No certificate. A nursing
student has nowhere to go. She picks GNM or BSc Nursing (and then has no
certificate to send) or "No certificate" (and we lose the fact that she is in
nursing college). Either way the reviewer does not know she is a student.

## What we will change

1. **A new row in the list: "Nursing student".**
   - Malayalam: **നഴ്സിംഗ് വിദ്യാർത്ഥി** — "GNM / BSc / ANM പഠിക്കുന്നു"
   - English: **Nursing student** — "Studying GNM / BSc / ANM"
   It sits just above "No certificate". WhatsApp allows 10 rows; this makes 8.

2. **The chat after she picks it.** Same steps as everyone (interest, duty
   hours, stay and food, duties), with two differences:
   - **Pay shown is the Basic pay**, the same as "No certificate".
   - **No course certificate is asked.** Instead: "Please send a photo of your
     **college ID card**." This proves she really is a student. (Your decision 1
     below.)
   Then name, age, sex, district, as today.

3. **Her closing message.** "Thank you. Since you are a nursing student, our
   team will call you for a short talk and inform you after that." Same as the
   "No certificate" message, with the word "nursing student".

4. **The review.** She goes to the same call-based review as "No certificate":
   - The alert says **"Nursing student — please call her, then approve as
     Basic or reject"**, with **Call her / Approve (Basic) / Reject**, and her
     college ID photo if she sent one.
   - She is in the **"Needs a call"** list on the desk, marked "Nursing student".
   - Approve (Basic) puts her on the Basic rate, reason "no course certificate".

5. **In the Pulso app.** She is a Basic caregiver, so she gets Basic duties and
   Basic pay. Her record still says "Nursing student", so ops can see it.

6. **When she qualifies.** Once she finishes the course, she sends the GNM/BSc
   certificate and ops change her to Nurse from the desk. No new chat needed.

## Your decisions

1. **College ID card**: ask for it (recommended), or ask nothing like
   "No certificate"?
2. **Mohamed's alerts**: should nursing students also go to Mohamed Afiq, like
   "No certificate"? (Recommended: yes, it is the same phone review.)
3. **The words**: are the Malayalam and English row text above fine? Your words
   are used exactly as you write them.

## Order of work

1. Bot: the new row, Basic pay, the college ID step, the closing message.
2. Review: the alert wording, Call her / Approve (Basic) / Reject, Mohamed if
   you say yes, the desk "Needs a call" list.
3. Pulso app side: "Nursing student" counts as Basic for pay and duties.
4. Tests, then a full run in the chat with a test number, then live.

## For the developer

- Bot list: `QUALIFICATIONS` / `ENGLISH_QUALIFICATIONS` in `src/flow.js`
  (~99, ~120); new `BUTTON_IDS.QUALIFICATION_NURSING_STUDENT`, parsed to
  `nursing_student` in `src/services/messageParser.js` (~76, ~90 for text).
- Basic band: add `nursing_student` to `BASIC_QUALIFICATIONS` (`src/flow.js`
  ~876) and to `tierForQualification` in `src/services/providerTiersConfig.js`.
- Certificate step: `startCertificateStep` area in `onboardingFlow.js` (~1975,
  where `no_certificate` skips to the name); for `nursing_student` ask for the
  ID card with `certificatePapers.nursing_student = 'college ID card'`
  (reuses `buildCertificateRequestMessage`). If decision 1 is "nothing", follow
  the `no_certificate` branch.
- Closing message: `verificationPendingNoCertificate` gets a nursing-student
  variant.
- Review: treat `nursing_student` like `no_certificate` in
  `isNoCertificateProvider` (opsNotifications) for the call-based alert and the
  second reviewer; the alert's first line names "Nursing student". The
  certificate_review_no_cert template's first line says "No certificate
  application" — either submit a second template or accept that wording.
- Approvable list: add `nursing_student` to `APPROVABLE_QUALIFICATIONS` and
  `validQualifications` (`onboardingFlow.js` ~243) only as a claimed value;
  approval stays `basic_caregiver`.
- Desk: `matchesQualificationFilter` "No certificate"/"Needs a call" includes
  `nursing_student`; `formatQualification` label "Nursing student"; review
  dropdown falls back to "Select qualification" (already done).
- Hub (senior/pulso_hub): `reconcileBotOnboardingForPhone` maps the bot's
  qualification to the app tier; map `nursing_student` → Basic in
  `functions/lib/provider_tiers.js`, needs a functions deploy.
- Google Contacts label: `googleContactsService.js` maps (~43, ~62).

## Built, 3 Oct 2026

Founder: proof = **marks card**; Mohamed gets them too; wording as written.
- Row "നഴ്സിംഗ് വിദ്യാർത്ഥി / Nursing student" above "No certificate"; typed
  words read as nursing student before GNM/BSc.
- Basic rate band; asked for "nursing course marks card" (not a CV).
- Closing message "Since you are a nursing student, our team will call you".
- Call-based review to you and Mohamed: Call her / Approve (Basic) / Reject;
  the template names her "(nursing student)"; the marks card follows the alert.
- Desk: label "Nursing student"; the "No certificate / student" filter holds both.
- Pulso app: nothing to change. The bot sends the approved value
  (basic_caregiver) after approval, so pay and duties are Basic. Teaching the
  app the claimed value nursing_student is optional, for display only.
- Tests: test/nursingStudent.test.js (5); suite 225/225.
