# Brixie

A voice-first personal assistant with an iPhone-friendly website and a native iOS and Android app. The website can answer general questions through an optional Cloudflare Worker connection, search Wikipedia, and show links to its sources. The native app currently provides the local planner features described below.

## What works in this first version

- Voice input and spoken replies
- Add reminders by saying or typing, for example, “Remind me to call Mom at 5 pm”
- Daily plan, task completion, and removal by voice or text
- Local storage and device notifications
- A calm, accessible mobile interface

Planner and calendar commands are handled by the website. Without an AI connection, general questions are not sent to a generative AI service. The native app remains a local planner and does not use the website's AI service.

## Run on a phone

You’ll need Node.js, npm, and Expo’s supported Android or iOS development setup.

```sh
npm install
npx expo prebuild
npm run android
```

For iOS, use a Mac with Xcode:

```sh
npm run ios
```

Speech recognition and notifications use native device capabilities, so this project requires an Expo development build; Expo Go is not sufficient. The first launch will request microphone, speech-recognition, and notification permissions. If notifications are declined, reminders remain on the list but the phone cannot alert you.

## Open the web version

The `website/` folder is a phone-friendly, installable website. It works in a browser without an Apple Developer membership, Xcode, an app-store download, or an account. Tasks are saved on the current device. Spoken replies use the browser's speech synthesis; microphone support depends on the browser. Reminder and calendar actions run in the website; general AI answers are optional and require the Worker setup below.

To preview it on this computer:

```sh
npm run web
```

Then open `http://localhost:5173`. For an iPhone Home Screen install and offline access, the website must be published over HTTPS. Open the live site in Safari, tap **Share**, then choose **Add to Home Screen**. The web version displays reminders while the page is open; it does not send background push notifications after the browser is closed.

The website is hosted separately from the private native-app source repository. Keep the native app repo private; publish the website from its separate static-site repository.

## Setting up Brixie's free AI

The `worker/` directory contains the backend for the website's optional general assistant. It uses Cloudflare Workers AI and Wikipedia's public API; no provider API key is placed in the website. This is a limited free-tier setup, not ChatGPT-level or unrestricted internet search. Wikipedia is the only search source, the AI can make mistakes, and Cloudflare's free allowance can change or run out.

1. Create a Cloudflare account and install Node.js on a computer.
2. Open a terminal in this project's `worker/` directory and deploy the Worker:

   ```sh
   npx wrangler@latest login
   npx wrangler@latest deploy
   ```

   Approve Wrangler's browser sign-in. The included `wrangler.toml` configures the Workers AI binding and a per-IP rate limit. Cloudflare will print the Worker URL after deployment.
3. Open Brixie's website, select **AI setup**, and paste the full URL ending in `/chat`, for example `https://brixie-assistant.your-account.workers.dev/chat`.
4. Ask a general question. When Wikipedia returns matching articles, Brixie includes source links beneath its answer.

Messages sent to the AI connection are processed by Cloudflare Workers AI, and question text is sent to Wikipedia search. The website sends the current question and a short, in-memory conversation history; that history is not saved by the site. Do not include sensitive personal information. Reminders and Google Calendar commands continue to use their existing website flows.

By default, the Worker accepts requests from `https://brightwebs.github.io` and local development at `http://localhost:5173`. If the site is moved to a different domain or port, update the allowed origins in `worker/src/index.js` before deploying. Keep the Worker source alongside the website's source when publishing or maintaining the site.

## Notes

- Tasks are saved locally with AsyncStorage and currently have no cloud sync or account sign-in.
- Voice recognition availability depends on the device and its language settings. Text entry remains available as a fallback.
- To check TypeScript after installing dependencies, run `npm run typecheck`.
