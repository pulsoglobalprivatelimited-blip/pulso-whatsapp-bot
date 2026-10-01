'use strict';
// People sent a CV when the bot asked for "your certificate" (founder, 1 Oct
// 2026: no CV is needed). The ask now names the paper for the qualification she
// chose, says plainly "not your CV", and a reviewer can answer a CV with CERT.
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.WHATSAPP_DRY_RUN = process.env.WHATSAPP_DRY_RUN || 'true';

const flow = require('../src/flow');
const {
  buildCertificateRequestMessage,
  buildCertificateRetryMessage,
  expandCertificateOnlyNote
} = require('../src/services/onboardingFlow');

const QUALIFICATIONS = ['gda', 'gnm', 'anm', 'bsc_nursing', 'hca', 'other_caregiving', 'basic_caregiver'];
const LANGS = [
  ['kerala_malayalam', /CV \/ resume അല്ല/],
  ['kerala_english', /Not your CV or resume/]
];

for (const [flowId, notCv] of LANGS) {
  test(`${flowId}: every qualification is asked for its own paper, never a CV`, () => {
    flow.runWithFlow(flowId, () => {
      const papers = flow.MESSAGES.certificatePapers;
      for (const q of QUALIFICATIONS) {
        const paper = papers[q];
        assert.ok(paper, `${q} has a paper`);
        const ask = buildCertificateRequestMessage({ qualification: q });
        const retry = buildCertificateRetryMessage({ qualification: q });
        assert.ok(ask.includes(paper), `${q} ask names the paper`);
        assert.ok(retry.includes(paper), `${q} retry names the paper`);
        assert.match(ask, notCv);
        assert.match(retry, notCv);
        assert.ok(!ask.includes('{{'), 'no unfilled placeholder');
      }
      assert.match(buildCertificateRequestMessage({ qualification: 'gnm' }), /GNM/);
      assert.match(buildCertificateRequestMessage({ qualification: 'gnm' }), /Nursing Council/);
    });
  });

  test(`${flowId}: an unknown qualification still gets a clear, CV-free ask`, () => {
    flow.runWithFlow(flowId, () => {
      const ask = buildCertificateRequestMessage({ qualification: '' });
      assert.match(ask, notCv);
      assert.ok(!ask.includes('{{'));
    });
  });

  test(`${flowId}: CERT as a Request doc note becomes the paper-named ask`, () => {
    flow.runWithFlow(flowId, () => {
      for (const word of ['CERT', 'cert', ' Certificate ', 'CV']) {
        const note = expandCertificateOnlyNote({ qualification: 'gda' }, word);
        assert.ok(note.includes(flow.MESSAGES.certificatePapers.gda), word);
      }
      assert.equal(expandCertificateOnlyNote({ qualification: 'gda' }, 'Please send Aadhaar'), 'Please send Aadhaar');
    });
  });
}
