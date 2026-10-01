# People send a CV when the bot asks for the certificate: plan

1 Oct 2026.

## The problem

At the certificate step the bot says only:

- Malayalam: "ദയവായി താങ്കളുടെ certificate upload ചെയ്യുക."
- English: "Please upload your certificate as an image or PDF."

To a job seeker, "send your document" means "send your CV". The word
"certificate" alone does not say *which* paper. So many send a CV (example:
Amal Roy, GNM, Idukki, 30 Sep). The reviewer then sees a CV, cannot check the
qualification, and has to press "Request doc" by hand. The caregiver waits, and
some never come back.

## What we will change

1. **Name the exact paper.** The bot already knows what she chose a moment
   earlier (GNM, ANM, GDA, BSc Nursing, HCA). Ask for that paper by name:
   - GNM / ANM / BSc: "Please send a photo of your **GNM course certificate or
     Nursing Council registration certificate**."
   - GDA / HCA: "Please send a photo of your **GDA course certificate**."
   - Say plainly: "**Not your CV or resume.** We need the certificate itself."
   Same in Malayalam, short lines.

2. **Show a picture.** Send one sample image with the question: a blurred
   example of a real certificate, with a tick, next to a CV with a cross. A
   picture beats any sentence for people who skim.

   Founder decision, 1 Oct 2026: **no CV is needed.** The bot never asks for
   one and never keeps one.

3. **Catch a CV automatically.** When a file arrives at the certificate step,
   read it:
   - PDF: read the text inside.
   - Photo: read the text from the image.
   If it has CV words (Resume, Curriculum Vitae, Objective, Skills, Languages,
   References) and no certificate words (Certificate, Council, Registration,
   Board, Diploma, Roll No), the bot does not keep the file and replies at once:
   "This looks like a CV. We do not need a CV. Please send your GNM
   certificate." The reviewer is
   alerted only when a real certificate is in. No human time spent.

4. **Help the reviewer when one slips through.** The alert says "Looks like a
   CV" at the top when the check is unsure, and "Request doc" sends the same
   clear text as step 1, with the paper's name.

5. **Measure it.** Count, per week, how many first uploads were CVs, and how
   many people finished after being asked again. Today's number first, as the
   baseline.

## Order of work

1. Step 1: new words only. Smallest change, most of the gain. Live
   the same day after your approval of the wording.
2. Step 2: the sample picture (a certificate only, no CV).
3. Steps 3 and 4: the automatic check. Reading photos needs a text-reading
   service: Google Vision costs about ₹0.10 a photo; at today's volume that is
   under ₹100 a month.
4. Step 5, then review after two weeks.

## What I need from you

- **Approve the exact words** (English and Malayalam) for steps 1 and 3.
  I will send a draft; your words are used as you write them.
- **Yes or no** to the automatic check in step 3 (the small cost above).
- A real certificate photo we may use, blurred, for the sample in step 2.

## For the developer

- Messages: `src/flow.js` `certificateRequest`, `certificateRetry` (ML at
  ~234, EN at ~471). Make them functions of `provider.qualification`
  (`gda/gnm/anm/hca/bsc_nursing/other_caregiving`; `no_certificate` skips the
  step already).
- Step handler: `handleCertificate` in `src/services/onboardingFlow.js`
  (~2174); classify after `archiveIncomingMedia` (~1978), before the file is
  appended to `certificateAttachments`. A CV is not stored at all (founder:
  no CV needed); log only that one was refused.
- Reviewer alert: `notifyCertificateUploaded` in
  `src/services/opsNotifications.js`; the v3 template body is fixed, so a
  "Looks like a CV" flag goes in the free-text follow-up, not the template.
- Request doc text: `REVIEW_ACTIONS.REQUEST_ADDITIONAL_DOCUMENT` handler.
- Baseline count: attachments at the certificate step whose text matches
  the CV words, last 30 days.

## Done, 1 Oct 2026

Founder: wording approved, **no automatic check**, a sample photo will come.

- Step 1 built: the ask and the retry name the paper for her qualification
  (GDA / GNM / ANM / BSc Nursing / HCA / other caregiving / basic) and say
  "Not your CV or resume", in Malayalam and English.
- Step 4 built (without the automatic check): a reviewer who gets a CV
  presses Request doc and replies **CERT**; she is told "What you sent is not
  the certificate. Please send a photo of your GNM course certificate…" in her
  own language. The note prompt tells the reviewer about CERT.
- Step 3 (automatic check) dropped by the founder.
- Step 2 waits for the founder's sample photo.
- Test: `test/certificateWording.test.js` (6); full suite 206/206.
