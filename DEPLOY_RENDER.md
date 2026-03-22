# Render Deployment Checklist

## Service settings
- Environment: `Node`
- Build Command: `npm install`
- Start Command: `npm run db:init && npm start`

## Environment variables
- `PUBLIC_BASE_URL=https://whatsapp.pulso.co.in`
- `FIREBASE_PROJECT_ID=pulso-whatsapp-onboarding`
- `FIREBASE_STORAGE_BUCKET=pulso-whatsapp-onboarding.appspot.com`
- `GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/pulso-whatsapp-onboarding-service-account.json`
- `WHATSAPP_VERIFY_TOKEN=pulso-whatsapp-webhook-2026`
- `WHATSAPP_ACCESS_TOKEN=<your current Meta token>`
- `WHATSAPP_PHONE_NUMBER_ID=996702816866404`
- `WHATSAPP_GRAPH_API_VERSION=v23.0`
- `WORKING_MODEL_AUDIO_MEDIA_ID=<set after voice-note upload>`
- `TERMS_AND_CONDITIONS_URL=https://www.pulso.co.in/terms-and-conditions`
- `WHATSAPP_DRY_RUN=true`
- `ADMIN_DEFAULT_REVIEWER=ops-team`
- `ADMIN_USERNAME=admin`
- `ADMIN_PASSWORD=<strong password>`
- `SESSION_SECRET=<long random secret>`
- `SESSION_TTL_HOURS=12`
- `MEDIA_STORAGE_DIR=/var/data/pulso-media`

## Secret file
Upload `secrets/pulso-whatsapp-onboarding-service-account.json` as a Render secret file and mount it at:
- `/etc/secrets/pulso-whatsapp-onboarding-service-account.json`

## Persistent disk
Attach a Render disk at:
- `/var/data`

## Custom domain
After first successful deploy:
- add custom domain `whatsapp.pulso.co.in`
- add the DNS record Render provides
- wait for SSL to become active

## Meta webhook values
- Callback URL: `https://whatsapp.pulso.co.in/webhook`
- Verify Token: `pulso-whatsapp-webhook-2026`
