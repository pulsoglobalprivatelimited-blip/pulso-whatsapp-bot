require('dotenv').config();

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || 'v23.0';
const ACCESS_TOKEN = process.env.WHATSAPP_MANAGEMENT_ACCESS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
const WABA_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || process.env.WABA_ID;
const TARGET_PHONE = (process.argv[2] || process.env.TARGET_WHATSAPP_PHONE || '').replace(/\D+/g, '');

function maskToken(value) {
  if (!value) return '';
  if (value.length <= 12) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function normalizePhone(value) {
  return (value || '').toString().replace(/\D+/g, '');
}

async function graphGet(path) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
  url.searchParams.set('access_token', ACCESS_TOKEN);
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) {
    const message = body && body.error ? body.error.message : response.statusText;
    const code = body && body.error ? body.error.code : response.status;
    throw new Error(`Meta Graph API error ${code}: ${message}`);
  }
  return body;
}

async function main() {
  if (!ACCESS_TOKEN) {
    throw new Error('Missing WHATSAPP_MANAGEMENT_ACCESS_TOKEN or WHATSAPP_ACCESS_TOKEN.');
  }

  if (!WABA_ID) {
    throw new Error(
      'Missing WHATSAPP_BUSINESS_ACCOUNT_ID or WABA_ID. Copy it from Meta WhatsApp Manager, then rerun this script.',
    );
  }

  const fields = [
    'id',
    'display_phone_number',
    'verified_name',
    'quality_rating',
    'code_verification_status',
    'platform_type'
  ].join(',');
  const body = await graphGet(`${WABA_ID}/phone_numbers?fields=${fields}&limit=100`);
  const numbers = (body.data || []).map((item) => ({
    id: item.id,
    display_phone_number: item.display_phone_number,
    verified_name: item.verified_name,
    quality_rating: item.quality_rating,
    code_verification_status: item.code_verification_status,
    platform_type: item.platform_type
  }));

  const matching = TARGET_PHONE
    ? numbers.filter((item) => normalizePhone(item.display_phone_number).endsWith(TARGET_PHONE.slice(-10)))
    : numbers;

  console.log(
    JSON.stringify(
      {
        ok: true,
        graphVersion: GRAPH_VERSION,
        wabaId: WABA_ID,
        token: maskToken(ACCESS_TOKEN),
        targetPhone: TARGET_PHONE || null,
        count: matching.length,
        phoneNumbers: matching
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
