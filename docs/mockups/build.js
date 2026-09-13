const fs = require('fs');
const path = require('path');
const OUT = __dirname;

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{width:480px;background:#f4f5f7;font-family:-apple-system,"Helvetica Neue",Segoe UI,sans-serif;
 padding:18px 25px 22px}
.title{font-size:14px;font-weight:700;color:#111b21;margin-bottom:3px}
.sub{font-size:11.5px;color:#667781;margin-bottom:12px;line-height:1.45}
.phone{width:430px;border-radius:16px;overflow:hidden;box-shadow:0 4px 18px rgba(11,20,26,.16);border:1px solid #dfe3e6}
.hdr{background:#008069;color:#fff;padding:9px 12px;display:flex;align-items:center;gap:9px}
.av{width:32px;height:32px;border-radius:50%;background:#4aa78f;display:flex;align-items:center;
 justify-content:center;font-size:13px;font-weight:700}
.hname{font-size:13.5px;font-weight:600;line-height:1.25}
.hnum{font-size:10.5px;opacity:.82}
.chat{background:#efeae2;background-image:radial-gradient(rgba(0,0,0,.028) 1px,transparent 1px);
 background-size:16px 16px;padding:12px 9px 14px;display:flex;flex-direction:column;gap:7px}
.day{align-self:center;background:#fff;color:#54656f;font-size:10.5px;padding:3px 9px;border-radius:6px;
 box-shadow:0 1px .5px rgba(11,20,26,.13);margin-bottom:2px}
.row{display:flex;max-width:86%}
.row.in{align-self:flex-start}
.row.out{align-self:flex-end}
.grp{display:flex;flex-direction:column;max-width:86%;align-self:flex-start}
.grp.out{align-self:flex-end}
.bub{background:#fff;border-radius:8px;padding:6px 8px 4px;box-shadow:0 1px .5px rgba(11,20,26,.13);
 font-size:13.2px;line-height:1.42;color:#111b21;white-space:pre-wrap;word-break:break-word}
.out .bub{background:#d9fdd3}
.bub .ml{font-family:"Malayalam Sangam MN","Malayalam MN",sans-serif;font-size:13px;line-height:1.55}
.bub a{color:#027eb5;text-decoration:none}
.time{font-size:10px;color:#667781;text-align:right;margin-top:2px}
.out .time:after{content:" ✓✓";color:#53bdeb;letter-spacing:-1px}
.btns{background:#fff;border-radius:0 0 8px 8px;margin-top:1px;box-shadow:0 1px .5px rgba(11,20,26,.13);overflow:hidden}
.btn{padding:8px;text-align:center;color:#027eb5;font-size:13px;font-weight:500;border-top:1px solid #e9edef}
.btn:first-child{border-top:none}
.list{background:#fff;border-radius:0 0 8px 8px;margin-top:1px;box-shadow:0 1px .5px rgba(11,20,26,.13)}
.listbtn{padding:8px;text-align:center;color:#027eb5;font-size:13px;font-weight:500}
.sheet{background:#fff;border-radius:10px;margin-top:6px;box-shadow:0 1px .5px rgba(11,20,26,.13);overflow:hidden;
 border:1px solid #e9edef}
.sheet .sh{padding:7px 12px;font-size:11px;font-weight:700;color:#008069;background:#f7f8fa;
 border-bottom:1px solid #e9edef;letter-spacing:.03em;text-transform:uppercase}
.opt{padding:8px 12px;font-size:12.8px;color:#111b21;border-top:1px solid #f0f2f4;display:flex;
 justify-content:space-between;align-items:center}
.opt:first-of-type{border-top:none}
.opt i{font-style:normal;color:#c4ccd1;font-size:13px}
.opt.ml{font-family:"Malayalam Sangam MN",sans-serif}
.note{font-size:10.5px;color:#8696a0;margin:5px 2px 0;font-style:italic}
.cap{margin-top:11px;font-size:11px;color:#54656f;line-height:1.5;border-left:2px solid #008069;padding-left:8px}
.tag{display:inline-block;background:#e7f4ef;color:#026b52;font-size:10px;font-weight:700;
 padding:2px 6px;border-radius:4px;margin-right:5px;vertical-align:1px}
`;

function bub(side, html, time, extra = '') {
  return `<div class="grp ${side}"><div class="bub">${html}<div class="time">${time}</div></div>${extra}</div>`;
}
const btns = (arr) => `<div class="btns">${arr.map((b) => `<div class="btn">${b}</div>`).join('')}</div>`;
const listbtn = (label) => `<div class="list"><div class="listbtn">☰&nbsp; ${label}</div></div>`;
const sheet = (head, rows, ml) =>
  `<div class="sheet"><div class="sh">${head}</div>${rows
    .map((r) => `<div class="opt${ml ? ' ml' : ''}">${r}<i>›</i></div>`)
    .join('')}</div>`;

function page(scene) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<div class="title">${scene.title}</div>
<div class="sub">${scene.sub}</div>
<div class="phone">
 <div class="hdr"><div class="av">P</div><div><div class="hname">${scene.hname}</div>
 <div class="hnum">+91 77361 29809</div></div></div>
 <div class="chat"><div class="day">TODAY</div>${scene.body}</div>
</div>
${scene.cap ? `<div class="cap">${scene.cap}</div>` : ''}
</body></html>`;
}

const T = '10:42';
const T2 = '10:43';

const WELCOME = bub(
  'in',
  `Welcome to Pulso Support.\nPlease tell us who you are:\n\n<span class="ml">Pulso Support-ലേക്ക് സ്വാഗതം.\nതാങ്കൾ ആരാണെന്ന് തിരഞ്ഞെടുക്കുക:</span>`,
  T,
  btns(['Caregiver / Nurse', 'Home care agency'])
);

const scenes = [
  {
    file: '01-entry-caregiver',
    title: '1 · Entry — the new "who are you" question',
    sub: 'Asked before anything else. Bilingual, because region (which sets language) has not been asked yet.',
    hname: 'Pulso Support',
    body: [
      WELCOME,
      bub('out', 'Caregiver / Nurse', T),
      bub('in', 'Hi, welcome to Pulso Provider Support.\n\nPlease select your region:', T,
        btns(['Kerala', 'Karnataka', 'Other'])),
      bub('out', 'Kerala', T2),
      bub('in', `<span class="ml">താങ്കൾക്ക് വേണ്ട സഹായം തിരഞ്ഞെടുക്കുക:</span>`, T2, listbtn('Option')) +
        sheet('Provider Support', ['Check Duty availability', 'Payment help', 'App/Login/OTP',
          'Duty/Family issue', 'Talk to support', 'Join Pulso']) +
        '<div class="note">WhatsApp list, shown expanded</div>'
    ].join(''),
    cap: '<span class="tag">UNCHANGED</span>A caregiver reaches today\'s menu with one extra tap. Kerala still switches the conversation to Malayalam.',
    h: 1180
  },
  {
    file: '02-partner-verified',
    title: '2 · Home care agency — number found in <code>bureaus</code>',
    sub: 'The partner lookup runs the moment they tap "Home care agency", before the region question.',
    hname: 'Pulso Support',
    body: [
      WELCOME,
      bub('out', 'Home care agency', T),
      bub('in', 'Hi Sneha Home Care\nWelcome to Pulso Partner Support.\n\nPlease select your region:', T,
        btns(['Kerala', 'Karnataka', 'Other'])),
      bub('out', 'Karnataka', T2),
      bub('in', 'Please choose an option:', T2, listbtn('Choose option')) +
        sheet('Partner Support', ['Payout &amp; settlement', 'Client &amp; booking status',
          'Console / app login', 'Caregiver / duty issue', 'Talk to partner manager', 'I am a caregiver']) +
        '<div class="note">WhatsApp list, shown expanded</div>'
    ].join(''),
    cap: '<span class="tag">NEW</span>A verified partner never sees a provider-flavoured word. Greeting uses <code>brandName</code> from their bureau record.',
    h: 1200
  },
  {
    file: '03-partner-payout',
    title: '3 · Payout &amp; settlement — answered from their own record',
    sub: 'billingDay, partnerPct and gstRegistered were already fetched during the gate, so the answer costs no extra read.',
    hname: 'Pulso Support',
    body: [
      bub('out', 'Payout &amp; settlement', T),
      bub('in', 'Sneha Home Care — settlement summary\n\nSettlement day: 5th of each month\nYour share: 50%\nGST: registered, so your invoice includes GST\n\nFor a specific invoice or a payment that has not arrived, tap below.', T,
        btns(['Talk to manager', 'Partner menu'])),
      bub('out', 'Talk to manager', T2),
      bub('in', 'Our partner team has been informed.\nThe team will review and contact you if needed.\n\nSupport time:\n10:00 AM to 5:00 PM\n\nFor urgent help, call:\n8714105333', T2)
    ].join(''),
    cap: '<span class="tag">NEW</span>The canned half answers the common question outright; the ticket half reaches a human. Per-reason cooldown means this 12h lock does not block a later caregiver emergency.',
    h: 880
  },
  {
    file: '04-not-registered',
    title: '4 · Agency we have no record of — pitched, not dead-ended',
    sub: 'No match in bureauInvites, users or bureaus — or the lookup failed. Same reply either way.',
    hname: 'Pulso Support',
    body: [
      WELCOME,
      bub('out', 'Home care agency', T),
      bub('in', 'This help line is for home care agencies already partnered with Pulso.\n\nWant to partner with Pulso? Start here:\n<a>https://admin.pulso.co.in/join</a>\n\nAlready a partner? Tap Talk to support and we will check.', T,
        btns(['I am a caregiver', 'Talk to support'])),
      bub('out', 'I am a caregiver', T2),
      bub('in', 'Hi, welcome to Pulso Provider Support.\n\nPlease select your region:', T2,
        btns(['Kerala', 'Karnataka', 'Other']))
    ].join(''),
    cap: '<span class="tag">NEW</span>The join link opens the existing partner deck on +91 77361 01039 with the PARTNER ENQUIRY text pre-filled — no pitch logic duplicated here. Both escape hatches are one tap.',
    h: 1070
  },
  {
    file: '05-partner-malayalam',
    title: '5 · Kerala partner — same branch in Malayalam',
    sub: 'Region drives language for partners exactly as it does for providers.',
    hname: 'Pulso Support',
    body: [
      bub('out', 'Kerala', T),
      bub('in', `<span class="ml">താങ്കൾക്ക് വേണ്ട സഹായം തിരഞ്ഞെടുക്കുക:</span>`, T, listbtn('Option')) +
        sheet('Partner Support', ['Payout &amp; settlement', 'Client &amp; booking status',
          'Console / app login', 'Caregiver / duty issue', 'Talk to partner manager', 'I am a caregiver']),
      bub('out', 'Caregiver / duty issue', T2),
      bub('in', `<span class="ml">ഞങ്ങളുടെ partner team-നെ അറിയിച്ചിട്ടുണ്ട്.\nTeam പരിശോധിച്ച് ആവശ്യമെങ്കിൽ നിങ്ങളെ ബന്ധപ്പെടും.\n\nSupport time:\nരാവിലെ 10:00 മുതൽ വൈകുന്നേരം 5:00 വരെ\n\nUrgent help-നായി വിളിക്കുക:\n8714105333</span>`, T2)
    ].join(''),
    cap: '<span class="tag">NEW</span>Row titles stay in English (WhatsApp caps list rows at 24 characters, and Malayalam runs long); the conversation around them is Malayalam.',
    h: 900
  },
  {
    file: '06-ops-alert',
    title: '6 · What the partner manager receives',
    sub: 'A separate alert from the provider one — different wording, different recipient, agency context attached.',
    hname: 'Pulso Alerts',
    body: [
      bub('in', 'Pulso alert: care partner requested help\n\nHelp type: Partner Duty Issue\nAgency: Sneha Home Care\nBureau ID: bR7k2xQ\nPartner status: Active\nRole: Owner\nDistrict: Bengaluru\nPartner phone: 919847012345\nRequested at: 2026-09-13T10:43:07Z\n\nReply now: <a>https://wa.me/919847012345</a>', T2)
    ].join(''),
    cap: '<span class="tag">NEW</span>Goes to PARTNER_HELP_WHATSAPP_NUMBER, falling back to the existing ops chain so it is never silently undeliverable.',
    h: 620
  }
];

scenes.forEach((s) => {
  fs.writeFileSync(path.join(OUT, `${s.file}.html`), page(s));
});
console.log(scenes.map((s) => `${s.file} ${s.h}`).join('\n'));
