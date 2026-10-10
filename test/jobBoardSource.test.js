const test = require('node:test');
const assert = require('node:assert');
const { parseJobBoardCode, jobBoardSourceUpdate } = require('../src/services/jobBoardSource');

test('reads site and district from the code', () => {
  assert.deepStrictEqual(parseJobBoardCode('JOB APNA KANNUR'), { site: 'apna', district: 'Kannur', code: 'JOB APNA KANNUR' });
  assert.deepStrictEqual(parseJobBoardCode('  job wi ekm  hello'), { site: 'workindia', district: 'Ernakulam', code: 'JOB WI EKM' });
  assert.deepStrictEqual(parseJobBoardCode('JOB INDEED'), { site: 'indeed', district: null, code: 'JOB INDEED' });
  assert.deepStrictEqual(parseJobBoardCode('JOB LI XYZ'), { site: 'linkedin', district: null, code: 'JOB LI' });
});

test('ignores ordinary messages', () => {
  for (const t of ['hi', 'job undo', 'I need a job', 'JOB', '', null, 'JOBAPNA KANNUR']) assert.strictEqual(parseJobBoardCode(t), null, String(t));
});

test('first touch wins', () => {
  const now = new Date('2026-10-10T10:00:00Z');
  const u = jobBoardSourceUpdate({}, 'JOB APNA KOLLAM', now);
  assert.strictEqual(u.jobBoardSource.district, 'Kollam');
  assert.strictEqual(u.jobBoardSource.at, '2026-10-10T10:00:00.000Z');
  assert.strictEqual(jobBoardSourceUpdate({ jobBoardSource: u.jobBoardSource }, 'JOB INDEED TVM', now), null);
  assert.strictEqual(jobBoardSourceUpdate({}, 'hello', now), null);
});
