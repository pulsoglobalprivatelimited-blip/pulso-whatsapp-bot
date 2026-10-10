const { AsyncLocalStorage } = require('async_hooks');

const STEPS = {
  1: 'incoming_lead',
  1.5: 'awaiting_region_selection',
  1.6: 'awaiting_language_selection',
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
  AWAITING_LANGUAGE_SELECTION: 'awaiting_language_selection',
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
  // After the district, before review: she sees her answers together and taps
  // Correct or Change (docs/confirm_details_before_review_plan.md, 8 Oct 2026).
  AWAITING_DETAILS_CONFIRMATION: 'awaiting_details_confirmation',
  VERIFICATION_PENDING: 'certificate_verification_pending',
  ADDITIONAL_DOCUMENT_REQUESTED: 'additional_document_requested',
  AWAITING_TERMS_ACCEPTANCE: 'awaiting_terms_acceptance',
  COMPLETED: 'completed',
  NEEDS_HUMAN_REVIEW: 'needs_human_review'
};

const BUTTON_IDS = {
  REGION_KERALA: 'region_kerala',
  REGION_KARNATAKA: 'region_karnataka',
  LANGUAGE_MALAYALAM: 'language_malayalam',
  LANGUAGE_ENGLISH: 'language_english',
  QUALIFICATION_GDA: 'qualification_gda',
  QUALIFICATION_GNM: 'qualification_gnm',
  QUALIFICATION_ANM: 'qualification_anm',
  QUALIFICATION_HCA: 'qualification_hca',
  QUALIFICATION_BSC_NURSING: 'qualification_bsc_nursing',
  QUALIFICATION_OTHER_CAREGIVING: 'qualification_other_caregiving',
  QUALIFICATION_NO_CERTIFICATE: 'qualification_no_certificate',
  QUALIFICATION_NURSING_STUDENT: 'qualification_nursing_student',
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
  // The check after the district: two buttons, then a five-row list.
  DETAILS_CORRECT: 'details_correct',
  DETAILS_CHANGE: 'details_change',
  DETAILS_EDIT_NAME: 'details_edit_name',
  DETAILS_EDIT_AGE: 'details_edit_age',
  DETAILS_EDIT_SEX: 'details_edit_sex',
  DETAILS_EDIT_DISTRICT: 'details_edit_district',
  DETAILS_EDIT_QUALIFICATION: 'details_edit_qualification',
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
  PULSO_APP_DEVICE_ANDROID: 'pulso_app_device_android',
  // The Duty Card question after onboarding, and the add-it-now follow-up.
  AGENCY_YES: 'agency_yes',
  AGENCY_NO: 'agency_no',
  ADD_DUTY_NOW: 'add_duty_now',
  ADD_DUTY_LATER: 'add_duty_later'
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
    // Founder, 3 Oct 2026: a nursing student is taken on as a Basic caregiver,
    // shows her marks card, and is reviewed by phone like "No certificate".
    id: BUTTON_IDS.QUALIFICATION_NURSING_STUDENT,
    title: 'നഴ്സിംഗ് വിദ്യാർത്ഥി',
    description: 'GNM / BSc / ANM പഠിക്കുന്നു / waiting for registration'
  },
  {
    // Replaces "None of these" (27 Sep 2026), the one row that refused the
    // person it was shown to. Founder's wording. She is reviewed by phone,
    // not by document, and approved as Basic if the reviewer says so.
    id: BUTTON_IDS.QUALIFICATION_NO_CERTIFICATE,
    title: 'സർട്ടിഫിക്കറ്റ് ഇല്ല',
    description: 'caregiver ജോലി ചെയ്യാൻ താൽപര്യമുണ്ട്'
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
    id: BUTTON_IDS.QUALIFICATION_NURSING_STUDENT,
    title: 'Nursing student',
    description: 'Studying GNM / BSc / ANM / waiting for registration'
  },
  {
    id: BUTTON_IDS.QUALIFICATION_NO_CERTIFICATE,
    title: 'No certificate',
    description: 'Interested in caregiving work'
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
    'താങ്കളുടെ qualification തിരഞ്ഞെടുക്കുക.',
  // Nobody is refused at this question any more, so this is an instruction,
  // not a rejection. It fires for a typed answer the list reader cannot place.
  notEligible:
    'ദയവായി താഴെയുള്ള list-ിൽ നിന്ന് ഒരു option തിരഞ്ഞെടുക്കുക. സർട്ടിഫിക്കറ്റ് ഇല്ലെങ്കിൽ "സർട്ടിഫിക്കറ്റ് ഇല്ല" എന്ന option തിരഞ്ഞെടുക്കുക.',
  qualificationRetry:
    'ദയവായി താഴെയുള്ള options-ിൽ നിന്നും qualification തിരഞ്ഞെടുക്കുക: GDA / GNM / ANM / HCA / BSc Nursing / Other with experience in caregiving / സർട്ടിഫിക്കറ്റ് ഇല്ല.',
  // Founder, 9 Oct 2026 (option B, verbatim): added under the GDA/nurse line
  // for No certificate applicants only; everyone else reads the intro as before.
  workingModelNoCertificateLine:
    'Caregiving / Nursing certificate ഇല്ലാത്തവർക്കും, പ്രായമായവരെ പരിചരിച്ച മുൻപരിചയം ഉണ്ടെങ്കിൽ Basic Caregiver ആയി ഞങ്ങളോടൊപ്പം join ചെയ്യാം. ഒരു ചെറിയ ഫോൺ സംഭാഷണത്തിന് ശേഷം തീരുമാനം അറിയിക്കും. നിങ്ങൾ interested ആണെങ്കിൽ ഞങ്ങൾ നിങ്ങൾക്ക് Pulso App വഴി duty offers അയച്ചു തരും.',
  workingModel:
    `**Pulso Global Private Limited** ഒരു homecare കമ്പനിയാണ്. പ്രായമായർക്കും കിടപ്പ് രോഗികൾക്കും അവരുടെ വീടുകളിൽ പരിചരണം നൽകുന്നതാണ് ഞങ്ങളുടെ സർവീസ്.\n\nGDA (General Duty Assistant) staff-നും nurse-നും ഞങ്ങളോടൊപ്പം join ചെയ്യാൻ കഴിയും. നിങ്ങൾ interested ആണെങ്കിൽ ഞങ്ങൾ നിങ്ങൾക്ക് Pulso App വഴി duty offers അയച്ചു തരും.\n\n**Duty details:**\n\n1. Duty area കേരളത്തിൽ എവിടെയും ആയിരിക്കാം\n2. Duty timing 8 hours, 24 hours എന്നീ രീതികളിലായിരിക്കും\n3. 8 hours duty സമയം രാവിലെ 8 മണി മുതൽ വൈകുന്നേരം 4 മണിവരെ ആയിരിക്കും\n4. Duty duration 1 week, 2 week, 1 month എന്നിങ്ങനെ വ്യത്യാസപ്പെടാം\n5. 24 hours duty-ക്ക് patient-ന്റെ വീട്ടിൽ stay-യും food-ും ലഭിക്കും\n6. 8 hour duty-ക്ക് stay ഉണ്ടായിരിക്കില്ല\n7. 8 മണിക്കൂർ ഡ്യൂട്ടിക്ക് ദിവസത്തിൽ ₹600 മുതൽ ₹900 വരെ ലഭിക്കും\n8. 24 മണിക്കൂർ ഡ്യൂട്ടിക്ക് ദിവസത്തിൽ ₹750 മുതൽ ₹1000 വരെ ലഭിക്കും\n9. Payment daily നിങ്ങളുടെ account-ിൽ credit ആവുന്നതാണ്\n10. നിങ്ങൾ work ചെയ്യുന്ന ദിവസങ്ങളിൽ മാത്രമായിരിക്കും payment ലഭിക്കുക\n11. House maid ജോലി ഉണ്ടായിരിക്കില്ല. Patient care duties മാത്രം ആയിരിക്കും\n\n**Working model:**\n\n1. Pulso App വഴി duty offers ലഭിക്കും\n2. നിങ്ങൾക്ക് താല്പര്യമുള്ള duty-കൾ മാത്രം accept ചെയ്യാം\n3. താല്പര്യമില്ലെങ്കിൽ reject ചെയ്യാം അല്ലെങ്കിൽ ignore ചെയ്യാം\n4. Duty accept ചെയ്തതിന് ശേഷം office verification call ഉണ്ടാകും\n5. എല്ലാ instructions-ും duty details-ും office staff clear ആയി അറിയിക്കും\n6. പിന്നീട് നിങ്ങൾ നേരിട്ട് duty location-ലേക്ക് പോകണം\n7. സമയത്തിന് duty ആരംഭിച്ച് ഉത്തരവാദിത്വത്തോടെ care നൽകണം\n\n**Emergency leave:**\n\nEmergency leave ആവശ്യമായി വന്നാൽ വേറെ staff-നെ ഞങ്ങൾ arrange ചെയ്ത് തരുന്നതായിരിക്കും.\n\n**ശ്രദ്ധിക്കുക:**\n\n- Duty offer accept ചെയ്യണോ വേണ്ടയോ എന്നത് മുഴുവൻ നിങ്ങളുടെ ഇഷ്ടമാണ്\n- ഇഷ്ടമുള്ള duty-കൾ മാത്രം സ്വീകരിച്ചാൽ മതി\n- ഇതിനായി പ്രത്യേക registration fee ഒന്നും നൽകേണ്ടതില്ല\n\n**Office Address:**\nPulso Elderlycare, Kalamassery, Kochi - 682021`,
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
    `Elderly female Patient (71 yrs)\nCondition: Supportive care\n\n🟡 Care Level: Assisted care (with walker support)\n\n🕘 Duty: 24-hour care\n\n📅 Duration: 1 month (continuous) – from 21 Jan\n\n📍 Location: Vennala (nearby)\n\n🩺 Care Needed (Supportive &\n Assisted):\n\n•⁠  ⁠Washroom support\n•⁠  ⁠Bed making\n•⁠  ⁠Assistance while feeding\n•⁠  ⁠Helping with medicines\n•⁠  ⁠Assistance in lifting & walking using walker\n•⁠  ⁠Assistance during physiotherapy exercises\n(Supportive home care – not hospital duty)\n💰 Earnings:\n\n₹ {{payout24h}} per day × 30 days\n👉 ₹ {{total24h}} total\n\n🛡 Safety & Support\n✔ Family verified\n✔ Payment guaranteed\n✔ Support available during duty`,
  sampleDutyOffer8Hour:
    `👤 Patient:\nfemale – 65 yrs\n\n🩺 Condition:\nPost-surgery recovery (Hip surgery)\n\n👨‍⚕ Care Type:\nHome supportive care (not complex)\n\n🕘 Duty:\n8 hours (8:00 AM – 4:00 PM)\n\n⏳ Duration:\nFrom 14 Feb – continuous\n\n📍 Location:\nThevakkal, Ernakulam\n\n🩺 Care Needed:\n•⁠  ⁠Walking / mobility support\n•⁠  ⁠Assistance with daily activities\n•⁠  ⁠Washroom support (if needed)\n•⁠  ⁠Helping with medicines\n•⁠  ⁠General supervision & comfort care\n\n💰 Earnings:\n₹{{payout8h}} per day\n👉 Stable regular day-duty\n\n🛡 Pulso Support:\n✔ Family verified\n✔ Payment guaranteed\n✔ Full support during duty`,
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
  // People sent a CV here because "certificate" did not say which paper
  // (founder, 1 Oct 2026: no CV is needed). The ask names the paper for the
  // qualification she chose a step earlier; {{paper}} comes from
  // certificatePapers below.
  certificateRequest:
    'ദയവായി താങ്കളുടെ certificate-ന്റെ വ്യക്തമായ ഫോട്ടോ അയയ്ക്കുക.\n\nCV / resume അല്ല — certificate തന്നെയാണ് വേണ്ടത്.',
  certificateRetry:
    'ദയവായി certificate image അല്ലെങ്കിൽ PDF ആയി അയയ്ക്കുക. CV / resume അല്ല, certificate തന്നെ വേണം. പരമാവധി 4 image/PDF വരെ അയക്കാം.',
  certificateRequestNamed:
    'ദയവായി താങ്കളുടെ *{{paper}}*-ന്റെ വ്യക്തമായ ഫോട്ടോ അയയ്ക്കുക.\n\nCV / resume അല്ല — certificate തന്നെയാണ് വേണ്ടത്.',
  certificateRetryNamed:
    'ദയവായി താങ്കളുടെ *{{paper}}* image അല്ലെങ്കിൽ PDF ആയി അയയ്ക്കുക. CV / resume അല്ല, certificate തന്നെ വേണം. പരമാവധി 4 image/PDF വരെ അയക്കാം.',
  certificateOnlyNote:
    'താങ്കൾ അയച്ചത് certificate അല്ല. ദയവായി *{{paper}}*-ന്റെ ഫോട്ടോ അയയ്ക്കുക. CV / resume വേണ്ട.',
  certificatePapers: {
    gda: 'GDA course certificate',
    gnm: 'GNM course certificate അല്ലെങ്കിൽ Nursing Council registration certificate',
    anm: 'ANM course certificate അല്ലെങ്കിൽ Nursing Council registration certificate',
    bsc_nursing: 'BSc Nursing degree certificate അല്ലെങ്കിൽ Nursing Council registration certificate',
    hca: 'HCA course certificate',
    other_caregiving: 'caregiving course certificate അല്ലെങ്കിൽ experience certificate',
    basic_caregiver: 'caregiving course certificate അല്ലെങ്കിൽ experience certificate',
    nursing_student: 'nursing course-ന്റെ marks card'
  },
  certificateUploadFailed:
    'Certificate file receive ചെയ്യാൻ കഴിഞ്ഞില്ല. ദയവായി certificate വീണ്ടും image അല്ലെങ്കിൽ PDF ആയി അയയ്ക്കുക.',
  certificateUploadProgress:
    'Certificate ലഭിച്ചു. കൂടുതൽ image/PDF ഉണ്ടെങ്കിൽ ഇനി അയക്കാം. തുടരണോ?',
  certificateUploadLimitReached:
    'പരമാവധി 4 certificate files ലഭിച്ചു. ഇനി അടുത്ത step-ലേക്ക് പോകുന്നു.',
  nameQuestion:
    'താങ്കളുടെ പൂർണ്ണ പേര് അയയ്ക്കുക.',
  ageQuestion:
    'താങ്കളുടെ വയസ് എത്രയാണ്?',
  // "No thanks" on the Basic Caregiver invite (basic_invite_*_ml, 7 Oct 2026).
  basicInviteDeclined:
    'ശരി, നന്ദി. ഇനി ഇതിനെക്കുറിച്ച് ഞങ്ങൾ message അയക്കില്ല.',
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
  // The check after the district (8 Oct 2026). Labels double as the rows of
  // the Change list, so each must fit a list row title (24).
  detailsCheckTitle:
    '*താങ്കൾ നൽകിയ വിവരങ്ങൾ ഒന്ന് പരിശോധിക്കുക:*',
  detailsCheckLabels: {
    name: 'പേര്',
    age: 'വയസ്',
    sex: 'സ്ത്രീ / പുരുഷൻ',
    district: 'ജില്ല',
    qualification: 'യോഗ്യത'
  },
  detailsSexValues: { Female: 'സ്ത്രീ', Male: 'പുരുഷൻ' },
  detailsChangeQuestion:
    'ഏത് വിവരമാണ് മാറ്റേണ്ടത്? താഴെയുള്ള list-ിൽ നിന്ന് തിരഞ്ഞെടുക്കുക.',
  detailsCheckReminder:
    "താങ്കളുടെ വിവരങ്ങൾ പരിശോധിച്ച് 'ശരിയാണ്' അമർത്തുക.",
  // A qualification changed at the check to one paid at the Basic rate.
  detailsQualificationBasicNotice:
    'ഈ qualification-ന് Pulso duty നൽകുന്നത് Basic നിരക്കിലാണ്.\n\nഡ്യൂട്ടി വേതനം:\n8 മണിക്കൂർ – ദിവസം ₹{{payout8h}}\n24 മണിക്കൂർ – ദിവസം ₹{{payout24h}}',
  verificationPending:
    'നന്ദി. താങ്കളുടെ certificate verification-നായി അയച്ചിരിക്കുന്നു. പരിശോധിച്ച ശേഷം ഉടൻ അറിയിക്കും.',
  // For the person with no certificate: nothing was "sent for verification".
  verificationPendingNoCertificate:
    'നന്ദി. നിങ്ങളുടെ വിവരങ്ങൾ ലഭിച്ചു. ഒരു പരിചരണ സർട്ടിഫിക്കറ്റ് ഇല്ലാത്തതിനാൽ, ഒരു ചെറിയ ഫോൺ സംഭാഷണത്തിനു ശേഷം തീരുമാനം അറിയിക്കും.',
  verificationPendingNursingStudent:
    'നന്ദി. നിങ്ങളുടെ വിവരങ്ങൾ ലഭിച്ചു. നിങ്ങൾ nursing student ആയതിനാൽ, ഒരു ചെറിയ ഫോൺ സംഭാഷണത്തിനു ശേഷം തീരുമാനം അറിയിക്കും.',
  verificationPendingBasicAge:
    'നന്ദി. നിങ്ങളുടെ വിവരങ്ങൾ ലഭിച്ചു. 50 വയസിന് മുകളിലായതിനാൽ, ഒരു ചെറിയ ഫോൺ സംഭാഷണത്തിനു ശേഷം തീരുമാനം അറിയിക്കും.',
  additionalDocumentRequest:
    'Onboarding തുടരാൻ ഒരു additional document കൂടി ആവശ്യമാണ്.\n\nNote: {{note}}\n\nദയവായി image അല്ലെങ്കിൽ PDF ആയി ഇപ്പോൾ upload ചെയ്യുക.',
  additionalDocumentRetry:
    'ദയവായി ആവശ്യപ്പെട്ട additional document image അല്ലെങ്കിൽ PDF ആയി upload ചെയ്യുക.',
  additionalDocumentReceived:
    'നന്ദി. ആവശ്യപ്പെട്ട additional document ലഭിച്ചു. വീണ്ടും review-നായി അയച്ചിരിക്കുന്നു.',
  certificateApproved:
    // The certificate promise is repeated only once she is accepted. It is
    // deliberately absent from the waiting message: someone we may still reject
    // must not be told what she earns for finishing.
    'താങ്കളുടെ certificate verify ചെയ്തിരിക്കുന്നു.\nതാങ്കൾ Pulso-യിൽ ജോയിൻ ചെയ്യാൻ eligible ആണ്.\n\n180 ദിവസത്തെ duty പൂർത്തിയാക്കിയാൽ Pulso Global Private Limited-ന്റെ experience certificate ലഭിക്കും.',
  certificateApprovedBasic:
    // Founder's Malayalam, verbatim, 26 Sep 2026.
    'നിങ്ങളുടെ രേഖകൾ പരിശോധിച്ചു. Pulso-യിൽ Basic Caregiver ആയി ചേരുന്നതിനുള്ള അംഗീകാരം നിങ്ങൾക്ക് ലഭിച്ചിരിക്കുന്നു.',
  termsRateBasic:
    // Founder's Malayalam, verbatim, 26 Sep 2026. He cut "on the basis of your
    // caregiving experience" the same day: she is about to accept terms, and the
    // sentence that matters there is the pay, not the reasoning. The rate lines
    // already read "ദിവസം ₹600" — per day — so the "/day" he added to the English
    // is already present here. Except the two figures, which
    // he wrote as ₹600 / ₹750 and are carried as {{payout8h}} / {{payout24h}} so a
    // repricing in app_config/provider_tiers reaches this line without a deploy.
    'നിങ്ങൾക്ക് Nursing/Caregiving കോഴ്സ് സർട്ടിഫിക്കറ്റ് ഇല്ലാത്തതിനാൽ, നിങ്ങളെ Basic Caregiver ആയാണ് തിരഞ്ഞെടുത്തിരിക്കുന്നത്.\n\nഡ്യൂട്ടി വേതനം:\n8 മണിക്കൂർ – ദിവസം ₹{{payout8h}}\n24 മണിക്കൂർ – ദിവസം ₹{{payout24h}}',
  basicTierAgeNotice:
    // Said the moment she gives her age, before she uploads anything or answers
    // eight more questions. She used to read nurse money three times and find
    // out at the terms screen; this is the same news, early enough to walk away.
    'നന്ദി. {{ageThreshold}} വയസ്സിന് മുകളിലുള്ള caregivers-ന് Pulso duty നൽകുന്നത് Basic നിരക്കിലാണ്.\n\nഡ്യൂട്ടി വേതനം:\n8 മണിക്കൂർ – ദിവസം ₹{{payout8h}}\n24 മണിക്കൂർ – ദിവസം ₹{{payout24h}}',
  termsRateBasicAge:
    // For someone whose certificate IS good — a nurse or a GDA — but who is
    // above the age at which Pulso offers the Basic rate. She must not read
    // that she has no certificate, because she has one and she just sent it.
    'നിങ്ങളുടെ സർട്ടിഫിക്കറ്റ് പരിശോധിച്ചു അംഗീകരിച്ചു.\n\n{{ageThreshold}} വയസ്സിന് മുകളിലുള്ള caregivers-ന് Pulso duty നൽകുന്നത് Basic നിരക്കിലാണ്.\n\nഡ്യൂട്ടി വേതനം:\n8 മണിക്കൂർ – ദിവസം ₹{{payout8h}}\n24 മണിക്കൂർ – ദിവസം ₹{{payout24h}}',
  certificateRejected:
    'ക്ഷമിക്കണം, താങ്കൾ അയച്ച certificate verify ചെയ്യാൻ കഴിഞ്ഞില്ല. ദയവായി വ്യക്തമായ certificate വീണ്ടും upload ചെയ്യുക.',
  /* Sent when a reviewer takes an approval back. The person already has
     "your certificate is verified" and the terms buttons in their chat;
     saying nothing leaves them holding buttons that no longer do anything. */
  approvalUndone:
    'ക്ഷമിക്കണം, താങ്കളുടെ certificate ഞങ്ങൾ ഒന്നുകൂടി പരിശോധിക്കുകയാണ്. പരിശോധന കഴിഞ്ഞ് ഞങ്ങൾ ഇവിടെ അറിയിക്കാം. ഇപ്പോൾ ഒന്നും ചെയ്യേണ്ടതില്ല.',
  certificateReuploadRequested:
    'താങ്കൾ അയച്ച certificate വ്യക്തമായി വായിക്കാൻ കഴിഞ്ഞില്ല. ദയവായി കൂടുതൽ clarity ഉള്ള certificate photo അല്ലെങ്കിൽ PDF വീണ്ടും upload ചെയ്യുക.',
  certificateCvUploaded:
    'താങ്കൾ CV ആണ് അയച്ചിരിക്കുന്നത്. Onboarding തുടരാൻ ദയവായി certificate photo അല്ലെങ്കിൽ certificate PDF upload ചെയ്യുക.',
  certificateWrongImageUploaded:
    'താങ്കൾ certificate അല്ലാത്ത image ആണ് അയച്ചിരിക്കുന്നത്. Onboarding തുടരാൻ ദയവായി താങ്കളുടെ certificate upload ചെയ്യുക.',
  certificateRejectedPermanent:
    'ക്ഷമിക്കണം, നിലവിലെ review അടിസ്ഥാനത്തിൽ ഈ onboarding അപേക്ഷ ഇനി തുടരാൻ കഴിയില്ല. പിന്നീട് സഹായം ആവശ്യമെങ്കിൽ ഓഫീസുമായി ബന്ധപ്പെടാം.',
  // A "No certificate" / student / above-50 applicant turned down after the
  // call (4 Oct 2026). Never "upload your certificate again": she has none.
  callReviewRejected:
    'നന്ദി. ഇപ്പോൾ ഞങ്ങൾക്ക് താങ്കളുടെ അപേക്ഷ മുന്നോട്ട് കൊണ്ടുപോകാൻ കഴിയില്ല. താൽപര്യത്തിന് നന്ദി.',
  /* Sent on its own, between the working model and the interest question.
     Inside the working model this sat at character 1,836 of 1,935 - WhatsApp
     folds that message at about 640 and shows "Read more", so the line was
     95% of the way down a message almost nobody unfolds. A short message is
     never folded. Founder's words, 30 Sep 2026, verbatim.
     Single asterisks: WhatsApp reads *text* as bold. */
  experienceCertificateNotice:
    '*\ud83d\udcc4 Experience Certificate*\n\nPulso-\u0d2f\u0d3f\u0d7d \u0d06\u0d15\u0d46 180 \u0d26\u0d3f\u0d35\u0d38\u0d24\u0d4d\u0d24\u0d46 duty \u0d2a\u0d42\u0d7c\u0d24\u0d4d\u0d24\u0d3f\u0d2f\u0d3e\u0d15\u0d4d\u0d15\u0d41\u0d28\u0d4d\u0d28 Caregivers / Nursing Professionals-\u0d28\u0d4d, healthcare \u0026 senior care sector-\u0d7d \u0d2a\u0d4d\u0d30\u0d35\u0d7c\u0d24\u0d4d\u0d24\u0d3f\u0d15\u0d4d\u0d15\u0d41\u0d28\u0d4d\u0d28 Pulso Global Private Limited-\u0d28\u0d4d\u0d31\u0d46 \u0d14\u0d26\u0d4d\u0d2f\u0d4b\u0d17\u0d3f\u0d15 Experience Certificate \u0d32\u0d2d\u0d3f\u0d15\u0d4d\u0d15\u0d41\u0d28\u0d4d\u0d28\u0d24\u0d3e\u0d23\u0d4d.\n\nPulso Global Private Limited\nHealthcare \u0026 Senior Care Services\nCIN: U86201KL2023PTC084619\nRegistered Office: JC Chambers, Panampilly Nagar, Ernakulam, Kerala \u2013 682036\n\ud83c\udf10 pulso.co.in',
  termsIntro:
    `ഞങ്ങളോടൊപ്പം ചേരുന്നതിന് മുമ്പ് താഴെ നൽകിയിരിക്കുന്ന എല്ലാ നിർദേശങ്ങളും ദയവായി വായിക്കുക.

1. ഡ്യൂട്ടി സ്വീകരിച്ച ശേഷം, ₹1999 വിലയുള്ള യൂണിഫോം കിറ്റ് എടുക്കേണ്ടതാണ്.
ഈ കിറ്റിൽ ഒരു ജോടി യൂണിഫോവും ഒരു ഐഡി കാർഡും ഉൾപ്പെടുന്നതാണ്.

ഞങ്ങളോടൊപ്പം കുറഞ്ഞത് 90 ദിവസം ഡ്യൂട്ടി പൂർത്തിയാക്കിയ ശേഷം, യൂണിഫോം ഓഫിസിൽ തിരികെ നൽകിയാൽ ₹1999 പൂർണ്ണമായി റിഫണ്ട് ലഭിക്കും.

കൂടുതൽ ഒരു ജോടി യൂണിഫോം ആവശ്യമുണ്ടെങ്കിൽ, ₹1250 അടച്ച് വാങ്ങാവുന്നതാണ്.
ഈ അധിക യൂണിഫോമിന്റെ തുക റിഫണ്ടബിൾ അല്ല.

👉 **പേയ്മെന്റ് ഓപ്ഷൻ:**
യൂണിഫോം കിറ്റിനുള്ള ₹1999 ഒരുമിച്ച് അടയ്ക്കാൻ കഴിയാത്ത പക്ഷം, ആദ്യ 4 ദിവസത്തെ ഡ്യൂട്ടി പേയ്മെന്റിൽ നിന്ന് ആദ്യ 3 ദിവസങ്ങളിൽ ദിവസവും ₹500 വീതവും 4-ാം ദിവസം ₹499 വീതവും കുറച്ച് ഈ തുക അടയ്ക്കാനുള്ള സൗകര്യവും ലഭ്യമാണ്.

2. ദയവായി ശ്രദ്ധിക്കുക: നിങ്ങൾ ഞങ്ങളുടെ സ്ഥിരം ശമ്പള ജീവനക്കാരൻ അല്ല. നിങ്ങൾ ജോലി ചെയ്യുന്ന ദിവസങ്ങളിലാണ് നിങ്ങൾക്ക് വരുമാനം ലഭിക്കുക. ഞങ്ങൾ നിങ്ങളിലേക്ക് ഡ്യൂട്ടി/ജോലി അവസരങ്ങൾ നൽകുന്നതാണ്. നിങ്ങൾ ആ സർവീസ് ഏറ്റെടുത്തു വിജയകരമായി പൂർത്തിയാക്കിയാൽ അതിന് അനുയോജ്യമായ പേയ്മെന്റ് ലഭിക്കും. ജോലി ചെയ്യാത്ത ദിവസങ്ങളിൽ ശമ്പളമോ മറ്റ് പേയ്മെന്റുകളോ ലഭിക്കില്ല. നിങ്ങൾ ചെയ്ത ജോലികളുടെ പേയ്മെന്റ് ദിവസേന നൽകുന്നതായിരിക്കും. ഈ സംവിധാനത്തെക്കുറിച്ച് വ്യക്തമായി മനസ്സിലാക്കി സഹകരിക്കണമെന്ന് അഭ്യർത്ഥിക്കുന്നു. നിങ്ങളുടെ സഹകരണത്തിനും വിശ്വാസത്തിനും നന്ദി.

3. അടുത്ത ലഭ്യമായ ഡ്യൂട്ടി ഞങ്ങൾ ഷെയർ ചെയ്യുന്നതായിരിക്കും. ഡ്യൂട്ടി ഓഫർ ദയവായി ശ്രദ്ധാപൂർവ്വം വായിക്കുക. നിങ്ങൾക്ക് Accept ചെയ്യുകയോ Decline ചെയ്യുകയോ ചെയ്യാം. എന്നാൽ Accept ചെയ്തതിന് ശേഷം Cancel ചെയ്യുന്നത്, ഞങ്ങൾക്ക് ലാസ്റ്റ് മിനിറ്റിൽ മറ്റൊരാളെ കണ്ടെത്താൻ വളരെ ബുദ്ധിമുട്ടുണ്ടാക്കും. അതിനാൽ ഇങ്ങനെ Cancel ചെയ്യുന്നവർക്ക് ഭാവിയിലെ ഡ്യൂട്ടി ഓഫറുകൾ Accept ചെയ്യുന്നതിൽ നിന്ന് സ്ഥിരമായി Block ചെയ്യുന്നതായിരിക്കും.`,
  termsQuestion:
    'Terms and conditions സ്വീകരിക്കുന്നുണ്ടോ?',
  termsReminder:
    'താങ്കളുടെ onboarding പൂർത്തിയാക്കാൻ terms and conditions ഇതുവരെ സ്വീകരിച്ചിട്ടില്ല.\nതുടരാൻ ദയവായി "continue" എന്ന് reply ചെയ്യുക.',
  termsReminderResume:
    'നന്ദി. വീണ്ടും terms acceptance options അയക്കുന്നു.',
  termsAccepted:
    // The count starts here, at zero, so the 180-day goal is in her head before
    // her first duty. She was told about the certificate at step 4; this is the
    // moment it becomes hers to work towards.
    'നന്ദി. താങ്കളുടെ onboarding വിജയകരമായി പൂർത്തിയായി.\n\nഇനി മുതൽ താങ്കൾക്ക് Pulso വഴി duty offers ലഭിച്ചു തുടങ്ങും.\n\nPulso വഴി ആകെ 180 ദിവസത്തെ verified duty പൂർത്തിയാക്കിയാൽ, Pulso Global Private Limited-ന്റെ Experience Certificate ലഭിക്കും.\n\nനിലവിൽ പൂർത്തിയാക്കിയ verified duty: **0 ദിവസം**.',
  termsDeclined:
    'ശരി. താൽപര്യമുണ്ടെങ്കിൽ പിന്നീട് വീണ്ടും message ചെയ്യാം.',
  postOnboardingSupport:
    'ഇനി മുതൽ ലഭ്യമായ duty offers താങ്കൾക്ക് Pulso app വഴി ലഭിക്കുന്നതാണ്.\n\nഓരോ duty offer-ഉം ശ്രദ്ധിച്ച് വായിക്കുക.\n\nതാങ്കൾക്ക് അനുയോജ്യമായ duty ആണെങ്കിൽ Pulso app വഴി accept ചെയ്യാം.\n\nതാങ്കൾക്ക് അനുയോജ്യമല്ലാത്ത duty ആണെങ്കിൽ reject ചെയ്യുകയോ ignore ചെയ്യുകയോ ചെയ്യാം.',
  mobileAppCampaignAnnouncement:
    'പ്രധാന അറിയിപ്പ്:\n\nduty confirmation, check-in, check-out, attendance tracking, duty completion, payment processing എന്നിവയ്ക്കായി Pulso mobile app നിർബന്ധമാണ്.\n\nDuty ലഭിക്കാനും complete ചെയ്യാനും Pulso mobile app install ചെയ്ത് profile active ആയി വയ്ക്കണം.\n\nWhatsApp onboarding-ൽ ഉപയോഗിച്ച അതേ phone number ഉപയോഗിച്ച് app-ൽ login ചെയ്യുക.\n\nApp activation ഇല്ലെങ്കിൽ duty allocation വൈകുകയോ ലഭിക്കാതിരിക്കുകയോ ചെയ്യാം.',
  pulsoAppPreferenceNotice:
    'പ്രധാന അറിയിപ്പ്:\n\nduty confirmation, check-in, check-out, attendance tracking, duty completion, payment processing എന്നിവയ്ക്കായി Pulso mobile app നിർബന്ധമാണ്.\n\nDuty ലഭിക്കാനും complete ചെയ്യാനും Pulso mobile app install ചെയ്ത് profile active ആയി വയ്ക്കണം.\n\nWhatsApp onboarding-ൽ ഉപയോഗിച്ച അതേ phone number ഉപയോഗിച്ച് app-ൽ login ചെയ്യുക.\n\nApp activation ഇല്ലെങ്കിൽ duty allocation വൈകുകയോ ലഭിക്കാതിരിക്കുകയോ ചെയ്യാം.',
  pulsoDutyAcceptVideoCaption:
    'Pulso app-ൽ duty offer എങ്ങനെ കാണാം, suitable duty എങ്ങനെ accept ചെയ്യാം എന്ന് ഈ video-ൽ കാണാം.',
  pulsoAppActivationInstruction:
    'Duty receive ചെയ്യാനും accept ചെയ്യാനും Pulso app install ചെയ്ത് WhatsApp onboarding-ൽ ഉപയോഗിച്ച അതേ phone number ഉപയോഗിച്ച് login ചെയ്യുക.',
  pulsoAppActivationVideoCaption:
    'Pulso app install/login ചെയ്ത് profile active ആക്കുന്നത് എങ്ങനെ എന്ന് ഈ video-ൽ കാണാം.',
  pulsoAppInstallQuestion:
    'താങ്കൾ ഏത് phone ആണ് ഉപയോഗിക്കുന്നത്?',
  pulsoAppInstallRetry:
    'ദയവായി താഴെയുള്ള options-ിൽ നിന്നും തിരഞ്ഞെടുക്കുക.',
  // The Duty Card. Asked once, after the app step, as the last thing in
  // onboarding. The founder's words, 1 Oct 2026 — do not rephrase.
  agencyQuestion:
    'താങ്കൾ ഇപ്പോൾ ഏതെങ്കിലും Home Care Agency / Caregiving Company വഴി duty ചെയ്യുന്നുണ്ടോ?',
  agencyYes:
    'നല്ലത് 👍\n\nഇപ്പോൾ ചെയ്യുന്ന duty Pulso App-ൽ add ചെയ്യാം. താങ്കൾ നൽകിയ duty details ഞങ്ങൾ Agency-യുമായി verify ചെയ്യും.\n\nDuty verify ആയാൽ താങ്കൾക്ക് ലഭിക്കുന്ന benefits:\n\n✓ Verify ആയ ഓരോ duty ദിവസവും Pulso-യുടെ 180-day Experience Certificate-ലേക്ക് count ചെയ്യും.\n\n✓ തുടർച്ചയായി 10 ദിവസം duty പൂർത്തിയാക്കി Agency-യിൽ നിന്ന് 5-star rating ലഭിച്ചാൽ ₹100 reward ലഭിക്കും.\n\n✓ കൂടുതൽ Verified Duty Days ഉണ്ടാകുമ്പോൾ Pulso-യിലെ താങ്കളുടെ Duty Ranking ഉയരും. അതിലൂടെ പുതിയ duty ലഭിക്കാനുള്ള chance മെച്ചപ്പെടും.',
  addDutyInterestQuestion:
    'ഇപ്പോൾ ചെയ്യുന്ന duty Pulso App-ൽ add ചെയ്യാൻ താൽപര്യമുണ്ടോ?',
  addDutyProcedure:
    'Pulso App-ൽ duty add ചെയ്യുന്ന വിധം:\n\n1️⃣ Pulso App open ചെയ്യുക\n2️⃣ Home screen-ൽ "Add my duty" tap ചെയ്യുക\n3️⃣ താഴെയുള്ള details നൽകുക:\n   • Agency-യുടെ പേര്\n   • Agency-യുടെ phone number — Google-ൽ കാണുന്ന number നൽകുക (Google Maps-ൽ agency-യുടെ പേര് search ചെയ്താൽ കാണാം)\n   • Duty ചെയ്യുന്ന area map-ൽ search ചെയ്ത് select ചെയ്യുക\n   • Duty തുടങ്ങിയ തീയതി\n   • Duty അവസാനിക്കുന്ന തീയതി\n   • Duty type (24 hour / Day / Night)\n4️⃣ Send tap ചെയ്യുക\n\nതാങ്കളുടെ Agency-ക്ക് Pulso-യിൽ നിന്ന് ഒരു WhatsApp message ലഭിക്കും. Agency "Yes" tap ചെയ്ത ശേഷം Pulso team agency-യെ verify ചെയ്യും. Verify ആയാൽ താങ്കൾക്ക് message ലഭിക്കും. അതിന് ശേഷം duty count തുടങ്ങും.\n\nഎല്ലാ ദിവസവും duty സ്ഥലത്ത് നിന്ന് Pulso App-ൽ selfie check-in ചെയ്യുക. Check-in ചെയ്ത ദിവസങ്ങൾ മാത്രമേ count ആകൂ.\n\nTip: Duty add ചെയ്യുന്നതിന് മുൻപ് Agency-യോട് പറയുക — "Pulso-യിൽ നിന്ന് ഒരു verification message വരും, Yes tap ചെയ്യണം."',
  addDutyInstallFirst:
    'ആദ്യം Pulso App install ചെയ്ത് onboarding-ൽ ഉപയോഗിച്ച അതേ number-ൽ login ചെയ്യുക.',
  addDutyLater:
    'ശരി. എപ്പോൾ വേണമെങ്കിലും "duty" എന്ന് message ചെയ്താൽ ഈ steps വീണ്ടും അയയ്ക്കാം.',
  agencyQuestionRetry:
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
    'സഹായത്തിനായി ഓഫീസ് നമ്പർ 8714105333-ൽ രാവിലെ 10 മുതൽ വൈകിട്ട് 6 വരെ വിളിക്കാം.\n+91 77361 29809 എന്ന നമ്പറിൽ 24 മണിക്കൂറും WhatsApp സന്ദേശം അയക്കാം.\nനിങ്ങൾക്ക് സഹായം നൽകാൻ ഞങ്ങൾ എപ്പോഴും തയ്യാറാണ്. 👍🏼',
  postOnboardingLinks:
    'Head Office Details\nPulso Elderly Care\n14/455-N4, 1st Floor,\nAmbeel Galleria, Near BSNL Office,\nKangarappady, Kochi, Kerala – 682021\nPhone: +91 87141 05333\nLocation: https://share.google/MWyrmA6XvDInViFkq\n\nWebsite:\nhttps://www.pulso.co.in/',
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

const LANGUAGE_OPTIONS = [
  { id: BUTTON_IDS.LANGUAGE_MALAYALAM, title: 'മലയാളം' },
  { id: BUTTON_IDS.LANGUAGE_ENGLISH, title: 'English' }
];

const ENGLISH_BASE_MESSAGES = {
  ...MESSAGES,
  regionQuestion: 'Welcome to Pulso.\n\nPlease select your region.',
  regionRetry: 'Please select Kerala or Karnataka to continue.',
  welcomeQualification: 'Please select your qualification.',
  notEligible:
    'Please select one option from the list below. If you do not have a certificate, select "No certificate".',
  qualificationRetry:
    'Please select one option: GDA / GNM / ANM / HCA / BSc Nursing / Other caregiving experience / No certificate.',
  workingModelNoCertificateLine:
    'People without a caregiving or nursing certificate can also join us as Basic Caregivers if they have experience caring for the elderly. We will decide after a short phone call. If you are interested, we will send you duty offers through the Pulso App.',
  workingModel:
    `Pulso Global Private Limited is a home care company. We provide care services for elderly people and bedridden patients at their homes.\n\nGDA staff, caregivers, and nurses can join Pulso. If you are interested, we will send duty offers to you through Pulso mobile app\n\nDuty details:\n\n1. Duty location can be anywhere in Karnataka\n2. Duty timing may be 8 hours or 24 hours\n3. 8-hour duty timing will usually be from morning 8 am to evening 4pm\n4. Duty duration may be 1 week, 2 weeks, 1 month, or more depending on the case\n5. For 24-hour duty, stay and food will be provided at the patient's home\n6. For 8-hour duty, stay will not be provided\n7. For 8-hour duty, you will receive Rs 600 to Rs 900 per day\n8. For 24-hour duty, you will receive Rs 750 to Rs 1000 per day\n9. Payment will be credited daily to your account\n10. You will receive payment only for the days you work\n11. There will be no housemaid work. Only patient care duties\n\nWorking model:\n\n1. Duty offers will be sent through Pulso App\n2. You can accept only the duties you are interested in\n3. If you are not interested in a duty, you can reject or ignore it\n4. After you accept a duty, the office team will call you for verification and confirmation\n5. The office team will clearly explain all duty details and instructions\n6. After confirmation, you should go directly to the duty location\n7. You should start duty on time and provide care responsibly\n\nEmergency leave:\n\nIf you need emergency leave, Pulso will try to arrange another staff member.\n\nImportant:\n\n- Accepting or rejecting a duty offer is completely your choice\n- You only need to accept duties you are interested in\n- There is no registration fee to join Pulso\n\nHead Office Address:\nPulso Elderlycare, cochin, kerala - 682036`,
  interestQuestion: 'Did you understand the working model? Are you interested to continue?',
  interestRetry: 'If you are interested to continue, please select the button below.',
  dutyHourPreferenceQuestion: 'Which duty hour do you prefer?',
  dutyHourPreferenceRetry: 'Please select one duty hour preference: 8 hour / 24 hour / Both.',
  dutyHourPreference8HourNotice:
    'Please note: stay and food are not provided for 8-hour duty. Stay and food are available only for 24-hour duty.',
  sampleDutyOfferQuestion: 'Would you like to see how a sample duty offer looks?',
  sampleDutyOfferRetry: 'Please select one option from below.',
  sampleDutyOtherOffer8HourQuestion: 'Do you want to see an 8-hour duty sample?',
  sampleDutyOtherOffer24HourQuestion: 'Do you want to see a 24-hour duty sample?',
  sampleDutyFinalChoiceQuestion: 'What is your final duty hour preference?',
  sampleDutyFinalChoiceRetry: 'Please select 8 hour / 24 hour / Both.',
  sampleDutyOffer24Hour:
    `Patient: Elderly female, 71 years\nCondition: Supportive care\n\nCare Level: Assisted care with walker support\n\nDuty: 24-hour care\n\nDuration: 1 month\n\nLocation: Bengaluru\n\nCare Needed:\n- Washroom support\n- Bed making\n- Assistance while feeding\n- Helping with medicines\n- Assistance in lifting and walking using walker\n- Assistance during physiotherapy exercises\n\nEarnings:\nRs {{payout24h}} per day x 30 days\nRs {{total24h}} total\n\nSafety and Support:\n- Family verified\n- Payment guaranteed\n- Pulso support available during duty`,
  sampleDutyOffer8Hour:
    `Patient: Female, 65 years\n\nCondition: Post-surgery recovery\n\nCare Type: Home supportive care\n\nDuty: 8 hours\n\nDuration: Continuous\n\nLocation: Bengaluru\n\nCare Needed:\n- Walking / mobility support\n- Assistance with daily activities\n- Washroom support if needed\n- Helping with medicines\n- General supervision and comfort care\n\nEarnings:\nRs {{payout8h}} per day\n\nSupport:\n- Family verified\n- Payment guaranteed\n- Pulso support available during duty`,
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
  certificateRequest:
    'Please send a clear photo of your certificate.\n\nNot your CV or resume — we need the certificate itself.',
  certificateRetry:
    'Please send your certificate as an image or PDF. Not your CV or resume — the certificate itself. You can send up to 4 image/PDF files.',
  certificateRequestNamed:
    'Please send a clear photo of your *{{paper}}*.\n\nNot your CV or resume — we need the certificate itself.',
  certificateRetryNamed:
    'Please send your *{{paper}}* as an image or PDF. Not your CV or resume — the certificate itself. You can send up to 4 image/PDF files.',
  certificateOnlyNote:
    'What you sent is not the certificate. Please send a photo of your *{{paper}}*. We do not need a CV or resume.',
  certificatePapers: {
    gda: 'GDA (General Duty Assistant) course certificate',
    gnm: 'GNM course certificate or Nursing Council registration certificate',
    anm: 'ANM course certificate or Nursing Council registration certificate',
    bsc_nursing: 'BSc Nursing degree certificate or Nursing Council registration certificate',
    hca: 'HCA (Home Care Assistant) course certificate',
    other_caregiving: 'caregiving course certificate or experience certificate',
    basic_caregiver: 'caregiving course certificate or experience certificate',
    nursing_student: 'nursing course marks card'
  },
  certificateUploadFailed:
    'We could not receive the certificate file. Please resend it as an image or PDF.',
  certificateUploadProgress:
    'Certificate received. If you have more certificate pages or documents, you can send them now. Do you want to send more files or continue?',
  certificateUploadLimitReached:
    'Maximum 4 certificate files received. Moving to the next step.',
  nameQuestion: 'Please send your full name.',
  ageQuestion: 'What is your age?',
  basicInviteDeclined: "Okay, thank you. We won't message you about this again.",
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
  detailsCheckTitle: '*Please check your details:*',
  detailsCheckLabels: {
    name: 'Name',
    age: 'Age',
    sex: 'Male or female',
    district: 'District',
    qualification: 'Qualification'
  },
  detailsSexValues: { Female: 'Female', Male: 'Male' },
  detailsChangeQuestion: 'Which detail do you want to change? Please choose from the list below.',
  detailsCheckReminder: 'Please check your details and tap Correct.',
  detailsQualificationBasicNotice:
    'With this qualification, Pulso offers duties at the Basic rate.\n\nDuty pay: 8 hours ₹{{payout8h}}/day, 24 hours ₹{{payout24h}}/day.',
  verificationPending:
    'Thank you. Your certificate has been sent for verification. We will inform you once it is reviewed.',
  verificationPendingNoCertificate:
    'Thank you. We have received your details. Since you do not have a caregiving certificate, our team will call you for a short talk and inform you after that.',
  verificationPendingNursingStudent:
    'Thank you. We have received your details. Since you are a nursing student, our team will call you for a short talk and inform you after that.',
  verificationPendingBasicAge:
    'Thank you. We have received your details. Since you are above 50, our team will call you for a short talk and inform you after that.',
  additionalDocumentRequest:
    'An additional document is required to continue onboarding.\n\nNote: {{note}}\n\nPlease upload it now as an image or PDF.',
  additionalDocumentRetry: 'Please upload the requested additional document as an image or PDF.',
  additionalDocumentReceived:
    'Thank you. The additional document has been received and sent for review again.',
  certificateApproved:
    'Your certificate has been verified.\nYou are eligible to join Pulso.\n\nAfter completing 180 days of duty you will receive an experience certificate from Pulso Global Private Limited.',
  certificateApprovedBasic:
    // Founder-approved, 26 Sep 2026.
    'Your document has been reviewed. You are approved to join Pulso as a Basic Caregiver.',
  termsRateBasic:
    // Founder's wording, 26 Sep 2026. Figures from app_config/provider_tiers at send time.
    'Because you have no Nursing/Caregiving course certificate, you have been selected as a Basic Caregiver.\n\nDuty pay: 8 hours ₹{{payout8h}}/day, 24 hours ₹{{payout24h}}/day.',
  basicTierAgeNotice:
    'Thank you. For caregivers above {{ageThreshold}}, Pulso offers duties at the Basic rate.\n\nDuty pay: 8 hours ₹{{payout8h}}/day, 24 hours ₹{{payout24h}}/day.',
  termsRateBasicAge:
    'Your certificate has been checked and approved.\n\nFor caregivers above {{ageThreshold}}, Pulso offers duties at the Basic rate.\n\nDuty pay: 8 hours ₹{{payout8h}}/day, 24 hours ₹{{payout24h}}/day.',
  certificateRejected:
    'Sorry, we could not verify your certificate. Please upload a clear certificate again.',
  approvalUndone:
    'Sorry, we are checking your certificate once more. We will let you know here when it is done. Nothing is needed from you right now.',
  certificateReuploadRequested:
    'We could not read your certificate clearly. Please upload a clearer certificate photo or PDF.',
  certificateCvUploaded:
    'You have sent a CV. To continue onboarding, please upload your certificate photo or certificate PDF.',
  certificateWrongImageUploaded:
    'The image you sent does not look like a certificate. To continue onboarding, please upload your certificate.',
  certificateRejectedPermanent:
    'Sorry, based on the current review, this onboarding application cannot continue. You can contact the office if you need help later.',
  callReviewRejected:
    'Thank you. We cannot take your application forward now. Thank you for your interest.',
  /* The English half of the same message. The Malayalam is the founder's own
     wording; this renders it, and the company block below is identical. */
  experienceCertificateNotice:
    '*\ud83d\udcc4 Experience Certificate*\n\nCaregivers / Nursing Professionals who complete 180 days of duty with Pulso in total will receive the official Experience Certificate of Pulso Global Private Limited, which works in the healthcare \u0026 senior care sector.\n\nPulso Global Private Limited\nHealthcare \u0026 Senior Care Services\nCIN: U86201KL2023PTC084619\nRegistered Office: JC Chambers, Panampilly Nagar, Ernakulam, Kerala \u2013 682036\n\ud83c\udf10 pulso.co.in',
  termsIntro:
    `Before joining Pulso, please read all instructions carefully.\n\n1. After accepting your first duty, you need to collect a uniform kit worth Rs 1999.\nThis kit includes one pair of uniform and one ID card.\n\nAfter completing at least 90 days of duty with us, if you return the uniform to the office, the full Rs 1999 will be refunded.\n\nIf you need one additional pair of uniform, you can buy it by paying Rs 1250.\nThis extra uniform amount is not refundable.\n\nPayment option:\nIf you are unable to pay Rs 1999 for the uniform kit at once, you can pay it through deduction from your first 4 days of duty payment. Rs 500 will be deducted per day for the first 3 duty days, and Rs 499 will be deducted on the 4th duty day.\n\n2. Please note: you are not a permanent salaried employee of Pulso. You will receive payment only for the days you work. Pulso shares duty/job opportunities with you. If you accept and complete a duty successfully, you will receive the applicable payment. You will not receive salary or payment for days you do not work. Payment for completed work will be given daily.\n\n3. We will share available duty offers with you. Please read each duty offer carefully. You can accept or decline. But after accepting a duty, last-minute cancellation makes it difficult for us to arrange another provider. Providers who cancel after accepting may be blocked from accepting future duty offers.`,
  termsQuestion: 'Do you accept the terms and conditions?',
  termsReminder:
    'You have not accepted the terms and conditions yet. To complete onboarding, please reply "continue".',
  termsReminderResume:
    'Thank you. Sending the terms acceptance options again.',
  termsAccepted:
    'Thank you. Your onboarding is complete.\n\nWe will start sending you duty offers. After 180 days of duty you will receive an experience certificate from Pulso Global Private Limited. You have completed 0 days so far.',
  termsDeclined: 'Okay. If you are interested later, you can message us again.',
  postOnboardingSupport:
    'From now onwards, available duty offers will be sent to you through the Pulso app.\n\nPlease read each duty offer carefully.\n\nIf a duty is suitable for you, you can accept it through the Pulso app.\n\nIf a duty is not suitable, you can reject or ignore it.',
  mobileAppCampaignAnnouncement:
    'Important notice:\n\nFor duty confirmation, check-in, check-out, attendance tracking, duty completion, and payment processing, Pulso mobile app is required.\n\nTo receive and complete duties, you must install the Pulso mobile app and keep your profile active.\n\nPlease install the app using the same phone number used for WhatsApp onboarding.\n\nWithout app activation, duty allocation may be delayed or unavailable.',
  pulsoAppPreferenceNotice:
    'Important notice:\n\nFor duty confirmation, check-in, check-out, attendance tracking, duty completion, and payment processing, Pulso mobile app is required.\n\nTo receive and complete duties, you must install the Pulso mobile app and keep your profile active.\n\nPlease install the app using the same phone number used for WhatsApp onboarding.\n\nWithout app activation, duty allocation may be delayed or unavailable.',
  pulsoDutyAcceptVideoCaption:
    'Watch this video to see how to check duty offers and accept suitable duties in the Pulso app.',
  pulsoAppActivationInstruction:
    'To receive and accept duties, please install the Pulso app and log in using the same phone number used for WhatsApp onboarding.',
  pulsoAppActivationVideoCaption:
    'Watch this video to see how to install/login and activate your Pulso app profile.',
  pulsoAppInstallQuestion: 'Which phone do you use?',
  pulsoAppInstallRetry: 'Please select one option from below.',
  // The Duty Card, in English. Same content as the Malayalam.
  agencyQuestion:
    'Are you currently doing duty through any Home Care Agency / Caregiving Company?',
  agencyYes:
    'Good 👍\n\nYou can add the duty you are doing now in the Pulso App. We will verify the duty details you give with the agency.\n\nOnce the duty is verified, you get:\n\n✓ Every verified duty day counts towards Pulso\u2019s 180-day Experience Certificate.\n\n✓ Complete 10 continuous days of duty and get a 5-star rating from the agency, and you receive a ₹100 reward.\n\n✓ As your Verified Duty Days grow, your Duty Ranking on Pulso rises, which improves your chance of getting new duties.',
  addDutyInterestQuestion:
    'Would you like to add the duty you are doing now in the Pulso App?',
  addDutyProcedure:
    'How to add a duty in the Pulso App:\n\n1️⃣ Open the Pulso App\n2️⃣ Tap "Add my duty" on the home screen\n3️⃣ Enter these details:\n   • The agency\u2019s name\n   • The agency\u2019s phone number — enter the number shown on Google (search the agency name on Google Maps to find it)\n   • Search and select the duty area on the map\n   • The date the duty started\n   • The date the duty ends\n   • Duty type (24 hour / Day / Night)\n4️⃣ Tap Send\n\nYour agency will get a WhatsApp message from Pulso. After the agency taps "Yes", the Pulso team verifies the agency. You will get a message once verified, and the duty count starts from then.\n\nEvery day, check in with a selfie in the Pulso App from the duty location. Only checked-in days are counted.\n\nTip: before adding the duty, tell your agency — "A verification message will come from Pulso, please tap Yes."',
  addDutyInstallFirst:
    'First install the Pulso App and log in with the same number you used for onboarding.',
  addDutyLater:
    'Okay. Message "duty" at any time and we will send these steps again.',
  agencyQuestionRetry: 'Please select one option from below.',
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
    'For help, you can call the office number 8714105333 between 10 AM and 6 PM.\nYou can send a WhatsApp message to +91 77361 29809 at any time.\nWe are always ready to help you. 👍🏼',
  postOnboardingLinks:
    'Head Office Details\nPulso Elderly Care\n14/455-N4, 1st Floor,\nAmbeel Galleria, Near BSNL Office,\nKangarappady, Kochi, Kerala - 682021\nPhone: +91 87141 05333\nLocation: https://share.google/MWyrmA6XvDInViFkq\n\nWebsite:\nhttps://www.pulso.co.in/',
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
  appInstalledTitle: 'Yes, installed',
  appLaterTitle: 'Not installed',
  appHelpInstallTitle: 'Install help',
  appHelpLoginOtpTitle: 'Login / OTP issue',
  appHelpNoSmartphoneTitle: 'Smartphone ഇല്ല',
  agencyYesTitle: 'ഉണ്ട്',
  agencyNoTitle: 'ഇല്ല',
  addDutyNowTitle: 'ഉണ്ട്',
  addDutyLaterTitle: 'പിന്നീട്',
  detailsCorrectTitle: 'ശരിയാണ്',
  detailsChangeTitle: 'മാറ്റണം',
  detailsChangeButtonText: 'തിരഞ്ഞെടുക്കുക',
  detailsChangeSectionTitle: 'വിവരങ്ങൾ',
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
  appInstalledTitle: 'Yes, installed',
  appLaterTitle: 'Not installed',
  appHelpInstallTitle: 'Install help',
  appHelpLoginOtpTitle: 'Login / OTP issue',
  appHelpNoSmartphoneTitle: 'No smartphone',
  agencyYesTitle: 'Yes',
  agencyNoTitle: 'No',
  addDutyNowTitle: 'Yes',
  addDutyLaterTitle: 'Later',
  detailsCorrectTitle: 'Correct',
  detailsChangeTitle: 'Change',
  detailsChangeButtonText: 'Select',
  detailsChangeSectionTitle: 'Your details',
  districtPageSize: 8
};

// Region and language are chosen separately, so each language set needs a copy
// carrying the other region's facts. Only the duty area and the sample duty
// locations actually differ; everything else is language, not region. Swapping
// by assertion keeps the two copies honest — if the source wording is edited and
// this marker moves, the process fails at load instead of quietly telling a
// Kerala caregiver their duty is in Bengaluru.
function swapExact(source, from, to) {
  if (!String(source).includes(from)) {
    throw new Error(`Text marker not found, cannot build variant: "${from}"`);
  }
  return String(source).split(from).join(to);
}

const KERALA_ENGLISH_MESSAGES = {
  ...ENGLISH_BASE_MESSAGES,
  workingModel: swapExact(
    ENGLISH_BASE_MESSAGES.workingModel,
    'Duty location can be anywhere in Karnataka',
    'Duty location can be anywhere in Kerala'
  ),
  sampleDutyOffer8Hour: swapExact(
    ENGLISH_BASE_MESSAGES.sampleDutyOffer8Hour,
    'Location: Bengaluru',
    'Location: Thevakkal, Ernakulam'
  ),
  sampleDutyOffer24Hour: swapExact(
    ENGLISH_BASE_MESSAGES.sampleDutyOffer24Hour,
    'Location: Bengaluru',
    'Location: Vennala, Ernakulam'
  )
};

/* ---- Bengaluru (Oct 2026): the agency working model ------------------------
   In Bengaluru the duty comes from a home-care agency, the agency fixes the
   rate (never below the minimum on the card), and the agency pays the
   caregiver directly, cash or UPI, on a day the two of them fix. Pulso holds no
   money there, so "credited daily to your account" would be untrue, and the
   uniform kit is not part of the Bengaluru terms (founder, 10 Oct 2026). The
   two rate lines below are WORKING_MODEL_MARKERS and are rewritten per band at
   runtime, exactly as in the Kerala text; reword them only with that table.
   Plan: pulso_hub docs/bangalore_agency_bot_flow_plan.md. */
const BENGALURU_WORKING_MODEL_EN = `Pulso Global Private Limited is a home care company. In Bengaluru we give caregivers and nurses to home-care agencies, for the agencies' patients.

GDA staff, caregivers, and nurses can join Pulso. If you are interested, we will send duty offers to you through Pulso mobile app

Duty details:

1. Duty location can be anywhere in Bengaluru
2. Duty timing may be 8 hours or 24 hours
3. 8-hour duty timing will usually be from morning 8 am to evening 4pm
4. Duty duration may be 1 week, 2 weeks, 1 month, or more depending on the case
5. For 24-hour duty, stay and food will be given at the patient's home by the patient's family, through your agency
6. For 8-hour duty, stay will not be provided
7. For 8-hour duty, you will receive Rs 600 to Rs 900 per day
8. For 24-hour duty, you will receive Rs 750 to Rs 1000 per day
9. The agency fixes the rate for each duty. The rate is on every offer. You get the full amount
10. The agency pays you directly, by cash or UPI. Fix the payment day with the agency before you start. Pulso does not collect or hold your pay
11. You will receive payment only for the days you work
12. There will be no housemaid work. Only patient care duties

Working model:

1. Duty offers from home-care agencies will be sent through Pulso App
2. You can accept only the duties you are interested in
3. If you are not interested in a duty, you can reject or ignore it
4. After you accept a duty, you get the agency's name and a Call button in the app. The agency can call you too
5. On the start day, go to the patient's house. The agency gives you a 4-digit PIN. Type it in the app to start the duty
6. Check in every day from the app with a selfie
7. You should start duty on time and provide care responsibly

Emergency leave:

If you need emergency leave, tell the agency and Pulso from the app. Pulso will try to arrange another staff member.

Important:

- Accepting or rejecting a duty offer is completely your choice
- You only need to accept duties you are interested in
- There is no registration fee to join Pulso

Head Office Address:
Pulso Elderlycare, cochin, kerala - 682036`;

const BENGALURU_SAMPLE_24H_EN = `Booked by: Sahaya Home Care (home-care agency)

Patient: Elderly female, 71 years
Condition: Supportive care

Care Level: Assisted care with walker support

Duty: 24-hour care

Duration: 1 month

Location: Jayanagar, Bengaluru

Care Needed:
- Washroom support
- Bed making
- Assistance while feeding
- Helping with medicines
- Assistance in lifting and walking using walker
- Assistance during physiotherapy exercises

Earnings:
Rs {{payout24h}} per day, fixed by the agency
Rs {{total24h}} for 30 days
The agency pays you directly

Safety and Support:
- Agency verified by Pulso
- Call the agency from the app
- Pulso support available during duty`;

const BENGALURU_SAMPLE_8H_EN = `Booked by: Sahaya Home Care (home-care agency)

Patient: Female, 65 years

Condition: Post-surgery recovery

Care Type: Home supportive care

Duty: 8 hours

Duration: Continuous

Location: Jayanagar, Bengaluru

Care Needed:
- Walking / mobility support
- Assistance with daily activities
- Washroom support if needed
- Helping with medicines
- General supervision and comfort care

Earnings:
Rs {{payout8h}} per day, fixed by the agency
The agency pays you directly

Support:
- Agency verified by Pulso
- Call the agency from the app
- Pulso support available during duty`;

const BENGALURU_TERMS_EN = `Before joining Pulso, please read all instructions carefully.

1. Please note: you are not a permanent salaried employee of Pulso. Pulso shares duty offers from home-care agencies in Bengaluru. If you accept and complete a duty, the agency pays you for the days you work, directly, by cash or UPI, on the day you and the agency agree. Pulso does not collect or hold your pay. You will not receive salary or payment for days you do not work.

2. We will share available duty offers with you. Please read each duty offer carefully. You can accept or decline. But after accepting a duty, last-minute cancellation makes it difficult for the agency and for us to arrange another provider. Providers who cancel after accepting may be blocked from accepting future duty offers.`;

const KARNATAKA_MESSAGES = {
  ...ENGLISH_BASE_MESSAGES,
  workingModel: BENGALURU_WORKING_MODEL_EN,
  sampleDutyOffer24Hour: BENGALURU_SAMPLE_24H_EN,
  sampleDutyOffer8Hour: BENGALURU_SAMPLE_8H_EN,
  termsIntro: BENGALURU_TERMS_EN
};

/* The same four texts in Malayalam. Drafts in the founder's style (Oct 2026);
   the founder's own words replace them line for line. */
const BENGALURU_WORKING_MODEL_ML = `**Pulso Global Private Limited** ഒരു homecare കമ്പനിയാണ്. Bengaluru-വിൽ ഞങ്ങൾ home-care agency-കൾക്ക് അവരുടെ patient-മാർക്കായി caregiver-മാരെയും nurse-മാരെയും നൽകുന്നു.

GDA (General Duty Assistant) staff-നും nurse-നും ഞങ്ങളോടൊപ്പം join ചെയ്യാൻ കഴിയും. നിങ്ങൾ interested ആണെങ്കിൽ ഞങ്ങൾ നിങ്ങൾക്ക് Pulso App വഴി duty offers അയച്ചു തരും.

**Duty details:**

1. Duty area Bengaluru-വിൽ എവിടെയും ആയിരിക്കാം
2. Duty timing 8 hours, 24 hours എന്നീ രീതികളിലായിരിക്കും
3. 8 hours duty സമയം രാവിലെ 8 മണി മുതൽ വൈകുന്നേരം 4 മണിവരെ ആയിരിക്കും
4. Duty duration 1 week, 2 week, 1 month എന്നിങ്ങനെ വ്യത്യാസപ്പെടാം
5. 24 hours duty-ക്ക് patient-ന്റെ വീട്ടിൽ stay-യും food-ും ലഭിക്കും (patient-ന്റെ family, നിങ്ങളുടെ agency വഴി)
6. 8 hour duty-ക്ക് stay ഉണ്ടായിരിക്കില്ല
7. 8 മണിക്കൂർ ഡ്യൂട്ടിക്ക് ദിവസത്തിൽ ₹600 മുതൽ ₹900 വരെ ലഭിക്കും
8. 24 മണിക്കൂർ ഡ്യൂട്ടിക്ക് ദിവസത്തിൽ ₹750 മുതൽ ₹1000 വരെ ലഭിക്കും
9. ഓരോ duty-യുടെയും rate agency ആണ് നിശ്ചയിക്കുന്നത്. Rate എല്ലാ offer-ിലും കാണാം. മുഴുവൻ തുകയും നിങ്ങൾക്കാണ്
10. Agency നേരിട്ട് നിങ്ങൾക്ക് payment നൽകും, cash അല്ലെങ്കിൽ UPI. Duty തുടങ്ങും മുമ്പ് payment ദിവസം agency-യുമായി ഉറപ്പിക്കുക. Pulso നിങ്ങളുടെ payment വാങ്ങുകയോ കൈവശം വയ്ക്കുകയോ ചെയ്യുന്നില്ല
11. നിങ്ങൾ work ചെയ്യുന്ന ദിവസങ്ങളിൽ മാത്രമായിരിക്കും payment ലഭിക്കുക
12. House maid ജോലി ഉണ്ടായിരിക്കില്ല. Patient care duties മാത്രം ആയിരിക്കും

**Working model:**

1. Home-care agency-കളുടെ duty offers Pulso App വഴി ലഭിക്കും
2. നിങ്ങൾക്ക് താല്പര്യമുള്ള duty-കൾ മാത്രം accept ചെയ്യാം
3. താല്പര്യമില്ലെങ്കിൽ reject ചെയ്യാം അല്ലെങ്കിൽ ignore ചെയ്യാം
4. Duty accept ചെയ്താൽ agency-യുടെ പേരും Call button-ും app-ിൽ കാണാം. Agency-ക്കും നിങ്ങളെ വിളിക്കാം
5. Duty തുടങ്ങുന്ന ദിവസം patient-ന്റെ വീട്ടിൽ പോകുക. Agency 4-digit PIN തരും. അത് app-ിൽ type ചെയ്ത് duty തുടങ്ങുക
6. എല്ലാ ദിവസവും app-ിൽ selfie എടുത്ത് check in ചെയ്യുക
7. സമയത്തിന് duty ആരംഭിച്ച് ഉത്തരവാദിത്വത്തോടെ care നൽകണം

**Emergency leave:**

Emergency leave ആവശ്യമായി വന്നാൽ agency-യെയും Pulso-യെയും app വഴി അറിയിക്കുക. വേറെ staff-നെ ഞങ്ങൾ arrange ചെയ്യാൻ ശ്രമിക്കും.

**ശ്രദ്ധിക്കുക:**

- Duty offer accept ചെയ്യണോ വേണ്ടയോ എന്നത് മുഴുവൻ നിങ്ങളുടെ ഇഷ്ടമാണ്
- ഇഷ്ടമുള്ള duty-കൾ മാത്രം സ്വീകരിച്ചാൽ മതി
- ഇതിനായി പ്രത്യേക registration fee ഒന്നും നൽകേണ്ടതില്ല

**Office Address:**
Pulso Elderlycare, Kalamassery, Kochi - 682021`;

const BENGALURU_TERMS_ML = `ഞങ്ങളോടൊപ്പം ചേരുന്നതിന് മുമ്പ് താഴെ നൽകിയിരിക്കുന്ന എല്ലാ നിർദേശങ്ങളും ദയവായി വായിക്കുക.

1. ദയവായി ശ്രദ്ധിക്കുക: നിങ്ങൾ ഞങ്ങളുടെ സ്ഥിരം ശമ്പള ജീവനക്കാരൻ അല്ല. Bengaluru-വിലെ home-care agency-കളുടെ ഡ്യൂട്ടി ഓഫറുകളാണ് Pulso നിങ്ങൾക്ക് നൽകുന്നത്. ഡ്യൂട്ടി സ്വീകരിച്ച് പൂർത്തിയാക്കിയാൽ, നിങ്ങൾ ജോലി ചെയ്ത ദിവസങ്ങളുടെ പേയ്മെന്റ് agency നേരിട്ട് നിങ്ങൾക്ക് നൽകും, cash അല്ലെങ്കിൽ UPI വഴി, നിങ്ങളും agency-യും തീരുമാനിക്കുന്ന ദിവസം. Pulso നിങ്ങളുടെ പേയ്മെന്റ് വാങ്ങുകയോ കൈവശം വയ്ക്കുകയോ ചെയ്യുന്നില്ല. ജോലി ചെയ്യാത്ത ദിവസങ്ങളിൽ ശമ്പളമോ മറ്റ് പേയ്മെന്റുകളോ ലഭിക്കില്ല. നിങ്ങളുടെ സഹകരണത്തിനും വിശ്വാസത്തിനും നന്ദി.

2. അടുത്ത ലഭ്യമായ ഡ്യൂട്ടി ഞങ്ങൾ ഷെയർ ചെയ്യുന്നതായിരിക്കും. ഡ്യൂട്ടി ഓഫർ ദയവായി ശ്രദ്ധാപൂർവ്വം വായിക്കുക. നിങ്ങൾക്ക് Accept ചെയ്യുകയോ Decline ചെയ്യുകയോ ചെയ്യാം. എന്നാൽ Accept ചെയ്തതിന് ശേഷം Cancel ചെയ്യുന്നത്, agency-ക്കും ഞങ്ങൾക്കും ലാസ്റ്റ് മിനിറ്റിൽ മറ്റൊരാളെ കണ്ടെത്താൻ വളരെ ബുദ്ധിമുട്ടുണ്ടാക്കും. അതിനാൽ ഇങ്ങനെ Cancel ചെയ്യുന്നവർക്ക് ഭാവിയിലെ ഡ്യൂട്ടി ഓഫറുകൾ Accept ചെയ്യുന്നതിൽ നിന്ന് സ്ഥിരമായി Block ചെയ്യുന്നതായിരിക്കും.`;

/* The Malayalam sample offers keep the Kerala layout and swap in the
   Bengaluru facts: the place, who booked, and the Support block. swapExact
   throws at load if the Kerala source is reworded under these markers. */
function bengaluruMlSample(source, placeFrom) {
  let t = swapExact(source, placeFrom, 'Jayanagar, Bengaluru');
  t = swapExact(t, '✔ Family verified\n✔ Payment guaranteed', '✔ Agency verified by Pulso\n✔ Agency pays you directly (cash / UPI)');
  return `Booked by: Sahaya Home Care (home-care agency)\n\n${t}`;
}
const KARNATAKA_MALAYALAM_MESSAGES = {
  ...MESSAGES,
  workingModel: BENGALURU_WORKING_MODEL_ML,
  termsIntro: BENGALURU_TERMS_ML,
  sampleDutyOffer8Hour: bengaluruMlSample(MESSAGES.sampleDutyOffer8Hour, 'Thevakkal, Ernakulam'),
  sampleDutyOffer24Hour: bengaluruMlSample(MESSAGES.sampleDutyOffer24Hour, 'Vennala (nearby)')
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
  kerala_english: {
    id: 'kerala_english',
    region: 'kerala',
    language: 'en',
    MESSAGES: KERALA_ENGLISH_MESSAGES,
    QUALIFICATIONS: ENGLISH_QUALIFICATIONS,
    DISTRICTS,
    UI_TEXT: KARNATAKA_UI_TEXT
  },
  karnataka_malayalam: {
    id: 'karnataka_malayalam',
    region: 'karnataka',
    language: 'ml',
    MESSAGES: KARNATAKA_MALAYALAM_MESSAGES,
    QUALIFICATIONS,
    DISTRICTS: KARNATAKA_DISTRICTS,
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

// The flow a record falls back to when a region is known but the language
// question has not been answered — today's behaviour for every existing record.
const DEFAULT_FLOW_ID_BY_REGION = {
  kerala: 'kerala_malayalam',
  karnataka: 'karnataka_english'
};

function getFlowIdFor(region, language) {
  const flow = Object.values(FLOWS).find((item) => item.region === region && item.language === language);
  return flow ? flow.id : null;
}

const DEFAULT_FLOW_ID = 'kerala_malayalam';
const flowStorage = new AsyncLocalStorage();

function getFlowConfig(flowId) {
  return FLOWS[flowId] || FLOWS[DEFAULT_FLOW_ID];
}

function getProviderFlowId(provider) {
  return provider && provider.flowId ? provider.flowId : DEFAULT_FLOW_ID;
}

// GNM and BSc Nursing are offered a higher band than the caregiver grades.
// The qualification is answered before the working model is sent, so the rate
// the person reads is already the one that applies to them.
const NURSE_QUALIFICATIONS = ['gnm', 'bsc_nursing'];

function isNurseQualification(qualification) {
  return NURSE_QUALIFICATIONS.includes(String(qualification || '').toLowerCase());
}

// The Basic band: no certificate, taken on for practical experience. Both the
// claimed value (`no_certificate`, what she picked) and the approved one
// (`basic_caregiver`, what the reviewer chose) read the Basic figures, so she
// never sees a rate she will not be paid — the GDA text was what she got until
// 27 Sep 2026, ₹900/₹1200 against a real ₹600/₹750.
const BASIC_QUALIFICATIONS = ['basic_caregiver', 'no_certificate', 'nursing_student'];

function isBasicQualification(qualification) {
  return BASIC_QUALIFICATIONS.includes(String(qualification || '').toLowerCase());
}

const BASIC_TIER_AGE_DEFAULT = 50;
const RATE_BANDS = ['basic', 'gda', 'nurse'];

/* A record can say what she is and what she is paid separately: a 52-year-old
   GNM is a nurse on the Basic rate, not a "Basic Caregiver". `careTier` is the
   stored decision and wins; the hub's tierForProvider reads the same field the
   same way. Age comes next, because it is a pay rule rather than a statement
   about her qualification. Only then does the certificate decide. */
function normalizeBand(value) {
  const band = String(value || '').trim().toLowerCase();
  return RATE_BANDS.includes(band) ? band : null;
}

function basicTierAgeThreshold(tiers) {
  const n = Math.round(Number(tiers && tiers.basicTierAgeThreshold));
  return Number.isFinite(n) && n > 0 ? n : BASIC_TIER_AGE_DEFAULT;
}

function isOverBasicTierAge(age, tiers) {
  const n = Math.round(Number(age));
  return Number.isFinite(n) && n > 0 && n > basicTierAgeThreshold(tiers);
}

/* Accepts a qualification string or the whole record. The string form is what
   a caller with nothing else has; the record form is the one that can see age
   and careTier, and is what every message path should pass. */
function subjectOf(value) {
  return value && typeof value === 'object' ? value : { qualification: value || null };
}

function rateBandFor(subject, tiers) {
  const who = subjectOf(subject);
  const stored = normalizeBand(who.careTier);
  if (stored) return stored;
  if (isOverBasicTierAge(who.age, tiers)) return 'basic';
  if (isNurseQualification(who.qualification)) return 'nurse';
  if (isBasicQualification(who.qualification)) return 'basic';
  return 'gda';
}

// Three bands, figures from app_config/provider_tiers (defaults when the doc is
// unreadable, so a message never quotes ₹0). GDA and above is a range — Basic
// pay to GDA pay — because a GDA is reachable by Basic-tier offers as well as
// her own (founder's decision, 26 Sep 2026). Basic is flat: she is never offered
// more. Nurse is flat too, and is no longer the older hand-written range — the
// founder repriced all three bands on 28 Sep 2026 and a hardcoded nurse line
// would have been the one figure left quoting the old money.
const TIER_FALLBACK = {
  basic: { payout24h: 600, payout8h: 500 },
  gda: { payout24h: 700, payout8h: 600 },
  nurse: { payout24h: 1400, payout8h: 1200 }
};

/**
 * What the GDA band is TOLD, as against what a booking is priced at.
 *
 * `payout24h` 700 is the floor Pulso will allow, not the wage. Of the 131
 * bookings made since 1 July 2026, 76 of the 101 twenty-four-hour duties paid
 * the caregiver ₹1,200 a day and the eight-hour ones sat around ₹900-960 —
 * the agency sets its own rate above the floor. Quoting the floor as the wage
 * cost us people who were being offered ₹1,200 the same week.
 *
 * So the band quotes a range the market really pays, and the sample duty offer
 * uses a figure inside it — deliberately below the top, so the first real offer
 * is a pleasant surprise rather than a let-down. The founder set these on
 * 30 Sep 2026. Overridable per figure from app_config/provider_tiers.
 */
const GDA_SHOWN_FALLBACK = {
  shownFrom8h: 800, shownTo8h: 900,
  shownFrom24h: 900, shownTo24h: 1200,
  sample8h: 800, sample24h: 1000
};

/**
 * What the Basic band is TOLD. The founder set ₹650 for 8 hours and ₹750 for
 * 24 hours on 3 Oct 2026 for the bot only — the payout floor in
 * app_config/provider_tiers (500/600) stays where it is, so bookings still
 * price from the floor. Overridable per figure as tiers.basic.shown8h /
 * shown24h in that doc.
 */
const BASIC_SHOWN_FALLBACK = { shown8h: 650, shown24h: 750 };

function tierFigures(tiers) {
  const t = tiers && typeof tiers === 'object' ? tiers : {};
  const pick = (name, key) => {
    const n = Math.round(Number((t[name] || {})[key]));
    return Number.isFinite(n) && n > 0 ? n : TIER_FALLBACK[name][key];
  };
  const shown = (key) => {
    const n = Math.round(Number((t.gda || {})[key]));
    return Number.isFinite(n) && n > 0 ? n : GDA_SHOWN_FALLBACK[key];
  };
  const basicShown = (key) => {
    const n = Math.round(Number((t.basic || {})[key]));
    return Number.isFinite(n) && n > 0 ? n : BASIC_SHOWN_FALLBACK[key];
  };
  return {
    b8: basicShown('shown8h'), b24: basicShown('shown24h'),
    g8: pick('gda', 'payout8h'), g24: pick('gda', 'payout24h'),
    n8: pick('nurse', 'payout8h'), n24: pick('nurse', 'payout24h'),
    gFrom8: shown('shownFrom8h'), gTo8: shown('shownTo8h'),
    gFrom24: shown('shownFrom24h'), gTo24: shown('shownTo24h'),
    gSample8: shown('sample8h'), gSample24: shown('sample24h')
  };
}

// The working model quotes the rate inside one long block, so the band's two
// lines are swapped in by exact match. The markers are the GDA-range lines as
// written in MESSAGES.workingModel; swapExact throws if either is reworded
// without this table, rather than silently sending the wrong band.
const WORKING_MODEL_MARKERS = {
  ml: [
    '8 മണിക്കൂർ ഡ്യൂട്ടിക്ക് ദിവസത്തിൽ ₹600 മുതൽ ₹900 വരെ ലഭിക്കും',
    '24 മണിക്കൂർ ഡ്യൂട്ടിക്ക് ദിവസത്തിൽ ₹750 മുതൽ ₹1000 വരെ ലഭിക്കും'
  ],
  en: [
    'For 8-hour duty, you will receive Rs 600 to Rs 900 per day',
    'For 24-hour duty, you will receive Rs 750 to Rs 1000 per day'
  ]
};

/**
 * Said right under the pay figures, to every band.
 *
 * Founder's ask, 9 Oct 2026: a caregiver reading ₹750 a day should also read
 * that it is a starting point — more days worked and good ratings can lift it.
 * It sits beside the money in both places the money is shown, because that is
 * the moment she is deciding whether ₹750 is worth it.
 */
const EARNINGS_GROWTH_LINE = {
  ml: 'Pulso-യിൽ കൂടുതൽ ദിവസങ്ങൾ duty ചെയ്യുകയും നല്ല rating നേടുകയും ചെയ്താൽ, പിന്നീട് വേതനം കൂടാൻ അവസരമുണ്ട്.',
  en: 'With more days of duty and good ratings on Pulso, you may be offered higher pay later.'
};

function earningsGrowthLine(language) {
  return language === 'ml' ? EARNINGS_GROWTH_LINE.ml : EARNINGS_GROWTH_LINE.en;
}

/** "₹650 മുതൽ ₹900 വരെ", or just "₹650" when the two ends meet. */
function mlRange(from, to) {
  return from === to ? `₹${from}` : `₹${from} മുതൽ ₹${to} വരെ`;
}

function enRange(from, to) {
  return from === to ? `Rs ${from}` : `Rs ${from} to Rs ${to}`;
}

function workingModelRateLines(band, language, f) {
  /* 24 hours first, then 8 — founder's order, 9 Oct 2026. The two lines land
     on the founder's numbered points 7 and 8 in that order, and the growth
     sentence rides on the second of them so it still reads after both
     figures. */
  if (language === 'ml') {
    if (band === 'nurse') {
      return [
        `24 മണിക്കൂർ ഡ്യൂട്ടിക്ക് ദിവസത്തിൽ ₹${f.n24} ലഭിക്കും`,
        `8 മണിക്കൂർ ഡ്യൂട്ടിക്ക് ദിവസത്തിൽ ₹${f.n8} ലഭിക്കും. ${earningsGrowthLine('ml')}`
      ];
    }
    if (band === 'basic') {
      return [
        `24 മണിക്കൂർ ഡ്യൂട്ടിക്ക് ദിവസത്തിൽ ₹${f.b24} ലഭിക്കും`,
        `8 മണിക്കൂർ ഡ്യൂട്ടിക്ക് ദിവസത്തിൽ ₹${f.b8} ലഭിക്കും. ${earningsGrowthLine('ml')}`
      ];
    }
    /* A range whose two ends are the same figure is one figure (mlRange). */
    return [
      `24 മണിക്കൂർ ഡ്യൂട്ടിക്ക് ദിവസത്തിൽ ${mlRange(f.gFrom24, f.gTo24)} ലഭിക്കും`,
      `8 മണിക്കൂർ ഡ്യൂട്ടിക്ക് ദിവസത്തിൽ ${mlRange(f.gFrom8, f.gTo8)} ലഭിക്കും. ${earningsGrowthLine('ml')}`
    ];
  }
  if (band === 'nurse') {
    return [`For 24-hour duty, you will receive Rs ${f.n24} per day`, `For 8-hour duty, you will receive Rs ${f.n8} per day. ${earningsGrowthLine('en')}`];
  }
  if (band === 'basic') {
    return [`For 24-hour duty, you will receive Rs ${f.b24} per day`, `For 8-hour duty, you will receive Rs ${f.b8} per day. ${earningsGrowthLine('en')}`];
  }
  return [
    `For 24-hour duty, you will receive ${enRange(f.gFrom24, f.gTo24)} per day`,
    `For 8-hour duty, you will receive ${enRange(f.gFrom8, f.gTo8)} per day. ${earningsGrowthLine('en')}`
  ];
}

/**
 * A sample duty offer at the rate this band is actually paid.
 *
 * The samples used to quote ₹1200 a day to everybody — the GDA rate, retired
 * on 26 Sep 2026 — while the pay summary sent moments earlier told a Basic
 * caregiver ₹750. Two numbers in one conversation, and the sample's is the one
 * with a patient and a date attached, so it is the one she remembers.
 *
 * The month is computed, never written. `₹36000` was typed once and outlived
 * two repricings; a total that derives from the rate cannot do that again.
 */
const SAMPLE_MONTH_DAYS = 30;

function sampleDutyRates(band, f) {
  if (band === 'nurse') return { day8: f.n8, day24: f.n24 };
  if (band === 'basic') return { day8: f.b8, day24: f.b24 };
  /* Inside the quoted range, not at the floor and not at the top: the sample is
     a picture of an ordinary duty, and ₹1,000 × 30 is the ₹30,000 the poster
     promises. */
  return { day8: f.gSample8, day24: f.gSample24 };
}

function getSampleDutyOfferFor(qualification, tiers, choice) {
  if (choice !== '24_hour' && choice !== '8_hour') return null;
  const flow = getActiveFlow();
  const template = choice === '24_hour'
    ? flow.MESSAGES.sampleDutyOffer24Hour
    : flow.MESSAGES.sampleDutyOffer8Hour;
  if (!template) return null;

  /* No blank-rate guard here, unlike getTermsRateFor: tierFigures substitutes
     TIER_FALLBACK for anything zero or unreadable, so these are always real
     figures. A throw would look like protection while never firing. */
  const { day8, day24 } = sampleDutyRates(rateBandFor(qualification, tiers), tierFigures(tiers));
  return String(template)
    .split('{{payout8h}}').join(String(day8))
    .split('{{payout24h}}').join(String(day24))
    .split('{{total24h}}').join(String(day24 * SAMPLE_MONTH_DAYS));
}

/**
 * The Basic-rate notice, or null when there is nothing to explain.
 *
 * Only for someone whose certificate would otherwise have earned more. A
 * caregiver with no course certificate is on the Basic rate for a reason that
 * has nothing to do with her age, and telling her about an age rule would be
 * both irrelevant and unkind.
 */
function getBasicTierAgeNoticeFor(subject, tiers) {
  const who = subjectOf(subject);
  if (!isOverBasicTierAge(who.age, tiers)) return null;
  if (rateBandFor({ qualification: who.qualification }, tiers) === 'basic') return null;
  const template = getActiveFlow().MESSAGES.basicTierAgeNotice;
  if (!template) return null;
  const f = tierFigures(tiers);
  return String(template)
    .split('{{ageThreshold}}').join(String(basicTierAgeThreshold(tiers)))
    .split('{{payout8h}}').join(String(f.b8))
    .split('{{payout24h}}').join(String(f.b24));
}

/**
 * A qualification changed at the details check to one paid at the Basic rate
 * (No certificate, Nursing student). The first time round she read the Basic
 * figures in the working model; a change at the check gets them in one line.
 */
function getBasicQualificationNoticeFor(subject, tiers) {
  const who = subjectOf(subject);
  if (rateBandFor({ qualification: who.qualification }, tiers) !== 'basic') return null;
  const template = getActiveFlow().MESSAGES.detailsQualificationBasicNotice;
  if (!template) return null;
  const f = tierFigures(tiers);
  return String(template)
    .split('{{payout8h}}').join(String(f.b8))
    .split('{{payout24h}}').join(String(f.b24));
}

/** The working model for the flow in play, at the rate this qualification earns. */
function getWorkingModelFor(qualification, tiers) {
  const flow = getActiveFlow();
  const band = rateBandFor(qualification, tiers);
  const markers = WORKING_MODEL_MARKERS[flow.language] || WORKING_MODEL_MARKERS.en;
  const lines = workingModelRateLines(band, flow.language, tierFigures(tiers));
  /* Two passes, through placeholders. A one-pass swap broke the day the card
     was set to the very figures the markers carry (GDA 24h 750–1000, 10 Oct
     2026): the first line swapped in matched the second marker word for word,
     so the second swap replaced both, and a GDA read two 8-hour lines and no
     24-hour line. */
  const parked = markers.reduce(
    (t, marker, i) => swapExact(t, marker, `\u0000RATE_LINE_${i}\u0000`),
    String(flow.MESSAGES.workingModel)
  );
  const text = parked.replace(/\u0000RATE_LINE_(\d)\u0000/g, (_, i) => lines[Number(i)]);
  return withNoCertificateLine(text, qualification, flow.MESSAGES);
}

/* The original "GDA staff and nurses can join" paragraph stays; a No
   certificate applicant also reads that she can join as a Basic Caregiver
   (founder, 9 Oct 2026), as its own paragraph right under it. */
function withNoCertificateLine(text, subject, messages) {
  const qualification = String(subjectOf(subject).qualification || '').toLowerCase();
  const line = messages && messages.workingModelNoCertificateLine;
  if (qualification !== 'no_certificate' || !line) return text;
  const at = ['\n\n**Duty details:**', '\n\nDuty details:']
    .map((marker) => text.indexOf(marker))
    .find((index) => index >= 0);
  if (at === undefined) return text;
  return `${text.slice(0, at)}\n\n${line}${text.slice(at)}`;
}

/**
 * The approval message for what the reviewer approved. A Basic caregiver's
 * document was NOT a certificate, so "your certificate has been verified"
 * would be untrue; they get their own line instead.
 */
function getCertificateApprovedFor(subject) {
  const messages = getActiveFlow().MESSAGES;
  /* Keyed on the qualification, not the band. A nurse placed on the Basic rate
     because of her age still uploaded a real certificate and it really was
     verified — telling her "your document has been reviewed" would take that
     away from her. Only someone with no course certificate gets the other
     line, because only for her is "your certificate is verified" untrue. */
  const qualification = String(subjectOf(subject).qualification || '').toLowerCase();
  if (qualification === 'basic_caregiver' && messages.certificateApprovedBasic) {
    return messages.certificateApprovedBasic;
  }
  return messages.certificateApproved;
}

/**
 * The rate line a Basic caregiver reads before accepting the terms, with the
 * figures filled from the tier matrix — or null for every other qualification,
 * whose terms are unchanged. Sent so the person accepts knowing the number.
 */
function getTermsRateFor(subject, tiers) {
  /* Keyed on the band, not the qualification: whoever is paid the Basic rate
     reads the Basic rate before accepting, however they got there. Which
     sentence explains it is a separate question — see termsRateBasicAge. */
  const who = subjectOf(subject);
  if (rateBandFor(who, tiers) !== 'basic') return null;
  const messages = getActiveFlow().MESSAGES;
  const isBasicQualified = String(who.qualification || '').toLowerCase() === 'basic_caregiver';
  const template = isBasicQualified ? messages.termsRateBasic : messages.termsRateBasicAge;
  if (!template) return null;
  const basic = (tiers && tiers.basic) || {};
  if (!basic.payout8h || !basic.payout24h) {
    throw new Error('Basic caregiver rate is not configured; refusing to send a blank rate');
  }
  // What Basic is told, not the payout floor — same figures as every other
  // Basic quote (tierFigures).
  const f = tierFigures(tiers);
  return String(template)
    .split('{{ageThreshold}}').join(String(basicTierAgeThreshold(tiers)))
    .split('{{payout8h}}').join(String(f.b8))
    .split('{{payout24h}}').join(String(f.b24));
}

/** The two-line pay summary shown with the duty-hours question, per band. */
function getDutyHourPaymentSummaryFor(qualification, tiers) {
  const flow = getActiveFlow();
  const messages = flow.MESSAGES;
  const band = rateBandFor(qualification, tiers);
  const f = tierFigures(tiers);
  const tail = `\n\n${earningsGrowthLine(flow.language)}`;
  // 24 hours first, then 8 — founder's order, 9 Oct 2026.
  if (flow.language === 'ml') {
    if (band === 'nurse') return `24 hour - ദിവസത്തിൽ ₹${f.n24}\n8 hour - ദിവസത്തിൽ ₹${f.n8}${tail}`;
    return band === 'basic'
      ? `24 hour - ദിവസത്തിൽ ₹${f.b24}\n8 hour - ദിവസത്തിൽ ₹${f.b8}${tail}`
      : `24 hour - ദിവസത്തിൽ ${mlRange(f.gFrom24, f.gTo24)}\n8 hour - ദിവസത്തിൽ ${mlRange(f.gFrom8, f.gTo8)}${tail}`;
  }
  if (band === 'nurse') return `24 hour - Rs ${f.n24} per day\n8 hour - Rs ${f.n8} per day${tail}`;
  return band === 'basic'
    ? `24 hour - Rs ${f.b24} per day\n8 hour - Rs ${f.b8} per day${tail}`
    : `24 hour - ${enRange(f.gFrom24, f.gTo24)} per day\n8 hour - ${enRange(f.gFrom8, f.gTo8)} per day${tail}`;
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
  LANGUAGE_OPTIONS,
  QUALIFICATIONS: ACTIVE_QUALIFICATIONS,
  DISTRICTS: ACTIVE_DISTRICTS,
  MESSAGES: ACTIVE_MESSAGES,
  UI_TEXT: ACTIVE_UI_TEXT,
  FLOWS,
  DEFAULT_FLOW_ID,
  DEFAULT_FLOW_ID_BY_REGION,
  getFlowIdFor,
  isNurseQualification,
  getWorkingModelFor,
  isBasicQualification,
  rateBandFor,
  getCertificateApprovedFor,
  getTermsRateFor,
  getBasicTierAgeNoticeFor,
  getBasicQualificationNoticeFor,
  getDutyHourPaymentSummaryFor,
  getSampleDutyOfferFor,
  getFlowConfig,
  getProviderFlowId,
  runWithFlow,
  runWithProviderFlow
};
