const STEPS = {
  1: 'incoming_lead',
  2: 'awaiting_qualification',
  3: 'working_model_sent',
  4: 'awaiting_interest_confirmation',
  5: 'awaiting_duty_hour_preference',
  6: 'awaiting_sample_duty_offer_preference',
  7: 'awaiting_expected_duties_confirmation',
  8: 'awaiting_certificate',
  9: 'awaiting_name',
  10: 'awaiting_age',
  11: 'awaiting_sex',
  12: 'awaiting_district',
  13: 'certificate_verification_pending',
  14: 'awaiting_terms_acceptance',
  15: 'completed'
};

const STATUS = {
  NEW: 'new_lead',
  AWAITING_QUALIFICATION: 'awaiting_qualification',
  AWAITING_INTEREST: 'awaiting_interest_confirmation',
  AWAITING_DUTY_HOUR_PREFERENCE: 'awaiting_duty_hour_preference',
  AWAITING_SAMPLE_DUTY_OFFER_PREFERENCE: 'awaiting_sample_duty_offer_preference',
  AWAITING_EXPECTED_DUTIES_CONFIRMATION: 'awaiting_expected_duties_confirmation',
  AWAITING_CERTIFICATE: 'awaiting_certificate',
  AWAITING_NAME: 'awaiting_name',
  AWAITING_AGE: 'awaiting_age',
  AGE_REJECTED: 'age_rejected',
  CERTIFICATE_REJECTED_PERMANENT: 'certificate_rejected_permanent',
  NOT_INTERESTED_RESTARTABLE: 'not_interested_restartable',
  AWAITING_PULSO_AGENT: 'awaiting_pulso_agent',
  AWAITING_SEX: 'awaiting_sex',
  AWAITING_DISTRICT: 'awaiting_district',
  VERIFICATION_PENDING: 'certificate_verification_pending',
  ADDITIONAL_DOCUMENT_REQUESTED: 'additional_document_requested',
  AWAITING_TERMS_ACCEPTANCE: 'awaiting_terms_acceptance',
  COMPLETED: 'completed',
  NEEDS_HUMAN_REVIEW: 'needs_human_review'
};

const BUTTON_IDS = {
  QUALIFICATION_GDA: 'qualification_gda',
  QUALIFICATION_GNM: 'qualification_gnm',
  QUALIFICATION_ANM: 'qualification_anm',
  QUALIFICATION_HCA: 'qualification_hca',
  QUALIFICATION_BSC_NURSING: 'qualification_bsc_nursing',
  QUALIFICATION_OTHER_CAREGIVING: 'qualification_other_caregiving',
  QUALIFICATION_NONE_OF_THESE: 'qualification_none_of_these',
  QUALIFICATION_GO_BACK: 'qualification_go_back',
  INTEREST_YES: 'interest_yes',
  INTEREST_NO: 'interest_no',
  DUTY_HOUR_8: 'duty_hour_8',
  DUTY_HOUR_24: 'duty_hour_24',
  DUTY_HOUR_BOTH: 'duty_hour_both',
  SAMPLE_DUTY_YES: 'sample_duty_yes',
  SAMPLE_DUTY_NO: 'sample_duty_no',
  EXPECTED_DUTIES_YES: 'expected_duties_yes',
  EXPECTED_DUTIES_NO: 'expected_duties_no',
  AGE_RETRY_ENTRY: 'age_retry_entry',
  AGE_CONFIRM_EXIT: 'age_confirm_exit',
  AGE_EDIT_AFTER_REJECTION: 'age_edit_after_rejection',
  AGE_CLOSE_AFTER_REJECTION: 'age_close_after_rejection',
  CERTIFICATE_ADD_MORE: 'certificate_add_more',
  CERTIFICATE_CONTINUE: 'certificate_continue',
  DISTRICT_PAGE_NEXT: 'district_page_next',
  DISTRICT_PAGE_PREVIOUS: 'district_page_previous',
  CONNECT_PULSO_AGENT: 'connect_pulso_agent',
  SEX_MALE: 'sex_male',
  SEX_FEMALE: 'sex_female',
  TERMS_ACCEPT: 'terms_accept',
  TERMS_DECLINE: 'terms_decline'
};

const QUALIFICATIONS = [
  { id: BUTTON_IDS.QUALIFICATION_GDA, title: 'GDA' },
  { id: BUTTON_IDS.QUALIFICATION_GNM, title: 'GNM' },
  { id: BUTTON_IDS.QUALIFICATION_ANM, title: 'ANM' },
  { id: BUTTON_IDS.QUALIFICATION_HCA, title: 'HCA' },
  { id: BUTTON_IDS.QUALIFICATION_BSC_NURSING, title: 'BSc Nursing' },
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
    'ക്ഷമിക്കണം, നിലവിൽ GDA / GNM / ANM / HCA / BSc Nursing qualification ഉള്ള providers-നെ മാത്രമാണ് onboarding ചെയ്യുന്നത്.',
  qualificationRetry:
    'ദയവായി താഴെയുള്ള options-ിൽ നിന്നും qualification തിരഞ്ഞെടുക്കുക: GDA / GNM / ANM / HCA / BSc Nursing / Other with experience in caregiving.',
  qualificationCertificateRequired:
    `Pulso-യിൽ Caregiver / Nursing Staff ആയി onboarding ചെയ്യുന്നതിനായി Certificate നിർബന്ധമാണ്.\nതാഴെ പറയുന്ന ഏതെങ്കിലും ഒരു യോഗ്യത നിർബന്ധമായും വേണം:\n✅ GDA (General Duty Assistant)\n✅ GNM (General Nursing & Midwifery)\n✅ ANM (Auxiliary Nurse Midwife)\n✅ HCA (Health Care Assistant)\n✅ BSc Nursing\n✅ Experience Certificate (caregiving fieldൽ ഉണ്ടായത്)\n💡 പ്രധാനമായി ശ്രദ്ധിക്കുക:\nഞങ്ങളുടെ daily payment automatic system പ്രവർത്തിക്കാൻ certificate upload ചെയ്യുന്നത് നിർബന്ധമാണ്.\nCertificate ഇല്ലാത്തവർക്ക് onboarding പൂർത്തിയാക്കാൻ സാധിക്കില്ല.`,
  qualificationGoBack:
    'മുകളിലെ യോഗ്യതകളിൽ ഏതെങ്കിലും ഉണ്ടെങ്കിൽ തിരികെ പോയി തിരഞ്ഞെടുക്കുക.',
  workingModel:
    `**Pulso Global Private Limited** ഒരു homecare കമ്പനിയാണ്. പ്രായമായർക്കും കിടപ്പ് രോഗികൾക്കും അവരുടെ വീടുകളിൽ പരിചരണം നൽകുന്നതാണ് ഞങ്ങളുടെ സർവീസ്.\n\nGDA (General Duty Assistant) staff-നും nurse-നും ഞങ്ങളോടൊപ്പം join ചെയ്യാൻ കഴിയും. നിങ്ങൾ interested ആണെങ്കിൽ ഞങ്ങൾ നിങ്ങൾക്ക് WhatsApp വഴി duty offers അയച്ചു തരും.\n\n**Duty details:**\n\n1. Duty area മിക്കപ്പോഴും Ernakulam ആയിരിക്കും\n2. Duty timing 8 hours, 24 hours എന്നീ രീതികളിലായിരിക്കും\n3. 8 hours duty സമയം രാവിലെ 8 മണി മുതൽ വൈകുന്നേരം 6 മണിവരെ ആയിരിക്കും\n4. Duty duration 1 week, 2 week, 1 month എന്നിങ്ങനെ വ്യത്യാസപ്പെടാം\n5. 24 hours duty-ക്ക് patient-ന്റെ വീട്ടിൽ stay-യും food-ും ലഭിക്കും\n6. 8 hour duty-ക്ക് stay ഉണ്ടായിരിക്കില്ല\n7. 8 hour duty-ക്ക് per day ₹900 ലഭിക്കും\n8. 24 hour duty-ക്ക് per day ₹1200 ലഭിക്കും\n9. Payment daily നിങ്ങളുടെ account-ിൽ credit ആവുന്നതാണ്\n10. നിങ്ങൾ work ചെയ്യുന്ന ദിവസങ്ങളിൽ മാത്രമായിരിക്കും payment ലഭിക്കുക\n11. House maid ജോലി ഉണ്ടായിരിക്കില്ല. Patient care duties മാത്രം ആയിരിക്കും\n\n**Working model:**\n\n1. WhatsApp വഴി duty offers ലഭിക്കും\n2. നിങ്ങൾക്ക് താല്പര്യമുള്ള duty-കൾ മാത്രം accept ചെയ്യാം\n3. താല്പര്യമില്ലെങ്കിൽ reject ചെയ്യാം അല്ലെങ്കിൽ ignore ചെയ്യാം\n4. Duty accept ചെയ്തതിന് ശേഷം office verification call ഉണ്ടാകും\n5. എല്ലാ instructions-ും duty details-ും office staff clear ആയി അറിയിക്കും\n6. പിന്നീട് നിങ്ങൾ നേരിട്ട് duty location-ലേക്ക് പോകണം\n7. സമയത്തിന് duty ആരംഭിച്ച് ഉത്തരവാദിത്വത്തോടെ care നൽകണം\n\n**Emergency leave:**\n\nEmergency leave ആവശ്യമായി വന്നാൽ വേറെ staff-നെ ഞങ്ങൾ arrange ചെയ്ത് തരുന്നതായിരിക്കും.\n\n**ശ്രദ്ധിക്കുക:**\n\n- Duty offer accept ചെയ്യണോ വേണ്ടയോ എന്നത് മുഴുവൻ നിങ്ങളുടെ ഇഷ്ടമാണ്\n- ഇഷ്ടമുള്ള duty-കൾ മാത്രം സ്വീകരിച്ചാൽ മതി\n- ഇതിനായി പ്രത്യേക registration fee ഒന്നും നൽകേണ്ടതില്ല\n\n**Office Address:**\nPulso Elderlycare, Kalamassery, Kochi - 682021`,
  interestQuestion:
    'മുകളിലെ working model മനസ്സിലായോ? തുടരാൻ താൽപര്യമുണ്ടോ?',
  interestRetry:
    'തുടരാൻ താൽപര്യമുണ്ടെങ്കിൽ താഴെയുള്ള button തിരഞ്ഞെടുക്കുക.',
  dutyHourPreferenceQuestion:
    'താങ്കൾക്ക് ഏത് duty hour ആണ് preference?',
  dutyHourPreferenceRetry:
    'ദയവായി താഴെയുള്ള options-ിൽ നിന്നും ഒരു duty hour preference തിരഞ്ഞെടുക്കുക: 8 hour / 24 hour / രണ്ടും.',
  dutyHourPreference8HourNotice:
    '8 hour duty തിരഞ്ഞെടുക്കുന്നവർ ശ്രദ്ധിക്കുക: stay ഉം food ഉം ലഭിക്കില്ല. Food ഉം stay ഉം 24 hour duty-ക്ക് മാത്രമാണ് ലഭിക്കുക.',
  sampleDutyOfferQuestion:
    'ഒരു sample duty offer എങ്ങനെയിരിക്കും എന്ന് കാണണോ?',
  sampleDutyOfferRetry:
    'ദയവായി താഴെയുള്ള options-ിൽ നിന്നും ഒരു മറുപടി തിരഞ്ഞെടുക്കുക.',
  sampleDutyOtherOffer8HourQuestion:
    '8 hour duty കാണണോ?',
  sampleDutyOtherOffer24HourQuestion:
    '24 hour duty കാണണോ?',
  sampleDutyFinalChoiceQuestion:
    'ഏത് duty hour ആണ് താങ്കളുടെ final preference?',
  sampleDutyFinalChoiceRetry:
    'ദയവായി 8 hour / 24 hour / രണ്ടും എന്നിവയിൽ ഒന്നിനെ തിരഞ്ഞെടുക്കുക.',
  sampleDutyOffer24Hour:
    `Elderly female Patient (71 yrs)\nCondition: Supportive care\n\n🟡 Care Level: Assisted care (with walker support)\n\n🕘 Duty: 24-hour care\n\n📅 Duration: 1 month (continuous) – from 21 Jan\n\n📍 Location: Vennala (nearby)\n\n🩺 Care Needed (Supportive &\n Assisted):\n\n•⁠  ⁠Washroom support\n•⁠  ⁠Bed making\n•⁠  ⁠Assistance while feeding\n•⁠  ⁠Helping with medicines\n•⁠  ⁠Assistance in lifting & walking using walker\n•⁠  ⁠Assistance during physiotherapy exercises\n(Supportive home care – not hospital duty)\n💰 Earnings:\n\n₹ 1200 per day × 30 days\n👉 ₹ 36000 total\n\n🛡 Safety & Support\n✔ Family verified\n✔ Payment guaranteed\n✔ Support available during duty`,
  sampleDutyOffer8Hour:
    `👤 Patient:\nfemale – 65 yrs\n\n🩺 Condition:\nPost-surgery recovery (Hip surgery)\n\n👨‍⚕ Care Type:\nHome supportive care (not complex)\n\n🕘 Duty:\n8 hours (8:00 AM – 4:00 PM)\n\n⏳ Duration:\nFrom 14 Feb – continuous\n\n📍 Location:\nThevakkal, Ernakulam\n\n🩺 Care Needed:\n•⁠  ⁠Walking / mobility support\n•⁠  ⁠Assistance with daily activities\n•⁠  ⁠Washroom support (if needed)\n•⁠  ⁠Helping with medicines\n•⁠  ⁠General supervision & comfort care\n\n💰 Earnings:\n₹900 per day\n👉 Stable regular day-duty\n\n🛡 Pulso Support:\n✔ Family verified\n✔ Payment guaranteed\n✔ Full support during duty`,
  expectedDutiesIntroOne:
    `Caregiver duty-യിൽ സാധാരണയായി വരാവുന്ന ചില ജോലികൾ താഴെ കൊടുക്കുന്നു.\nPatient-ന്റെ condition അനുസരിച്ച് duty responsibilities മാറാം.\n\n*Personal care*\n- Bathing / sponge bath (non-clinical)\n- Dressing\n- Oral care, grooming, hair combing\n\n*Toileting & continence support*\n- Diaper change\n- Bedpan / urinal support\n- Cleaning and maintaining hygiene`,
  expectedDutiesIntroTwo:
    `*Mobility & safety*\n- Helping to sit, stand, walk\n- Turning & positioning in bed\n- Fall-risk precautions\n\n*Feeding support*\n- Helping with meals\n- Ensuring adequate water intake\n- Following diet plan given by doctor / dietician`,
  expectedDutiesIntroThree:
    `*Companionship*\n- Talking, engaging in simple activities\n- Reminding medicines (if prescribed schedule is given)\n\nഈ തരത്തിലുള്ള duty responsibilities ചെയ്യാൻ താങ്കൾക്ക് തയ്യാറാണെങ്കിൽ മാത്രം onboarding തുടരുക.`,
  expectedDutiesQuestion:
    'മുകളിലെ duty responsibilities ചെയ്യാൻ താങ്കൾക്ക് തയ്യാറാണോ?',
  expectedDutiesRetry:
    'ദയവായി താഴെയുള്ള options-ിൽ നിന്നും ഒരു മറുപടി തിരഞ്ഞെടുക്കുക.',
  expectedDutiesDeclined:
    'ശരി. ഈ തരത്തിലുള്ള duty responsibilities-ിൽ താൽപര്യമില്ലെങ്കിൽ പിന്നീട് വീണ്ടും message ചെയ്യാം.',
  notInterested:
    'ശരി. പിന്നീട് താൽപര്യമുണ്ടെങ്കിൽ വീണ്ടും message ചെയ്യാം.',
  certificateRequest:
    'ദയവായി താങ്കളുടെ certificate upload ചെയ്യുക.',
  certificateRetry:
    'ദയവായി certificate image അല്ലെങ്കിൽ document ആയി upload ചെയ്യുക. പരമാവധി 4 image/PDF വരെ അയക്കാം.',
  certificateUploadProgress:
    'Certificate ലഭിച്ചു. കൂടുതൽ image/PDF ഉണ്ടെങ്കിൽ ഇനി അയക്കാം. തുടരണോ?',
  certificateUploadLimitReached:
    'പരമാവധി 4 certificate files ലഭിച്ചു. ഇനി അടുത്ത step-ലേക്ക് പോകുന്നു.',
  nameQuestion:
    'താങ്കളുടെ പൂർണ്ണ പേര് അയയ്ക്കുക.',
  ageQuestion:
    'താങ്കളുടെ വയസ് എത്രയാണ്?',
  ageRetry:
    'ദയവായി വയസ് അക്കങ്ങളായി അയയ്ക്കുക. ഉദാ: 32',
  ageAboveLimit:
    'ക്ഷമിക്കണം. നിലവിലെ onboarding criteria പ്രകാരം 50 വയസിന് മുകളിലുള്ള applicants-നെ ഇപ്പോൾ proceed ചെയ്യാൻ കഴിയില്ല. വയസ് തെറ്റായി നൽകിയതാണെങ്കിൽ വീണ്ടും നൽകാം.',
  ageAboveLimitOptions:
    'വയസ് തെറ്റായി നൽകിയതാണെങ്കിൽ വീണ്ടും നൽകുക. അല്ലെങ്കിൽ ഇവിടെ തന്നെ നിർത്താം.',
  ageFinalRejection:
    'ശരി. നിലവിലെ criteria പ്രകാരം 50 വയസാണ് age limit. അതിനാൽ ഇപ്പോൾ onboarding തുടരാൻ കഴിയില്ല. താങ്കളുടെ താൽപര്യത്തിനും സമയത്തിനും നന്ദി.',
  ageFinalRejectionOptions:
    'വയസ് തെറ്റായി നൽകിയതാണെങ്കിൽ തിരുത്താം. അല്ലെങ്കിൽ ഇവിടെ തന്നെ തുടരാതെ നിർത്താം.',
  ageRejectionClosed:
    'ശരി. അപേക്ഷ ഇവിടെ അവസാനിപ്പിച്ചിരിക്കുന്നു. പിന്നീട് സഹായം ആവശ്യമെങ്കിൽ വീണ്ടും message ചെയ്യാം.',
  sexQuestion:
    'താങ്കളുടെ sex തിരഞ്ഞെടുക്കുക.',
  sexRetry:
    'ദയവായി Male അല്ലെങ്കിൽ Female തിരഞ്ഞെടുക്കുക.',
  districtQuestion:
    'താഴെയുള്ള ആദ്യ list-ിൽ നിന്ന് താങ്കളുടെ ജില്ല തിരഞ്ഞെടുക്കുക. ജില്ല കാണുന്നില്ലെങ്കിൽ അടുത്ത list തുറക്കുക.',
  districtRetry:
    'ദയവായി താഴെയുള്ള list-ിൽ നിന്ന് താങ്കളുടെ ജില്ല തിരഞ്ഞെടുക്കുക.',
  districtListQuestion:
    'താഴെയുള്ള list-ിൽ നിന്ന് താങ്കളുടെ ജില്ല തിരഞ്ഞെടുക്കുക.',
  verificationPending:
    'നന്ദി. താങ്കളുടെ certificate verification-നായി അയച്ചിരിക്കുന്നു. പരിശോധിച്ച ശേഷം ഉടൻ അറിയിക്കും.',
  additionalDocumentRequest:
    'Onboarding തുടരാൻ ഒരു additional document കൂടി ആവശ്യമാണ്.\n\nNote: {{note}}\n\nദയവായി image അല്ലെങ്കിൽ PDF ആയി ഇപ്പോൾ upload ചെയ്യുക.',
  additionalDocumentRetry:
    'ദയവായി ആവശ്യപ്പെട്ട additional document image അല്ലെങ്കിൽ PDF ആയി upload ചെയ്യുക.',
  additionalDocumentReceived:
    'നന്ദി. ആവശ്യപ്പെട്ട additional document ലഭിച്ചു. വീണ്ടും review-നായി അയച്ചിരിക്കുന്നു.',
  certificateApproved:
    'താങ്കളുടെ certificate verify ചെയ്തിരിക്കുന്നു.\nതാങ്കൾ Pulso-യിൽ ജോയിൻ ചെയ്യാൻ eligible ആണ്.',
  certificateRejected:
    'ക്ഷമിക്കണം, താങ്കൾ അയച്ച certificate verify ചെയ്യാൻ കഴിഞ്ഞില്ല. ദയവായി വ്യക്തമായ certificate വീണ്ടും upload ചെയ്യുക.',
  certificateReuploadRequested:
    'താങ്കൾ അയച്ച certificate വ്യക്തമായി വായിക്കാൻ കഴിഞ്ഞില്ല. ദയവായി കൂടുതൽ clarity ഉള്ള certificate photo അല്ലെങ്കിൽ PDF വീണ്ടും upload ചെയ്യുക.',
  certificateCvUploaded:
    'താങ്കൾ CV ആണ് അയച്ചിരിക്കുന്നത്. Onboarding തുടരാൻ ദയവായി certificate photo അല്ലെങ്കിൽ certificate PDF upload ചെയ്യുക.',
  certificateWrongImageUploaded:
    'താങ്കൾ certificate അല്ലാത്ത image ആണ് അയച്ചിരിക്കുന്നത്. Onboarding തുടരാൻ ദയവായി താങ്കളുടെ certificate upload ചെയ്യുക.',
  certificateRejectedPermanent:
    'ക്ഷമിക്കണം, നിലവിലെ review അടിസ്ഥാനത്തിൽ ഈ onboarding അപേക്ഷ ഇനി തുടരാൻ കഴിയില്ല. പിന്നീട് സഹായം ആവശ്യമെങ്കിൽ ഓഫീസുമായി ബന്ധപ്പെടാം.',
  termsIntro:
    `ഞങ്ങളോടൊപ്പം ചേരുന്നതിന് മുമ്പ് താഴെ നൽകിയിരിക്കുന്ന എല്ലാ നിർദേശങ്ങളും ദയവായി വായിക്കുക.

1. ഡ്യൂട്ടി സ്വീകരിച്ച ശേഷം, ₹1500 വിലയുള്ള യൂണിഫോം കിറ്റ് എടുക്കേണ്ടതാണ്.
ഈ കിറ്റിൽ ഒരു ജോടി യൂണിഫോവും ഒരു ഐഡി കാർഡും ഉൾപ്പെടുന്നതാണ്.

ഞങ്ങളോടൊപ്പം കുറഞ്ഞത് 90 ദിവസം ഡ്യൂട്ടി പൂർത്തിയാക്കിയ ശേഷം, യൂണിഫോം ഓഫിസിൽ തിരികെ നൽകിയാൽ ₹1500 പൂർണ്ണമായി റിഫണ്ട് ലഭിക്കും.

കൂടുതൽ ഒരു ജോടി യൂണിഫോം ആവശ്യമുണ്ടെങ്കിൽ, ₹950 അടച്ച് വാങ്ങാവുന്നതാണ്.
ഈ അധിക യൂണിഫോമിന്റെ തുക റിഫണ്ടബിൾ അല്ല.

👉 **പേയ്മെന്റ് ഓപ്ഷൻ:**
യൂണിഫോം കിറ്റിനുള്ള ₹1500 ഒരുമിച്ച് അടയ്ക്കാൻ കഴിയാത്ത പക്ഷം, ആദ്യ 3 ദിവസത്തെ ഡ്യൂട്ടി പേയ്മെന്റിൽ നിന്ന് ദിവസവും ₹500 വീതം കുറച്ച് ഈ തുക അടയ്ക്കാനുള്ള സൗകര്യവും ലഭ്യമാണ്.

2. ദയവായി ശ്രദ്ധിക്കുക: നിങ്ങൾ ഞങ്ങളുടെ സ്ഥിരം ശമ്പള ജീവനക്കാരൻ അല്ല. നിങ്ങൾ ജോലി ചെയ്യുന്ന ദിവസങ്ങളിലാണ് നിങ്ങൾക്ക് വരുമാനം ലഭിക്കുക. ഞങ്ങൾ നിങ്ങളിലേക്ക് ഡ്യൂട്ടി/ജോലി അവസരങ്ങൾ നൽകുന്നതാണ്. നിങ്ങൾ ആ സർവീസ് ഏറ്റെടുത്തു വിജയകരമായി പൂർത്തിയാക്കിയാൽ അതിന് അനുയോജ്യമായ പേയ്മെന്റ് ലഭിക്കും. ജോലി ചെയ്യാത്ത ദിവസങ്ങളിൽ ശമ്പളമോ മറ്റ് പേയ്മെന്റുകളോ ലഭിക്കില്ല. നിങ്ങൾ ചെയ്ത ജോലികളുടെ പേയ്മെന്റ് ദിവസേന നൽകുന്നതായിരിക്കും. ഈ സംവിധാനത്തെക്കുറിച്ച് വ്യക്തമായി മനസ്സിലാക്കി സഹകരിക്കണമെന്ന് അഭ്യർത്ഥിക്കുന്നു. നിങ്ങളുടെ സഹകരണത്തിനും വിശ്വാസത്തിനും നന്ദി.

3. അടുത്ത ലഭ്യമായ ഡ്യൂട്ടി ഞങ്ങൾ ഷെയർ ചെയ്യുന്നതായിരിക്കും. ഡ്യൂട്ടി ഓഫർ ദയവായി ശ്രദ്ധാപൂർവ്വം വായിക്കുക. നിങ്ങൾക്ക് Accept ചെയ്യുകയോ Decline ചെയ്യുകയോ ചെയ്യാം. എന്നാൽ Accept ചെയ്തതിന് ശേഷം Cancel ചെയ്യുന്നത്, ഞങ്ങൾക്ക് ലാസ്റ്റ് മിനിറ്റിൽ മറ്റൊരാളെ കണ്ടെത്താൻ വളരെ ബുദ്ധിമുട്ടുണ്ടാക്കും. അതിനാൽ ഇങ്ങനെ Cancel ചെയ്യുന്നവർക്ക് ഭാവിയിലെ ഡ്യൂട്ടി ഓഫറുകൾ Accept ചെയ്യുന്നതിൽ നിന്ന് സ്ഥിരമായി Block ചെയ്യുന്നതായിരിക്കും.`,
  termsQuestion:
    'Terms and conditions സ്വീകരിക്കുന്നുണ്ടോ?',
  termsReminder:
    'താങ്കളുടെ onboarding പൂർത്തിയാക്കാൻ terms and conditions ഇതുവരെ സ്വീകരിച്ചിട്ടില്ല.\nതുടരാൻ ദയവായി "continue" എന്ന് reply ചെയ്യുക.',
  termsReminderResume:
    'നന്ദി. വീണ്ടും terms acceptance options അയക്കുന്നു.',
  termsAccepted:
    'നന്ദി. താങ്കളുടെ onboarding പൂർത്തിയായി.',
  termsDeclined:
    'ശരി. താൽപര്യമുണ്ടെങ്കിൽ പിന്നീട് വീണ്ടും message ചെയ്യാം.',
  postOnboardingSupport:
    'ഇന്ന് മുതൽ ലഭ്യമായ ഡ്യൂട്ടി ഓഫറുകൾ നിങ്ങളെ WhatsApp വഴി 9446600809 എന്ന നമ്പറിൽ നിന്ന് അറിയിക്കുന്നതാണ്.\nഡ്യൂട്ടി മെസേജുകൾ എല്ലാം ഓട്ടോമാറ്റിക്കായി അയക്കുന്നതായിരിക്കും.\nതാങ്കൾക്ക് അനുയോജ്യമല്ലാത്ത ഡ്യൂട്ടികൾ ദയവായി അവഗണിക്കാവുന്നതാണ്.\nസ്വീകരിക്കാൻ താൽപര്യമുള്ള ഡ്യൂട്ടികൾക്ക് മാത്രം ദയവായി reply ചെയ്യുക.',
  postOnboardingContactSupport:
    'സഹായത്തിനായി ഓഫീസ് നമ്പർ 8714105333-ൽ രാവിലെ 10 മുതൽ വൈകിട്ട് 6 വരെ വിളിക്കാം.\n9446600809 എന്ന നമ്പറിൽ 24 മണിക്കൂറും WhatsApp സന്ദേശം അയക്കാം.\nനിങ്ങൾക്ക് സഹായം നൽകാൻ ഞങ്ങൾ എപ്പോഴും തയ്യാറാണ്. 👍🏼',
  postOnboardingLinks:
    'Office Details\nPulso Elderly Care\n14/455-N4, 1st Floor,\nAmbeel Galleria, Near BSNL Office,\nKangarappady, Kochi, Kerala – 682021\nPhone: +91 87141 05333\nLocation: https://share.google/MWyrmA6XvDInViFkq\n\nWebsite:\nhttps://www.pulso.co.in/',
  optionalAgentHelp:
    'കൂടുതൽ സംശയങ്ങൾ ഉണ്ടെങ്കിൽ Pulso agent-നോട് ബന്ധപ്പെടാം.',
  optionalAgentHelpConfirmed:
    'ശരി. Pulso agent ഉടൻ തന്നെ WhatsApp വഴി താങ്കളുമായി ബന്ധപ്പെടുന്നതാണ്.',
  agentHelpAlreadyRequested:
    'ഞങ്ങളുടെ support team-നെ ഇതിനകം അറിയിച്ചിട്ടുണ്ട്. സഹായം ലഭിക്കാത്ത പക്ഷം 12 മണിക്കൂറിന് ശേഷം വീണ്ടും "കൂടുതൽ സഹായം" തിരഞ്ഞെടുക്കാവുന്നതാണ്.',
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
