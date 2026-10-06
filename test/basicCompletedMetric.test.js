'use strict';
// "Basic completed" on the desk (founder, 7 Oct 2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'src');
const dashboard = fs.readFileSync(path.join(root, 'public/assets/dashboard.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/admin/index.html'), 'utf8');
const storage = fs.readFileSync(path.join(root, 'services/storage.js'), 'utf8');

const src = dashboard.match(/function isCompletedBasic\(provider\) \{[\s\S]*?\n\}/)[0];
// eslint-disable-next-line no-new-func
const isCompletedBasic = new Function('getDashboardStatus', `${src}; return isCompletedBasic;`)((p) => (p ? p.status : ""));

test('counts Basic caregivers and anyone on the Basic rate, only once joined', () => {
  assert.equal(isCompletedBasic({ status: 'completed', qualification: 'basic_caregiver' }), true);
  assert.equal(isCompletedBasic({ status: 'completed', qualification: 'gnm', careTier: 'basic' }), true, 'GNM above 50 on the Basic rate');
  assert.equal(isCompletedBasic({ status: 'completed', qualification: 'gda' }), false);
  assert.equal(isCompletedBasic({ status: 'completed', qualification: 'gda', careTier: 'gda' }), false);
  assert.equal(isCompletedBasic({ status: 'awaiting_terms_acceptance', qualification: 'basic_caregiver' }), false);
  assert.equal(isCompletedBasic(null), false);
});

test('the box sits after Total females completed, and the list carries careTier', () => {
  const female = html.indexOf('id="completed-female-metric"');
  const basic = html.indexOf('id="completed-basic-metric"');
  const today = html.indexOf('id="completed-today-metric"');
  assert.ok(female > 0 && basic > female && today > basic);
  assert.match(html, /<label>Basic completed<\/label>/);
  assert.match(storage, /'qualification',\s*'careTier',/);
  assert.match(dashboard, /applyCompletedMetricFilter\('all', 'basic'\)/);
});
