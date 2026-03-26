const STEPS = {
  1: 'incoming_lead',
  2: 'awaiting_qualification',
  3: 'working_model_sent',
  4: 'awaiting_interest_confirmation',
  5: 'awaiting_certificate',
  6: 'awaiting_name',
  7: 'awaiting_age',
  8: 'awaiting_sex',
  9: 'awaiting_address',
  10: 'certificate_verification_pending',
  11: 'awaiting_terms_acceptance',
  12: 'completed'
};

const STATUS = {
  NEW: 'new_lead',
  AWAITING_QUALIFICATION: 'awaiting_qualification',
  AWAITING_INTEREST: 'awaiting_interest_confirmation',
  AWAITING_CERTIFICATE: 'awaiting_certificate',
  AWAITING_NAME: 'awaiting_name',
  AWAITING_AGE: 'awaiting_age',
  AWAITING_SEX: 'awaiting_sex',
  AWAITING_ADDRESS: 'awaiting_address',
  VERIFICATION_PENDING: 'certificate_verification_pending',
  AWAITING_TERMS_ACCEPTANCE: 'awaiting_terms_acceptance',
  COMPLETED: 'completed',
  NEEDS_HUMAN_REVIEW: 'needs_human_review'
};

const BUTTON_IDS = {
  QUALIFICATION_GDA: 'qualification_gda',
  QUALIFICATION_GNM: 'qualification_gnm',
  QUALIFICATION_ANM: 'qualification_anm',
  INTEREST_YES: 'interest_yes',
  INTEREST_NO: 'interest_no',
  SEX_MALE: 'sex_male',
  SEX_FEMALE: 'sex_female',
  TERMS_ACCEPT: 'terms_accept',
  TERMS_HELP: 'terms_help'
};

const MESSAGES = {
  welcomeQualification:
    'നമസ്കാരം. Pulso-ലേക്ക് സ്വാഗതം.\nതാങ്കളുടെ qualification തിരഞ്ഞെടുക്കുക.',
  notEligible:
    'ക്ഷമിക്കണം, നിലവിൽ GDA / GNM / ANM qualification ഉള്ള providers-നെ മാത്രമാണ് onboarding ചെയ്യുന്നത്.',
  qualificationRetry:
    'ദയവായി താഴെയുള്ള options-ിൽ നിന്നും qualification തിരഞ്ഞെടുക്കുക: GDA / GNM / ANM.',
  workingModel:
    `**Pulso** വീടുകളിൽ care ആവശ്യമായ രോഗികൾക്കും മുതിർന്നവർക്കും സഹായം നൽകുന്നതിനായി caregivers / nursing staff-നെ duty-കളിലേക്ക് connect ചെയ്യുന്ന സേവന സംവിധാനമാണ്.\n\n**Working model:**\n\n1. WhatsApp / app വഴി duty opportunities ലഭിക്കും\n2. താല്പര്യമുള്ള duty-കൾക്ക് മാത്രം reply / accept ചെയ്യുക\n3. ഒരു duty message പലർക്കും പോകാം. അതിൽ ആദ്യം confirm ചെയ്യുന്ന care provider-നാണ് സാധാരണയായി duty ലഭിക്കുക\n4. Duty confirm ചെയ്തതിന് ശേഷം office verification call ഉണ്ടാകും. Office staff എല്ലാ instructions-ും details-ും നിങ്ങളെ assist ചെയ്ത് clear ആയി അറിയിക്കും\n5. നേരിട്ട് duty location-ലേക്ക് പോകണം\n6. സമയത്തിന് duty ആരംഭിച്ച് ഉത്തരവാദിത്വത്തോടെ care നൽകണം\n7. Payment ദിവസേന ലഭിക്കും\n\n**Duty timing & payment:**\n8 മണിക്കൂർ duty: രാവിലെ 8 മണി മുതൽ 4 മണി വരെ — ₹900 per day\n24 മണിക്കൂർ duty: ₹1200 per day\n\n**Emergency leave:**\nEmergency leave വന്നാൽ Pulso മറ്റൊരു staff-നെ arrange ചെയ്ത് manage ചെയ്യും.\n\n**ശ്രദ്ധിക്കുക:**\nഇഷ്ടമുള്ള duty-കൾ മാത്രം സ്വീകരിക്കാം. താല്പര്യമില്ലാത്തവ ignore ചെയ്യാം.`,
  interestQuestion:
    'മുകളിലെ working model മനസ്സിലായോ? തുടരാൻ താൽപര്യമുണ്ടോ?',
  interestRetry:
    'തുടരാൻ താൽപര്യമുണ്ടെങ്കിൽ താഴെയുള്ള button തിരഞ്ഞെടുക്കുക.',
  notInterested:
    'ശരി. പിന്നീട് താൽപര്യമുണ്ടെങ്കിൽ വീണ്ടും message ചെയ്യാം.',
  certificateRequest:
    'ദയവായി ആദ്യം താങ്കളുടെ certificate photo അല്ലെങ്കിൽ PDF upload ചെയ്യുക.',
  certificateRetry:
    'ദയവായി certificate image അല്ലെങ്കിൽ document ആയി upload ചെയ്യുക.',
  nameQuestion:
    'താങ്കളുടെ പൂർണ്ണ പേര് അയയ്ക്കുക.',
  ageQuestion:
    'താങ്കളുടെ വയസ് എത്രയാണ്?',
  ageRetry:
    'ദയവായി വയസ് അക്കങ്ങളായി അയയ്ക്കുക. ഉദാ: 32',
  sexQuestion:
    'താങ്കളുടെ sex തിരഞ്ഞെടുക്കുക.',
  sexRetry:
    'ദയവായി Male അല്ലെങ്കിൽ Female തിരഞ്ഞെടുക്കുക.',
  addressQuestion:
    'താങ്കളുടെ പൂർണ്ണ വിലാസം അയയ്ക്കുക.',
  verificationPending:
    'നന്ദി. താങ്കളുടെ certificate verification-നായി അയച്ചിരിക്കുന്നു. പരിശോധിച്ച ശേഷം ഉടൻ അറിയിക്കും.',
  certificateApproved:
    'താങ്കളുടെ certificate verify ചെയ്തിരിക്കുന്നു.',
  certificateRejected:
    'ക്ഷമിക്കണം, താങ്കൾ അയച്ച certificate verify ചെയ്യാൻ കഴിഞ്ഞില്ല. ദയവായി വ്യക്തമായ certificate വീണ്ടും upload ചെയ്യുക.',
  termsIntro:
    `ദയവായി ശ്രദ്ധിക്കുക:
നിങ്ങൾ ഞങ്ങളുടെ സ്ഥിരം ശമ്പള ജീവനക്കാരൻ അല്ല. നിങ്ങൾ ജോലി ചെയ്യുന്ന ദിവസങ്ങളിലാണ് നിങ്ങൾക്ക് വരുമാനം ലഭിക്കുക (You earn while you work).
ഞങ്ങൾ നിങ്ങളിലേക്ക് ഡ്യൂട്ടി/ജോലി അവസരങ്ങൾ നൽകുന്നതാണ്. നിങ്ങൾ ആ സർവീസ് ഏറ്റെടുത്തു വിജയകരമായി പൂർത്തിയാക്കിയാൽ അതിന് അനുയോജ്യമായ പേയ്മെന്റ് ലഭിക്കും.
ജോലി ചെയ്യാത്ത ദിവസങ്ങളിൽ ശമ്പളമോ മറ്റ് പേയ്മെന്റുകളോ ലഭിക്കില്ല.
നിങ്ങൾ ചെയ്ത ജോലികളുടെ പേയ്മെന്റ് ദിവസേന (Daily) നൽകുന്നതായിരിക്കും.
ഈ സംവിധാനത്തെക്കുറിച്ച് വ്യക്തമായി മനസ്സിലാക്കി സഹകരിക്കണമെന്ന് അഭ്യർത്ഥിക്കുന്നു.`,
  termsQuestion:
    'Terms and conditions സ്വീകരിക്കുന്നുണ്ടോ?',
  termsAccepted:
    'നന്ദി. താങ്കളുടെ onboarding പൂർത്തിയായി.',
  termsHelp:
    'ശരി. ഞങ്ങളുടെ team ഉടൻ താങ്കളെ സഹായിക്കും.',
  verificationStillPending:
    'താങ്കളുടെ certificate ഇപ്പോൾ verification-ലാണ്. പരിശോധിച്ച ശേഷം ഉടൻ update അറിയിക്കും.',
  completed:
    'താങ്കളുടെ onboarding ഇതിനകം പൂർത്തിയായിട്ടുണ്ട്. കൂടുതൽ സഹായം ആവശ്യമെങ്കിൽ വീണ്ടും message ചെയ്യുക.'
};

module.exports = {
  STEPS,
  STATUS,
  BUTTON_IDS,
  MESSAGES
};
