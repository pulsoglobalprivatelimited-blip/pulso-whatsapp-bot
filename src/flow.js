const STEPS = {
  1: 'incoming_lead',
  2: 'awaiting_qualification',
  3: 'working_model_sent',
  4: 'awaiting_interest_confirmation',
  5: 'awaiting_certificate',
  6: 'awaiting_name',
  7: 'awaiting_age',
  8: 'awaiting_sex',
  9: 'awaiting_district',
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
  AWAITING_DISTRICT: 'awaiting_district',
  VERIFICATION_PENDING: 'certificate_verification_pending',
  AWAITING_TERMS_ACCEPTANCE: 'awaiting_terms_acceptance',
  COMPLETED: 'completed',
  NEEDS_HUMAN_REVIEW: 'needs_human_review'
};

const BUTTON_IDS = {
  QUALIFICATION_GDA: 'qualification_gda',
  QUALIFICATION_GNM: 'qualification_gnm',
  QUALIFICATION_ANM: 'qualification_anm',
  QUALIFICATION_OTHER_CAREGIVING: 'qualification_other_caregiving',
  QUALIFICATION_NONE_OF_THESE: 'qualification_none_of_these',
  QUALIFICATION_GO_BACK: 'qualification_go_back',
  INTEREST_YES: 'interest_yes',
  INTEREST_NO: 'interest_no',
  SEX_MALE: 'sex_male',
  SEX_FEMALE: 'sex_female',
  TERMS_ACCEPT: 'terms_accept',
  TERMS_HELP: 'terms_help'
};

const QUALIFICATIONS = [
  { id: BUTTON_IDS.QUALIFICATION_GDA, title: 'GDA' },
  { id: BUTTON_IDS.QUALIFICATION_GNM, title: 'GNM' },
  { id: BUTTON_IDS.QUALIFICATION_ANM, title: 'ANM' },
  {
    id: BUTTON_IDS.QUALIFICATION_OTHER_CAREGIVING,
    title: 'Other',
    description: 'Experience in caregiving'
  },
  {
    id: BUTTON_IDS.QUALIFICATION_NONE_OF_THESE,
    title: 'ഇവയൊന്നുമല്ല'
  }
];

const DISTRICTS = [
  { id: 'district_thiruvananthapuram', title: 'തിരുവനന്തപുരം', value: 'Thiruvananthapuram' },
  { id: 'district_kollam', title: 'കൊല്ലം', value: 'Kollam' },
  { id: 'district_pathanamthitta', title: 'പത്തനംതിട്ട', value: 'Pathanamthitta' },
  { id: 'district_alappuzha', title: 'ആലപ്പുഴ', value: 'Alappuzha' },
  { id: 'district_kottayam', title: 'കോട്ടയം', value: 'Kottayam' },
  { id: 'district_idukki', title: 'ഇടുക്കി', value: 'Idukki' },
  { id: 'district_ernakulam', title: 'എറണാകുളം', value: 'Ernakulam' },
  { id: 'district_thrissur', title: 'തൃശ്ശൂർ', value: 'Thrissur' },
  { id: 'district_palakkad', title: 'പാലക്കാട്', value: 'Palakkad' },
  { id: 'district_malappuram', title: 'മലപ്പുറം', value: 'Malappuram' },
  { id: 'district_kozhikode', title: 'കോഴിക്കോട്', value: 'Kozhikode' },
  { id: 'district_wayanad', title: 'വയനാട്', value: 'Wayanad' },
  { id: 'district_kannur', title: 'കണ്ണൂർ', value: 'Kannur' },
  { id: 'district_kasaragod', title: 'കാസർഗോഡ്', value: 'Kasaragod' }
];

const MESSAGES = {
  welcomeQualification:
    'നമസ്കാരം. Pulso-ലേക്ക് സ്വാഗതം.\nതാങ്കളുടെ qualification തിരഞ്ഞെടുക്കുക.',
  notEligible:
    'ക്ഷമിക്കണം, നിലവിൽ GDA / GNM / ANM qualification ഉള്ള providers-നെ മാത്രമാണ് onboarding ചെയ്യുന്നത്.',
  qualificationRetry:
    'ദയവായി താഴെയുള്ള options-ിൽ നിന്നും qualification തിരഞ്ഞെടുക്കുക: GDA / GNM / ANM / Other with experience in caregiving.',
  qualificationCertificateRequired:
    `Pulso-യിൽ Caregiver / Nursing Staff ആയി onboarding ചെയ്യുന്നതിനായി Certificate നിർബന്ധമാണ്.\nതാഴെ പറയുന്ന ഏതെങ്കിലും ഒരു യോഗ്യത നിർബന്ധമായും വേണം:\n✅ GDA (General Duty Assistant)\n✅ GNM (General Nursing & Midwifery)\n✅ ANM (Auxiliary Nurse Midwife)\n✅ Experience Certificate (caregiving fieldൽ ഉണ്ടായത്)\n💡 പ്രധാനമായി ശ്രദ്ധിക്കുക:\nഞങ്ങളുടെ daily payment automatic system പ്രവർത്തിക്കാൻ certificate upload ചെയ്യുന്നത് നിർബന്ധമാണ്.\nCertificate ഇല്ലാത്തവർക്ക് onboarding പൂർത്തിയാക്കാൻ സാധിക്കില്ല.`,
  qualificationGoBack:
    'മുകളിലെ യോഗ്യതകളിൽ ഏതെങ്കിലും ഉണ്ടെങ്കിൽ തിരികെ പോയി തിരഞ്ഞെടുക്കുക.',
  workingModel:
    `**Pulso Global Private Limited** ഒരു homecare കമ്പനിയാണ്. പ്രായമായർക്കും കിടപ്പ് രോഗികൾക്കും അവരുടെ വീടുകളിൽ പരിചരണം നൽകുന്നതാണ് ഞങ്ങളുടെ സർവീസ്.\n\nGDA (General Duty Assistant) staff-നും nurse-നും ഞങ്ങളോടൊപ്പം join ചെയ്യാൻ കഴിയും. നിങ്ങൾ interested ആണെങ്കിൽ ഞങ്ങൾ നിങ്ങൾക്ക് WhatsApp വഴി duty offers അയച്ചു തരും.\n\n**Duty details:**\n\n1. Duty area മിക്കപ്പോഴും Ernakulam ആയിരിക്കും\n2. Duty timing 8 hours, 24 hours എന്നീ രീതികളിലായിരിക്കും\n3. 8 hours duty സമയം രാവിലെ 8 മണി മുതൽ വൈകുന്നേരം 6 മണിവരെ ആയിരിക്കും\n4. Duty duration 1 week, 2 week, 1 month എന്നിങ്ങനെ വ്യത്യാസപ്പെടാം\n5. 24 hours duty-ക്ക് patient-ന്റെ വീട്ടിൽ stay-യും food-ും ലഭിക്കും\n6. 8 hour duty-ക്ക് stay ഉണ്ടായിരിക്കില്ല\n7. 8 hour duty-ക്ക് per day ₹900 ലഭിക്കും\n8. 24 hour duty-ക്ക് per day ₹1200 ലഭിക്കും\n9. Payment daily നിങ്ങളുടെ account-ിൽ credit ആവുന്നതാണ്\n10. നിങ്ങൾ work ചെയ്യുന്ന ദിവസങ്ങളിൽ മാത്രമായിരിക്കും payment ലഭിക്കുക\n\n**Working model:**\n\n1. WhatsApp വഴി duty offers ലഭിക്കും\n2. നിങ്ങൾക്ക് താല്പര്യമുള്ള duty-കൾ മാത്രം accept ചെയ്യാം\n3. താല്പര്യമില്ലെങ്കിൽ reject ചെയ്യാം അല്ലെങ്കിൽ ignore ചെയ്യാം\n4. Duty accept ചെയ്തതിന് ശേഷം office verification call ഉണ്ടാകും\n5. എല്ലാ instructions-ും duty details-ും office staff clear ആയി അറിയിക്കും\n6. പിന്നീട് നിങ്ങൾ നേരിട്ട് duty location-ലേക്ക് പോകണം\n7. സമയത്തിന് duty ആരംഭിച്ച് ഉത്തരവാദിത്വത്തോടെ care നൽകണം\n\n**Emergency leave:**\n\nEmergency leave ആവശ്യമായി വന്നാൽ വേറെ staff-നെ ഞങ്ങൾ arrange ചെയ്ത് തരുന്നതായിരിക്കും.\n\n**ശ്രദ്ധിക്കുക:**\n\n- Duty offer accept ചെയ്യണോ വേണ്ടയോ എന്നത് മുഴുവൻ നിങ്ങളുടെ ഇഷ്ടമാണ്\n- ഇഷ്ടമുള്ള duty-കൾ മാത്രം സ്വീകരിച്ചാൽ മതി\n- ഇതിനായി പ്രത്യേക registration fee ഒന്നും നൽകേണ്ടതില്ല`,
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
  districtQuestion:
    'താങ്കളുടെ ജില്ലയുടെ പേര് ടൈപ്പ് ചെയ്യുക.',
  districtRetry:
    'ദയവായി താങ്കളുടെ ജില്ലയുടെ ശരിയായ പേര് ടൈപ്പ് ചെയ്യുക. ഉദാ: Ernakulam / എറണാകുളം',
  verificationPending:
    'നന്ദി. താങ്കളുടെ certificate verification-നായി അയച്ചിരിക്കുന്നു. പരിശോധിച്ച ശേഷം ഉടൻ അറിയിക്കും.',
  certificateApproved:
    'താങ്കളുടെ certificate verify ചെയ്തിരിക്കുന്നു.',
  certificateRejected:
    'ക്ഷമിക്കണം, താങ്കൾ അയച്ച certificate verify ചെയ്യാൻ കഴിഞ്ഞില്ല. ദയവായി വ്യക്തമായ certificate വീണ്ടും upload ചെയ്യുക.',
  termsIntro:
    `1. ഡ്യൂട്ടി സ്വീകരിച്ച ശേഷം ₹1500 വിലയുള്ള യൂണിഫോം കിറ്റ് എടുക്കേണ്ടതാണ്. ഈ കിറ്റിൽ ഒരു ജോടി യൂണിഫോവും ഒരു ഐഡി കാർഡും ഉൾപ്പെടും. ഞങ്ങളോടൊപ്പം കുറഞ്ഞത് 90 ദിവസം ഡ്യൂട്ടി പൂർത്തിയാക്കിയ ശേഷം യൂണിഫോം ഓഫിസിൽ തിരികെ നൽകിയാൽ ₹1500 പൂർണ്ണമായി റിഫണ്ട് ലഭിക്കും. കൂടുതൽ ഒരു ജോടി യൂണിഫോം ആവശ്യമുണ്ടെങ്കിൽ ₹950 അടച്ച് വാങ്ങാവുന്നതാണ്. ഈ അധിക യൂണിഫോമിന്റെ തുക റിഫണ്ടബിൾ അല്ല.

2. ദയവായി ശ്രദ്ധിക്കുക: നിങ്ങൾ ഞങ്ങളുടെ സ്ഥിരം ശമ്പള ജീവനക്കാരൻ അല്ല. നിങ്ങൾ ജോലി ചെയ്യുന്ന ദിവസങ്ങളിലാണ് നിങ്ങൾക്ക് വരുമാനം ലഭിക്കുക. ഞങ്ങൾ നിങ്ങളിലേക്ക് ഡ്യൂട്ടി/ജോലി അവസരങ്ങൾ നൽകുന്നതാണ്. നിങ്ങൾ ആ സർവീസ് ഏറ്റെടുത്തു വിജയകരമായി പൂർത്തിയാക്കിയാൽ അതിന് അനുയോജ്യമായ പേയ്മെന്റ് ലഭിക്കും. ജോലി ചെയ്യാത്ത ദിവസങ്ങളിൽ ശമ്പളമോ മറ്റ് പേയ്മെന്റുകളോ ലഭിക്കില്ല. നിങ്ങൾ ചെയ്ത ജോലികളുടെ പേയ്മെന്റ് ദിവസേന നൽകുന്നതായിരിക്കും. ഈ സംവിധാനത്തെക്കുറിച്ച് വ്യക്തമായി മനസ്സിലാക്കി സഹകരിക്കണമെന്ന് അഭ്യർത്ഥിക്കുന്നു. നിങ്ങളുടെ സഹകരണത്തിനും വിശ്വാസത്തിനും നന്ദി.

3. അടുത്ത ലഭ്യമായ ഡ്യൂട്ടി ഞങ്ങൾ ഷെയർ ചെയ്യുന്നതായിരിക്കും. ഡ്യൂട്ടി ഓഫർ ദയവായി ശ്രദ്ധാപൂർവ്വം വായിക്കുക. നിങ്ങൾക്ക് Accept ചെയ്യുകയോ Decline ചെയ്യുകയോ ചെയ്യാം. എന്നാൽ Accept ചെയ്തതിന് ശേഷം Cancel ചെയ്യുന്നത്, ഞങ്ങൾക്ക് ലാസ്റ്റ് മിനിറ്റിൽ മറ്റൊരാളെ കണ്ടെത്താൻ വളരെ ബുദ്ധിമുട്ടുണ്ടാക്കും. അതിനാൽ ഇങ്ങനെ Cancel ചെയ്യുന്നവർക്ക് ഭാവിയിലെ ഡ്യൂട്ടി ഓഫറുകൾ Accept ചെയ്യുന്നതിൽ നിന്ന് സ്ഥിരമായി Block ചെയ്യുന്നതായിരിക്കും.`,
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
  QUALIFICATIONS,
  DISTRICTS,
  MESSAGES
};
