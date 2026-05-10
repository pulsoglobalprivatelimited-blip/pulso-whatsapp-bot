require('dotenv').config();

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || 'v23.0';
const ACCESS_TOKEN = process.env.WHATSAPP_MANAGEMENT_ACCESS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID =
  process.argv[2] ||
  process.env.PROVIDER_SUPPORT_WHATSAPP_PHONE_NUMBER_ID ||
  process.env.WHATSAPP_PHONE_NUMBER_ID;
const PIN = process.env.WHATSAPP_REGISTER_PIN || process.env.PROVIDER_SUPPORT_WHATSAPP_REGISTER_PIN;

function mask(value) {
  if (!value) return '';
  if (value.length <= 4) return '*'.repeat(value.length);
  return `${value.slice(0, 2)}${'*'.repeat(value.length - 4)}${value.slice(-2)}`;
}

async function main() {
  if (!ACCESS_TOKEN) {
    throw new Error('Missing WHATSAPP_MANAGEMENT_ACCESS_TOKEN or WHATSAPP_ACCESS_TOKEN.');
  }
  if (!PHONE_NUMBER_ID) {
    throw new Error('Missing phone number ID argument or PROVIDER_SUPPORT_WHATSAPP_PHONE_NUMBER_ID.');
  }
  if (!/^\d{6}$/.test(PIN || '')) {
    throw new Error('Missing 6-digit WHATSAPP_REGISTER_PIN or PROVIDER_SUPPORT_WHATSAPP_REGISTER_PIN.');
  }

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/register`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        pin: PIN
      })
    },
  );
  const body = await response.json();

  if (!response.ok) {
    const error = body && body.error ? body.error : {};
    throw new Error(
      `Meta registration failed ${error.code || response.status}: ${error.message || response.statusText}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        phoneNumberId: PHONE_NUMBER_ID,
        pin: mask(PIN),
        response: body
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
