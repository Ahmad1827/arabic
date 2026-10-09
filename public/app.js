import { LETTERS, LETTER_AUDIO, LETTER_SPOKEN, ALPHABET_GROUPS, TRAINER_LETTERS, letterForms } from "./letters.js";

const view = document.getElementById("view");
const panel = document.getElementById("panel");
const toastEl = document.getElementById("toast");
const dueBadge = document.getElementById("due-badge");
const streakChip = document.getElementById("streak-chip");

const MODE_LABEL = { levantine: "Levantine", quranic: "Quranic", hadith: "Hadith", msa: "Modern Standard" };
const BASMALA = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ";
const AYAH_MARK = /﴿([٠-٩]+)﴾/;

// Quran recitation: one recording per verse from EveryAyah, and one per word
// from Quran.com. Both are streamed, so they need an internet connection.
const RECITERS = [
  ["Alafasy_128kbps", "Mishary Alafasy"],
  ["Husary_128kbps", "Mahmoud Al-Husary"],
  ["Abdul_Basit_Murattal_192kbps", "Abdul Basit"],
  ["Minshawy_Murattal_128kbps", "Al-Minshawi"],
  ["MaherAlMuaiqly128kbps", "Maher Al-Muaiqly"],
  ["Abdurrahmaan_As-Sudais_192kbps", "Abdurrahman As-Sudais"],
];
const pad3 = (n) => String(n).padStart(3, "0");
const verseAudioUrl = (reciter, surah, verse) => `https://everyayah.com/data/${reciter}/${pad3(surah)}${pad3(verse)}.mp3`;
const wordAudioUrl = (surah, verse, word) => `https://audio.qurancdn.com/wbw/${pad3(surah)}_${pad3(verse)}_${pad3(word)}.mp3`;
const recitation = new Audio(); // the one verse player, shared so two verses never overlap

const SAMPLES = [
  {
    label: "Levantine: meeting someone",
    mode: "levantine",
    title: "Meeting someone",
    body: "مرحبا، كيفك؟\nأنا منيح، الحمد لله. وإنت؟\nشو اسمك؟\nاسمي أحمد. من وين إنت؟\nأنا من الشام، بس ساكن هون.\nبدي أتعلم عربي منيح.",
  },
  {
    label: "Quran: Al-Fatiha",
    mode: "quranic",
    title: "Al-Fatiha",
    body: "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ\nالْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ\nالرَّحْمَٰنِ الرَّحِيمِ\nمَالِكِ يَوْمِ الدِّينِ\nإِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ\nاهْدِنَا الصِّرَاطَ الْمُسْتَقِيمَ\nصِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ الْمَغْضُوبِ عَلَيْهِمْ وَلَا الضَّالِّينَ",
  },
];

// ---- Small helpers --------------------------------------------------------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        "X-TZ-Offset": String(new Date().getTimezoneOffset()), // so "today" means the learner's today
        ...(body && { "Content-Type": "application/json" }),
      },
      body: body && JSON.stringify(body),
    });
  } catch {
    throw new Error("Cannot reach the app. Is it still running in the terminal?");
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const ICON_PATHS = {
  speaker: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  play: '<polygon points="7 4 20 12 7 20 7 4"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
};

function icon(name) {
  const span = h("span", { class: `icon icon-${name}`, "aria-hidden": "true" });
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</svg>`;
  return span;
}

let toastTimer;
function toast(message, duration = 4000) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), duration);
}

const stripMarks = (s) => s.replace(/[\p{M}ـ]/gu, "");
const cardKey = (mode, vowelled) => `${mode}|${vowelled}`;

function loadSettings() {
  const defaults = { vowels: true, translit: true, gloss: false, translation: true, reciter: RECITERS[0][0] };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem("reader-settings") || "{}") };
  } catch {
    return defaults;
  }
}
function saveSettings() {
  try {
    localStorage.setItem("reader-settings", JSON.stringify(settings));
  } catch {
    // Private windows may refuse storage; the toggles still work for this visit.
  }
}
const settings = loadSettings();

// ---- Audio ----------------------------------------------------------------

// Everything without a recording is read aloud by the app's own voice, made
// on this computer so it works in every browser. If that voice has not been
// installed, the browser's Arabic voice is used instead, when it has one.
const VOICE_LOCALES = {
  levantine: ["ar-sy", "ar-lb", "ar-jo", "ar-ps", "ar-sa"],
  other: ["ar-sa", "ar-ae", "ar-eg"],
};
const hasBrowserSpeech = "speechSynthesis" in window;
const voiceAudio = new Audio(); // plays the app's own voice
let appVoice = false;
let warnedNoVoice = false;
let currentUtterance = null; // the most recent thing asked to be spoken
if (hasBrowserSpeech) speechSynthesis.getVoices(); // starts loading the voice list
api("/voice")
  .then((voice) => (appVoice = voice.available))
  .catch(() => {});

function pickVoice(mode) {
  if (!hasBrowserSpeech) return null;
  const wanted = VOICE_LOCALES[mode] ?? VOICE_LOCALES.other;
  const score = (voice) => {
    const rank = wanted.indexOf(voice.lang.toLowerCase().replace("_", "-"));
    return (rank === -1 ? 0 : 100 - rank * 10) + (/natural|neural|online/i.test(voice.name) ? 5 : 0);
  };
  const voices = speechSynthesis.getVoices().filter((voice) => voice.lang.toLowerCase().startsWith("ar"));
  return voices.sort((a, b) => score(b) - score(a))[0] ?? null;
}

const canSpeak = (mode) => appVoice || Boolean(pickVoice(mode));

function noVoiceNotice() {
  toast("No Arabic voice is set up yet. In the project folder run: npm run setup-voice, then restart the app.", 9000);
}

function stopSpeaking() {
  voiceAudio.pause();
  if (hasBrowserSpeech) speechSynthesis.cancel();
}

// Speaks the text and returns a handle whose onend/onerror can be set, or
// null if nothing was spoken. `quiet` is for automatic playback: it stays
// silent instead of complaining.
function speak(text, mode, { quiet = false } = {}) {
  if (!canSpeak(mode)) {
    if (!quiet && !warnedNoVoice) noVoiceNotice();
    if (!quiet) warnedNoVoice = true;
    return null;
  }
  // Whatever was being spoken is cut off, and whoever was waiting on it is told.
  const previous = currentUtterance;
  currentUtterance = null;
  stopSpeaking();
  previous?.onerror?.();

  let handle;
  if (appVoice) {
    handle = { onend: null, onerror: null };
    voiceAudio.onended = () => handle.onend?.();
    voiceAudio.onerror = () => {
      handle.onerror?.();
      if (!quiet) toast("The voice could not read that.");
    };
    voiceAudio.src = `/api/tts?text=${encodeURIComponent(text)}`;
    voiceAudio.play().catch(() => {});
  } else {
    const voice = pickVoice(mode);
    handle = new SpeechSynthesisUtterance(text);
    handle.lang = voice.lang;
    handle.voice = voice;
    handle.rate = 0.8;
    speechSynthesis.speak(handle);
  }
  currentUtterance = handle;
  return handle;
}

// A letter is played from a person's recording of its name where there is one.
function speakLetter(letter, options) {
  const file = LETTER_AUDIO[letter];
  if (!file) return void speak(LETTER_SPOKEN[letter] ?? letter, undefined, options);
  const previous = currentUtterance;
  currentUtterance = null;
  stopSpeaking();
  previous?.onerror?.();
  voiceAudio.onended = voiceAudio.onerror = null;
  voiceAudio.src = `audio/letters/${file}.mp3`;
  voiceAudio.play().catch(() => {});
}

const iconButton = (label, onclick, name = "speaker") =>
  h("button", { class: "icon-btn", type: "button", title: label, "aria-label": label, onclick }, icon(name));

const speakButton = (text, label = "Listen", mode) => iconButton(label, () => speak(text, mode));

// A saved word: its recording if it has one (Quran words), else the voice.
function playCard(card, options) {
  if (!card.audio) return void speak(card.vowelled, card.mode, options);
  recitation.pause();
  new Audio(card.audio).play().catch(() => speak(card.vowelled, card.mode, options));
}
const cardAudioButton = (card) => iconButton("Listen to this word", () => playCard(card));

// ---- Routing --------------------------------------------------------------

let renderToken = 0; // bumped on every navigation so stale async work can stop

async function route() {
  const token = ++renderToken;
  view.classList.remove("enter");
  recitation.onended = recitation.onerror = recitation.onplay = recitation.onpause = null;
  recitation.pause();
  stopSpeaking();
  closePanel();
  const hash = location.hash.replace(/^#/, "") || "/";
  const textMatch = hash.match(/^\/text\/(\d+)$/);
  const current = textMatch || hash === "/" ? "read" : hash.split("/")[1];
  for (const link of document.querySelectorAll("[data-nav]")) {
    link.classList.toggle("active", link.dataset.nav === current);
  }
  try {
    if (textMatch) await renderText(Number(textMatch[1]), token);
    else if (hash === "/words") await renderWords(token);
    else if (hash === "/review") await renderReview(token);
    else if (hash.startsWith("/library")) await renderLibrary(token, hash.split("/").slice(2));
    else if (hash === "/settings") await renderSettings(token);
    else if (hash === "/alphabet") await renderAlphabet(token);
    else if (hash === "/alphabet/practice") await renderAlphabetPractice(token);
    else await renderHome(token);
  } catch (err) {
    if (token === renderToken) view.replaceChildren(h("p", { class: "error" }, err.message));
  }
  // Lets the new page fade in once, without replaying on every later redraw.
  if (token === renderToken) {
    view.classList.add("enter");
    setTimeout(() => token === renderToken && view.classList.remove("enter"), 700);
  }
  refreshBadge();
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Called with the latest goal and streak numbers after every practice answer.
function onProgress(progress) {
  streakChip.replaceChildren(icon("flame"), String(progress.streak));
  streakChip.title = `${plural(progress.streak, "day")} in a row · today ${progress.today} of ${progress.goal}`;
  streakChip.classList.toggle("lit", progress.today >= progress.goal);
  streakChip.hidden = false;
  if (progress.justReached) toast(`Daily goal reached. Your streak is now ${plural(progress.streak, "day")}.`);
}

async function refreshBadge() {
  try {
    const stats = await api("/stats");
    dueBadge.textContent = stats.due;
    dueBadge.hidden = stats.due === 0;
    onProgress(stats);
  } catch {
    dueBadge.hidden = true;
  }
}

function progressCard(stats) {
  const done = stats.today >= stats.goal;
  const goalSelect = h(
    "select",
    {
      "aria-label": "Daily goal",
      onchange: async () => {
        try {
          onProgress(await api("/goal", { method: "PUT", body: { goal: Number(goalSelect.value) } }));
          route();
        } catch (err) {
          toast(err.message);
        }
      },
    },
    [5, 10, 20, 30].map((n) => h("option", { value: n, selected: n === stats.goal }, `Daily goal: ${n}`)),
  );
  const now = Date.now();

  const left = stats.goal - stats.today;
  const title = done ? "Goal reached today" : stats.today === 0 ? "Start today's practice" : `${plural(left, "answer")} to go today`;

  return h(
    "section",
    { class: "card progress" },
    h(
      "div",
      { class: "progress-top" },
      h(
        "div",
        {
          class: `ring${done ? " done" : ""}`,
          style: `--p: ${Math.min(100, (stats.today / stats.goal) * 100)}`,
          role: "progressbar",
          "aria-label": "Today's goal",
          "aria-valuemin": 0,
          "aria-valuemax": stats.goal,
          "aria-valuenow": Math.min(stats.today, stats.goal),
        },
        h("div", { class: "ring-inner" }, h("strong", {}, String(stats.today)), h("span", {}, `of ${stats.goal}`)),
      ),
      h(
        "div",
        { class: "progress-text" },
        h("p", { class: "progress-title" }, title),
        h(
          "p",
          { class: `streak-line${stats.streak > 0 ? " lit" : ""}` },
          icon("flame"),
          h("strong", {}, stats.streak === 0 ? "No streak yet" : `${stats.streak}-day streak`),
          stats.best > stats.streak && h("span", { class: "muted" }, `best: ${stats.best}`),
        ),
      ),
    ),
    h(
      "ol",
      { class: "week", "aria-label": "Last 7 days" },
      stats.week.map((day, i) =>
        h(
          "li",
          { class: day.met ? "met" : day.count > 0 ? "some" : "", title: plural(day.count, "answer") },
          h("span", { class: "dot" }, day.met && icon("check")),
          h("span", { class: "day" }, new Date(now - (6 - i) * 86_400_000).toLocaleDateString(undefined, { weekday: "short" })),
        ),
      ),
    ),
    h(
      "div",
      { class: "progress-actions" },
      stats.due > 0 && h("a", { class: "button", href: "#/review" }, `Review ${plural(stats.due, "word")}`),
      h("a", { class: stats.due > 0 ? "button secondary" : "button", href: "#/alphabet/practice" }, "Practise the alphabet"),
    ),
    h(
      "div",
      { class: "progress-foot" },
      h("span", { class: "muted small" }, `Flashcards and letter answers both count. Saved words: ${stats.words}.`),
      goalSelect,
    ),
  );
}

// ---- Home: add a text, list of texts --------------------------------------

async function renderHome(token) {
  const [texts, stats] = await Promise.all([api("/texts"), api("/stats")]);
  if (token !== renderToken) return;

  const body = h("textarea", {
    dir: "auto",
    rows: 6,
    placeholder: "Paste Arabic text here: a message, song lyrics, a verse, a news paragraph…",
    required: true,
  });
  const title = h("input", { type: "text", placeholder: "Title (optional)" });
  const mode = h(
    "select",
    { "aria-label": "Kind of Arabic" },
    Object.entries(MODE_LABEL).map(([value, label]) => h("option", { value }, label)),
  );
  const submit = h("button", { class: "primary", type: "submit" }, "Read it");

  const form = h(
    "form",
    {
      class: "card new-text",
      onsubmit: async (event) => {
        event.preventDefault();
        submit.disabled = true;
        try {
          const { id } = await api("/texts", {
            method: "POST",
            body: { body: body.value, title: title.value, mode: mode.value },
          });
          location.hash = `#/text/${id}`;
        } catch (err) {
          toast(err.message);
          submit.disabled = false;
        }
      },
    },
    h("h2", {}, "Read something"),
    body,
    h("div", { class: "row" }, title, mode, submit),
    h(
      "p",
      { class: "samples" },
      "Nothing to paste? Try: ",
      SAMPLES.map((sample) =>
        h(
          "button",
          {
            type: "button",
            class: "link",
            onclick: () => {
              body.value = sample.body;
              title.value = sample.title;
              mode.value = sample.mode;
            },
          },
          sample.label,
        ),
      ),
    ),
  );

  const list = texts.length
    ? h(
        "ul",
        { class: "text-list" },
        texts.map((text) =>
          h(
            "li",
            {},
            h("a", { href: `#/text/${text.id}`, dir: "auto" }, text.title),
            h("span", { class: "tag" }, MODE_LABEL[text.mode]),
            h(
              "button",
              {
                class: "icon-btn",
                type: "button",
                title: "Delete this text",
                "aria-label": `Delete ${text.title}`,
                onclick: async () => {
                  if (!confirm(`Delete "${text.title}"? Words you saved from it are kept.`)) return;
                  await api(`/texts/${text.id}`, { method: "DELETE" });
                  route();
                },
              },
              icon("close"),
            ),
          ),
        ),
      )
    : h("p", { class: "muted" }, "Texts you read will be listed here.");

  const firstVisit = texts.length === 0 && stats.words === 0 && stats.best === 0 && stats.today === 0;
  const step = (title, text, href) =>
    h(href ? "a" : "div", { class: "step", href }, h("strong", {}, title), h("span", {}, text));
  const steps =
    firstVisit &&
    h(
      "div",
      { class: "steps" },
      step("Learn the letters", "A few minutes in the alphabet trainer.", "#/alphabet/practice"),
      step("Read something real", "Paste a text below and tap any word."),
      step("Review your words", "Saved words return just before you forget them."),
    );

  const promoTile = (href, arabic, title, text) =>
    h("a", { class: "promo", href }, h("span", { class: "promo-ar", lang: "ar" }, arabic), h("strong", {}, title), h("span", {}, text));
  const promo = h(
    "div",
    { class: "library-promo" },
    promoTile("#/library", "القرآن", "Read the Quran", "All 114 surahs, word by word"),
    promoTile("#/library/hadith", "الحديث", "Read hadith", "Nawawi's Forty, Bukhari, Muslim and more"),
  );

  view.replaceChildren(
    ...[progressCard(stats), steps, promo, form, h("section", {}, h("h2", {}, "Your texts"), list)].filter(Boolean),
  );
}

// ---- Reader ---------------------------------------------------------------

const TOGGLES = [
  ["vowels", "Vowel marks"],
  ["translit", "Pronunciation"],
  ["gloss", "Meanings"],
  ["translation", "Translation"],
];

async function renderText(id, token) {
  const [text, cards] = await Promise.all([api(`/texts/${id}`), api("/cards")]);
  if (token !== renderToken) return;

  const saved = new Map(cards.map((card) => [cardKey(card.mode, card.vowelled), card.id]));
  const article = h("article", { class: `reader ${text.mode}` });
  const applySettings = () => {
    for (const [name] of TOGGLES) article.classList.toggle(`hide-${name}`, !settings[name]);
  };
  applySettings();

  const toolbar = h(
    "div",
    { class: "toolbar" },
    TOGGLES.map(([name, label]) => {
      const box = h("input", {
        type: "checkbox",
        checked: settings[name],
        onchange: () => {
          settings[name] = box.checked;
          saveSettings();
          applySettings();
        },
      });
      return h("label", { class: "toggle" }, box, label);
    }),
  );
  const status = h("div", { class: "status" });

  const blocks = text.sentences.map(() => h("section", { class: "sentence" }));

  function markSaved() {
    for (const button of article.querySelectorAll(".word[data-key]")) {
      button.classList.toggle("saved", saved.has(button.dataset.key));
    }
  }

  // A sentence is read from its vowelled words where they are known: the
  // voice pronounces fully vowelled Arabic far more accurately.
  function spokenText(sentence) {
    let wordIndex = 0;
    return sentence.tokens
      .map((token) => {
        if (!token.isWord) return AYAH_MARK.test(token.pre + token.core + token.post) ? "" : token.pre + token.core + token.post;
        const entry = sentence.analysis?.words[wordIndex++];
        return token.pre + (entry?.vowelled || token.core) + token.post;
      })
      .filter(Boolean)
      .join(" ");
  }

  function draw(index) {
    const sentence = text.sentences[index];
    const row = h("div", { class: "words", dir: "rtl", lang: "ar" });
    let wordIndex = 0;
    for (const token of sentence.tokens) {
      if (!token.isWord) {
        const plain = token.pre + token.core + token.post;
        const ayah = plain.match(AYAH_MARK);
        row.append(ayah ? h("span", { class: "ayah", title: "Verse number" }, ayah[1]) : h("span", { class: "plain" }, plain));
        continue;
      }
      const k = wordIndex++;
      const entry = sentence.analysis?.words[k];
      const key = entry && cardKey(text.mode, entry.vowelled);
      row.append(
        h(
          "button",
          {
            class: `word${entry ? "" : " pending"}`,
            type: "button",
            "data-key": key,
            onclick: entry && ((event) => openWord({ entry, sentence, index, k }, event.currentTarget)),
          },
          h("span", { class: "ar ar-v" }, token.pre + (entry?.vowelled || token.core) + token.post),
          h("span", { class: "ar ar-p" }, token.pre + token.core + token.post),
          h("span", { class: "tr", dir: "ltr", lang: "en" }, entry?.translit ?? (sentence.analysis ? "" : "…")),
          h("span", { class: "gl", dir: "ltr", lang: "en" }, entry?.meaning ?? ""),
        ),
      );
    }
    blocks[index].replaceChildren(
      row,
      h(
        "div",
        { class: "sentence-foot" },
        text.surah
          ? h(
              "button",
              {
                class: "icon-btn",
                type: "button",
                title: "Listen to this verse",
                "aria-label": `Listen to verse ${index + 1}`,
                onclick: () => (playing?.index === index && !recitation.paused ? stopRecitation() : playVerse(index, false)),
              },
              icon("speaker"),
            )
          : iconButton("Listen to this sentence", () => speak(spokenText(sentence), text.mode)),
        h("p", { class: "translation" }, sentence.analysis?.translation ?? ""),
      ),
    );
    markSaved();
  }

  function openWord({ entry, sentence, index, k }, button) {
    article.querySelector(".word.selected")?.classList.remove("selected");
    button.classList.add("selected");
    const key = cardKey(text.mode, entry.vowelled);
    const letters = Array.from(stripMarks(entry.vowelled)).filter((ch) => LETTERS[ch]);

    const saveButton = h("button", { class: "primary", type: "button" });
    const paintSave = () => {
      saveButton.textContent = saved.has(key) ? "Saved · tap to remove" : "Save this word";
      saveButton.classList.toggle("done", saved.has(key));
    };
    saveButton.addEventListener("click", async () => {
      saveButton.disabled = true;
      try {
        if (saved.has(key)) {
          await api(`/cards/${saved.get(key)}`, { method: "DELETE" });
          saved.delete(key);
        } else {
          const card = await api("/cards", { method: "POST", body: { textId: id, index, word: k } });
          saved.set(key, card.id);
        }
        markSaved();
        refreshBadge();
      } catch (err) {
        toast(err.message);
      }
      saveButton.disabled = false;
      paintSave();
    });
    paintSave();

    const fact = (label, value, attrs = {}) => value && [h("dt", {}, label), h("dd", attrs, value)];

    panel.replaceChildren(
      h("button", { class: "icon-btn close", type: "button", "aria-label": "Close", onclick: closePanel }, icon("close")),
      h(
        "div",
        { class: "panel-head" },
        h("span", { class: "big-ar", lang: "ar", dir: "rtl" }, entry.vowelled),
        // Words that came from Quran.com (no dictionary details) have a recorded pronunciation.
        text.surah && !entry.lemma && !entry.pos
          ? h(
              "button",
              {
                class: "icon-btn",
                type: "button",
                title: "Listen to this word",
                "aria-label": "Listen to this word",
                onclick: () => {
                  recitation.pause();
                  new Audio(wordAudioUrl(text.surah.number, index + 1, k + 1)).play().catch(() => speak(entry.vowelled, text.mode));
                },
              },
              icon("speaker"),
            )
          : speakButton(entry.vowelled, "Listen to this word", text.mode),
      ),
      h("p", { class: "panel-translit" }, entry.translit),
      h("p", { class: "panel-meaning" }, entry.meaning),
      h(
        "dl",
        {},
        fact("Dictionary form", entry.lemma, { lang: "ar", dir: "rtl", class: "ar-inline" }),
        fact("Root", entry.root, { lang: "ar", dir: "rtl", class: "ar-inline" }),
        fact("Type", entry.pos),
      ),
      entry.note && h("p", { class: "note" }, entry.note),
      h("h3", {}, "Letter by letter"),
      h(
        "ol",
        { class: "letters", dir: "rtl" },
        letters.map((ch) =>
          h(
            "li",
            {},
            h("span", { class: "letter", lang: "ar" }, ch),
            h("span", { class: "letter-name", dir: "ltr" }, LETTERS[ch][0]),
            h("span", { class: "letter-sound", dir: "ltr" }, LETTERS[ch][1]),
          ),
        ),
      ),
      saveButton,
    );
    panel.hidden = false;
    document.body.classList.add("panel-open");
  }

  // Long texts are shown a page at a time, and only the page on screen is
  // analysed, so opening a long hadith does not analyse all of it at once.
  const PAGE_SIZE = 15;
  const pageCount = Math.max(1, Math.ceil(text.sentences.length / PAGE_SIZE));
  const pageKey = `reader-page-${id}`;
  let page = 0;
  try {
    page = Math.min(pageCount - 1, Number(localStorage.getItem(pageKey)) || 0);
  } catch {
    // No storage: start from the beginning.
  }
  let pending = [];
  let total = 0;
  let active = 0;
  let failed = false;

  function paintStatus(error) {
    if (error) {
      status.replaceChildren(
        h("p", { class: "error" }, error),
        h(
          "div",
          { class: "row" },
          h("button", { type: "button", onclick: startWorkers }, "Try again"),
          h("a", { class: "button secondary", href: "#/settings" }, "Open Settings"),
        ),
      );
    } else if (pending.length + active > 0) {
      status.replaceChildren(
        h("p", { class: "muted" }, `Working out the words… ${Math.max(0, total - pending.length - active)} of ${total} ready`),
      );
    } else {
      status.replaceChildren();
    }
  }

  async function worker() {
    active++;
    while (pending.length && !failed && token === renderToken) {
      const index = pending.shift();
      try {
        text.sentences[index].analysis = await api("/analyze", { method: "POST", body: { textId: id, index } });
        if (token !== renderToken) break;
        draw(index);
        paintStatus();
      } catch (err) {
        pending.unshift(index);
        failed = true;
        if (token === renderToken) paintStatus(err.message);
      }
    }
    active--;
    if (!failed && token === renderToken) paintStatus();
  }

  function startWorkers() {
    failed = false;
    paintStatus();
    for (let n = active; n < 3 && n < pending.length + active; n++) worker();
  }

  const pagers = [h("div", { class: "pager" }), h("div", { class: "pager" })];

  function showPage(scrollUp) {
    closePanel();
    const first = page * PAGE_SIZE;
    const indexes = text.sentences.slice(first, first + PAGE_SIZE).map((_, i) => first + i);
    article.replaceChildren(...indexes.map((i) => blocks[i]));
    indexes.forEach(draw);
    pending = indexes.filter((i) => !text.sentences[i].analysis);
    total = pending.length;

    const unit = text.surah ? "Verses" : "Sentences";
    for (const pager of pagers) {
      pager.hidden = pageCount === 1;
      pager.replaceChildren(
        h("button", { type: "button", disabled: page === 0, onclick: () => turn(-1) }, "Previous"),
        h("span", { class: "muted" }, `${unit} ${first + 1}–${first + indexes.length} of ${text.sentences.length}`),
        h("button", { type: "button", class: "primary", disabled: page === pageCount - 1, onclick: () => turn(1) }, "Next"),
      );
    }
    try {
      localStorage.setItem(pageKey, String(page));
    } catch {
      // The page is simply not remembered.
    }
    startWorkers();
    if (scrollUp) window.scrollTo({ top: 0 });
  }

  function turn(step) {
    page = Math.min(pageCount - 1, Math.max(0, page + step));
    showPage(true);
  }

  // ---- Listening: recorded recitation for library surahs, the browser's
  // Arabic voice for every other text ----

  let playing = null; // { index, continuous, basmala, paused, utterance } while something is loaded
  const unit = text.surah ? "Verse" : "Sentence";
  const playButton = h("button", { class: "primary play", type: "button", onclick: togglePlay });
  const stopButton = iconButton("Stop", stopRecitation, "stop");
  const playLabel = h("span", { class: "player-label" });
  const reciterSelect = h(
    "select",
    {
      "aria-label": "Reciter",
      onchange: () => {
        settings.reciter = reciterSelect.value;
        saveSettings();
        if (playing) playVerse(playing.index, playing.continuous, playing.basmala);
      },
    },
    RECITERS.map(([folder, name]) => h("option", { value: folder, selected: folder === settings.reciter }, name)),
  );
  const player = h("div", { class: "player" }, playButton, stopButton, playLabel, text.surah && reciterSelect);
  const isPaused = () => (text.surah ? recitation.paused : playing.paused);

  function paintPlayer() {
    const active = playing && !isPaused();
    const idle = text.surah ? "Play recitation" : "Read aloud";
    playButton.replaceChildren(icon(active ? "pause" : "play"), active ? "Pause" : playing ? "Resume" : idle);
    stopButton.hidden = !playing;
    playLabel.textContent = !playing ? "" : playing.basmala ? "Basmala" : `${unit} ${playing.index + 1} of ${text.sentences.length}`;
    player.classList.toggle("active", Boolean(playing));
  }

  function playVerse(index, continuous, basmala = false) {
    playing = { index, continuous, basmala, paused: false, utterance: null };
    if (text.surah) {
      // The basmala before a surah is recited from the opening verse of Al-Fatiha.
      recitation.src = basmala ? verseAudioUrl(settings.reciter, 1, 1) : verseAudioUrl(settings.reciter, text.surah.number, index + 1);
      recitation.play().catch(() => {}); // a failed load is reported by onerror below
    } else {
      const utterance = speak(spokenText(text.sentences[index]), text.mode);
      playing.utterance = utterance;
      const done = (finishedNormally) => {
        if (playing?.utterance !== utterance) return; // paused, stopped or already moved on
        // Something else was spoken instead (a single word, say): hand over quietly.
        if (!finishedNormally || currentUtterance !== utterance) {
          playing.utterance = null;
          return stopRecitation();
        }
        finished();
      };
      utterance.onend = () => done(true);
      utterance.onerror = () => done(false);
    }
    article.querySelector(".sentence.playing")?.classList.remove("playing");
    if (!basmala) {
      blocks[index].classList.add("playing");
      if (continuous) blocks[index].scrollIntoView({ block: "center", behavior: "smooth" });
    }
    paintPlayer();
  }

  // The current recording or sentence has ended: move on, or stop at the end.
  function finished() {
    if (!playing) return;
    const { index, continuous, basmala } = playing;
    if (basmala) return playVerse(index, continuous);
    if (!continuous || index + 1 >= text.sentences.length) return stopRecitation();
    const next = index + 1;
    if (Math.floor(next / PAGE_SIZE) !== page) {
      page = Math.floor(next / PAGE_SIZE);
      showPage(true);
    }
    playVerse(next, true);
  }

  function stopRecitation() {
    const speaking = playing?.utterance;
    playing = null;
    recitation.pause();
    if (speaking) stopSpeaking();
    article.querySelector(".sentence.playing")?.classList.remove("playing");
    paintPlayer();
  }

  function togglePlay() {
    if (!playing) {
      if (!text.surah && !canSpeak(text.mode)) return noVoiceNotice();
      return playVerse(page * PAGE_SIZE, true, Boolean(text.surah?.basmala) && page === 0);
    }
    if (text.surah) {
      if (recitation.paused) recitation.play().catch(() => {});
      else recitation.pause();
    } else if (playing.paused) {
      playVerse(playing.index, true); // the voice restarts the sentence it was on
    } else {
      playing.paused = true;
      playing.utterance = null;
      stopSpeaking();
      paintPlayer();
    }
  }

  if (text.surah) {
    recitation.onplay = recitation.onpause = paintPlayer;
    recitation.onended = finished;
    recitation.onerror = () => {
      if (!playing) return;
      stopRecitation();
      toast("Could not load the recitation. It needs an internet connection.");
    };
  }
  toolbar.append(player);
  paintPlayer();

  const head = text.surah
    ? h(
        "header",
        { class: "surah-banner" },
        h("span", { class: "medallion" }, String(text.surah.number)),
        h("h1", { class: "surah-arabic", lang: "ar", dir: "rtl" }, `سورة ${text.surah.nameArabic}`),
        h("p", { class: "surah-latin" }, `${text.surah.name} · ${text.surah.meaning}`),
        h("p", { class: "surah-meta" }, `${text.surah.place} · ${plural(text.surah.verses, "verse")}`),
        text.surah.basmala && h("p", { class: "basmala", lang: "ar", dir: "rtl" }, BASMALA),
      )
    : h("div", { class: "reader-head" }, h("h1", { dir: "auto" }, text.title), h("span", { class: "tag" }, MODE_LABEL[text.mode]));

  view.replaceChildren(
    ...[
      head,
      toolbar,
      text.translation &&
        h("details", { class: "full-translation" }, h("summary", {}, "Full English translation"), h("p", {}, text.translation)),
      status,
      pagers[0],
      article,
      pagers[1],
      text.source && h("p", { class: "source" }, text.source),
    ].filter(Boolean),
  );
  showPage(false);
}

function closePanel() {
  document.querySelector(".word.selected")?.classList.remove("selected");
  panel.hidden = true;
  document.body.classList.remove("panel-open");
}

// ---- Saved words ----------------------------------------------------------

function dueLabel(due) {
  const days = (due - Date.now()) / 86_400_000;
  if (days <= 0) return "due now";
  if (days < 1) return "due today";
  const rounded = Math.round(days);
  return `in ${rounded} ${rounded === 1 ? "day" : "days"}`;
}

async function renderWords(token) {
  const cards = await api("/cards");
  if (token !== renderToken) return;

  if (cards.length === 0) {
    view.replaceChildren(
      h("h1", {}, "Your words"),
      h("p", { class: "muted" }, "No saved words yet. Open a text, tap a word and choose “Save this word”."),
    );
    return;
  }

  view.replaceChildren(
    h("h1", {}, `Your words (${cards.length})`),
    h(
      "ul",
      { class: "word-list" },
      cards.map((card) =>
        h(
          "li",
          {},
          h("span", { class: "ar-inline wl-ar", lang: "ar", dir: "rtl" }, card.vowelled),
          h("span", { class: "wl-main" }, h("strong", {}, card.translit), ` — ${card.meaning}`),
          h("span", { class: "tag" }, MODE_LABEL[card.mode]),
          h("span", { class: "muted wl-due" }, dueLabel(card.due)),
          cardAudioButton(card),
          h(
            "button",
            {
              class: "icon-btn",
              type: "button",
              title: "Remove this word",
              "aria-label": `Remove ${card.translit}`,
              onclick: async () => {
                if (!confirm(`Remove "${card.translit}" and its review history?`)) return;
                await api(`/cards/${card.id}`, { method: "DELETE" });
                route();
              },
            },
            icon("close"),
          ),
        ),
      ),
    ),
  );
}

// ---- Review ---------------------------------------------------------------

const GRADE_BUTTONS = [
  ["again", "Again", "forgot it"],
  ["hard", "Hard", "barely"],
  ["good", "Good", "knew it"],
  ["easy", "Easy", "instantly"],
];

function highlighted(sentence, word) {
  const at = sentence.indexOf(word);
  if (at === -1) return [sentence];
  return [sentence.slice(0, at), h("mark", {}, word), sentence.slice(at + word.length)];
}

async function renderReview(token) {
  const queue = await api("/review");
  if (token !== renderToken) return;
  let answered = 0;
  let revealed = false;
  let busy = false;

  function finish() {
    view.replaceChildren(
      h("h1", {}, "Review"),
      h(
        "p",
        { class: "summary" },
        answered > 0
          ? `Done. You answered ${answered} ${answered === 1 ? "card" : "cards"}; nothing else is due right now.`
          : "Nothing is due right now. Save more words while reading, or come back later.",
      ),
      h("a", { class: "button", href: "#/" }, "Read something"),
    );
    refreshBadge();
  }

  async function grade(name) {
    if (busy) return;
    busy = true;
    const card = queue[0];
    try {
      const { progress } = await api(`/review/${card.id}`, { method: "POST", body: { grade: name } });
      onProgress(progress);
      answered++;
      queue.shift();
      if (name === "again") queue.push(card); // ask again before the session ends
      revealed = false;
      show();
    } catch (err) {
      toast(err.message);
    }
    busy = false;
  }

  // Turning a card over also says the word, so sound and spelling stick together.
  function reveal() {
    revealed = true;
    show();
    playCard(queue[0], { quiet: true });
  }

  function show() {
    if (queue.length === 0) return finish();
    const card = queue[0];
    const isQuranic = card.mode === "quranic" || card.mode === "hadith";

    const back = revealed && [
      h("p", { class: "panel-translit" }, card.translit),
      h("p", { class: "panel-meaning" }, card.meaning),
      card.note && h("p", { class: "note" }, card.note),
      h("p", { class: "translation" }, card.sentence_translation),
      h(
        "div",
        { class: "grades" },
        GRADE_BUTTONS.map(([name, label, hint], n) =>
          h("button", { type: "button", class: `grade ${name}`, onclick: () => grade(name) }, h("strong", {}, label), h("small", {}, `${hint} · ${n + 1}`)),
        ),
      ),
    ];

    view.replaceChildren(
      h("p", { class: "muted" }, `${queue.length} ${queue.length === 1 ? "card" : "cards"} left`),
      h(
        "div",
        { class: `card flashcard ${isQuranic ? "quranic" : ""}` },
        h(
          "div",
          { class: "panel-head" },
          h("span", { class: "big-ar", lang: "ar", dir: "rtl" }, card.vowelled),
          cardAudioButton(card),
        ),
        h("p", { class: "context", lang: "ar", dir: "rtl" }, highlighted(card.sentence.replace(AYAH_MARK, ""), card.word)),
        revealed
          ? back
          : h(
              "button",
              {
                class: "primary",
                type: "button",
                onclick: reveal,
              },
              "Show answer",
              h("small", {}, " · space"),
            ),
      ),
    );
  }

  function onKey(event) {
    if (token !== renderToken) return document.removeEventListener("keydown", onKey);
    if (queue.length === 0) return;
    if (!revealed && (event.key === " " || event.key === "Enter")) {
      event.preventDefault();
      reveal();
    } else if (revealed && ["1", "2", "3", "4"].includes(event.key)) {
      grade(GRADE_BUTTONS[Number(event.key) - 1][0]);
    }
  }
  document.addEventListener("keydown", onKey);

  show();
}

// ---- Library: Quran and hadith ---------------------------------------------

// Opens a library text in the reader, downloading it the first time.
async function openFromLibrary(button, path, slow) {
  button.disabled = true;
  button.classList.add("loading");
  if (slow) toast("Downloading this one for the first time. Long surahs can take half a minute.");
  try {
    const { id } = await api(path, { method: "POST" });
    location.hash = `#/text/${id}`;
  } catch (err) {
    toast(err.message);
    button.disabled = false;
    button.classList.remove("loading");
  }
}

const libraryTabs = (current) =>
  h(
    "div",
    { class: "segmented" },
    h("a", { href: "#/library", class: current === "quran" ? "on" : "" }, "Quran"),
    h("a", { href: "#/library/hadith", class: current === "hadith" ? "on" : "" }, "Hadith"),
  );

async function renderLibrary(token, parts) {
  if (parts[0] === "hadith") return renderHadith(token, parts[1], parts[2]);

  const surahs = await api("/library/quran");
  if (token !== renderToken) return;
  const simplify = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

  const cards = surahs.map((surah) => {
    const card = h(
      "button",
      {
        class: `surah-card${surah.textId ? " opened" : ""}`,
        type: "button",
        onclick: () => openFromLibrary(card, `/library/quran/${surah.number}`, !surah.textId && surah.verses > 60),
      },
      h("span", { class: "medallion" }, String(surah.number)),
      h("span", { class: "surah-names" }, h("strong", {}, surah.name), h("small", {}, `${surah.meaning} · ${plural(surah.verses, "verse")}`)),
      h("span", { class: "surah-ar", lang: "ar" }, surah.nameArabic),
    );
    card.dataset.search = simplify(`${surah.number} ${surah.name} ${surah.meaning}`);
    return card;
  });

  const empty = h("p", { class: "muted", hidden: true }, "No surah matches that search.");
  const search = h("input", {
    type: "search",
    class: "search",
    placeholder: "Search by name or number, e.g. Yasin or 36",
    "aria-label": "Search surahs",
    oninput: () => {
      const query = simplify(search.value);
      let shown = 0;
      for (const card of cards) {
        card.hidden = !card.dataset.search.includes(query);
        if (!card.hidden) shown++;
      }
      empty.hidden = shown > 0;
    },
  });

  view.replaceChildren(
    h("h1", {}, "Library"),
    libraryTabs("quran"),
    h("p", { class: "muted" }, "Every word shows its pronunciation and meaning straight away. Surahs you have opened are marked in gold and work offline."),
    search,
    h("div", { class: "surah-grid" }, cards),
    empty,
  );
}

async function renderHadith(token, key, section) {
  const collections = await api("/library/hadith");
  if (token !== renderToken) return;
  const collection = collections.find((c) => c.key === key);
  const firstPage = (c) => (c.sections.length === 1 ? `#/library/hadith/${c.key}/${c.sections[0].number}` : `#/library/hadith/${c.key}`);

  if (!collection) {
    view.replaceChildren(
      h("h1", {}, "Library"),
      libraryTabs("hadith"),
      h("p", { class: "muted" }, "Pick a collection. New to hadith? Start with an-Nawawi's Forty: short, famous and fully vowelled."),
      h(
        "div",
        { class: "collection-grid" },
        collections.map((c) =>
          h("a", { class: "collection-card", href: firstPage(c) }, h("strong", {}, c.title), h("span", {}, c.blurb), h("small", {}, c.sections.length === 1 ? plural(c.sections[0].count, "hadith") : `${c.sections.length} books`)),
        ),
      ),
    );
    return;
  }

  if (section === undefined) {
    view.replaceChildren(
      h("p", { class: "crumb" }, h("a", { href: "#/library/hadith" }, "Hadith collections")),
      h("h1", {}, collection.title),
      h(
        "ol",
        { class: "book-list" },
        collection.sections.map((s) =>
          h(
            "li",
            {},
            h(
              "a",
              { href: `#/library/hadith/${collection.key}/${s.number}` },
              h("span", { class: "medallion" }, String(s.number)),
              h("strong", {}, s.title),
            ),
          ),
        ),
      ),
    );
    return;
  }

  const hadiths = await api(`/library/hadith/${collection.key}/${section}`);
  if (token !== renderToken) return;
  const book = collection.sections.find((s) => String(s.number) === section);
  const single = collection.sections.length === 1;

  view.replaceChildren(
    h(
      "p",
      { class: "crumb" },
      h("a", { href: single ? "#/library/hadith" : `#/library/hadith/${collection.key}` }, single ? "Hadith collections" : collection.title),
    ),
    h("h1", {}, single ? collection.title : (book?.title ?? collection.title)),
    h("p", { class: "muted" }, "Open a hadith to read it word by word. The words are explained as you reach them."),
    h(
      "div",
      { class: "hadith-list" },
      hadiths.map((hadith) => {
        const card = h(
          "button",
          {
            class: `hadith-card${hadith.textId ? " opened" : ""}`,
            type: "button",
            onclick: () => openFromLibrary(card, `/library/hadith/${collection.key}/${section}/${hadith.number}`),
          },
          h("span", { class: "medallion" }, String(hadith.number)),
          h("span", { class: "hadith-ar", lang: "ar", dir: "rtl" }, hadith.arabic),
          hadith.english && h("span", { class: "hadith-en" }, hadith.english),
        );
        return card;
      }),
    ),
  );
}

// ---- Settings ---------------------------------------------------------------

// The AI that explains words is chosen by whoever runs the app.
const AI_CHOICES = [
  {
    id: "claude-code",
    title: "Claude Code on this computer",
    text: "Uses the Claude Code app that is installed and logged in here. Nothing to paste. It counts toward that Claude plan's usage limits.",
    fields: ["model"],
    modelPlaceholder: "sonnet (or opus, haiku)",
  },
  {
    id: "anthropic",
    title: "Claude with your own API key",
    text: "Pay-as-you-go access to Claude. Create a key at console.anthropic.com and paste it here.",
    fields: ["apiKey", "model"],
    modelPlaceholder: "claude-opus-5-5",
  },
  {
    id: "openai-compatible",
    title: "Another AI service",
    text: "Any service that uses the OpenAI chat format: OpenAI, Google Gemini, OpenRouter, Groq, or a model running on your own computer with Ollama.",
    fields: ["baseUrl", "apiKey", "model"],
    modelPlaceholder: "the model's name, as your service lists it",
  },
];
const SERVICE_ADDRESSES = [
  ["OpenAI", "https://api.openai.com/v1"],
  ["Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai"],
  ["OpenRouter", "https://openrouter.ai/api/v1"],
  ["Groq", "https://api.groq.com/openai/v1"],
  ["Ollama on this computer", "http://localhost:11434/v1"],
];

async function renderSettings(token) {
  const [ai, voice] = await Promise.all([api("/ai"), api("/voice")]);
  if (token !== renderToken) return;
  let chosen = ai.provider;

  const inputs = {
    baseUrl: h("input", { type: "text", value: ai.baseUrl, placeholder: "https://…", autocomplete: "off", spellcheck: "false" }),
    apiKey: h("input", { type: "password", autocomplete: "off", placeholder: ai.hasKey ? "A key is saved. Leave empty to keep it." : "Paste the key" }),
    model: h("input", { type: "text", value: ai.model, autocomplete: "off", spellcheck: "false" }),
  };
  const labels = { baseUrl: "Service address", apiKey: "API key", model: "Model" };
  const hints = {
    baseUrl: h(
      "span",
      { class: "field-hint" },
      "Fill in: ",
      SERVICE_ADDRESSES.map(([name, address]) =>
        h("button", { type: "button", class: "link", onclick: () => (inputs.baseUrl.value = address) }, name),
      ),
    ),
    apiKey: h("span", { class: "field-hint" }, "Stored only on this computer, in the app's data folder. Ollama needs no key."),
    model: h("span", { class: "field-hint" }, "Leave empty for the usual choice."),
  };
  const fields = Object.fromEntries(
    Object.keys(inputs).map((name) => [name, h("label", { class: "field" }, h("span", {}, labels[name]), inputs[name], hints[name])]),
  );
  const result = h("p", { class: "settings-result", role: "status" });
  const save = h("button", { class: "primary", type: "submit" }, "Save and test");

  const cards = AI_CHOICES.map((choice) => {
    const radio = h("input", { type: "radio", name: "provider", value: choice.id, checked: choice.id === chosen });
    radio.addEventListener("change", () => {
      chosen = choice.id;
      paint();
    });
    return h("label", { class: "choice-card" }, radio, h("span", {}, h("strong", {}, choice.title), h("small", {}, choice.text)));
  });

  function paint() {
    const choice = AI_CHOICES.find((c) => c.id === chosen);
    cards.forEach((card, i) => card.classList.toggle("on", AI_CHOICES[i].id === chosen));
    for (const [name, field] of Object.entries(fields)) field.hidden = !choice?.fields.includes(name);
    if (choice) inputs.model.placeholder = choice.modelPlaceholder;
    hints.model.hidden = chosen === "openai-compatible";
    save.disabled = !choice;
  }
  paint();

  const form = h(
    "form",
    {
      class: "card settings",
      onsubmit: async (event) => {
        event.preventDefault();
        save.disabled = true;
        result.className = "settings-result muted";
        result.textContent = "Saving, then trying it on a short sentence…";
        try {
          await api("/ai", {
            method: "PUT",
            body: { provider: chosen, model: inputs.model.value, baseUrl: inputs.baseUrl.value, apiKey: inputs.apiKey.value },
          });
          inputs.apiKey.value = "";
          const test = await api("/ai/test", { method: "POST" });
          result.className = "settings-result ok";
          result.textContent = `It works. It read “أهلا وسهلا” as “${test.translation}”.`;
        } catch (err) {
          result.className = "settings-result error";
          result.textContent = err.message;
        }
        save.disabled = false;
      },
    },
    h("h2", {}, "Who explains the words"),
    h(
      "p",
      { class: "muted" },
      "Texts you paste and hadith are explained word by word by an AI that you choose and set up yourself. The Quran, the alphabet trainer and reviewing need no AI.",
    ),
    cards,
    Object.values(fields),
    h("div", { class: "row" }, save),
    result,
  );

  view.replaceChildren(...[
    h("h1", {}, "Settings"),
    !ai.provider && h("p", { class: "note" }, "Nothing is chosen yet, so pasted texts and hadith cannot be explained. Pick one of the options below."),
    form,
    h(
      "section",
      { class: "card" },
      h("h2", {}, "Voice"),
      h(
        "p",
        { class: voice.available ? "" : "muted" },
        voice.available
          ? "The app's own Arabic voice is installed, so reading aloud works in every browser."
          : "The app's own Arabic voice is not installed, so reading aloud depends on your browser. To add it, run “npm run setup-voice” in the project folder and restart the app.",
      ),
      h("p", { class: "muted small" }, "Quran recitation uses real recordings and needs only an internet connection."),
    ),
  ].filter(Boolean));
}

// ---- Alphabet trainer -----------------------------------------------------

const UNLOCK_AT = 2; // strength every letter needs before the next group opens
const KNOWN_AT = 4;

// How many letter groups are open: the first, plus each next one once all
// letters before it have been answered correctly a couple of times.
function unlockedGroups(strengths) {
  let open = 1;
  while (
    open < ALPHABET_GROUPS.length &&
    ALPHABET_GROUPS.slice(0, open).every((group) => group.letters.every((l) => (strengths[l] ?? 0) >= UNLOCK_AT))
  ) {
    open++;
  }
  return open;
}

const shuffled = (items) =>
  items
    .map((item) => [Math.random(), item])
    .sort((a, b) => a[0] - b[0])
    .map(([, item]) => item);

function strengthMeter(strength) {
  return h(
    "span",
    { class: "meter", title: `Strength ${strength} of 5` },
    [1, 2, 3, 4, 5].map((n) => h("i", { class: n <= strength ? "on" : "" })),
  );
}

const formsRow = (letter) =>
  h(
    "span",
    { class: "forms", dir: "rtl" },
    letterForms(letter).map((form) =>
      h("span", { class: "form" }, h("span", { class: "form-glyph", lang: "ar" }, form.text), h("small", { dir: "ltr" }, form.where)),
    ),
  );

async function renderAlphabet(token) {
  const strengths = await api("/letters");
  if (token !== renderToken) return;
  const open = unlockedGroups(strengths);
  const known = TRAINER_LETTERS.filter((l) => (strengths[l] ?? 0) >= KNOWN_AT).length;

  view.replaceChildren(
    h("h1", {}, "The alphabet"),
    h(
      "p",
      { class: "summary" },
      `${known} of ${TRAINER_LETTERS.length} letters known.`,
      h("a", { class: "button", href: "#/alphabet/practice" }, "Practise"),
    ),
    h(
      "p",
      { class: "muted" },
      "Arabic is written right to left, and most letters change shape depending on whether they stand alone or sit at the start, middle or end of a word. Practice starts with the first group and opens the next one as you get the letters right. Tap a letter to hear it.",
    ),
    ...ALPHABET_GROUPS.map((group, index) =>
      h(
        "section",
        { class: `letter-group${index < open ? "" : " locked"}` },
        h("h2", {}, `${index + 1}. ${group.title}`, index >= open && h("span", { class: "tag" }, "not in practice yet")),
        h(
          "div",
          { class: "letter-grid", dir: "rtl" },
          group.letters.map((letter) =>
            h(
              "button",
              { class: "letter-tile", type: "button", onclick: () => speakLetter(letter) },
              h("span", { class: "letter", lang: "ar" }, letter),
              h("strong", { dir: "ltr" }, LETTERS[letter][0]),
              h("span", { class: "letter-sound", dir: "ltr" }, LETTERS[letter][1]),
              formsRow(letter),
              strengthMeter(strengths[letter] ?? 0),
            ),
          ),
        ),
      ),
    ),
  );
}

// Chooses what to ask next. Weak letters come up more often, and new letters
// are introduced one at a time, in order.
function nextQuestion(strengths, introduced, lastLetter) {
  const open = unlockedGroups(strengths);
  const unlocked = ALPHABET_GROUPS.slice(0, open).flatMap((group) => group.letters);
  const seen = unlocked.filter((l) => introduced.has(l));
  const firstNew = unlocked.find((l) => !introduced.has(l));

  let candidates = seen.map((l) => [l, 6 - (strengths[l] ?? 0)]);
  if (firstNew) candidates.push([firstNew, seen.length === 0 ? 1 : 3]);
  if (candidates.length > 1) candidates = candidates.filter(([l]) => l !== lastLetter);

  let roll = Math.random() * candidates.reduce((sum, [, weight]) => sum + weight, 0);
  const letter = candidates.find(([, weight]) => (roll -= weight) < 0)?.[0] ?? candidates[0][0];
  if (!introduced.has(letter)) return { kind: "intro", letter };
  return quizFor(letter, strengths, unlocked);
}

function quizFor(letter, strengths, unlocked) {
  const strength = strengths[letter] ?? 0;
  const group = ALPHABET_GROUPS.find((g) => g.letters.includes(letter)).letters;
  // Wrong options: look-alikes from the same group first, then other letters.
  const others = [...new Set([...shuffled(group), ...shuffled(unlocked), ...shuffled(TRAINER_LETTERS)])].filter((l) => l !== letter);
  const forms = letterForms(letter);
  return {
    kind: strength > 0 && Math.random() < 0.5 ? "pick-letter" : "pick-sound",
    letter,
    form: strength >= UNLOCK_AT ? forms[Math.floor(Math.random() * forms.length)] : forms[0],
    options: shuffled([letter, ...others.slice(0, 3)]),
  };
}

async function renderAlphabetPractice(token) {
  const strengths = await api("/letters");
  if (token !== renderToken) return;
  const introduced = new Set(Object.keys(strengths));
  let question;
  let picked = null;
  let answered = 0;

  function advance() {
    picked = null;
    question = nextQuestion(strengths, introduced, question?.letter);
    show();
  }

  function gotIt() {
    introduced.add(question.letter);
    const open = unlockedGroups(strengths);
    question = quizFor(question.letter, strengths, ALPHABET_GROUPS.slice(0, open).flatMap((g) => g.letters));
    question.kind = "pick-sound";
    show();
  }

  async function choose(option) {
    if (picked) return;
    picked = option;
    const asked = question;
    const correct = option === asked.letter;
    show();
    speakLetter(asked.letter, { quiet: true });
    try {
      const openBefore = unlockedGroups(strengths);
      const result = await api("/letters/answer", { method: "POST", body: { letter: asked.letter, correct } });
      strengths[asked.letter] = result.strength;
      answered++;
      onProgress(result.progress);
      if (unlockedGroups(strengths) > openBefore) toast("New letters unlocked.");
    } catch (err) {
      toast(err.message);
    }
    if (correct) {
      setTimeout(() => {
        if (token === renderToken && question === asked) advance();
      }, 900);
    }
  }

  function show() {
    const [name, sound] = LETTERS[question.letter];
    const head = h(
      "p",
      { class: "muted practice-head" },
      h("a", { href: "#/alphabet" }, "All letters"),
      `${answered} answered this session`,
    );

    if (question.kind === "intro") {
      view.replaceChildren(
        head,
        h(
          "div",
          { class: "card flashcard" },
          h("p", { class: "muted" }, "New letter"),
          h("div", { class: "panel-head" }, h("span", { class: "big-ar huge", lang: "ar" }, question.letter), iconButton("Listen", () => speakLetter(question.letter))),
          h("p", { class: "panel-translit" }, name),
          h("p", { class: "panel-meaning" }, `sounds like: ${sound}`),
          formsRow(question.letter),
          h("button", { class: "primary", type: "button", onclick: gotIt }, "Got it", h("small", {}, " · space")),
        ),
      );
      speakLetter(question.letter, { quiet: true });
      return;
    }

    const askSound = question.kind === "pick-sound";
    const prompt = askSound
      ? [
          h("span", { class: "big-ar huge", lang: "ar" }, question.form.text),
          h(
            "p",
            { class: "muted" },
            question.form.where === "alone" ? "Which sound does this letter make?" : `Which letter is this? It is drawn the way it looks at the ${question.form.where} of a word.`,
          ),
        ]
      : [h("p", { class: "ask-sound" }, h("strong", {}, name), ` · ${sound}`), h("p", { class: "muted" }, "Which letter is this?")];

    view.replaceChildren(
      head,
      h(
        "div",
        { class: "card flashcard" },
        prompt,
        h(
          "div",
          { class: `choices${askSound ? "" : " letters-choice"}` },
          question.options.map((option, n) => {
            const state = !picked ? "" : option === question.letter ? " right" : option === picked ? " wrong" : " faded";
            return h(
              "button",
              { type: "button", class: `choice${state}`, disabled: Boolean(picked), onclick: () => choose(option) },
              askSound
                ? [h("strong", {}, LETTERS[option][1]), h("small", {}, LETTERS[option][0])]
                : h("span", { class: "letter", lang: "ar" }, option),
              h("kbd", {}, String(n + 1)),
            );
          }),
        ),
        picked &&
          h(
            "div",
            { class: "feedback" },
            h(
              "p",
              { class: picked === question.letter ? "ok" : "error" },
              picked === question.letter ? "Correct." : `Not quite. This is ${name}, which sounds like: ${sound}.`,
            ),
            picked !== question.letter && formsRow(question.letter),
            h("button", { class: "primary", type: "button", onclick: advance }, "Next", h("small", {}, " · space")),
          ),
      ),
    );
  }

  function onKey(event) {
    if (token !== renderToken) return document.removeEventListener("keydown", onKey);
    const forward = event.key === " " || event.key === "Enter";
    if (question.kind === "intro") {
      if (forward) {
        event.preventDefault();
        gotIt();
      }
    } else if (picked) {
      if (forward) {
        event.preventDefault();
        advance();
      }
    } else if (["1", "2", "3", "4"].includes(event.key)) {
      choose(question.options[Number(event.key) - 1]);
    }
  }
  document.addEventListener("keydown", onKey);

  advance();
}

window.addEventListener("hashchange", route);
route();
