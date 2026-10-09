# Brixie

A phone-friendly daily planner with voice input, spoken replies, optional Google Calendar access, and an optional general AI assistant.

The live website is <https://brightwebs.github.io/lexie-web-planner/>. On iPhone, open it in Safari, tap **Share**, then choose **Add to Home Screen**. Reminders and plans stay in the browser on that device. Calendar access is optional and requires signing in with Google.

## Setting up Brixie's free AI

The optional AI service is in [`worker/`](./worker/). It uses Cloudflare Workers AI and Wikipedia search; no API key is put in the website.

1. Create a Cloudflare account and install Node.js.
2. Open a terminal in the `worker/` directory and run:

   ```sh
   npx wrangler@latest login
   npx wrangler@latest deploy
   ```

   Approve the browser sign-in. The included `wrangler.toml` enables the Workers AI binding and a per-IP rate limit. Cloudflare prints the Worker URL after deployment.
3. Open Brixie, tap **AI setup**, and paste the full URL ending in `/chat`, such as `https://brixie-assistant.your-account.workers.dev/chat`.

The free allowance is limited and may change or run out. Wikipedia is the only search source in this version, so this is not unrestricted internet search and answers can be wrong or out of date. Brixie shows Wikipedia links when matching articles are found. When no connection is configured, reminders and calendar commands continue to work; general AI answers do not.

Your question and a short, in-memory chat history are sent to the Worker. The Worker sends the question to Wikipedia search and the selected prompt/context to Cloudflare Workers AI. Do not enter sensitive personal information.

By default, the Worker allows `https://brightwebs.github.io` and local development at `http://localhost:5173`. If you host the site elsewhere, add its exact origin to `SITE_ORIGINS` in `worker/src/index.js` before deploying.
