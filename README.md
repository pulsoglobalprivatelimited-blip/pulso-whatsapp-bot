# Pulso WhatsApp Onboarding Bot

A production-oriented WhatsApp Business onboarding bot for care providers from Meta ads, using a 12-step flow with manual certificate verification, Firestore storage, and an internal ops dashboard.

## What this system does

- Receives incoming WhatsApp messages through a Meta webhook
- Guides providers through qualification, interest confirmation, and document upload
- Pauses automatically for manual certificate verification
- Resumes only after approval
- Stores provider state in Firebase Firestore
- Exposes an internal dashboard for certificate approval and rejection
- Sends WhatsApp messages through the WhatsApp Cloud API
- Archives uploaded CVs and certificates to local disk storage
- Protects the admin dashboard with reviewer login

## 12-step onboarding flow

1. Incoming lead enters from Meta ad into WhatsApp
2. Bot asks if the provider is `GDA`, `GNM`, or `ANM`
3. System captures qualification
4. Bot sends the working-model voice note
5. Bot waits for `Interested`
6. Bot asks for `CV` and `certificate`
7. Provider uploads documents
8. System creates verification queue entry
9. Certificate stays in `pending verification`
10. Team approves or rejects the certificate
11. If approved, bot asks duty preference: `8 hour` or `24 hour`
12. Bot sends onboarding confirmation and terms and conditions

## Status model

- `new_lead`
- `awaiting_qualification`
- `voice_note_sent`
- `awaiting_interest_confirmation`
- `awaiting_documents`
- `certificate_verification_pending`
- `certificate_rejected`
- `awaiting_duty_preference`
- `completed`

## Project structure

- `src/server.js`: Express app, webhook, and admin endpoints
- `src/services/onboardingFlow.js`: 12-step state machine
- `src/services/providerService.js`: provider record management
- `src/services/storage.js`: Firestore persistence layer
- `src/services/metaClient.js`: WhatsApp Cloud API sender
- `src/services/messageParser.js`: intent and document parsing
- `src/flow.js`: messages, statuses, and step constants
- `src/public/admin/index.html`: internal verification dashboard
- `src/public/admin/login.html`: reviewer login
- `src/public/assets/dashboard.js`: dashboard behavior
- `render.yaml`: Render deployment config
- `railway.json`: Railway deployment config

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create environment variables:

```bash
cp .env.example .env
```

3. Set your key values inside `.env`:

```bash
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
PUBLIC_BASE_URL=https://your-domain.com
WHATSAPP_VERIFY_TOKEN=...
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
WORKING_MODEL_AUDIO_MEDIA_ID=...
TERMS_AND_CONDITIONS_URL=...
WHATSAPP_DRY_RUN=false
ADMIN_USERNAME=admin
ADMIN_PASSWORD=strong-password
SESSION_SECRET=long-random-secret
MEDIA_STORAGE_DIR=./storage/media
```

4. Initialize Firestore access:

```bash
npm run db:init
```

5. Start the server:

```bash
npm run dev
```

## Dashboard

Open:

```bash
http://localhost:3000/admin
```

The dashboard lets your ops team:

- see all providers and filter by status
- review qualification, document status, and message history
- approve certificates
- reject certificates with notes
- sign in using reviewer credentials from `.env`

## Reviewer authentication

Set these environment variables:

```bash
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-strong-password
SESSION_SECRET=your-long-random-secret
```

Admin users will log in at:

```bash
http://localhost:3000/admin/login
```

The dashboard uses a signed, http-only session cookie.

## Media archival

When a provider uploads a CV or certificate, the app now:

1. reads the WhatsApp media id
2. fetches media metadata from Meta
3. downloads the file from the WhatsApp Cloud API
4. stores it under `MEDIA_STORAGE_DIR/<phone>/<category>/`
5. saves file metadata and local path in the provider record

During dry-run mode, files are not downloaded. The provider record will show `archiveStatus: dry_run`.

Set the archive location with:

```bash
MEDIA_STORAGE_DIR=./storage/media
```

## Firebase / Firestore setup

You can connect Firestore in either of these ways:

- set `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`
- or set `GOOGLE_APPLICATION_CREDENTIALS` to a Firebase service-account JSON file

Recommended for deployment:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

After setting credentials:

```bash
npm run db:init
```

## Real Meta / WhatsApp setup

Use these values in Meta:

- Callback URL: `https://your-domain.com/webhook`
- Verify token: same value as `WHATSAPP_VERIFY_TOKEN`

Steps in Meta Business / WhatsApp Cloud API:

1. Create or open your Meta app
2. Add the `WhatsApp` product
3. Open the WhatsApp Cloud API panel
4. Copy your permanent or long-lived access token into `WHATSAPP_ACCESS_TOKEN`
5. Copy the `Phone Number ID` into `WHATSAPP_PHONE_NUMBER_ID`
6. Configure webhook callback URL as `https://your-domain.com/webhook`
7. Use the same verify token you set in `.env`
8. Subscribe to message events
9. Upload your working-model audio to WhatsApp and store its media id in `WORKING_MODEL_AUDIO_MEDIA_ID`
10. Confirm your app has permission to access message media downloads

Before going live:

- set `WHATSAPP_DRY_RUN=false`
- make sure your server is publicly reachable
- test webhook verification from Meta
- send a live test message from a test provider number
- log into `/admin/login` and confirm reviewers can approve/reject providers
- confirm uploaded CV/certificate files appear inside `MEDIA_STORAGE_DIR`

## Admin API

### List providers

```bash
curl http://localhost:3000/admin/providers
```

### View one provider

```bash
curl http://localhost:3000/admin/providers/919999999999
```

### Approve certificate

```bash
curl -X POST http://localhost:3000/admin/providers/919999999999/approve-certificate \
  -H 'Content-Type: application/json' \
  -d '{"reviewedBy":"ops-team","notes":"Certificate checked and valid"}'
```

### Reject certificate

```bash
curl -X POST http://localhost:3000/admin/providers/919999999999/reject-certificate \
  -H 'Content-Type: application/json' \
  -d '{"reviewedBy":"ops-team","notes":"Blurry certificate, please resend"}'
```

## Manual verification rule

The bot does not proceed to duty preference or onboarding confirmation until the certificate is manually approved.

- Document upload only means `received`
- Team review changes verification status to `verified` or `rejected`
- Only `verified` resumes the flow

## Notes for production

This version is set up for Firestore, admin login, and archived media files. Strong next upgrades would be:

- template messages for re-engagement outside the 24-hour session window
- stricter message parsing for multilingual replies
- deployment on a public server with HTTPS
- persistent object storage for media backups
- role-based access control for multiple reviewer types

## Deploy on Render

1. Push this repo to GitHub
2. Create a new Render Web Service from the repo
3. Render will detect [render.yaml](/Users/abdulrahoof/Documents/pulso-whatsapp-bot/render.yaml)
4. Add environment variables from `.env.example`
5. Add Firebase admin credentials as environment variables
6. Attach a persistent disk and point `MEDIA_STORAGE_DIR` to that mount path
7. After deploy, set `PUBLIC_BASE_URL` to your Render URL
8. Use `https://your-render-url/webhook` inside Meta

## Deploy on Railway

1. Push this repo to GitHub
2. Create a new Railway project from the repo
3. Railway will use [railway.json](/Users/abdulrahoof/Documents/pulso-whatsapp-bot/railway.json)
4. Add Firebase admin credentials
5. Add all WhatsApp and admin env vars
6. Set `PUBLIC_BASE_URL` to your Railway domain
7. Mount persistent storage if you want local archived files to survive deploys

## Firebase notes

If you use Firestore:

1. Create a Firebase project
2. Enable Firestore Database
3. Create a service account in Google Cloud / Firebase project settings
4. Add the service-account credentials to your environment
5. Run `npm run db:init`
6. Media files still land in `MEDIA_STORAGE_DIR`
