'use strict';
// "Nursing student" in the caregiver chat (founder, 3 Oct 2026): a row in the
// qualification list, the Basic rate band, a marks card instead of a course
// certificate, a call-based review like "No certificate", and the same second
// reviewer.
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.WHATSAPP_DRY_RUN = process.env.WHATSAPP_DRY_RUN || 'true';

const flow = require('../src/flow');
const ML = flow.FLOWS.kerala_malayalam;
const EN = flow.FLOWS.kerala_english;
const { parseQualification } = require('../src/services/messageParser');
const { tierForQualification } = require('../src/services/providerTiersConfig');
const ops = require('../src/services/opsNotifications');
const { buildCertificateRequestMessage } = require('../src/services/onboardingFlow');

const utf16 = (s) => Buffer.from(String(s), 'utf16le').length / 2;

test('the row sits just above "No certificate" in both lists and fits WhatsApp limits', () => {
  for (const list of [ML.QUALIFICATIONS, EN.QUALIFICATIONS]) {
    const ids = list.map((r) => r.id);
    const i = ids.indexOf(flow.BUTTON_IDS.QUALIFICATION_NURSING_STUDENT);
    assert.ok(i >= 0);
    assert.equal(ids[i + 1], flow.BUTTON_IDS.QUALIFICATION_NO_CERTIFICATE);
    assert.ok(list.length <= 10);
    assert.ok(utf16(list[i].title) <= 24, list[i].title);
    assert.ok(utf16(list[i].description) <= 72);
  }
  assert.equal(ML.QUALIFICATIONS.find((r) => r.id === flow.BUTTON_IDS.QUALIFICATION_NURSING_STUDENT).title, 'നഴ്സിംഗ് വിദ്യാർത്ഥി');
  assert.equal(EN.QUALIFICATIONS.find((r) => r.id === flow.BUTTON_IDS.QUALIFICATION_NURSING_STUDENT).title, 'Nursing student');
});

test('the tap and typed words both read as nursing_student, before GNM/BSc', () => {
  const tap = { type: 'interactive', interactive: { list_reply: { id: flow.BUTTON_IDS.QUALIFICATION_NURSING_STUDENT } } };
  assert.equal(parseQualification(tap), 'nursing_student');
  for (const body of ['Nursing student', 'nursing student GNM', 'Studying GNM / BSc / ANM', 'നഴ്സിംഗ് വിദ്യാർത്ഥി', 'waiting for registration', 'Studying GNM / BSc / ANM / waiting for registration']) {
    assert.equal(parseQualification({ type: 'text', text: { body } }), 'nursing_student', body);
  }
  assert.equal(parseQualification({ type: 'text', text: { body: 'GNM' } }), 'gnm');
});

test('she is on the Basic band', () => {
  assert.equal(tierForQualification('nursing_student'), 'basic');
});

test('she is asked for her marks card, by name, in both languages', () => {
  flow.runWithFlow('kerala_malayalam', () => {
    assert.match(buildCertificateRequestMessage({ qualification: 'nursing_student' }), /nursing course-ന്റെ marks card/);
  });
  flow.runWithFlow('kerala_english', () => {
    const ask = buildCertificateRequestMessage({ qualification: 'nursing_student' });
    assert.match(ask, /nursing course marks card/);
    assert.match(ask, /Not your CV or resume/);
  });
});

test('her review is the call-based one, and the template names her as a nursing student', () => {
  const p = { phone: '919000000301', fullName: 'Asha', age: 21, qualification: 'nursing_student', district: 'Kannur', dutyHourPreference: 'both' };
  assert.equal(ops.isNoCertificateProvider(p), true);
  assert.equal(ops.buildNoCertificateTemplateBodyValues(p, 'Mohamed Afiq')[0], 'Asha (nursing student)');
  assert.equal(ops.buildNoCertificateTemplateBodyValues({ ...p, qualification: 'no_certificate' }, '')[0], 'Asha');
});
