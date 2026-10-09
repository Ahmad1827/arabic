// The practice rounds: the alphabet trainer and the review of saved words.
// Both are short game-like sessions built from several kinds of question,
// with a progress bar, a run counter, sounds and a results screen.

import { LETTERS, LETTER_AUDIO, ALPHABET_GROUPS, TRAINER_LETTERS, letterForms } from "./letters.js";

export const UNLOCK_AT = 2; // strength every letter needs before the next group opens
export const KNOWN_AT = 4;
const ROUND_LENGTH = 10;

// How many letter groups are open: the first, plus each next one once all
// letters before it have been answered correctly a couple of times.
export function unlockedGroups(strengths) {
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
const pick = (items) => items[Math.floor(Math.random() * items.length)];
const stripMarks = (text) => text.replace(/[\p{M}ـ]/gu, "");

// Everyday words for "find the letter" questions; between them they contain
// every letter of the alphabet.
const WORDS = [
  ["باب", "door"], ["بيت", "house"], ["كتاب", "book"], ["مسجد", "mosque"], ["شمس", "sun"], ["قمر", "moon"],
  ["ولد", "boy"], ["بنت", "girl"], ["ماء", "water"], ["خبز", "bread"], ["حليب", "milk"], ["سمك", "fish"],
  ["قلم", "pen"], ["مدرسة", "school"], ["طالب", "student"], ["صديق", "friend"], ["ضوء", "light"], ["ظهر", "noon"],
  ["عين", "eye"], ["غرفة", "room"], ["فيل", "elephant"], ["ثلج", "snow"], ["ذهب", "gold"], ["زيت", "oil"],
  ["جبل", "mountain"], ["حصان", "horse"], ["خروف", "sheep"], ["دجاجة", "chicken"], ["رأس", "head"], ["يد", "hand"],
  ["نهر", "river"], ["هواء", "air"], ["وردة", "rose"], ["لحم", "meat"], ["كلب", "dog"], ["طاولة", "table"],
  ["أرض", "earth"], ["شاي", "tea"], ["قهوة", "coffee"], ["سيارة", "car"], ["مستشفى", "hospital"], ["نظيف", "clean"],
];
// A tapped glyph counts as the letter asked for; alif also covers its hamza forms.
const isLetter = (glyph, letter) => glyph === letter || (letter === "ا" && "أإآ".includes(glyph));
const wordsWith = (letter) => WORDS.filter(([word]) => Array.from(word).some((glyph) => isLetter(glyph, letter)));

const GRADE_BUTTONS = [
  ["again", "Again", "forgot it"],
  ["hard", "Hard", "barely"],
  ["good", "Good", "knew it"],
  ["easy", "Easy", "instantly"],
];

export function createPractice(ctx) {
  const { h, api, icon, iconButton, toast, plural, view, settings, saveSettings, speakLetter, playCard, canSpeak, onProgress, refreshBadge, alive, formsRow, ayahMark } = ctx;

  // ---- Sounds ---------------------------------------------------------------

  let audioContext;
  function chime(notes, shape = "sine") {
    if (!settings.sounds) return;
    try {
      audioContext ??= new AudioContext();
      let at = audioContext.currentTime;
      for (const [frequency, length] of notes) {
        const oscillator = audioContext.createOscillator();
        const volume = audioContext.createGain();
        oscillator.type = shape;
        oscillator.frequency.value = frequency;
        volume.gain.setValueAtTime(0.0001, at);
        volume.gain.exponentialRampToValueAtTime(0.11, at + 0.015);
        volume.gain.exponentialRampToValueAtTime(0.0001, at + length);
        oscillator.connect(volume).connect(audioContext.destination);
        oscillator.start(at);
        oscillator.stop(at + length);
        at += length * 0.7;
      }
    } catch {
      // No sound on this device: the round works the same without it.
    }
  }
  const sounds = {
    right: () => chime([[660, 0.12], [880, 0.2]]),
    wrong: () => chime([[220, 0.16], [165, 0.26]], "triangle"),
    finish: () => chime([[523, 0.14], [659, 0.14], [784, 0.14], [1047, 0.36]]),
  };
  // Spoken audio waits for the chime, so the two do not talk over each other.
  const afterChime = (play) => setTimeout(play, settings.sounds ? 420 : 0);

  // ---- The session frame: progress, run counter, keys, results ----------------

  function startSession({ token, total, back }) {
    const score = { done: 0, right: 0, wrong: 0, run: 0, bestRun: 0 };
    const fill = h("div", { class: "bar-fill" });
    const run = h("span", { class: "combo", hidden: true });
    const mute = iconButton("Sounds on or off", () => {
      settings.sounds = !settings.sounds;
      saveSettings();
      paintMute();
    });
    const paintMute = () => {
      mute.replaceChildren(icon(settings.sounds ? "speaker" : "mute"));
      mute.classList.toggle("off", !settings.sounds);
    };
    paintMute();
    const stage = h("div", { class: "stage" });
    view.replaceChildren(
      h(
        "div",
        { class: "session-top" },
        h("a", { class: "icon-btn session-back", href: back, title: "Leave practice", "aria-label": "Leave practice" }, icon("close")),
        h("div", { class: "bar session-bar", role: "progressbar", "aria-label": "Progress" }, fill),
        run,
        mute,
      ),
      stage,
    );

    const session = {
      score,
      keys: {}, // { choose(n), forward(), back() } for the question on screen
      show(...nodes) {
        stage.replaceChildren(...nodes.flat().filter(Boolean));
        stage.classList.remove("swap");
        void stage.offsetWidth; // restarts the entrance animation
        stage.classList.add("swap");
      },
      // Records an answer in the score and plays its sound.
      answer(correct) {
        if (correct) {
          score.right++;
          score.run++;
          score.bestRun = Math.max(score.bestRun, score.run);
          sounds.right();
        } else {
          score.wrong++;
          score.run = 0;
          sounds.wrong();
        }
        run.hidden = score.run < 2;
        run.replaceChildren(icon("flame"), `${score.run} in a row`);
        run.classList.remove("pop");
        void run.offsetWidth;
        run.classList.add("pop");
      },
      advance() {
        score.done++;
        fill.style.width = `${Math.min(100, (score.done / total) * 100)}%`;
      },
      results({ title, details, actions }) {
        session.keys = {};
        run.hidden = true;
        fill.style.width = "100%";
        const answered = score.right + score.wrong;
        const accuracy = answered ? Math.round((score.right / answered) * 100) : 0;
        sounds.finish();
        if (accuracy >= 80) confetti();
        session.show(
          h(
            "div",
            { class: "card flashcard results" },
            h("div", { class: `ring${accuracy >= 80 ? " done" : ""}`, style: `--p: ${accuracy}` }, h("div", { class: "ring-inner" }, h("strong", {}, `${accuracy}%`), h("span", {}, "right"))),
            h("h1", {}, title),
            h(
              "dl",
              { class: "result-stats" },
              h("dt", {}, "Correct"),
              h("dd", {}, `${score.right} of ${answered}`),
              h("dt", {}, "Longest run"),
              h("dd", {}, plural(score.bestRun, "answer")),
            ),
            details,
            h("div", { class: "result-actions" }, actions),
          ),
        );
      },
    };

    function onKey(event) {
      if (!alive(token)) return document.removeEventListener("keydown", onKey);
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      const { choose, forward, back: undo } = session.keys;
      if (["1", "2", "3", "4"].includes(event.key) && choose) choose(Number(event.key) - 1);
      else if ((event.key === " " || event.key === "Enter") && forward) {
        event.preventDefault();
        forward();
      } else if (event.key === "Backspace" && undo) {
        event.preventDefault();
        undo();
      }
    }
    document.addEventListener("keydown", onKey);
    return session;
  }

  function confetti() {
    const colours = ["#e6b450", "#0d7a6d", "#42c9b5", "#faedcd", "#b47a12"];
    const layer = h(
      "div",
      { class: "confetti", "aria-hidden": "true" },
      Array.from({ length: 44 }, () =>
        h("i", {
          style: `left:${Math.random() * 100}%;background:${pick(colours)};animation-delay:${Math.random() * 0.5}s;animation-duration:${1.8 + Math.random() * 1.4}s;--turn:${Math.random() * 720 - 360}deg`,
        }),
      ),
    );
    document.body.append(layer);
    setTimeout(() => layer.remove(), 3800);
  }

  // A row of answer buttons shared by most questions. `onPick` is told the
  // option; afterwards each button is coloured right, wrong or faded.
  function choices({ options, correct, label, wide, onPick }) {
    let picked = null;
    const buttons = options.map((option, n) =>
      h("button", { type: "button", class: "choice", onclick: () => choose(n) }, label(option), h("kbd", {}, String(n + 1))),
    );
    function choose(n) {
      if (picked !== null || !options[n]) return;
      picked = options[n];
      buttons.forEach((button, i) => {
        button.disabled = true;
        button.classList.add(options[i] === correct ? "right" : options[i] === picked ? "wrong" : "faded");
      });
      onPick(picked === correct);
    }
    return { element: h("div", { class: `choices${wide ? " wide" : ""}` }, buttons), choose };
  }

  // ---- Alphabet -----------------------------------------------------------------

  async function renderAlphabetPractice(token) {
    const strengths = await api("/letters");
    if (!alive(token)) return;
    const introduced = new Set(Object.keys(strengths));
    const session = startSession({ token, total: ROUND_LENGTH, back: "#/alphabet" });
    const openAtStart = unlockedGroups(strengths);
    const missed = new Set();
    let asked = 0;
    let lastLetter = null;

    const unlocked = () => ALPHABET_GROUPS.slice(0, unlockedGroups(strengths)).flatMap((group) => group.letters);
    const nameOf = (letter) => LETTERS[letter][0];
    const soundOf = (letter) => LETTERS[letter][1];

    // Saves one answer about one letter (strength, daily goal, streak).
    async function record(letter, correct) {
      if (!correct) missed.add(letter);
      try {
        const result = await api("/letters/answer", { method: "POST", body: { letter, correct } });
        strengths[letter] = result.strength;
        onProgress(result.progress);
      } catch (err) {
        toast(err.message);
      }
    }

    // Wrong options: look-alikes from the same group first, then other letters.
    function rivals(letter, count = 3) {
      const group = ALPHABET_GROUPS.find((g) => g.letters.includes(letter)).letters;
      return [...new Set([...shuffled(group), ...shuffled(unlocked()), ...shuffled(TRAINER_LETTERS)])].filter((l) => l !== letter).slice(0, count);
    }

    // After any answer: say what it was, then move on (at once if it was right).
    function conclude(letter, correct, stageNodes) {
      session.answer(correct);
      record(letter, correct);
      afterChime(() => alive(token) && speakLetter(letter, { quiet: true }));
      let moved = false;
      const forward = () => {
        if (moved) return;
        moved = true;
        next();
      };
      session.keys = { forward };
      const feedback = h(
        "div",
        { class: "feedback" },
        h("p", { class: correct ? "ok" : "error" }, correct ? pick(["Correct.", "Yes.", "That's it.", "Right."]) : `This is ${nameOf(letter)}, which sounds like: ${soundOf(letter)}.`),
        !correct && formsRow(letter),
        h("button", { class: "primary", type: "button", onclick: forward }, "Continue", h("small", {}, " · space")),
      );
      stageNodes.append(feedback);
      if (correct) setTimeout(() => alive(token) && forward(), 1100);
    }

    function introQuestion(letter) {
      const gotIt = () => {
        introduced.add(letter);
        asked++;
        soundQuestion(letter, letterForms(letter)[0]);
      };
      session.keys = { forward: gotIt };
      session.show(
        h(
          "div",
          { class: "card flashcard" },
          h("p", { class: "eyebrow" }, "New letter"),
          h("div", { class: "panel-head" }, h("span", { class: "big-ar huge", lang: "ar" }, letter), iconButton("Listen", () => speakLetter(letter))),
          h("p", { class: "panel-translit" }, nameOf(letter)),
          h("p", { class: "panel-meaning" }, `sounds like: ${soundOf(letter)}`),
          formsRow(letter),
          h("button", { class: "primary", type: "button", onclick: gotIt }, "Got it", h("small", {}, " · space")),
        ),
      );
      speakLetter(letter, { quiet: true });
    }

    // "Which sound does this letter make?"
    function soundQuestion(letter, form) {
      const card = h("div", { class: "card flashcard" });
      const answers = choices({
        options: shuffled([letter, ...rivals(letter)]),
        correct: letter,
        label: (option) => [h("strong", {}, soundOf(option)), h("small", {}, nameOf(option))],
        onPick: (correct) => conclude(letter, correct, card),
      });
      session.keys = { choose: answers.choose };
      card.append(
        h("p", { class: "eyebrow" }, form.where === "alone" ? "Which sound does this letter make?" : `Which letter is this? It is drawn as it looks at the ${form.where} of a word.`),
        h("span", { class: "big-ar huge", lang: "ar" }, form.text),
        answers.element,
      );
      session.show(card);
    }

    // "Which letter is bā?"
    function letterQuestion(letter) {
      const card = h("div", { class: "card flashcard" });
      const answers = choices({
        options: shuffled([letter, ...rivals(letter)]),
        correct: letter,
        label: (option) => h("span", { class: "letter", lang: "ar" }, option),
        onPick: (correct) => conclude(letter, correct, card),
      });
      session.keys = { choose: answers.choose };
      card.append(h("p", { class: "eyebrow" }, "Which letter is this?"), h("p", { class: "ask-sound" }, h("strong", {}, nameOf(letter)), ` · ${soundOf(letter)}`), answers.element);
      session.show(card);
    }

    // "Listen: which letter did you hear?"
    function listenQuestion(letter) {
      const card = h("div", { class: "card flashcard" });
      const answers = choices({
        options: shuffled([letter, ...rivals(letter)]),
        correct: letter,
        label: (option) => h("span", { class: "letter", lang: "ar" }, option),
        onPick: (correct) => conclude(letter, correct, card),
      });
      session.keys = { choose: answers.choose };
      card.append(
        h("p", { class: "eyebrow" }, "Listen. Which letter did you hear?"),
        h("button", { class: "listen-btn", type: "button", title: "Play again", "aria-label": "Play again", onclick: () => speakLetter(letter) }, icon("speaker")),
        answers.element,
      );
      session.show(card);
      speakLetter(letter, { quiet: true });
    }

    // "Which of these is the same letter, as it looks inside a word?"
    function shapeQuestion(letter) {
      const joined = (l) => letterForms(l).find((form) => form.where === "middle") ?? letterForms(l).at(-1);
      const card = h("div", { class: "card flashcard" });
      const answers = choices({
        options: shuffled([letter, ...rivals(letter)]),
        correct: letter,
        label: (option) => h("span", { class: "letter", lang: "ar" }, joined(option).text),
        onPick: (correct) => conclude(letter, correct, card),
      });
      session.keys = { choose: answers.choose };
      card.append(
        h("p", { class: "eyebrow" }, "Letters change shape inside a word. Which of these is the same letter?"),
        h("span", { class: "big-ar huge", lang: "ar" }, letter),
        answers.element,
      );
      session.show(card);
    }

    // "Tap the letter jīm in this word."
    function findQuestion(letter) {
      const [word, meaning] = pick(wordsWith(letter));
      const card = h("div", { class: "card flashcard" });
      let done = false;
      const glyphs = Array.from(word).map((glyph) => {
        const span = h("span", { class: "glyph", role: "button", tabindex: "0" }, glyph);
        const tap = () => {
          if (done) return;
          done = true;
          const correct = isLetter(glyph, letter);
          glyphs.forEach((other) => other.classList.add(isLetter(other.textContent, letter) ? "right" : "faded"));
          if (!correct) span.classList.replace("faded", "wrong");
          conclude(letter, correct, card);
        };
        span.addEventListener("click", tap);
        span.addEventListener("keydown", (event) => event.key === "Enter" && tap());
        return span;
      });
      session.keys = {};
      card.append(
        h("p", { class: "eyebrow" }, "Tap the letter ", h("strong", {}, nameOf(letter)), ` (${soundOf(letter)}) in this word`),
        h("div", { class: "find-word", lang: "ar", dir: "rtl" }, glyphs),
        h("p", { class: "muted" }, `“${meaning}”`),
      );
      session.show(card);
    }

    // Match four letters to their names.
    function matchQuestion(letters) {
      const card = h("div", { class: "card flashcard" });
      const slipped = new Set();
      const matched = new Set();
      let chosen = { letter: null, name: null };
      const make = (side, letter, content) => {
        const button = h("button", { type: "button", class: `match ${side}`, onclick: () => choose(side, letter) }, content);
        button.dataset.letter = letter;
        return button;
      };
      const letterButtons = shuffled(letters).map((l) => make("letter", l, h("span", { class: "letter", lang: "ar" }, l)));
      const nameButtons = shuffled(letters).map((l) => make("name", l, [h("strong", {}, nameOf(l)), h("small", {}, soundOf(l))]));
      const all = [...letterButtons, ...nameButtons];
      const buttonFor = (side, letter) => all.find((b) => b.classList.contains(side) && b.dataset.letter === letter);

      function choose(side, letter) {
        if (matched.has(letter) && buttonFor(side, letter).disabled) return;
        chosen[side] = letter;
        all.forEach((b) => b.classList.toggle("picked", !b.disabled && chosen[b.classList.contains("letter") ? "letter" : "name"] === b.dataset.letter));
        if (side === "letter") speakLetter(letter, { quiet: true });
        if (!chosen.letter || !chosen.name) return;

        const pair = [buttonFor("letter", chosen.letter), buttonFor("name", chosen.name)];
        if (chosen.letter === chosen.name) {
          const letterDone = chosen.letter;
          matched.add(letterDone);
          pair.forEach((b) => {
            b.disabled = true;
            b.classList.remove("picked");
            b.classList.add("right");
          });
          // A pair found only after a slip counts as missed.
          const clean = !slipped.has(letterDone);
          if (clean) session.answer(true);
          record(letterDone, clean);
        } else {
          for (const l of [chosen.letter, chosen.name]) {
            if (!slipped.has(l)) {
              slipped.add(l);
              session.answer(false);
            }
          }
          pair.forEach((b) => {
            b.classList.remove("picked", "shake");
            void b.offsetWidth;
            b.classList.add("shake");
          });
        }
        chosen = { letter: null, name: null };
        if (matched.size === letters.length) {
          let moved = false;
          const forward = () => {
            if (moved) return;
            moved = true;
            next();
          };
          session.keys = { forward };
          card.append(h("div", { class: "feedback" }, h("button", { class: "primary", type: "button", onclick: forward }, "Continue", h("small", {}, " · space"))));
          setTimeout(() => alive(token) && forward(), 1200);
        }
      }

      session.keys = {};
      card.append(
        h("p", { class: "eyebrow" }, "Match each letter to its name"),
        h("div", { class: "match-grid" }, h("div", { class: "match-col" }, letterButtons), h("div", { class: "match-col" }, nameButtons)),
      );
      session.show(card);
    }

    function finish() {
      const openNow = unlockedGroups(strengths);
      const accuracy = session.score.right / Math.max(1, session.score.right + session.score.wrong);
      session.results({
        title: accuracy === 1 ? "A perfect round" : accuracy >= 0.8 ? "Well done" : accuracy >= 0.5 ? "Good practice" : "Keep going",
        details: [
          openNow > openAtStart && h("p", { class: "note" }, `New letters unlocked: ${ALPHABET_GROUPS[openNow - 1].letters.join(" ")}`),
          missed.size > 0 &&
            h("p", { class: "muted" }, "Worth another look: ", h("span", { class: "missed-letters", lang: "ar" }, [...missed].join("  "))),
        ],
        actions: [
          h("button", { class: "primary", type: "button", onclick: () => renderAlphabetPractice(token) }, "Another round"),
          h("a", { class: "button secondary", href: "#/alphabet" }, "All letters"),
        ],
      });
    }

    // Chooses what to ask next. Weak letters come up more often, new letters
    // are introduced one at a time, and the kind of question keeps changing.
    function next() {
      if (asked >= ROUND_LENGTH) return finish();
      if (asked > 0) session.advance();
      const open = unlocked();
      const seen = open.filter((l) => introduced.has(l));
      const firstNew = open.find((l) => !introduced.has(l));

      // Every few questions, a matching board over the weakest letters.
      if (seen.length >= 4 && asked % 5 === 3) {
        asked++;
        lastLetter = null;
        return matchQuestion(shuffled(seen).sort((a, b) => (strengths[a] ?? 0) - (strengths[b] ?? 0)).slice(0, 4));
      }

      let candidates = seen.map((l) => [l, 6 - (strengths[l] ?? 0)]);
      if (firstNew) candidates.push([firstNew, seen.length === 0 ? 1 : 3]);
      if (candidates.length > 1) candidates = candidates.filter(([l]) => l !== lastLetter);
      let roll = Math.random() * candidates.reduce((sum, [, weight]) => sum + weight, 0);
      const letter = candidates.find(([, weight]) => (roll -= weight) < 0)?.[0] ?? candidates[0][0];
      lastLetter = letter;
      if (!introduced.has(letter)) return introQuestion(letter);

      asked++;
      const strength = strengths[letter] ?? 0;
      const forms = letterForms(letter);
      const kinds = [() => soundQuestion(letter, strength >= UNLOCK_AT ? pick(forms) : forms[0])];
      if (strength > 0) {
        kinds.push(() => letterQuestion(letter));
        if (LETTER_AUDIO[letter] || canSpeak()) kinds.push(() => listenQuestion(letter), () => listenQuestion(letter));
        if (wordsWith(letter).length) kinds.push(() => findQuestion(letter));
        if (forms.length > 2) kinds.push(() => shapeQuestion(letter));
      }
      pick(kinds)();
    }

    next();
  }

  // ---- Reviewing saved words ----------------------------------------------------

  function highlighted(sentence, word) {
    const at = sentence.indexOf(word);
    if (at === -1) return [sentence];
    return [sentence.slice(0, at), h("mark", {}, word), sentence.slice(at + word.length)];
  }

  async function renderReview(token) {
    const [due, everything] = await Promise.all([api("/review"), api("/cards")]);
    if (!alive(token)) return;

    if (due.length === 0) {
      view.replaceChildren(
        h("h1", {}, "Review"),
        h("p", { class: "summary" }, "Nothing is due right now. Save more words while reading, or come back later."),
        h("a", { class: "button", href: "#/" }, "Read something"),
      );
      return;
    }

    // Exercises need other words to use as wrong answers.
    const enoughWords = everything.length >= 4;
    const classic = settings.classicCards || !enoughWords;
    const session = startSession({ token, total: due.length, back: "#/" });
    const queue = [...due];
    const isQuranic = (card) => card.mode === "quranic" || card.mode === "hadith";
    const bare = (card) => stripMarks(card.vowelled);
    const context = (card) => h("p", { class: "context", lang: "ar", dir: "rtl" }, highlighted(card.sentence.replace(ayahMark, ""), card.word));
    const wordHead = (card) =>
      h("div", { class: "panel-head" }, h("span", { class: "big-ar", lang: "ar", dir: "rtl" }, card.vowelled), iconButton("Listen to this word", () => playCard(card)));

    const modeSwitch = enoughWords
      ? h(
          "button",
          {
            type: "button",
            class: "link mode-switch",
            onclick: () => {
              settings.classicCards = !settings.classicCards;
              saveSettings();
              renderReview(token);
            },
          },
          classic ? "Switch to exercises" : "Switch to plain flashcards",
        )
      : h("p", { class: "muted small mode-switch" }, "Save at least 4 words to unlock exercises: choosing meanings, listening and building words.");

    // Three other words to offer as wrong answers, from the same kind of Arabic where possible.
    function rivals(card) {
      const others = everything.filter((other) => other.id !== card.id && other.meaning !== card.meaning && other.vowelled !== card.vowelled);
      const sameMode = shuffled(others.filter((other) => other.mode === card.mode));
      const rest = shuffled(others.filter((other) => other.mode !== card.mode));
      const unique = [];
      for (const other of [...sameMode, ...rest]) {
        if (!unique.some((u) => u.meaning === other.meaning || u.vowelled === other.vowelled)) unique.push(other);
        if (unique.length === 3) break;
      }
      return unique;
    }

    async function grade(card, name) {
      try {
        const { progress } = await api(`/review/${card.id}`, { method: "POST", body: { grade: name } });
        onProgress(progress);
      } catch (err) {
        toast(err.message);
      }
      queue.shift();
      if (name === "again") queue.push(card); // comes round again before the session ends
      else session.advance();
      next();
    }

    // Shown after an exercise is answered: the whole word, then on to the next.
    function reveal(card, correct, stageCard) {
      session.answer(correct);
      afterChime(() => alive(token) && playCard(card, { quiet: true }));
      let chosen = false;
      const finish = (name) => {
        if (chosen) return;
        chosen = true;
        grade(card, name);
      };
      const forward = () => finish(correct ? "good" : "again");
      session.keys = { forward };
      stageCard.append(
        h(
          "div",
          { class: `feedback answer${isQuranic(card) ? " quranic" : ""}` },
          h("p", { class: correct ? "ok" : "error" }, correct ? pick(["Correct.", "Yes.", "That's it.", "Right."]) : "Not quite. Here it is:"),
          wordHead(card),
          h("p", { class: "panel-translit" }, card.translit),
          h("p", { class: "panel-meaning" }, card.meaning),
          card.note && h("p", { class: "note" }, card.note),
          context(card),
          h("p", { class: "translation" }, card.sentence_translation),
          h(
            "div",
            { class: "result-actions" },
            h("button", { class: "primary", type: "button", onclick: forward }, "Continue", h("small", {}, " · space")),
            correct && h("button", { type: "button", class: "too-easy", onclick: () => finish("easy") }, "Too easy"),
          ),
        ),
      );
    }

    const frame = (card, ...children) => h("div", { class: `card flashcard${isQuranic(card) ? " quranic" : ""}` }, children);

    // See the Arabic word, choose its meaning.
    function meaningQuestion(card) {
      const stageCard = frame(card);
      const answers = choices({
        options: shuffled([card, ...rivals(card)]),
        correct: card,
        wide: true,
        label: (option) => h("span", {}, option.meaning),
        onPick: (correct) => reveal(card, correct, stageCard),
      });
      session.keys = { choose: answers.choose };
      stageCard.append(h("p", { class: "eyebrow" }, "What does this word mean?"), wordHead(card), answers.element);
      session.show(stageCard, modeSwitch);
    }

    // See the meaning, choose the Arabic word.
    function wordQuestion(card) {
      const stageCard = frame(card);
      const answers = choices({
        options: shuffled([card, ...rivals(card)]),
        correct: card,
        label: (option) => h("span", { class: "letter word-option", lang: "ar", dir: "rtl" }, option.vowelled),
        onPick: (correct) => reveal(card, correct, stageCard),
      });
      session.keys = { choose: answers.choose };
      stageCard.append(h("p", { class: "eyebrow" }, "Which word means this?"), h("p", { class: "ask-sound" }, card.meaning), answers.element);
      session.show(stageCard, modeSwitch);
    }

    // Hear the word, choose its meaning.
    function listenQuestion(card) {
      const stageCard = frame(card);
      const answers = choices({
        options: shuffled([card, ...rivals(card)]),
        correct: card,
        wide: true,
        label: (option) => h("span", {}, option.meaning),
        onPick: (correct) => reveal(card, correct, stageCard),
      });
      session.keys = { choose: answers.choose };
      stageCard.append(
        h("p", { class: "eyebrow" }, "Listen. What does it mean?"),
        h("button", { class: "listen-btn", type: "button", title: "Play again", "aria-label": "Play again", onclick: () => playCard(card) }, icon("speaker")),
        answers.element,
      );
      session.show(stageCard, modeSwitch);
      playCard(card, { quiet: true });
    }

    // See the meaning, build the word from its letters.
    function buildQuestion(card) {
      const target = Array.from(bare(card));
      let tiles = shuffled(target.map((letter, id) => ({ letter, id })));
      if (tiles.map((t) => t.letter).join("") === target.join("")) tiles = tiles.reverse();
      const placed = [];
      let finished = false;
      const stageCard = frame(card);
      const built = h("div", { class: "built", lang: "ar", dir: "rtl" });
      const tileButtons = tiles.map((tile) => h("button", { type: "button", class: "tile", lang: "ar", onclick: () => place(tile) }, tile.letter));
      const undoButton = iconButton("Remove the last letter", undo, "undo");

      function paint() {
        // Shown as one word, so the letters join up as they are added.
        built.replaceChildren(placed.map((t) => t.letter).join("") || " ");
        built.classList.toggle("empty", placed.length === 0);
        tiles.forEach((tile, i) => (tileButtons[i].disabled = finished || placed.includes(tile)));
        undoButton.disabled = finished || placed.length === 0;
      }
      function place(tile) {
        if (finished || placed.includes(tile)) return;
        placed.push(tile);
        if (placed.length === target.length) {
          finished = true;
          const correct = placed.map((t) => t.letter).join("") === target.join("");
          built.classList.add(correct ? "right" : "wrong");
          paint();
          return reveal(card, correct, stageCard);
        }
        paint();
      }
      function undo() {
        if (finished) return;
        placed.pop();
        paint();
      }

      session.keys = { back: undo, choose: (n) => tiles[n] && place(tiles[n]) };
      stageCard.append(
        h("p", { class: "eyebrow" }, "Build the word, first letter first"),
        h("p", { class: "ask-sound" }, card.meaning, " ", iconButton("Listen to this word", () => playCard(card))),
        h("div", { class: "built-row" }, built, undoButton),
        h("div", { class: "tiles", dir: "rtl" }, tileButtons),
      );
      paint();
      session.show(stageCard, modeSwitch);
    }

    // The plain flashcard: think, turn it over, say how well you knew it.
    function flipQuestion(card) {
      let turned = false;
      function show() {
        session.keys = turned
          ? { choose: (n) => grade(card, GRADE_BUTTONS[n][0]) }
          : {
              forward: () => {
                turned = true;
                show();
                playCard(card, { quiet: true });
              },
            };
        session.show(
          frame(
            card,
            wordHead(card),
            context(card),
            turned
              ? [
                  h("p", { class: "panel-translit" }, card.translit),
                  h("p", { class: "panel-meaning" }, card.meaning),
                  card.note && h("p", { class: "note" }, card.note),
                  h("p", { class: "translation" }, card.sentence_translation),
                  h(
                    "div",
                    { class: "grades" },
                    GRADE_BUTTONS.map(([name, label, hint], n) =>
                      h("button", { type: "button", class: `grade ${name}`, onclick: () => grade(card, name) }, h("strong", {}, label), h("small", {}, `${hint} · ${n + 1}`)),
                    ),
                  ),
                ]
              : h("button", { class: "primary", type: "button", onclick: () => session.keys.forward() }, "Show answer", h("small", {}, " · space")),
          ),
          modeSwitch,
        );
      }
      show();
    }

    function next() {
      if (queue.length === 0) {
        refreshBadge();
        return session.results({
          title: "Review finished",
          details: h("p", { class: "muted" }, "Nothing else is due right now. Words you missed will come back sooner."),
          actions: [h("a", { class: "button", href: "#/" }, "Read something"), h("a", { class: "button secondary", href: "#/words" }, "Your words")],
        });
      }
      const card = queue[0];
      if (classic) return flipQuestion(card);

      const kinds = [meaningQuestion, wordQuestion];
      if (card.audio || canSpeak(card.mode)) kinds.push(listenQuestion);
      const letters = Array.from(bare(card));
      if (letters.length >= 2 && letters.length <= 9 && !/\s/.test(bare(card))) kinds.push(buildQuestion, buildQuestion);
      // A word seen for the first time starts with the gentlest question.
      (card.reps === 0 && !card.lapses ? meaningQuestion : pick(kinds))(card);
    }

    next();
  }

  return { renderAlphabetPractice, renderReview };
}
