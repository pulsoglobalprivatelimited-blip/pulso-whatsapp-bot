'use strict';
// Free job-board posts (Apna, WorkIndia, Indeed, LinkedIn) ask applicants to
// WhatsApp a code like "JOB APNA KANNUR". The first such code a person sends is
// kept on their record so the weekly report can count joiners per site and
// district. Founder approved the pay and the posts on 10 Oct 2026.
// See senior/pulso_hub/docs/job_board_posts.md in the hub repo.

const SITES = { APNA: 'apna', WI: 'workindia', WORKINDIA: 'workindia', INDEED: 'indeed', LI: 'linkedin', LINKEDIN: 'linkedin', WEB: 'website', IG: 'instagram', YT: 'youtube', CH: 'whatsapp_channel' };
const DISTRICTS = {
  KANNUR: 'Kannur', EKM: 'Ernakulam', ERNAKULAM: 'Ernakulam', KOCHI: 'Ernakulam', KOLLAM: 'Kollam',
  KTYM: 'Kottayam', KOTTAYAM: 'Kottayam', TCR: 'Thrissur', THRISSUR: 'Thrissur', TVM: 'Thiruvananthapuram',
  TRIVANDRUM: 'Thiruvananthapuram', ALP: 'Alappuzha', ALAPPUZHA: 'Alappuzha', KKD: 'Kozhikode', KOZHIKODE: 'Kozhikode',
  MLP: 'Malappuram', MALAPPURAM: 'Malappuram', PKD: 'Palakkad', PALAKKAD: 'Palakkad', KSD: 'Kasaragod',
  KASARAGOD: 'Kasaragod', WYD: 'Wayanad', WAYANAD: 'Wayanad', IDK: 'Idukki', IDUKKI: 'Idukki', PTA: 'Pathanamthitta',
  PATHANAMTHITTA: 'Pathanamthitta'
};

// Returns { site, district, code } or null. Tolerates lower case, extra spaces
// and text after the code ("JOB APNA KANNUR hi").
function parseJobBoardCode(text) {
  const m = String(text || '').trim().toUpperCase().match(/^JOB\s+([A-Z]+)(?:\s+([A-Z]+))?/);
  if (!m || !SITES[m[1]]) return null;
  const district = m[2] && DISTRICTS[m[2]] ? DISTRICTS[m[2]] : null;
  return { site: SITES[m[1]], district, code: ['JOB', m[1], m[2] && DISTRICTS[m[2]] ? m[2] : null].filter(Boolean).join(' ') };
}

// Fields to write, or null when the provider already has a source (first touch wins).
function jobBoardSourceUpdate(provider, text, now = new Date()) {
  if (provider && provider.jobBoardSource) return null;
  const parsed = parseJobBoardCode(text);
  if (!parsed) return null;
  return { jobBoardSource: { ...parsed, at: now.toISOString() } };
}

module.exports = { parseJobBoardCode, jobBoardSourceUpdate };
