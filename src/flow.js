const { AsyncLocalStorage } = require('async_hooks');

const STEPS = {
  1: 'incoming_lead',
  1.5: 'awaiting_region_selection',
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
  AWAITING_REGION_SELECTION: 'awaiting_region_selection',
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
  REGION_KERALA: 'region_kerala',
  REGION_KARNATAKA: 'region_karnataka',
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
  TERMS_DECLINE: 'terms_decline',
  PULSO_APP_INSTALL_YES: 'pulso_app_install_yes',
  PULSO_APP_INSTALL_NO: 'pulso_app_install_no',
  PULSO_APP_INSTALLED: 'pulso_app_installed',
  PULSO_APP_LATER: 'pulso_app_later',
  PULSO_APP_NEED_HELP: 'pulso_app_need_help',
  PULSO_APP_HELP_INSTALL: 'pulso_app_help_install',
  PULSO_APP_HELP_LOGIN_OTP: 'pulso_app_help_login_otp',
  PULSO_APP_HELP_NO_SMARTPHONE: 'pulso_app_help_no_smartphone',
  PULSO_APP_DEVICE_IPHONE: 'pulso_app_device_iphone',
  PULSO_APP_DEVICE_ANDROID: 'pulso_app_device_android'
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

const ENGLISH_QUALIFICATIONS = [
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
    title: 'None of these'
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

const KARNATAKA_DISTRICTS = [
  { id: 'district_bengaluru_urban', title: 'Bengaluru Urban', value: 'Bengaluru Urban' },
  { id: 'district_bengaluru_rural', title: 'Bengaluru Rural', value: 'Bengaluru Rural' },
  { id: 'district_mysuru', title: 'Mysuru', value: 'Mysuru' },
  { id: 'district_dakshina_kannada', title: 'Dakshina Kannada', value: 'Dakshina Kannada' },
  { id: 'district_udupi', title: 'Udupi', value: 'Udupi' },
  { id: 'district_belagavi', title: 'Belagavi', value: 'Belagavi' },
  { id: 'district_dharwad', title: 'Dharwad', value: 'Dharwad' },
  { id: 'district_kalaburagi', title: 'Kalaburagi', value: 'Kalaburagi' },
  { id: 'district_shivamogga', title: 'Shivamogga', value: 'Shivamogga' },
  { id: 'district_tumakuru', title: 'Tumakuru', value: 'Tumakuru' },
  { id: 'district_mandya', title: 'Mandya', value: 'Mandya' },
  { id: 'district_hassan', title: 'Hassan', value: 'Hassan' },
  { id: 'district_davangere', title: 'Davangere', value: 'Davangere' },
  { id: 'district_ballari', title: 'Ballari', value: 'Ballari' },
  { id: 'district_vijayapura', title: 'Vijayapura', value: 'Vijayapura' },
  { id: 'district_bidar', title: 'Bidar', value: 'Bidar' },
  { id: 'district_raichur', title: 'Raichur', value: 'Raichur' },
  { id: 'district_kolar', title: 'Kolar', value: 'Kolar' },
  { id: 'district_ramanagara', title: 'Ramanagara', value: 'Ramanagara' },
  { id: 'district_chikkamagaluru', title: 'Chikkamagaluru', value: 'Chikkamagaluru' },
  { id: 'district_kodagu', title: 'Kodagu', value: 'Kodagu' },
  { id: 'district_chitradurga', title: 'Chitradurga', value: 'Chitradurga' },
  { id: 'district_uttara_kannada', title: 'Uttara Kannada', value: 'Uttara Kannada' },
  { id: 'district_yadgir', title: 'Yadgir', value: 'Yadgir' },
  { id: 'district_koppal', title: 'Koppal', value: 'Koppal' },
  { id: 'district_gadag', title: 'Gadag', value: 'Gadag' },
  { id: 'district_haveri', title: 'Haveri', value: 'Haveri' },
  { id: 'district_bagalkot', title: 'Bagalkot', value: 'Bagalkot' },
  { id: 'district_chamarajanagar', title: 'Chamarajanagar', value: 'Chamarajanagar' },
  { id: 'district_vijayanagara', title: 'Vijayanagara', value: 'Vijayanagara' }
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
    `**Pulso Global Private Limited** ഒരു homecare കമ്പനിയാണ്. പ്രായമായർക്കും കിടപ്പ് രോഗികൾക്കും അവരുടെ വീടുകളിൽ പരിചരണം നൽകുന്നതാണ് ഞങ്ങളുടെ സർവീസ്.\n\nGDA (General Duty Assistant) staff-നും nurse-നും ഞങ്ങളോടൊപ്പം join ചെയ്യാൻ കഴിയും. നിങ്ങൾ interested ആണെങ്കിൽ ഞങ്ങൾ നിങ്ങൾക്ക് WhatsApp വഴി duty offers അയച്ചു തരും.\n\n**Duty details:**\n\n1. Duty area മിക്കപ്പോഴും Ernakulam ആയിരിക്കും\n2. Duty timing 8 hours, 24 hours എന്നീ രീതികളിലായിരിക്കും\n3. 8 hours duty സമയം രാവിലെ 8 മണി മുതൽ വൈകുന്നേരം 4 മണിവരെ ആയിരിക്കും\n4. Duty duration 1 week, 2 week, 1 month എന്നിങ്ങനെ വ്യത്യാസപ്പെടാം\n5. 24 hours duty-ക്ക് patient-ന്റെ വീട്ടിൽ stay-യും food-ും ലഭിക്കും\n6. 8 hour duty-ക്ക് stay ഉണ്ടായിരിക്കില്ല\n7. 8 hour duty-ക്ക് per day ₹900 ലഭിക്കും\n8. 24 hour duty-ക്ക് per day ₹1200 ലഭിക്കും\n9. Payment daily നിങ്ങളുടെ account-ിൽ credit ആവുന്നതാണ്\n10. നിങ്ങൾ work ചെയ്യുന്ന ദിവസങ്ങളിൽ മാത്രമായിരിക്കും payment ലഭിക്കുക\n11. House maid ജോലി ഉണ്ടായിരിക്കില്ല. Patient care duties മാത്രം ആയിരിക്കും\n\n**Working model:**\n\n1. Pulso App വഴി duty offers ലഭിക്കും\n2. നിങ്ങൾക്ക് താല്പര്യമുള്ള duty-കൾ മാത്രം accept ചെയ്യാം\n3. താല്പര്യമില്ലെങ്കിൽ reject ചെയ്യാം അല്ലെങ്കിൽ ignore ചെയ്യാം\n4. Duty accept ചെയ്തതിന് ശേഷം office verification call ഉണ്ടാകും\n5. എല്ലാ instructions-ും duty details-ും office staff clear ആയി അറിയിക്കും\n6. പിന്നീട് നിങ്ങൾ നേരിട്ട് duty location-ലേക്ക് പോകണം\n7. സമയത്തിന് duty ആരംഭിച്ച് ഉത്തരവാദിത്വത്തോടെ care നൽകണം\n\n**Emergency leave:**\n\nEmergency leave ആവശ്യമായി വന്നാൽ വേറെ staff-നെ ഞങ്ങൾ arrange ചെയ്ത് തരുന്നതായിരിക്കും.\n\n**ശ്രദ്ധിക്കുക:**\n\n- Duty offer accept ചെയ്യണോ വേണ്ടയോ എന്നത് മുഴുവൻ നിങ്ങളുടെ ഇഷ്ടമാണ്\n- ഇഷ്ടമുള്ള duty-കൾ മാത്രം സ്വീകരിച്ചാൽ മതി\n- ഇതിനായി പ്രത്യേക registration fee ഒന്നും നൽകേണ്ടതില്ല\n\n**Office Address:**\nPulso Elderlycare, Kalamassery, Kochi - 682021`,
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

1. ഡ്യൂട്ടി സ്വീകരിച്ച ശേഷം, ₹2000 വിലയുള്ള യൂണിഫോം കിറ്റ് എടുക്കേണ്ടതാണ്.
ഈ കിറ്റിൽ ഒരു ജോടി യൂണിഫോവും ഒരു ഐഡി കാർഡും ഉൾപ്പെടുന്നതാണ്.

ഞങ്ങളോടൊപ്പം കുറഞ്ഞത് 90 ദിവസം ഡ്യൂട്ടി പൂർത്തിയാക്കിയ ശേഷം, യൂണിഫോം ഓഫിസിൽ തിരികെ നൽകിയാൽ ₹2000 പൂർണ്ണമായി റിഫണ്ട് ലഭിക്കും.

കൂടുതൽ ഒരു ജോടി യൂണിഫോം ആവശ്യമുണ്ടെങ്കിൽ, ₹950 അടച്ച് വാങ്ങാവുന്നതാണ്.
ഈ അധിക യൂണിഫോമിന്റെ തുക റിഫണ്ടബിൾ അല്ല.

👉 **പേയ്മെന്റ് ഓപ്ഷൻ:**
യൂണിഫോം കിറ്റിനുള്ള ₹2000 ഒരുമിച്ച് അടയ്ക്കാൻ കഴിയാത്ത പക്ഷം, ആദ്യ 4 ദിവസത്തെ ഡ്യൂട്ടി പേയ്മെന്റിൽ നിന്ന് ദിവസവും ₹500 വീതം കുറച്ച് ഈ തുക അടയ്ക്കാനുള്ള സൗകര്യവും ലഭ്യമാണ്.

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
    'ഇനി മുതൽ ലഭ്യമായ duty offers താങ്കൾക്ക് Pulso app വഴി ലഭിക്കുന്നതാണ്.\n\nഓരോ duty offer-ഉം ശ്രദ്ധിച്ച് വായിക്കുക.\n\nതാങ്കൾക്ക് അനുയോജ്യമായ duty ആണെങ്കിൽ Pulso app വഴി accept ചെയ്യാം.\n\nതാങ്കൾക്ക് അനുയോജ്യമല്ലാത്ത duty ആണെങ്കിൽ reject ചെയ്യുകയോ ignore ചെയ്യുകയോ ചെയ്യാം.',
  mobileAppCampaignAnnouncement:
    'പ്രധാന അറിയിപ്പ്:\n\nduty confirmation, check-in, check-out, attendance tracking, duty completion, payment processing എന്നിവയ്ക്കായി Pulso mobile app നിർബന്ധമാണ്.\n\nDuty ലഭിക്കാനും complete ചെയ്യാനും Pulso mobile app install ചെയ്ത് profile active ആയി വയ്ക്കണം.\n\nWhatsApp onboarding-ൽ ഉപയോഗിച്ച അതേ phone number ഉപയോഗിച്ച് app-ൽ login ചെയ്യുക.\n\nApp activation ഇല്ലെങ്കിൽ duty allocation വൈകുകയോ ലഭിക്കാതിരിക്കുകയോ ചെയ്യാം.',
  pulsoAppPreferenceNotice:
    'പ്രധാന അറിയിപ്പ്:\n\nduty confirmation, check-in, check-out, attendance tracking, duty completion, payment processing എന്നിവയ്ക്കായി Pulso mobile app നിർബന്ധമാണ്.\n\nDuty ലഭിക്കാനും complete ചെയ്യാനും Pulso mobile app install ചെയ്ത് profile active ആയി വയ്ക്കണം.\n\nWhatsApp onboarding-ൽ ഉപയോഗിച്ച അതേ phone number ഉപയോഗിച്ച് app-ൽ login ചെയ്യുക.\n\nApp activation ഇല്ലെങ്കിൽ duty allocation വൈകുകയോ ലഭിക്കാതിരിക്കുകയോ ചെയ്യാം.',
  pulsoAppInstallQuestion:
    'താങ്കൾ ഏത് phone ആണ് ഉപയോഗിക്കുന്നത്?',
  pulsoAppInstallRetry:
    'ദയവായി താഴെയുള്ള options-ിൽ നിന്നും തിരഞ്ഞെടുക്കുക.',
  pulsoAppDeviceQuestion:
    'താങ്കൾ ഏത് phone ആണ് ഉപയോഗിക്കുന്നത്?',
  pulsoAppDeviceRetry:
    'ദയവായി Android / iPhone / സഹായം വേണം എന്നിവയിൽ ഒന്നിനെ തിരഞ്ഞെടുക്കുക.',
  pulsoAppAndroidLink:
    'Pulso mobile app Android phone-ൽ install ചെയ്യാൻ താഴെയുള്ള link ഉപയോഗിക്കുക:\n\nhttps://play.google.com/store/apps/details?id=com.pulso.global&pcampaignid=web_share\n\nInstall ചെയ്ത ശേഷം WhatsApp onboarding-ൽ ഉപയോഗിച്ച അതേ phone number ഉപയോഗിച്ച് login ചെയ്യുക.',
  pulsoAppIphoneLink:
    'Pulso mobile app iPhone-ൽ install ചെയ്യാൻ താഴെയുള്ള link ഉപയോഗിക്കുക:\n\nhttps://apps.apple.com/in/app/pulso/id6757874217\n\nInstall ചെയ്ത ശേഷം WhatsApp onboarding-ൽ ഉപയോഗിച്ച അതേ phone number ഉപയോഗിച്ച് login ചെയ്യുക.',
  pulsoAppInstalledQuestion:
    'App install ചെയ്ത് login ചെയ്തോ?',
  pulsoAppInstalledPending:
    'നന്ദി.\n\nതാങ്കളുടെ Pulso app activation ഞങ്ങൾ verify ചെയ്യുന്നതാണ്.\n\nApp profile active ആയതിന് ശേഷം താങ്കൾക്ക് duty opportunities ലഭിക്കാനും complete ചെയ്യാനും eligible ആയിരിക്കും.\n\nദയവായി app install ചെയ്ത നിലയിൽ വയ്ക്കുകയും notifications on ആക്കുകയും ചെയ്യുക.',
  pulsoAppActivationVerified:
    'താങ്കളുടെ Pulso app profile active ആണ്.\n\nഇനി duty opportunities receive ചെയ്യാൻ താങ്കൾ ready ആണ്.\n\nഓരോ duty-ക്കും Pulso app ഉപയോഗിക്കേണ്ടതാണ്:\n\nDuty confirmation\nCheck-in\nCheck-out\nAttendance tracking\nDuty completion\n\nദയവായി app notifications on ആക്കി വയ്ക്കുക.',
  pulsoAppLater:
    'ശരി.\n\nതാങ്കളുടെ onboarding പൂർത്തിയായിട്ടുണ്ട്. പക്ഷേ app activation ഇപ്പോഴും pending ആണ്.\n\nDuty allocation-ന് മുമ്പ് Pulso app activation നിർബന്ധമാണ്.\n\nശരിയായ link ഉപയോഗിച്ച് app പിന്നീട് install ചെയ്യാം.',
  pulsoAppHelpQuestion:
    'ശരി. എന്തിലാണ് സഹായം വേണ്ടത്?',
  pulsoAppInstallHelp:
    'Pulso app install ചെയ്യാൻ ഞങ്ങളുടെ support team സഹായിക്കും.\n\nദയവായി phone ready ആയി വയ്ക്കുക. Internet connection ഉണ്ടെന്ന് ഉറപ്പാക്കുക.\n\nPulso support team ഉടൻ തന്നെ ബന്ധപ്പെടുന്നതാണ്.',
  pulsoAppLoginOtpHelp:
    'Login അല്ലെങ്കിൽ OTP issue പരിഹരിക്കാൻ support team സഹായിക്കും.\n\nWhatsApp onboarding-ൽ ഉപയോഗിച്ച അതേ phone number ആണ് ഉപയോഗിക്കുന്നതെന്ന് ഉറപ്പാക്കുക.\n\nPulso support team ഉടൻ ബന്ധപ്പെടുന്നതാണ്.',
  pulsoAppNoSmartphone:
    'Pulso app duty confirmation, check-in, check-out, attendance tracking, duty completion എന്നിവയ്ക്കായി നിർബന്ധമാണ്.\n\nApp ഇല്ലാതെ duty allocation സാധ്യമാകില്ല.\n\nTemporary support option ഉണ്ടോ എന്ന് പരിശോധിക്കാൻ support team താങ്കളെ ബന്ധപ്പെടുന്നതാണ്.',
  pulsoAppInstallDeclined:
    'ശരി. താങ്കളുടെ onboarding പൂർത്തിയായിട്ടുണ്ട്. പക്ഷേ app activation pending ആണ്.\n\nDuty allocation-ന് Pulso app activation നിർബന്ധമാണ്.',
  mobileAppCampaignThanks:
    'നന്ദി. കൂടുതൽ സഹായം ആവശ്യമുണ്ടെങ്കിൽ Pulso support team-നെ WhatsApp വഴി ബന്ധപ്പെടാം.',
  mobileAppLinkHelp:
    'Pulso app activation pending ആണ്. App install link അല്ലെങ്കിൽ support ആവശ്യമെങ്കിൽ താഴെയുള്ള options ഉപയോഗിക്കുക.',
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

const REGION_OPTIONS = [
  { id: BUTTON_IDS.REGION_KERALA, title: 'Kerala' },
  { id: BUTTON_IDS.REGION_KARNATAKA, title: 'Karnataka' }
];

const KARNATAKA_MESSAGES = {
  ...MESSAGES,
  regionQuestion: 'Welcome to Pulso.\n\nPlease select your region.',
  regionRetry: 'Please select Kerala or Karnataka to continue.',
  welcomeQualification: 'Welcome to Pulso.\nPlease select your qualification.',
  notEligible:
    'Sorry, currently we are onboarding only providers with GDA / GNM / ANM / HCA / BSc Nursing qualification or caregiving experience.',
  qualificationRetry:
    'Please select one option: GDA / GNM / ANM / HCA / BSc Nursing / Other caregiving experience.',
  qualificationCertificateRequired:
    `To join Pulso as a Caregiver / Nursing Staff, a certificate is required.\n\nYou should have at least one of the following:\n- GDA (General Duty Assistant)\n- GNM (General Nursing & Midwifery)\n- ANM (Auxiliary Nurse Midwife)\n- HCA (Health Care Assistant)\n- BSc Nursing\n- Experience Certificate in caregiving\n\nCertificate upload is required to complete onboarding. Providers without a valid certificate cannot complete onboarding.`,
  qualificationGoBack:
    'If you have any of the above qualifications, please go back and select the correct option.',
  workingModel:
    `Pulso Global Private Limited is a home care company. We provide care services for elderly people and bedridden patients at their homes.\n\nGDA staff, caregivers, and nurses can join Pulso. If you are interested, we will send duty offers to you through Pulso mobile app\n\nDuty details:\n\n1. Duty location will mostly be in Bengaluru or other active Karnataka service areas\n2. Duty timing may be 8 hours or 24 hours\n3. 8-hour duty timing will usually be from morning 8 am to evening 4pm\n4. Duty duration may be 1 week, 2 weeks, 1 month, or more depending on the case\n5. For 24-hour duty, stay and food will be provided at the patient's home\n6. For 8-hour duty, stay will not be provided\n7. For 8-hour duty, you will receive Rs 900 per day\n8. For 24-hour duty, you will receive Rs 1200 per day\n9. Payment will be credited daily to your account\n10. You will receive payment only for the days you work\n11. There will be no housemaid work. Only patient care duties\n\nWorking model:\n\n1. Duty offers will be sent through Pulso App\n2. You can accept only the duties you are interested in\n3. If you are not interested in a duty, you can reject or ignore it\n4. After you accept a duty, the office team will call you for verification and confirmation\n5. The office team will clearly explain all duty details and instructions\n6. After confirmation, you should go directly to the duty location\n7. You should start duty on time and provide care responsibly\n\nEmergency leave:\n\nIf you need emergency leave, Pulso will try to arrange another staff member.\n\nImportant:\n\n- Accepting or rejecting a duty offer is completely your choice\n- You only need to accept duties you are interested in\n- There is no registration fee to join Pulso\n\nHead Office Address:\nPulso Elderlycare, cochin, kerala - 682036`,
  interestQuestion: 'Did you understand the working model? Are you interested to continue?',
  interestRetry: 'If you are interested to continue, please select the button below.',
  dutyHourPreferenceQuestion: 'Which duty hour do you prefer?',
  dutyHourPreferenceRetry: 'Please select one duty hour preference: 8 hour / 24 hour / Both.',
  dutyHourPreference8HourNotice:
    'Please note: stay and food are not provided for 8-hour duty. Stay and food are available only for 24-hour duty.',
  dutyHourPaymentSummary: '8 hour - Rs 900 per day\n24 hour - Rs 1200 per day',
  sampleDutyOfferQuestion: 'Would you like to see how a sample duty offer looks?',
  sampleDutyOfferRetry: 'Please select one option from below.',
  sampleDutyOtherOffer8HourQuestion: 'Do you want to see an 8-hour duty sample?',
  sampleDutyOtherOffer24HourQuestion: 'Do you want to see a 24-hour duty sample?',
  sampleDutyFinalChoiceQuestion: 'What is your final duty hour preference?',
  sampleDutyFinalChoiceRetry: 'Please select 8 hour / 24 hour / Both.',
  sampleDutyOffer24Hour:
    `Patient: Elderly female, 71 years\nCondition: Supportive care\n\nCare Level: Assisted care with walker support\n\nDuty: 24-hour care\n\nDuration: 1 month\n\nLocation: Bengaluru\n\nCare Needed:\n- Washroom support\n- Bed making\n- Assistance while feeding\n- Helping with medicines\n- Assistance in lifting and walking using walker\n- Assistance during physiotherapy exercises\n\nEarnings:\nRs 1200 per day x 30 days\nRs 36000 total\n\nSafety and Support:\n- Family verified\n- Payment guaranteed\n- Pulso support available during duty`,
  sampleDutyOffer8Hour:
    `Patient: Female, 65 years\n\nCondition: Post-surgery recovery\n\nCare Type: Home supportive care\n\nDuty: 8 hours\n\nDuration: Continuous\n\nLocation: Bengaluru\n\nCare Needed:\n- Walking / mobility support\n- Assistance with daily activities\n- Washroom support if needed\n- Helping with medicines\n- General supervision and comfort care\n\nEarnings:\nRs 900 per day\n\nSupport:\n- Family verified\n- Payment guaranteed\n- Pulso support available during duty`,
  expectedDutiesIntroOne:
    `Caregiver duties may include the following. Duties may change depending on the patient's condition.\n\n*Personal care*\n- Bathing or sponge bath support\n- Dressing\n- Oral care\n- Grooming\n- Hair combing\n\n*Toileting and hygiene support*\n- Diaper change\n- Bedpan or urinal support\n- Cleaning and maintaining hygiene`,
  expectedDutiesIntroTwo:
    `*Mobility and safety*\n- Helping the patient sit, stand, and walk\n- Turning and positioning in bed\n- Fall-risk precautions\n\n*Feeding support*\n- Helping with meals\n- Ensuring enough water intake\n- Following diet instructions given by the family or doctor`,
  expectedDutiesIntroThree:
    `*Companionship*\n- Talking to the patient\n- Engaging in simple activities\n- Medicine reminders if schedule is given\n\nPlease continue only if you are willing to do these care duties.`,
  expectedDutiesQuestion: 'Are you willing to do these care duties?',
  expectedDutiesRetry: 'Please select one option from below.',
  expectedDutiesDeclined:
    'Okay. If you are not interested in these care duties, you can message us later.',
  notInterested: 'Okay. If you are interested later, you can message us again.',
  certificateRequest: 'Please upload your certificate as an image or PDF.',
  certificateRetry:
    'Please upload your certificate as an image or document. You can send up to 4 image/PDF files.',
  certificateUploadProgress:
    'Certificate received. If you have more certificate pages or documents, you can send them now. Do you want to send more files or continue?',
  certificateUploadLimitReached:
    'Maximum 4 certificate files received. Moving to the next step.',
  nameQuestion: 'Please send your full name.',
  ageQuestion: 'What is your age?',
  ageRetry: 'Please enter your age in numbers. Example: 32',
  ageAboveLimit:
    'Sorry. As per the current onboarding criteria, we cannot proceed with applicants above 50 years of age. If the age was entered wrongly, you can enter it again.',
  ageAboveLimitOptions:
    'If the age was entered wrongly, you can correct it. Otherwise, you can stop here.',
  ageFinalRejection:
    'Okay. As per the current criteria, the age limit is 50 years. So we cannot continue onboarding now. Thank you for your interest and time.',
  ageFinalRejectionOptions:
    'If the age was entered wrongly, you can correct it. Otherwise, you can stop here.',
  ageRejectionClosed:
    'Okay. This application has been closed. If you need help later, you can message us again.',
  sexQuestion: 'Please select your sex.',
  sexRetry: 'Please select Male or Female.',
  districtQuestion:
    'Please select your district from the list below. If your district is not shown, open the next list.',
  districtRetry: 'Please select your district from the list below.',
  districtListQuestion: 'Please select your district from the list below.',
  verificationPending:
    'Thank you. Your certificate has been sent for verification. We will inform you once it is reviewed.',
  additionalDocumentRequest:
    'An additional document is required to continue onboarding.\n\nNote: {{note}}\n\nPlease upload it now as an image or PDF.',
  additionalDocumentRetry: 'Please upload the requested additional document as an image or PDF.',
  additionalDocumentReceived:
    'Thank you. The additional document has been received and sent for review again.',
  certificateApproved:
    'Your certificate has been verified.\nYou are eligible to join Pulso.',
  certificateRejected:
    'Sorry, we could not verify your certificate. Please upload a clear certificate again.',
  certificateReuploadRequested:
    'We could not read your certificate clearly. Please upload a clearer certificate photo or PDF.',
  certificateCvUploaded:
    'You have sent a CV. To continue onboarding, please upload your certificate photo or certificate PDF.',
  certificateWrongImageUploaded:
    'The image you sent does not look like a certificate. To continue onboarding, please upload your certificate.',
  certificateRejectedPermanent:
    'Sorry, based on the current review, this onboarding application cannot continue. You can contact the office if you need help later.',
  termsIntro:
    `Before joining Pulso, please read all instructions carefully.\n\n1. After accepting your first duty, you need to collect a uniform kit worth Rs 2000.\nThis kit includes one pair of uniform and one ID card.\n\nAfter completing at least 90 days of duty with us, if you return the uniform to the office, the full Rs 2000 will be refunded.\n\nIf you need one additional pair of uniform, you can buy it by paying Rs 950.\nThis extra uniform amount is not refundable.\n\nPayment option:\nIf you are unable to pay Rs 2000 for the uniform kit at once, you can pay it through deduction from your first 4 days of duty payment. Rs 500 will be deducted per day for the first 4 duty days.\n\n2. Please note: you are not a permanent salaried employee of Pulso. You will receive payment only for the days you work. Pulso shares duty/job opportunities with you. If you accept and complete a duty successfully, you will receive the applicable payment. You will not receive salary or payment for days you do not work. Payment for completed work will be given daily.\n\n3. We will share available duty offers with you. Please read each duty offer carefully. You can accept or decline. But after accepting a duty, last-minute cancellation makes it difficult for us to arrange another provider. Providers who cancel after accepting may be blocked from accepting future duty offers.`,
  termsQuestion: 'Do you accept the terms and conditions?',
  termsReminder:
    'You have not accepted the terms and conditions yet. To complete onboarding, please reply "continue".',
  termsReminderResume:
    'Thank you. Sending the terms acceptance options again.',
  termsAccepted: 'Thank you. Your onboarding is complete.',
  termsDeclined: 'Okay. If you are interested later, you can message us again.',
  postOnboardingSupport:
    'From now onwards, available duty offers will be sent to you through the Pulso app.\n\nPlease read each duty offer carefully.\n\nIf a duty is suitable for you, you can accept it through the Pulso app.\n\nIf a duty is not suitable, you can reject or ignore it.',
  mobileAppCampaignAnnouncement:
    'Important notice:\n\nFor duty confirmation, check-in, check-out, attendance tracking, duty completion, and payment processing, Pulso mobile app is required.\n\nTo receive and complete duties, you must install the Pulso mobile app and keep your profile active.\n\nPlease install the app using the same phone number used for WhatsApp onboarding.\n\nWithout app activation, duty allocation may be delayed or unavailable.',
  pulsoAppPreferenceNotice:
    'Important notice:\n\nFor duty confirmation, check-in, check-out, attendance tracking, duty completion, and payment processing, Pulso mobile app is required.\n\nTo receive and complete duties, you must install the Pulso mobile app and keep your profile active.\n\nPlease install the app using the same phone number used for WhatsApp onboarding.\n\nWithout app activation, duty allocation may be delayed or unavailable.',
  pulsoAppInstallQuestion: 'Which phone do you use?',
  pulsoAppInstallRetry: 'Please select one option from below.',
  pulsoAppDeviceQuestion: 'Which phone do you use?',
  pulsoAppDeviceRetry: 'Please select Android / iPhone / Need help.',
  pulsoAppAndroidLink:
    'Use the link below to install the Pulso mobile app on Android:\n\nhttps://play.google.com/store/apps/details?id=com.pulso.global&pcampaignid=web_share\n\nAfter installing, log in using the same phone number used for WhatsApp onboarding.',
  pulsoAppIphoneLink:
    'Use the link below to install the Pulso mobile app on iPhone:\n\nhttps://apps.apple.com/in/app/pulso/id6757874217\n\nAfter installing, log in using the same phone number used for WhatsApp onboarding.',
  pulsoAppInstalledQuestion:
    'Have you installed and logged in to the app?',
  pulsoAppInstalledPending:
    'Thank you.\n\nWe will verify your Pulso app activation.\n\nOnce your app profile is active, you will be eligible to receive and complete duty opportunities.\n\nPlease keep the app installed and notifications turned on.',
  pulsoAppActivationVerified:
    'Your Pulso app profile is active.\n\nYou are now ready to receive duty opportunities.\n\nFor every duty, you must use the Pulso app for:\n\nDuty confirmation\nCheck-in\nCheck-out\nAttendance tracking\nDuty completion\n\nPlease keep your app notifications turned on.',
  pulsoAppLater:
    'Okay.\n\nYour onboarding is complete, but app activation is still pending.\n\nPulso app activation is required before duty allocation.\n\nYou can install the app later using the correct link.',
  pulsoAppHelpQuestion:
    'No problem. Please select the issue you are facing.',
  pulsoAppInstallHelp:
    'Our support team will help you install the Pulso app.\n\nPlease keep your phone ready and make sure you have internet access.\n\nPulso support team will contact you soon.',
  pulsoAppLoginOtpHelp:
    'Our support team will help you with the login or OTP issue.\n\nPlease make sure you are using the same phone number used for WhatsApp onboarding.\n\nPulso support team will contact you soon.',
  pulsoAppNoSmartphone:
    'Pulso app is required for duty confirmation, check-in, check-out, attendance tracking, and duty completion.\n\nWithout the app, duty allocation may not be possible.\n\nOur support team will contact you to check if any temporary support option is available.',
  pulsoAppInstallDeclined:
    'Okay. Your onboarding is complete, but app activation is still pending.\n\nPulso app activation is required before duty allocation.',
  mobileAppCampaignThanks:
    'Thank you. If you need more help, you can contact the Pulso support team through WhatsApp.',
  mobileAppLinkHelp:
    'Pulso app activation is pending. Use the options below if you need the install link or support.',
  postOnboardingContactSupport:
    'For help, you can contact the Pulso support team.\nYou can message us on WhatsApp anytime.',
  postOnboardingLinks:
    'Pulso Elderly Care\nBengaluru, Karnataka\n\nWebsite:\nhttps://www.pulso.co.in/',
  optionalAgentHelp: 'If you have more questions, you can connect with a Pulso agent.',
  optionalAgentHelpConfirmed:
    'Okay. A Pulso agent will contact you soon through WhatsApp.',
  agentHelpAlreadyRequested:
    'Our support team has already been informed. If you do not get help, you can select "More help" again after 12 hours.',
  verificationStillPending:
    'Your certificate is currently under verification. We will update you after review.',
  completed:
    'Your onboarding is already complete. If you need more help, please message again.'
};

const UI_TEXT = {
  regionButtonText: 'Select',
  qualificationButtonText: 'തിരഞ്ഞെടുക്കുക',
  districtButtonText: 'ജില്ല തിരഞ്ഞെടുക്കുക',
  qualificationSectionTitle: 'Qualification options',
  districtSectionTitle: 'District options',
  nextListTitle: 'അടുത്ത list',
  nextListDescription: 'ജില്ല ഇവിടെ ഇല്ലെങ്കിൽ തുറക്കുക',
  previousListTitle: 'ആദ്യ list',
  previousListDescription: 'മുൻപത്തെ ജില്ലകൾ കാണുക',
  qualificationGoBackTitle: 'തിരികെ പോകുക',
  interestYesTitle: 'താൽപര്യമുണ്ട്',
  interestNoTitle: 'താൽപര്യമില്ല',
  dutyBothTitle: 'രണ്ടും',
  sampleYesTitle: 'കാണാം',
  sampleNoTitle: 'വേണ്ട',
  expectedDutiesYesTitle: 'തയ്യാറാണ്',
  expectedDutiesNoTitle: 'താൽപര്യമില്ല',
  ageRetryTitle: 'വയസ് വീണ്ടും നൽകാം',
  ageExitTitle: 'ശരി',
  ageEditTitle: 'വയസ് തിരുത്താം',
  certificateAddMoreTitle: 'കൂടുതൽ അയക്കാം',
  certificateContinueTitle: 'തുടരാം',
  termsAcceptTitle: 'സ്വീകരിക്കുന്നു',
  termsDeclineTitle: 'സ്വീകരിക്കുന്നില്ല',
  optionalAgentHelpTitle: 'കൂടുതൽ സഹായം',
  appDeviceAndroidTitle: 'Android',
  appDeviceIphoneTitle: 'iPhone',
  appNeedHelpTitle: 'സഹായം വേണം',
  appInstalledTitle: 'ചെയ്തു',
  appLaterTitle: 'പിന്നീട്',
  appHelpInstallTitle: 'Install help',
  appHelpLoginOtpTitle: 'Login / OTP issue',
  appHelpNoSmartphoneTitle: 'Smartphone ഇല്ല',
  districtPageSize: 7
};

const KARNATAKA_UI_TEXT = {
  ...UI_TEXT,
  qualificationButtonText: 'Select',
  districtButtonText: 'Select district',
  nextListTitle: 'Next list',
  nextListDescription: 'Open if your district is not here',
  previousListTitle: 'Previous list',
  previousListDescription: 'See previous districts',
  qualificationGoBackTitle: 'Go back',
  interestYesTitle: 'Yes, interested',
  interestNoTitle: 'Not interested',
  dutyBothTitle: 'Both',
  sampleYesTitle: 'Yes',
  sampleNoTitle: 'No',
  expectedDutiesYesTitle: 'Yes',
  expectedDutiesNoTitle: 'No',
  ageRetryTitle: 'Correct age',
  ageExitTitle: 'Stop here',
  ageEditTitle: 'Correct age',
  certificateAddMoreTitle: 'Send more',
  certificateContinueTitle: 'Continue',
  termsAcceptTitle: 'Accept',
  termsDeclineTitle: 'Decline',
  optionalAgentHelpTitle: 'More help',
  appNeedHelpTitle: 'Need help',
  appInstalledTitle: 'Installed',
  appLaterTitle: 'Later',
  appHelpInstallTitle: 'Install help',
  appHelpLoginOtpTitle: 'Login / OTP issue',
  appHelpNoSmartphoneTitle: 'No smartphone',
  districtPageSize: 8
};

const FLOWS = {
  kerala_malayalam: {
    id: 'kerala_malayalam',
    region: 'kerala',
    language: 'ml',
    MESSAGES,
    QUALIFICATIONS,
    DISTRICTS,
    UI_TEXT
  },
  karnataka_english: {
    id: 'karnataka_english',
    region: 'karnataka',
    language: 'en',
    MESSAGES: KARNATAKA_MESSAGES,
    QUALIFICATIONS: ENGLISH_QUALIFICATIONS,
    DISTRICTS: KARNATAKA_DISTRICTS,
    UI_TEXT: KARNATAKA_UI_TEXT
  }
};

const DEFAULT_FLOW_ID = 'kerala_malayalam';
const flowStorage = new AsyncLocalStorage();

function getFlowConfig(flowId) {
  return FLOWS[flowId] || FLOWS[DEFAULT_FLOW_ID];
}

function getProviderFlowId(provider) {
  return provider && provider.flowId ? provider.flowId : DEFAULT_FLOW_ID;
}

function getActiveFlow() {
  return getFlowConfig(flowStorage.getStore() || DEFAULT_FLOW_ID);
}

function runWithFlow(flowId, callback) {
  return flowStorage.run(getFlowConfig(flowId).id, callback);
}

function runWithProviderFlow(provider, callback) {
  return runWithFlow(getProviderFlowId(provider), callback);
}

function createObjectProxy(key) {
  return new Proxy(
    {},
    {
      get(_target, property) {
        return getActiveFlow()[key][property];
      },
      ownKeys() {
        return Reflect.ownKeys(getActiveFlow()[key]);
      },
      getOwnPropertyDescriptor(_target, property) {
        return Object.getOwnPropertyDescriptor(getActiveFlow()[key], property);
      }
    }
  );
}

function createArrayProxy(key) {
  return new Proxy(
    [],
    {
      get(_target, property) {
        const value = getActiveFlow()[key][property];
        return typeof value === 'function' ? value.bind(getActiveFlow()[key]) : value;
      },
      ownKeys() {
        return Reflect.ownKeys(getActiveFlow()[key]);
      },
      getOwnPropertyDescriptor(_target, property) {
        return Object.getOwnPropertyDescriptor(getActiveFlow()[key], property);
      }
    }
  );
}

const ACTIVE_MESSAGES = createObjectProxy('MESSAGES');
const ACTIVE_QUALIFICATIONS = createArrayProxy('QUALIFICATIONS');
const ACTIVE_DISTRICTS = createArrayProxy('DISTRICTS');
const ACTIVE_UI_TEXT = createObjectProxy('UI_TEXT');

module.exports = {
  STEPS,
  STATUS,
  BUTTON_IDS,
  REGION_OPTIONS,
  QUALIFICATIONS: ACTIVE_QUALIFICATIONS,
  DISTRICTS: ACTIVE_DISTRICTS,
  MESSAGES: ACTIVE_MESSAGES,
  UI_TEXT: ACTIVE_UI_TEXT,
  FLOWS,
  DEFAULT_FLOW_ID,
  getFlowConfig,
  getProviderFlowId,
  runWithFlow,
  runWithProviderFlow
};
