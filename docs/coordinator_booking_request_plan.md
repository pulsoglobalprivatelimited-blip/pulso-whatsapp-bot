# Care coordinator sends a booking request; 9446600809 reviews it: plan

5 Oct 2026. An agency asks for a caregiver. The care coordinator puts the
details into WhatsApp, the bot asks the questions, and the request reaches
**9446600809** as a review note. Nothing is booked until 9446600809 says so.
The coordinator gives **no rates**.

## Who uses what

| Who | Number they write to | What they do |
|---|---|---|
| Care coordinators: **7736108778** and **Afiq, 6238378859** | **+91 77361 29809** (support bot) | Types **request**, answers the questions, sends the note |
| Reviewers: **9446600809, 8714105666, 7736108778** | get the note from 77361 29809 | **Book it** (sets rates there) · **Ask coordinator** · **Reject** |

Decided (founder, 6 Oct 2026). The note goes to all three reviewers;
whoever taps first decides, and the others see "Booked by … at 4:12 pm".
7736108778 is both a coordinator and a reviewer: its own requests still go
to all three. Everyone else writing to 77361 29809 sees today's chat. The
admin booking bot (**booking**) stays as it is for the three admins.

**The coordinator only gives the note** (founder, 6 Oct 2026): nothing is
created in Pulso Hub from the coordinator's side, not even a new agency or
patient. The reviewer does all of it when booking.

## What the coordinator does

Types **request**. The bot asks, one question at a time, the same way the
admin booking bot does:

1. **Agency:** a list of manpower agencies (type to search), or **Not in the
   list**: the coordinator types the agency's name, the owner's WhatsApp
   number and the district, as text in the note.
2. **Patient:** the agency's patients ("Patient 1", "Patient 2"…) or **New
   patient**: age in years, Female / Male, written in the note.
3. **Patient details:** weight; Yes / No for bedridden, feeding tube
   (Ryles), urine tube (catheter), stoma, tracheostomy.
4. **Service:** 8 hours / 24 hours. **Caregiver gender:** Any / Female / Male.
5. **Start date** and **number of days** (at least 5).
6. **Location:** the WhatsApp location pin only. Outside the service area:
   "We do not serve this location yet. Send another pin."
7. **Who should do this work?** Basic · GDA and above · Nurse (stoma or
   tracheostomy sets Nurse). No rates are shown or asked.
8. **Summary** with **Send for review** · **Change something** · **Cancel**.

On **Send for review**: "Sent to 9446600809 for review. You'll get the answer
here." The request gets a short number, e.g. **R-1042**.

**back** and **cancel** work at any point; an unfinished request is kept for
24 hours. Under-45 patients: the bot asks the coordinator why, as in the app.

## The review note to 9446600809

One message, like the certificate review alert:

> **Booking request R-1042** from Sanju (care coordinator)
> Agency: CarePlus Manpower
> Patient: Patient 3 · F · 78 · 58 kg · bedridden · catheter
> Service: 24 hours · female caregiver
> Dates: 6 Oct to 15 Oct · 10 days
> Location: Kakkanad, Kochi (map link)
> Who: GDA and above
> **[ Book it ] [ Ask coordinator ] [ Reject ]**

If 9446600809 has not written to the bot in 24 hours, WhatsApp delivers this
only as an approved template, so the note goes as a template (submitted to
Meta once; until it is approved, the note arrives whenever the chat is open).

### Book it

The bot shows the suggested rates for the tier and shift, from the live
settings:

> Caregiver gets ₹900/day · agency is charged ₹1,000/day · Pulso keeps ₹100
> **[ Keep ] [ Change pay ] [ Change agency ]**

Then **Push online / Assign manually**, then **Create booking**. The booking
is created exactly as the admin bot creates it: as the 77777 22222 admin,
with the reviewer's and the coordinator's numbers saved on it.

If the note names an agency that is not in Pulso yet, **Book it** first asks
the reviewer: "Add <name> (owner <number>, <district>) as a new manpower
agency? [ Add and continue ] [ Cancel ]". A new patient is added the same
way, as "Patient N" with the age and gender from the note.

The coordinator gets: "✅ R-1042 booked for CarePlus Manpower, starts 6 Oct."

### Ask coordinator

9446600809 types the question; the bot sends it to the coordinator: "About
R-1042: <question>". The coordinator's reply comes back to 9446600809 under
the note, and the request stays waiting. If the coordinator needs to change
a detail, they tap **Change something** on the request and it is sent for
review again (the old note is marked "replaced").

### Reject

9446600809 types a short reason; the coordinator gets: "R-1042 not booked:
<reason>."

## What stays the same

- The admin booking bot (**booking**) is unchanged for the three admins.
- Rates, rules and the booking itself are those of the admin bot and the
  app: pay at least ₹500, agency charge not under the pay, weekly billing.
- A request is never booked twice: once booked or rejected, the buttons on
  the note answer "Already booked at 4:12 pm" / "Already rejected".

## Decided (founder, 6 Oct 2026)

1. Coordinators: 7736108778 and Afiq (6238378859).
2. Reviewers: 9446600809, 8714105666 and 7736108778.
3. The coordinator only gives the note; the reviewer creates everything.

## Order of work

1. Pulso Hub endpoint: a **coordinators** list in `app_config/admin_booking_bot`
   allowed only the look-up actions (agencies, districts, patients, location
   check); no create.
2. Bot: the **request** chat (reusing the admin booking steps without rates
   or after-creation), saved as a request, and the review note.
3. Bot: the three buttons on the note, the rates step and Create (reusing
   the admin bot), the question / reply relay, the reject message.
4. Review template submitted to Meta.
5. Test with a test coordinator number and the TEST Manpower Agency.
6. Live.

## For the developer

- Bot (`pulso-whatsapp-bot`): `src/services/coordinatorRequestFlow.js`,
  built on `adminBookingFlow.js` (share the step table; drop `tier rates`,
  `afterCreation`; the summary's primary button becomes Send for review).
  Route on the support number after the admin check: sender in
  `COORDINATOR_PHONES` (default `7736108778,6238378859`) and (start word
  **request** or open request draft). 7736108778 is also an admin: "booking"
  goes to the admin bot, "request" to this one; an open draft of either kind
  takes the next message. Reviewers: `COORDINATOR_REVIEWER_PHONES` (default
  `9446600809,8714105666,7736108778`); first tap wins (transaction on the
  request's status).
- Requests: Firestore `coordinatorBookingRequests/{R-number}`:
  `{ status: draft|pending|booked|rejected|replaced, coordinatorPhone,
  answers, pendingAgency?, pendingPatient?, reviewerPhone, requestId?,
  rejectReason?, thread: [{from, text, at}] }`. R-number from a counter doc.
- Review note: `sendButtons` to 9446600809 with payloads
  `coordreq_book_<R>`, `coordreq_ask_<R>`, `coordreq_reject_<R>`; outside
  24 h use template `coordinator_booking_review` (UTILITY, quick replies with
  the same payloads), flag `COORDINATOR_REVIEW_TEMPLATE_ENABLED`.
- Book it: load the request into an admin booking draft for 9446600809 at the
  rates step (the admin flow already maps 9446600809 to the 77777 22222
  login); on Create, first `createAgency` / `addPatient` if pending, then
  `create` with `bookedVia: 'coordinator_request'`, `coordinatorPhone`,
  `coordinatorRequestId`.
- Pulso Hub `functions/lib/admin_booking_bot.js`: `coordinators` array
  `{ phone, name }`; for such a caller allow only look-ups: `whoami`,
  `listAgencies`, `listDistricts`, `listPatients` (given a `bureauId`, read
  the agency's client record without creating it), `checkLocation`; refuse
  everything else with `not-allowed`. Afiq's 6238378859 needs an entry; it is
  not an admin login and does not need to be. Add `bookedVia` / `coordinatorPhone` /
  `coordinatorRequestId` to the fields `create` stamps.
- Tests: coordinator happy path to Send for review (no rate questions sent);
  note content and buttons; Book it creates once (second tap answers
  "Already booked"); pending new agency/patient created first; ask/reply
  relay; reject; a coordinator calling `create` on the endpoint is refused.
