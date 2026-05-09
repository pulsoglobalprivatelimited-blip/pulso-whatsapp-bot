# CallerDesk WhatsApp API

Use this API when a caller presses `2` for Caregiver / Nursing Staff job opportunities.

CallerDesk should not call Meta WhatsApp API directly and should not receive the WhatsApp access token. CallerDesk only calls this Pulso endpoint; Pulso sends the WhatsApp message using the existing WhatsApp Cloud API setup.

## Endpoint

```text
POST https://whatsapp.pulso.co.in/ivr/job-whatsapp
```

## Headers

```text
Content-Type: application/json
x-ivr-secret: <IVR_WEBHOOK_SECRET>
```

## English Request

```json
{
  "phone": "919999999999",
  "lang": "en"
}
```

## Malayalam Request

```json
{
  "phone": "919999999999",
  "lang": "ml"
}
```

## GET Fallback

If CallerDesk only supports a webhook URL, use:

```text
https://whatsapp.pulso.co.in/ivr/job-whatsapp?phone=919999999999&lang=en&secret=<IVR_WEBHOOK_SECRET>
```

For Malayalam:

```text
https://whatsapp.pulso.co.in/ivr/job-whatsapp?phone=919999999999&lang=ml&secret=<IVR_WEBHOOK_SECRET>
```

## Accepted Phone Field Names

The API accepts any of these fields:

```text
phone
mobile
from
From
caller
Caller
caller_id
callerId
CallFrom
recipient.phone
customer.phone
```

Phone numbers can be sent as `919999999999`, `9999999999`, or `+919999999999`.

## Success Response

```json
{
  "ok": true,
  "phone": "919999999999",
  "language": "en",
  "result": {
    "messaging_product": "whatsapp",
    "messages": [
      {
        "id": "wamid..."
      }
    ]
  }
}
```

## Error Responses

Missing phone number:

```json
{
  "ok": false,
  "error": "Missing caller phone number. Send phone, mobile, from, From, caller, caller_id, or recipient.phone."
}
```

Wrong secret:

```json
{
  "error": "Unauthorized"
}
```

## IVR Prompt Change

The current IVR says SMS. Change that line to WhatsApp message:

English:

```text
We are sending the WhatsApp link to you on WhatsApp.
```

Malayalam:

```text
WhatsApp link WhatsApp message ആയി അയച്ചിട്ടുണ്ട്.
```

## Production Requirement

Because the WhatsApp message starts from a phone call, use an approved Meta WhatsApp template. Configure:

```bash
IVR_JOB_WHATSAPP_TEMPLATE_NAME_EN=<approved_english_template_name>
IVR_JOB_WHATSAPP_TEMPLATE_NAME_ML=<approved_malayalam_template_name>
IVR_JOB_WHATSAPP_TEMPLATE_LANGUAGE_EN=en
IVR_JOB_WHATSAPP_TEMPLATE_LANGUAGE_ML=ml
```

If these template names are blank, Pulso will try to send free-form text, which can fail unless the caller already has an open WhatsApp service window.
