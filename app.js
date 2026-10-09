"use strict";

(() => {
  const STORAGE_KEY = "lexie-web-tasks-v1";
  const GOOGLE_CLIENT_KEY = "lexie-google-client-id-v1";
  const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
  const conversation = document.querySelector("#conversation");
  const form = document.querySelector("#chat-form");
  const input = document.querySelector("#message-input");
  const taskList = document.querySelector("#task-list");
  const count = document.querySelector("#remaining-count");
  const greeting = document.querySelector("#day-summary");
  const date = document.querySelector("#current-date");
  const voiceButton = document.querySelector("#voice-button");
  const voiceCaption = document.querySelector("#voice-caption");
  const voiceHint = document.querySelector("#voice-hint");
  const installButton = document.querySelector("#install-button");
  const voiceSelect = document.querySelector("#voice-select");
  const calendarConnectButton = document.querySelector("#calendar-connect-button");
  const calendarSettingsButton = document.querySelector("#calendar-settings-button");
  const calendarDisconnectButton = document.querySelector("#calendar-disconnect-button");
  const calendarStatus = document.querySelector("#calendar-status");
  const calendarStatusText = document.querySelector("#calendar-status-text");
  const calendarEventsElement = document.querySelector("#calendar-events");
  let tasks = loadTasks();
  let reminderTimers = [];
  let deferredInstallPrompt = null;
  let recognition = null;
  let isListening = false;
  let speechVoices = [];
  let selectedVoiceName = loadPreferredVoiceName();
  let calendarAccessToken = null;
  let calendarTokenClient = null;
  let calendarEvents = [];
  let calendarRefreshTimer = null;
  let calendarClientId = loadCalendarClientId();

  function loadCalendarClientId() {
    try {
      return localStorage.getItem(GOOGLE_CLIENT_KEY) || "";
    } catch (error) {
      console.error("Couldn't read calendar settings.", error);
      return "";
    }
  }

  function loadPreferredVoiceName() {
    try {
      return localStorage.getItem("lexie-web-voice-v1") || "";
    } catch (error) {
      console.error("Couldn't read Lexie's voice setting.", error);
      return "";
    }
  }

  const feminineVoiceName = /\b(female|samantha|ava|allison|karen|moira|tessa|fiona|victoria|zoe|aria|jenny|sonia|susan|emma|kate|serena|siri|zira|hazel|catherine|eva|lulu|nicky)\b/i;

  function updateAvailableVoices() {
    if (!("speechSynthesis" in window)) return;
    speechVoices = window.speechSynthesis.getVoices()
      .filter((voice) => /^en(?:-|$)/i.test(voice.lang))
      .sort((left, right) => {
        const feminine = Number(feminineVoiceName.test(right.name)) - Number(feminineVoiceName.test(left.name));
        if (feminine) return feminine;
        const preferredRegion = Number(/^en-US/i.test(right.lang)) - Number(/^en-US/i.test(left.lang));
        return preferredRegion || left.name.localeCompare(right.name);
      });
    renderVoiceChoices();
  }

  function renderVoiceChoices() {
    if (!voiceSelect) return;
    voiceSelect.replaceChildren();
    const autoOption = document.createElement("option");
    autoOption.value = "";
    autoOption.textContent = speechVoices.some((voice) => feminineVoiceName.test(voice.name))
      ? "Automatic — feminine-sounding English voice"
      : "Automatic — device’s English voice";
    voiceSelect.append(autoOption);
    for (const voice of speechVoices) {
      const option = document.createElement("option");
      option.value = voice.name;
      option.textContent = `${voice.name} · ${voice.lang}${feminineVoiceName.test(voice.name) ? " · feminine-sounding" : ""}`;
      voiceSelect.append(option);
    }
    const savedVoice = speechVoices.find((voice) => voice.name === selectedVoiceName);
    voiceSelect.value = savedVoice ? selectedVoiceName : "";
    if (selectedVoiceName && !savedVoice) selectedVoiceName = "";
  }

  function preferredVoice() {
    if (!speechVoices.length) updateAvailableVoices();
    return speechVoices.find((voice) => voice.name === selectedVoiceName)
      || speechVoices.find((voice) => feminineVoiceName.test(voice.name))
      || speechVoices[0]
      || null;
  }

  function newId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function loadTasks() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(saved)) throw new Error("Saved reminders are not a list.");
      return saved.filter((task) =>
        task &&
        typeof task.id === "string" &&
        typeof task.title === "string" &&
        (typeof task.dueAt === "string" || task.dueAt === null) &&
        typeof task.completed === "boolean" &&
        typeof task.alerted === "boolean"
      );
    } catch (error) {
      console.error("Couldn't restore Lexie's saved reminders.", error);
      return [];
    }
  }

  function saveTasks() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch (error) {
      console.error("Couldn't save Lexie's reminders.", error);
      addMessage("I couldn’t save your changes on this device. Check your available browser storage and try again.", "error");
    }
  }

  function addMessage(text, role = "assistant") {
    const message = document.createElement("div");
    message.className = `message ${role}`;
    message.textContent = text;
    conversation.append(message);
    conversation.scrollTop = conversation.scrollHeight;
  }

  function speak(text) {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = preferredVoice();
    utterance.lang = voice?.lang || "en-US";
    utterance.rate = 0.91;
    utterance.pitch = 1.1;
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  }

  function respond(text, shouldSpeak = true) {
    addMessage(text);
    if (shouldSpeak) speak(text);
  }

  function escapeTaskText(value) {
    return value.trim().replace(/\s+/g, " ");
  }

  function parseReminder(text) {
    const prefix = /^(?:(?:hey\s+)?lexie[, ]+)?(?:please\s+)?(?:can you\s+)?(?:remind me to|remind me|add (?:a )?(?:reminder|task)(?: to)?|schedule|put (?:a )?(?:reminder|task)(?: to)?|plan to|i need to|i have to)\s*/i;
    if (!prefix.test(text.trim())) return null;

    let title = text.trim().replace(prefix, "");
    let dueAt = null;
    const now = new Date();
    const relativeTime = title.match(/\bin\s+(\d{1,3})\s+(minute|minutes|hour|hours)\b/i);
    const timeMatch = title.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
    const isTomorrow = /\btomorrow\b/i.test(title);
    const isTonight = /\btonight\b/i.test(title);

    if (relativeTime) {
      const amount = Number(relativeTime[1]);
      if (amount < 1 || amount > 999) return null;
      dueAt = new Date(now.getTime() + amount * (relativeTime[2].toLowerCase().startsWith("hour") ? 3600000 : 60000));
      title = title.replace(/\bin\s+\d{1,3}\s+(?:minute|minutes|hour|hours)\b/i, "");
    } else {
      const fixedTime = title.match(/\b(?:at\s+)?(noon|midnight)\b/i);
      if (timeMatch) {
        const hourInput = Number(timeMatch[1]);
        const minute = Number(timeMatch[2] || "0");
        if (hourInput < 1 || hourInput > 12 || minute > 59) return null;
        let hour = hourInput % 12;
        if (timeMatch[3].toLowerCase().startsWith("p")) hour += 12;
        dueAt = new Date(now);
        dueAt.setHours(hour, minute, 0, 0);
        if (isTomorrow || dueAt.getTime() <= now.getTime()) dueAt.setDate(dueAt.getDate() + 1);
        title = title.replace(/\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/i, "");
      } else if (fixedTime) {
        dueAt = new Date(now);
        dueAt.setHours(fixedTime[1].toLowerCase() === "noon" ? 12 : 0, 0, 0, 0);
        if (isTomorrow || dueAt.getTime() <= now.getTime()) dueAt.setDate(dueAt.getDate() + 1);
        title = title.replace(/\b(?:at\s+)?(?:noon|midnight)\b/i, "");
      } else if (isTomorrow || isTonight) {
        dueAt = new Date(now);
        dueAt.setDate(dueAt.getDate() + (isTomorrow || now.getHours() >= 20 ? 1 : 0));
        dueAt.setHours(isTonight ? 20 : 9, 0, 0, 0);
      }
    }

    title = escapeTaskText(title.replace(/\b(today|tomorrow|tonight)\b/gi, "").replace(/[,.!?]+$/g, ""));
    if (!title) return null;
    return {
      title: title[0].toUpperCase() + title.slice(1),
      dueAt: dueAt ? dueAt.toISOString() : null,
    };
  }

  function formatTime(value) {
    return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function setCalendarStatus(message, state = "") {
    calendarStatusText.textContent = message;
    calendarStatus.classList.toggle("is-connected", state === "connected");
    calendarStatus.classList.toggle("is-error", state === "error");
    calendarConnectButton.classList.toggle("is-connected", state === "connected");
    calendarConnectButton.textContent = calendarAccessToken ? "Refresh" : "Connect";
    calendarSettingsButton.textContent = calendarClientId ? "Settings" : "Set up";
    calendarDisconnectButton.hidden = !calendarClientId && !calendarAccessToken;
    calendarDisconnectButton.textContent = calendarAccessToken ? "Disconnect" : "Remove ID";
  }

  function calendarStart(event) {
    return event.start?.dateTime || event.start?.date || "";
  }

  function renderCalendarEvents() {
    calendarEventsElement.replaceChildren();
    if (!calendarAccessToken) {
      const prompt = document.createElement("div");
      prompt.className = "calendar-empty";
      prompt.innerHTML = '<span class="calendar-empty-icon" aria-hidden="true">▦</span><span>Connect your Google Calendar to see plans you already have.</span>';
      calendarEventsElement.append(prompt);
      return;
    }
    if (!calendarEvents.length) {
      const empty = document.createElement("div");
      empty.className = "calendar-empty";
      empty.innerHTML = '<span class="calendar-empty-icon" aria-hidden="true">✦</span><span>Your calendar is clear for the next seven days.</span>';
      calendarEventsElement.append(empty);
      return;
    }

    const now = Date.now();
    for (const event of calendarEvents.filter((item) => {
      if (item.status === "cancelled" || !calendarStart(item)) return false;
      return new Date(calendarStart(item)).getTime() >= now;
    }).slice(0, 5)) {
      const start = new Date(calendarStart(event));
      const row = document.createElement("div");
      row.className = "calendar-event";
      const time = document.createElement("span");
      time.className = "calendar-event-time";
      time.textContent = event.start?.date
        ? "All day"
        : `${start.toLocaleDateString([], { weekday: "short" })} · ${formatTime(start.toISOString())}`;
      const details = document.createElement("div");
      details.className = "calendar-event-details";
      const title = document.createElement("div");
      title.className = "calendar-event-title";
      title.textContent = event.summary || "Untitled event";
      const dateLabel = document.createElement("div");
      dateLabel.className = "calendar-event-date";
      dateLabel.textContent = start.toLocaleDateString([], {
        weekday: "long",
        month: "short",
        day: "numeric",
      });
      details.append(title, dateLabel);
      row.append(time, details);
      calendarEventsElement.append(row);
    }
  }

  function calendarUrl(path, params = {}) {
    const url = new URL(`https://www.googleapis.com/calendar/v3/${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    return url;
  }

  async function googleCalendarRequest(path, options = {}) {
    if (!calendarAccessToken) throw new Error("Connect your Google Calendar first.");
    const response = await fetch(calendarUrl(path, options.query), {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${calendarAccessToken}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    if (response.status === 401) {
      calendarAccessToken = null;
      calendarEvents = [];
      setCalendarStatus("Google sign-in expired. Please connect again.");
      renderCalendarEvents();
      throw new Error("Google sign-in expired. Please connect your calendar again.");
    }
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      console.error("Google Calendar API error.", response.status, error);
      if (response.status === 403) {
        throw new Error("Google Calendar access was denied. Check that the Calendar API is enabled and that you approved calendar access.");
      }
      if (response.status === 404) throw new Error("I couldn’t find that Google Calendar event.");
      throw new Error(error?.error?.message || `Google Calendar returned an error (${response.status}).`);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  function dayBounds() {
    const now = new Date();
    const until = new Date(now);
    until.setDate(until.getDate() + 7);
    return { timeMin: now.toISOString(), timeMax: until.toISOString() };
  }

  async function refreshCalendar() {
    if (!calendarAccessToken) return;
    setCalendarStatus("Checking your next seven days…", "connected");
    try {
      const result = await googleCalendarRequest("calendars/primary/events", {
        query: {
          ...dayBounds(),
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 50,
        },
      });
      calendarEvents = Array.isArray(result.items) ? result.items : [];
      renderCalendarEvents();
      const count = calendarEvents.filter((event) =>
        event.status !== "cancelled" &&
        calendarStart(event) &&
        new Date(calendarStart(event)).getTime() >= Date.now()
      ).length;
      setCalendarStatus(`Connected · ${count} ${count === 1 ? "upcoming event" : "upcoming events"}`, "connected");
    } catch (error) {
      console.error("Couldn't load Google Calendar events.", error);
      if (calendarAccessToken) setCalendarStatus(error.message, "error");
      throw error;
    }
  }

  function loadGoogleIdentity() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    const existingScript = document.querySelector('script[data-google-identity="true"]');
    if (existingScript) {
      return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("Google sign-in took too long to load. Check your connection and try again.")), 15_000);
        existingScript.addEventListener("load", () => {
          window.clearTimeout(timeout);
          if (window.google?.accounts?.oauth2) resolve();
          else reject(new Error("Google sign-in couldn’t initialize in this browser."));
        }, { once: true });
        existingScript.addEventListener("error", () => {
          window.clearTimeout(timeout);
          reject(new Error("Google sign-in couldn’t load."));
        }, { once: true });
      });
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.dataset.googleIdentity = "true";
      script.onload = resolve;
      script.onerror = () => reject(new Error("Google sign-in couldn’t load. Check your connection and try again."));
      document.head.append(script);
    });
  }

  async function connectGoogleCalendar() {
    if (!calendarClientId) {
      document.querySelector("#google-client-id").value = "";
      showDialog("#calendar-dialog");
      return;
    }
    if (!window.google?.accounts?.oauth2) {
      try {
        setCalendarStatus("Loading secure Google sign-in…");
        await loadGoogleIdentity();
        setCalendarStatus("Google sign-in is ready. Tap Connect to continue.");
      } catch (error) {
        setCalendarStatus(error.message, "error");
      }
      return;
    }
    try {
      if (!calendarTokenClient) {
        calendarTokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: calendarClientId,
          scope: GOOGLE_SCOPE,
          include_granted_scopes: true,
          callback: async (result) => {
            if (result.error || !result.access_token) {
              setCalendarStatus(`Google sign-in was not completed${result.error ? ` (${result.error})` : ""}.`, "error");
              return;
            }
            calendarAccessToken = result.access_token;
            setCalendarStatus("Google Calendar connected.", "connected");
            const secondsUntilExpiry = Math.max(30, Number(result.expires_in || 3600) - 60);
            window.clearTimeout(calendarRefreshTimer);
            calendarRefreshTimer = window.setTimeout(() => {
              if (calendarAccessToken && window.google?.accounts?.oauth2) {
                calendarTokenClient?.requestAccessToken({ prompt: "" });
              }
            }, secondsUntilExpiry * 1000);
            try {
              await refreshCalendar();
              respond("Your Google Calendar is connected. I’ll read your upcoming events when you ask and can add, move, rename, or remove calendar events at your request.");
            } catch (error) {
              console.error("Unable to sync the connected Google Calendar.", error);
              setCalendarStatus(error.message, "error");
            }
          },
          error_callback: (error) => {
            console.error("Google sign-in couldn't open.", error);
            setCalendarStatus("Google’s sign-in window couldn’t open. Check that pop-ups are allowed and try again.", "error");
          },
        });
      }
      calendarTokenClient.requestAccessToken({ prompt: calendarAccessToken ? "" : "consent" });
    } catch (error) {
      console.error("Google Calendar sign-in failed.", error);
      setCalendarStatus(error.message, "error");
    }
  }

  function disconnectGoogleCalendar() {
    if (!calendarAccessToken) return;
    const token = calendarAccessToken;
    calendarAccessToken = null;
    calendarTokenClient = null;
    calendarEvents = [];
    window.clearTimeout(calendarRefreshTimer);
    if (window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(token, (response) => {
        if (response?.error) console.error("Google didn't confirm token revocation.", response.error);
      });
    }
    renderCalendarEvents();
    setCalendarStatus("Disconnected");
    respond("I’ve disconnected Google Calendar on this device.");
  }

  function parseCalendarStart(text) {
    const now = new Date();
    const timeMatch = text.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
    if (!timeMatch) return null;
    const hourInput = Number(timeMatch[1]);
    const minute = Number(timeMatch[2] || "0");
    if (hourInput < 1 || hourInput > 12 || minute > 59) return null;
    let hour = hourInput % 12;
    if (timeMatch[3].toLowerCase().startsWith("p")) hour += 12;

    const start = new Date(now);
    const weekdayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const requestedWeekday = weekdayNames.findIndex((weekday) => new RegExp(`\\b${weekday}\\b`, "i").test(text));
    if (requestedWeekday !== -1) {
      const dayOffset = (requestedWeekday - now.getDay() + 7) % 7 || 7;
      start.setDate(start.getDate() + dayOffset);
    } else if (/\btomorrow\b/i.test(text)) {
      start.setDate(start.getDate() + 1);
    } else if (/\b(next week)\b/i.test(text)) {
      start.setDate(start.getDate() + 7);
    }
    start.setHours(hour, minute, 0, 0);
    if (requestedWeekday === -1 && !/\b(tomorrow|today|next week)\b/i.test(text) && start.getTime() <= now.getTime()) {
      start.setDate(start.getDate() + 1);
    }
    return start;
  }

  function parseCalendarCreate(text) {
    if (!/\bcalendar\b/i.test(text)) return null;
    const addPrefix = /^(?:(?:hey\s+)?lexie[, ]+)?(?:please\s+)?(?:add|create|schedule|book|put)\s+(?:a\s+)?/i;
    if (!addPrefix.test(text)) return null;
    let details = text.replace(addPrefix, "");
    details = details.replace(/^(?:google\s+)?calendar\s+event(?:\s+(?:called|named|for))?\s+/i, "");
    details = details.replace(/^event(?:\s+(?:called|named|for))?\s+/i, "");
    const calendarConnector = /\s+(?:to|on)\s+(?:my\s+)?(?:google\s+)?calendar\b/i;
    const connector = calendarConnector.exec(details);
    if (connector) {
      details = `${details.slice(0, connector.index)} ${details.slice(connector.index + connector[0].length)}`;
    } else if (!/^.+?\bcalendar\b/i.test(text)) {
      return null;
    }

    const start = parseCalendarStart(details);
    if (!start) return { error: "What time should I put the Google Calendar event down for? Try “Add a dentist appointment to my calendar tomorrow at 3 pm.”" };
    let title = escapeTaskText(
      details
        .replace(/\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/i, "")
        .replace(/\b(?:today|tomorrow|next week|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi, "")
        .replace(/[,.!?]+$/g, ""),
    );
    if (!title) return { error: "What should I call the calendar event?" };
    title = title[0].toUpperCase() + title.slice(1);
    return { title, start };
  }

  function eventDateTime(event) {
    return event?.start?.dateTime || event?.start?.date || "";
  }

  async function findCalendarEvent(query) {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    let candidates = calendarEvents;
    let event = candidates.find((item) => (item.summary || "").toLocaleLowerCase() === normalizedQuery);
    if (!event) event = candidates.find((item) => (item.summary || "").toLocaleLowerCase().includes(normalizedQuery));
    if (event || !normalizedQuery) return event || null;

    const result = await googleCalendarRequest("calendars/primary/events", {
      query: {
        q: query,
        timeMin: new Date(Date.now() - 90 * 86_400_000).toISOString(),
        timeMax: new Date(Date.now() + 365 * 86_400_000).toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 20,
      },
    });
    candidates = Array.isArray(result.items) ? result.items : [];
    event = candidates.find((item) => (item.summary || "").toLocaleLowerCase() === normalizedQuery)
      || candidates.find((item) => (item.summary || "").toLocaleLowerCase().includes(normalizedQuery));
    return event || null;
  }

  async function processCalendarCommand(text) {
    const normalized = text.toLowerCase();
    const asksForEvents = /\b(calendar|google calendar|my events|meetings today)\b/i.test(normalized)
      && /\b(what|show|list|look|check|any|events|meetings|coming up|week|today)\b/i.test(normalized);
    const deleteMatch = /^(?:(?:hey\s+)?lexie[, ]+)?(?:please\s+)?(?:delete|remove|cancel)\s+(?:the\s+)?(?:calendar\s+)?event\s+(.+?)(?:\s+from\s+(?:my\s+)?(?:google\s+)?calendar)?[?.!]*$/i.exec(text);
    const renameMatch = /^(?:(?:hey\s+)?lexie[, ]+)?(?:please\s+)?(?:rename|retitle)\s+(?:the\s+)?(?:calendar\s+)?event\s+(.+?)\s+to\s+(.+?)\s*[?.!]*$/i.exec(text);
    const moveMatch = /^(?:(?:hey\s+)?lexie[, ]+)?(?:please\s+)?(?:move|reschedule)\s+(?:my\s+)?(?:calendar\s+)?event\s+(.+?)\s+(?:to|at)\s+(.+?)\s*[?.!]*$/i.exec(text);
    const createRequest = parseCalendarCreate(text);

    if (!asksForEvents && !deleteMatch && !renameMatch && !moveMatch && !createRequest) return false;
    if (!calendarAccessToken) {
      respond("Connect your Google Calendar using the Calendar card first. You stay in control of what Google access you approve.");
      return true;
    }

    try {
      if (asksForEvents) {
        await refreshCalendar();
        const upcoming = calendarEvents.filter((event) => event.status !== "cancelled" && eventDateTime(event) && new Date(eventDateTime(event)).getTime() >= Date.now());
        const summary = upcoming.slice(0, 6).map((event) => `${event.summary || "Untitled event"}${event.start?.date ? " all day" : ` at ${formatTime(event.start.dateTime)}`}`).join("; ");
        respond(summary ? `In the next seven days, you have: ${summary}.` : "You have no upcoming Google Calendar events this week.");
        return true;
      }

      if (createRequest) {
        if (createRequest.error) {
          respond(createRequest.error);
          return true;
        }
        const { title, start } = createRequest;
        const end = new Date(start.getTime() + 60 * 60 * 1000);
        const event = await googleCalendarRequest("calendars/primary/events", {
          method: "POST",
          body: {
            summary: title,
            start: { dateTime: start.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
            end: { dateTime: end.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
          },
        });
        calendarEvents.push(event);
        renderCalendarEvents();
        respond(`Added “${event.summary || title}” to your Google Calendar for ${formatTime(start.toISOString())}.`);
        return true;
      }

      if (deleteMatch) {
        const event = await findCalendarEvent(deleteMatch[1]);
        if (!event) {
          respond(`I couldn’t find a Google Calendar event matching “${deleteMatch[1]}”.`);
          return true;
        }
        if (!window.confirm(`Remove “${event.summary || "Untitled event"}” from your Google Calendar? This can’t be undone here.`)) {
          respond("I left that calendar event as it was.");
          return true;
        }
        await googleCalendarRequest(`calendars/primary/events/${encodeURIComponent(event.id)}`, { method: "DELETE" });
        calendarEvents = calendarEvents.filter((item) => item.id !== event.id);
        renderCalendarEvents();
        respond(`Removed “${event.summary || "Untitled event"}” from your Google Calendar.`);
        return true;
      }

      if (renameMatch) {
        const event = await findCalendarEvent(renameMatch[1]);
        if (!event) {
          respond(`I couldn’t find a Google Calendar event matching “${renameMatch[1]}”.`);
          return true;
        }
        const summary = escapeTaskText(renameMatch[2]);
        if (!summary) {
          respond("Tell me what new name you want for that calendar event.");
          return true;
        }
        const updated = await googleCalendarRequest(`calendars/primary/events/${encodeURIComponent(event.id)}`, {
          method: "PATCH",
          body: { summary: summary[0].toUpperCase() + summary.slice(1) },
        });
        calendarEvents = calendarEvents.map((item) => item.id === updated.id ? updated : item);
        renderCalendarEvents();
        respond(`I renamed that Google Calendar event to “${updated.summary}”.`);
        return true;
      }

      if (moveMatch) {
        const start = parseCalendarStart(moveMatch[2]);
        if (!start) {
          respond("What time should I move it to? For example, “Move my dentist event to tomorrow at 3 pm.”");
          return true;
        }
        const event = await findCalendarEvent(moveMatch[1]);
        if (!event) {
          respond(`I couldn’t find a Google Calendar event matching “${moveMatch[1]}”.`);
          return true;
        }
        const oldStart = event.start?.dateTime ? new Date(event.start.dateTime) : null;
        const duration = oldStart && event.end?.dateTime
          ? Math.max(60_000, new Date(event.end.dateTime).getTime() - oldStart.getTime())
          : 60 * 60 * 1000;
        const timeZone = event.start?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const updated = await googleCalendarRequest(`calendars/primary/events/${encodeURIComponent(event.id)}`, {
          method: "PATCH",
          body: {
            start: { dateTime: start.toISOString(), timeZone },
            end: { dateTime: new Date(start.getTime() + duration).toISOString(), timeZone },
          },
        });
        calendarEvents = calendarEvents.map((item) => item.id === updated.id ? updated : item);
        renderCalendarEvents();
        respond(`Moved “${updated.summary || event.summary}” to ${formatTime(start.toISOString())} in your Google Calendar.`);
        return true;
      }
    } catch (error) {
      console.error("Google Calendar command failed.", error);
      respond(error.message || "I couldn’t update Google Calendar. Please try again.", false);
    }
    return true;
  }

  function renderTasks() {
    tasks.sort((a, b) => {
      if (!a.dueAt) return b.dueAt ? 1 : 0;
      if (!b.dueAt) return -1;
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    });
    taskList.replaceChildren();
    const remaining = tasks.filter((task) => !task.completed).length;
    count.textContent = `${remaining} ${remaining === 1 ? "THING" : "THINGS"} LEFT`;
    greeting.textContent = remaining
      ? `${remaining} ${remaining === 1 ? "little thing" : "little things"} on your list. One step at a time.`
      : "Your list is clear for now. Nice and easy.";

    if (!tasks.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = '<span class="empty-sun" aria-hidden="true">☼</span><strong>Nothing on your list yet</strong><span>Tell me what you’d like to remember.</span>';
      taskList.append(empty);
      return;
    }

    for (const task of tasks) {
      const row = document.createElement("div");
      row.className = `task-row${task.completed ? " is-complete" : ""}`;

      const check = document.createElement("button");
      check.className = "check-button";
      check.type = "button";
      check.setAttribute("role", "checkbox");
      check.setAttribute("aria-checked", String(task.completed));
      check.setAttribute("aria-label", `${task.completed ? "Mark incomplete" : "Complete"}: ${task.title}`);
      check.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.2 3 3 6-6.4"/></svg>';
      check.addEventListener("click", () => setTaskCompleted(task, !task.completed));

      const details = document.createElement("div");
      details.className = "task-details";
      const title = document.createElement("div");
      title.className = "task-title";
      title.textContent = task.title;
      details.append(title);

      const due = document.createElement("div");
      due.className = "task-due";
      if (task.dueAt) {
        const time = new Date(task.dueAt);
        const dueToday = new Date().toDateString() === time.toDateString();
        due.classList.toggle("overdue", time.getTime() < Date.now() && !task.completed);
        due.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.2 1.5"/></svg>';
        due.append(document.createTextNode(`${dueToday ? "Today" : time.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · ${formatTime(task.dueAt)}`));
      } else {
        due.textContent = "Whenever you’re ready";
      }
      details.append(due);

      const remove = document.createElement("button");
      remove.className = "delete-button";
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ${task.title}`);
      remove.innerHTML = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3.5 5h11m-9.5 0 .7 9h7.6l.7-9M7 5V3.7h4V5m-3 2v4m2-4v4"/></svg>';
      remove.addEventListener("click", () => removeTask(task));

      row.append(check, details, remove);
      taskList.append(row);
    }
  }

  function persistAndRender() {
    saveTasks();
    renderTasks();
    scheduleReminders();
  }

  function scheduleReminders() {
    for (const timer of reminderTimers) window.clearTimeout(timer);
    reminderTimers = [];
    const now = Date.now();
    for (const task of tasks) {
      if (task.completed || task.alerted || !task.dueAt) continue;
      const delay = new Date(task.dueAt).getTime() - now;
      if (delay < 0) continue;
      const timer = window.setTimeout(() => {
        const latest = tasks.find((item) => item.id === task.id);
        if (!latest || latest.completed || latest.alerted) return;
        if (new Date(latest.dueAt).getTime() > Date.now()) {
          scheduleReminders();
          return;
        }
        latest.alerted = true;
        saveTasks();
        const reminder = `A little reminder: ${latest.title}.`;
        respond(reminder);
        if ("Notification" in window && Notification.permission === "granted" && document.visibilityState === "visible") {
          try {
            new Notification("A little reminder from Lexie", { body: latest.title, icon: "./icon.svg", tag: `lexie-${latest.id}` });
          } catch (error) {
            console.error("Couldn't display the browser reminder notification.", error);
          }
        }
        renderTasks();
      }, Math.min(delay, 2147483647));
      reminderTimers.push(timer);
    }
  }

  function setTaskCompleted(task, completed) {
    const target = tasks.find((item) => item.id === task.id);
    if (!target) return;
    target.completed = completed;
    persistAndRender();
    if (completed) respond(`Nicely done! I marked “${target.title}” complete.`, false);
  }

  function findTask(query) {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return null;
    return tasks.find((task) => task.title.toLocaleLowerCase().includes(normalized));
  }

  function removeTask(task) {
    tasks = tasks.filter((item) => item.id !== task.id);
    persistAndRender();
    respond(`Okay, I removed “${task.title}” from your list.`);
  }

  function processMessage(rawText) {
    const text = rawText.trim();
    if (!text) return;
    addMessage(text, "user");
    processCalendarCommand(text)
      .then((handled) => {
        if (!handled) processPlannerMessage(text);
      })
      .catch((error) => {
        console.error("Couldn't process the calendar request.", error);
        respond("I couldn’t finish that calendar request. Please try again.", false);
      });
  }

  function processPlannerMessage(text) {
    const normalized = text.toLowerCase();
    const finish = /^(?:i(?:'m| am) done with|complete|finish|mark done)\s+(.+)$/i.exec(text);
    const remove = /^(?:delete|remove|cancel)\s+(?:my\s+)?(?:reminder\s+)?(.+)$/i.exec(text);

    if (finish) {
      const task = findTask(finish[1]);
      if (!task) return respond("I couldn’t find that on your list. Tell me a few words from the reminder.");
      task.completed = true;
      persistAndRender();
      return respond(`Nicely done! I marked “${task.title}” complete.`);
    }

    if (remove) {
      const task = findTask(remove[1]);
      if (!task) return respond("I couldn’t find that reminder. Try telling me a few words from its name.");
      return removeTask(task);
    }

    const reminder = parseReminder(text);
    if (reminder) {
      tasks.push({ id: newId(), ...reminder, completed: false, alerted: false });
      persistAndRender();
      if (reminder.dueAt) {
        return respond(`All set! I added “${reminder.title}” for ${formatTime(reminder.dueAt)}. Keep Lexie open for its in-app reminder.`);
      }
      return respond(`I added “${reminder.title}” to your day. What time should I put it down for?`);
    }

    if (/(what('?s| is) (on )?my day|my plan|my schedule|what do i have|show.*(plan|reminder)|today'?s plan)/i.test(normalized)) {
      const upcoming = tasks.filter((task) => !task.completed);
      if (!upcoming.length) return respond("Your list is clear for now. Want to add anything to your day?");
      const summary = upcoming.map((task) => `${task.title}${task.dueAt ? ` at ${formatTime(task.dueAt)}` : ""}`).join("; ");
      return respond(`Here’s what you have planned: ${summary}. One step at a time—you’ve got this!`);
    }

    if (/^(hi|hello|hey|good morning|good afternoon|good evening)\b/i.test(text)) {
      return respond("Hi Lexie! It’s lovely to hear from you. What would you like to plan today?");
    }
    if (/\b(help|what can you do)\b/i.test(normalized)) {
      return respond("I can keep your daily list, set reminders, and tell you what’s coming up. If you connect Google Calendar, you can also ask me to read, add, rename, move, or remove calendar events. Try “Remind me to take a break at 3 pm.”");
    }
    return respond("I’m your little daily planner. Tell me “Remind me to…” to add something, ask what’s on your day, or say “I’m done with…” to check it off.");
  }

  function updateVoiceButton(listening) {
    isListening = listening;
    voiceButton.classList.toggle("is-listening", listening);
    voiceButton.setAttribute("aria-label", listening ? "Stop listening" : "Talk to Lexie");
    voiceButton.setAttribute("aria-pressed", String(listening));
    voiceCaption.textContent = listening ? "I’M LISTENING" : "TAP TO TALK";
  }

  function startListening() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      voiceHint.textContent = "Voice input isn’t supported in this browser yet — you can type instead.";
      addMessage("Voice input isn’t available in this browser. You can type a reminder below and I’ll still read my reply aloud.");
      return;
    }
    if (!window.isSecureContext) {
      voiceHint.textContent = "Open the secure website link to use your microphone.";
      return;
    }
    if (!recognition) {
      recognition = new SpeechRecognition();
      recognition.lang = "en-US";
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        const lastResult = event.results[event.results.length - 1];
        if (!lastResult) return;
        const transcript = Array.from(event.results, (result) => result[0].transcript).join(" ").trim();
        input.value = transcript;
        if (lastResult.isFinal) {
          recognition.stop();
          input.value = "";
          voiceHint.textContent = "Or type instead — whatever feels easy.";
          processMessage(transcript);
        }
      };
      recognition.onerror = (event) => {
        if (event.error === "no-speech" || event.error === "aborted") return;
        const message = event.error === "not-allowed"
          ? "Microphone access is off. Allow it in your browser settings, or type instead."
          : "I couldn’t hear that clearly. Try again, or type instead.";
        voiceHint.textContent = message;
        addMessage(message, "error");
        updateVoiceButton(false);
      };
      recognition.onend = () => updateVoiceButton(false);
    }
    try {
      voiceHint.textContent = "Go ahead, I’m listening.";
      updateVoiceButton(true);
      recognition.start();
    } catch (error) {
      console.error("Couldn't start voice input.", error);
      updateVoiceButton(false);
      voiceHint.textContent = "I couldn’t start listening. Please try again or type instead.";
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    processMessage(text);
    input.focus();
  });

  voiceButton.addEventListener("click", () => {
    if (isListening) {
      recognition?.stop();
      updateVoiceButton(false);
      return;
    }
    startListening();
  });

  document.querySelector("#suggestions").addEventListener("click", (event) => {
    const button = event.target.closest("[data-prompt]");
    if (button) processMessage(button.dataset.prompt);
  });

  calendarConnectButton.addEventListener("click", () => {
    if (calendarAccessToken) {
      refreshCalendar().catch((error) => {
        console.error("Couldn't refresh Google Calendar.", error);
        setCalendarStatus(error.message, "error");
      });
    } else {
      connectGoogleCalendar();
    }
  });

  calendarSettingsButton.addEventListener("click", () => {
    document.querySelector("#google-client-id").value = calendarClientId;
    showDialog("#calendar-dialog");
  });

  document.querySelector("#save-calendar-settings").addEventListener("click", () => {
    const clientId = document.querySelector("#google-client-id").value.trim();
    if (!/^[\w-]+\.apps\.googleusercontent\.com$/i.test(clientId)) {
      setCalendarStatus("Paste a valid Google OAuth web-client ID first.", "error");
      return;
    }
    try {
      localStorage.setItem(GOOGLE_CLIENT_KEY, clientId);
    } catch (error) {
      console.error("Couldn't save Google Calendar settings.", error);
      setCalendarStatus("I couldn’t save that ID in this browser.", "error");
      return;
    }
    if (clientId !== calendarClientId) {
      calendarAccessToken = null;
      calendarTokenClient = null;
      calendarEvents = [];
      renderCalendarEvents();
    }
    calendarClientId = clientId;
    document.querySelector("#calendar-dialog").close();
    setCalendarStatus("Google client ID saved · tap Connect to sign in.");
    respond("Your Google Calendar setup is saved on this device. Tap Connect when you’re ready to sign in and approve access.", false);
  });

  calendarDisconnectButton.addEventListener("click", () => {
    if (calendarAccessToken) disconnectGoogleCalendar();
    else if (calendarClientId && window.confirm("Remove the saved Google client ID from this device?")) {
      try {
        localStorage.removeItem(GOOGLE_CLIENT_KEY);
      } catch (error) {
        console.error("Couldn't clear Google Calendar settings.", error);
        setCalendarStatus("I couldn’t clear that setting from this browser.", "error");
        return;
      }
      calendarClientId = "";
      calendarTokenClient = null;
      calendarEvents = [];
      renderCalendarEvents();
      setCalendarStatus("Disconnected");
    }
  });

  function showDialog(id) {
    const dialog = document.querySelector(id);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else window.alert(id === "#install-dialog"
      ? "In Safari, tap Share at the bottom of your screen, then choose Add to Home Screen."
      : "Your to-do list is saved on this device. Voice recognition may use a speech service from your browser or device.");
  }

  installButton.addEventListener("click", async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      return;
    }
    const instructions = document.querySelector("#install-instructions");
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      instructions.innerHTML = 'In Safari, tap the <strong>Share</strong> button at the bottom of your screen, then choose <strong>Add to Home Screen</strong>.';
    } else if (/Android/i.test(navigator.userAgent)) {
      instructions.innerHTML = 'In Chrome, tap the <strong>menu ⋮</strong> at the top, then choose <strong>Add to Home screen</strong> or <strong>Install app</strong>.';
    } else {
      instructions.textContent = "On your phone, open this secure website in Safari or Chrome, tap the browser’s Share or menu button, then choose Add to Home Screen.";
    }
    showDialog("#install-dialog");
  });

  document.querySelector("#privacy-button").addEventListener("click", () => showDialog("#privacy-dialog"));
  document.querySelector("#voice-settings-button").addEventListener("click", () => {
    updateAvailableVoices();
    showDialog("#voice-dialog");
  });
  voiceSelect.addEventListener("change", () => {
    selectedVoiceName = voiceSelect.value;
    try {
      if (selectedVoiceName) localStorage.setItem("lexie-web-voice-v1", selectedVoiceName);
      else localStorage.removeItem("lexie-web-voice-v1");
    } catch (error) {
      console.error("Couldn't save Lexie's voice choice.", error);
      addMessage("I couldn’t save that voice choice on this device.", "error");
    }
  });
  document.querySelector("#preview-voice").addEventListener("click", () => speak("Hello, Lexie. I’m here to help make your day feel a little lighter."));
  document.querySelector("#voice-done").addEventListener("click", () => document.querySelector("#voice-dialog").close());
  window.speechSynthesis?.addEventListener?.("voiceschanged", updateAvailableVoices);
  document.querySelector("#dialog-done").addEventListener("click", () => document.querySelector("#install-dialog").close());
  document.querySelector("#privacy-done").addEventListener("click", () => document.querySelector("#privacy-dialog").close());

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installButton.setAttribute("aria-label", "Install Lexie");
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) scheduleReminders();
  });

  if ("serviceWorker" in navigator && window.location.protocol !== "file:") {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch((error) => {
        console.error("Lexie couldn’t register offline support.", error);
      });
    });
  }

  date.textContent = new Date().toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).toUpperCase();

  if (!("speechSynthesis" in window)) {
    voiceHint.textContent = "Spoken replies aren’t supported in this browser. You can still use your plan by typing.";
  } else {
    updateAvailableVoices();
    if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) {
      voiceHint.textContent = "Voice input varies by browser — typing works everywhere.";
    }
  }

  if (!calendarClientId) {
    setCalendarStatus("Not connected");
    renderCalendarEvents();
  } else {
    setCalendarStatus("Setup saved · tap Connect to sign in");
    renderCalendarEvents();
  }

  renderTasks();
  scheduleReminders();
  window.setInterval(() => {
    const now = Date.now();
    if (tasks.some((task) => task.dueAt && !task.completed && !task.alerted && new Date(task.dueAt).getTime() < now)) {
      renderTasks();
    }
  }, 60_000);
  addMessage("Hi Lexie! I’m here to help with your day. Try “Remind me to call Mom at 5 pm,” or ask what’s on your list.");
})();
