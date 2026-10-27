'use strict';
// CNA (Certified Nursing Assistant): UAE only, GDA band (founder, 27 Oct 2026).
process.env.WHATSAPP_DRY_RUN = 'true';

const test = require('node:test');
const assert = require('node:assert/strict');

const flow = require('../src/flow');
const { FLOWS, BUTTON_IDS } = flow;
const { parseQualification } = require('../src/services/messageParser');
const ops = require('../src/services/opsNotifications');
const { photoReviewCourseLabel } = ops;

const ids = (list) => list.map((r) => r.id);
const listReply = (id) => ({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id } } });
const text = (body) => ({ type: 'text', text: { body } });

test('UAE caregiver lists show CNA right after HCA, in English and Malayalam', () => {
  for (const id of ['uae_english', 'uae_malayalam']) {
    const list = ids(FLOWS[id].QUALIFICATIONS);
    const hca = list.indexOf(BUTTON_IDS.QUALIFICATION_HCA);
    assert.equal(list[hca + 1], BUTTON_IDS.QUALIFICATION_CNA, id);
    assert.ok(list.length <= 10, `${id} fits a WhatsApp list`);
  }
});

test('Kerala and Bengaluru lists never show CNA', () => {
  for (const [id, f] of Object.entries(FLOWS)) {
    if (f.region === 'uae') continue;
    assert.ok(!ids(f.QUALIFICATIONS).includes(BUTTON_IDS.QUALIFICATION_CNA), id);
  }
});

test('the UAE asks for a CNA certificate and names CNA in the retry line; India does not', () => {
  for (const id of ['uae_english', 'uae_malayalam']) {
    assert.equal(FLOWS[id].MESSAGES.certificatePapers.cna, 'CNA (Certified Nursing Assistant) certificate');
    assert.match(FLOWS[id].MESSAGES.qualificationRetry, /HCA \/ CNA \//);
  }
  for (const [id, f] of Object.entries(FLOWS)) {
    if (f.region === 'uae') continue;
    assert.equal((f.MESSAGES.certificatePapers || {}).cna, undefined, id);
    assert.doesNotMatch(String(f.MESSAGES.qualificationRetry || ''), /CNA/, id);
  }
});

test('a CNA tap or typed CNA parses as cna', () => {
  assert.equal(parseQualification(listReply(BUTTON_IDS.QUALIFICATION_CNA)), 'cna');
  assert.equal(parseQualification(text('CNA')), 'cna');
  assert.equal(parseQualification(text('Certified Nursing Assistant')), 'cna');
  assert.equal(parseQualification(text('HCA')), 'hca');
});

test('CNA is the GDA band: not Basic, not a nurse', () => {
  assert.equal(flow.rateBandFor({ qualification: 'cna', age: 30 }), 'gda');
});

test('reviewer list: 8 rows with CNA for a UAE caregiver, the old 7 for Kerala', () => {
  const uae = ops.buildApproveQualificationRows('971500000101', { phone: '971500000101', region: 'uae' });
  const kerala = ops.buildApproveQualificationRows('919000000156', { phone: '919000000156', region: 'kerala' });
  assert.equal(uae.length, 8);
  assert.equal(uae[4].title, 'CNA');
  assert.equal(kerala.length, 7);
  assert.ok(!kerala.some((r) => r.title === 'CNA'));
  assert.equal(ops.buildApproveQualificationRows('919000000156').length, 7);
});

test('a reviewer CNA tap is understood', () => {
  const uae = ops.buildApproveQualificationRows('971500000101', { phone: '971500000101', region: 'uae' });
  const parsed = ops.parseReviewerAction(listReply(uae[4].id));
  assert.equal(parsed.action, 'approve_qualification');
  assert.equal(parsed.qualification, 'cna');
  assert.equal(parsed.phone, '971500000101');
  assert.equal(photoReviewCourseLabel('cna'), 'CNA');
});
