// The practice rounds: the alphabet trainer, the courses (vowel marks, words
// and phrases) and the review of saved words. All are short game-like sessions
// built from several kinds of question, with a progress bar, a run counter,
// sounds and a results screen.

import { LETTERS, LETTER_AUDIO, ALPHABET_GROUPS, TRAINER_LETTERS, letterForms } from "./letters.js";
import { courseById, MARK_CARRIERS } from "./lessons.js";

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

// Wrong ways to read a word: the same consonants with one vowel changed, or
// made long or short. Only the vowel marks tell them apart from the right one.
const SHORT_VOWELS = "aiu";
const LONG_VOWELS = "āīū";
export function misreadings(translit, count = 3) {
  const chars = Array.from(translit);
  const variants = new Set();
  chars.forEach((char, at) => {
    const short = SHORT_VOWELS.indexOf(char);
    const long = LONG_VOWELS.indexOf(char);
    if (short === -1 && long === -1) return;
    const swapped = (vowel) => [...chars.slice(0, at), vowel, ...chars.slice(at + 1)].join("");
    for (const vowel of short === -1 ? LONG_VOWELS : SHORT_VOWELS) variants.add(swapped(vowel));
    variants.add(swapped(short === -1 ? SHORT_VOWELS[long] : LONG_VOWELS[short]));
  });
  variants.delete(translit);
  return shuffled([...variants]).slice(0, count);
}

const PRAISE = ["Correct.", "Yes.", "That's it.", "Right."];

const GRADE_BUTTONS = [
  ["again", "Again", "forgot it"],
  ["hard", "Hard", "barely"],
  ["good", "Good", "knew it"],
  ["easy", "Easy", "instantly"],
];

export function createPractice(ctx) {
  const { h, api, icon, iconButton, toast, plural, view, settings, saveSettings, speak, speakLetter, playCard, canSpeak, onProgress, refreshBadge, alive, formsRow, ayahMark } = ctx;

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

  // Tiles tapped in order to rebuild `target`: the letters of a word, or (with
  // a space as `joiner`) the words of a sentence. `extra` tiles do not belong.
  function tileBuilder({ target, extra = [], joiner = "", onDone }) {
    let tiles = shuffled([...target, ...extra].map((text, id) => ({ text, id })));
    if (tiles.map((t) => t.text).join(joiner) === target.join(joiner)) tiles = tiles.reverse();
    const placed = [];
    let finished = false;
    const built = h("div", { class: `built${joiner ? " sentence" : ""}`, lang: "ar", dir: "rtl" });
    const tileButtons = tiles.map((tile) =>
      h("button", { type: "button", class: `tile${joiner ? " word-tile" : ""}`, lang: "ar", onclick: () => place(tile) }, tile.text),
    );
    const undoButton = iconButton(joiner ? "Remove the last word" : "Remove the last letter", undo, "undo");

    function paint() {
      // Shown as running text, so letters join up as they are added.
      built.replaceChildren(placed.map((t) => t.text).join(joiner) || " ");
      built.classList.toggle("empty", placed.length === 0);
      tiles.forEach((tile, i) => (tileButtons[i].disabled = finished || placed.includes(tile)));
      undoButton.disabled = finished || placed.length === 0;
    }
    function place(tile) {
      if (finished || placed.includes(tile)) return;
      placed.push(tile);
      if (placed.length === target.length) {
        finished = true;
        const correct = placed.map((t) => t.text).join(joiner) === target.join(joiner);
        built.classList.add(correct ? "right" : "wrong");
        paint();
        return onDone(correct);
      }
      paint();
    }
    function undo() {
      if (finished) return;
      placed.pop();
      paint();
    }

    paint();
    return {
      elements: [h("div", { class: "built-row" }, built, undoButton), h("div", { class: "tiles", dir: "rtl" }, tileButtons)],
      keys: { back: undo, choose: (n) => tiles[n] && place(tiles[n]) },
    };
  }

  // A board of pairs to join up, left column to right column. `record` is told
  // each pair found and whether it was found without a slip.
  function matchBoard({ session, token, title, items, left, right, onLeft, record, next }) {
    const card = h("div", { class: "card flashcard" });
    const slipped = new Set();
    const matched = new Set();
    const buttons = [];
    let chosen = { left: null, right: null };
    const make = (side, item, content) => {
      const button = h("button", { type: "button", class: "match", onclick: () => choose(side, item) }, content);
      buttons.push({ side, item, button });
      return button;
    };
    const leftButtons = shuffled(items).map((item) => make("left", item, left(item)));
    const rightButtons = shuffled(items).map((item) => make("right", item, right(item)));
    const buttonFor = (side, item) => buttons.find((b) => b.side === side && b.item === item).button;

    function choose(side, item) {
      if (matched.has(item)) return;
      chosen[side] = item;
      buttons.forEach((b) => b.button.classList.toggle("picked", !b.button.disabled && chosen[b.side] === b.item));
      if (side === "left") onLeft?.(item);
      if (!chosen.left || !chosen.right) return;

      const pair = [buttonFor("left", chosen.left), buttonFor("right", chosen.right)];
      if (chosen.left === chosen.right) {
        const found = chosen.left;
        matched.add(found);
        pair.forEach((b) => {
          b.disabled = true;
          b.classList.remove("picked");
          b.classList.add("right");
        });
        // A pair found only after a slip counts as missed.
        const clean = !slipped.has(found);
        if (clean) session.answer(true);
        record(found, clean);
      } else {
        for (const item of [chosen.left, chosen.right]) {
          if (!slipped.has(item)) {
            slipped.add(item);
            session.answer(false);
          }
        }
        pair.forEach((b) => {
          b.classList.remove("picked", "shake");
          void b.offsetWidth;
          b.classList.add("shake");
        });
      }
      chosen = { left: null, right: null };
      if (matched.size === items.length) {
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
    card.append(h("p", { class: "eyebrow" }, title), h("div", { class: "match-grid" }, h("div", { class: "match-col" }, leftButtons), h("div", { class: "match-col" }, rightButtons)));
    session.show(card);
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
        h("p", { class: correct ? "ok" : "error" }, correct ? pick(PRAISE) : `This is ${nameOf(letter)}, which sounds like: ${soundOf(letter)}.`),
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
      matchBoard({
        session,
        token,
        title: "Match each letter to its name",
        items: letters,
        left: (l) => h("span", { class: "letter", lang: "ar" }, l),
        right: (l) => [h("strong", {}, nameOf(l)), h("small", {}, soundOf(l))],
        onLeft: (l) => speakLetter(l, { quiet: true }),
        record,
        next,
      });
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

  // ---- Courses: vowel marks, words and phrases -------------------------------------

  // One round over a unit of a course, or (unit "mixed") over everything met so far.
  async function renderLesson(token, courseId, unitId) {
    const course = courseById(courseId);
    const unit = course?.units.find((u) => u.id === unitId);
    if (!course || (!unit && unitId !== "mixed")) {
      location.hash = "#/practice";
      return;
    }
    const strengths = (await api("/lessons"))[course.id];
    if (!alive(token)) return;

    const isMark = course.kind === "mark";
    const isPhrase = course.kind === "phrase";
    const homeOf = new Map(course.units.flatMap((u) => u.items.map((item) => [item, u])));
    const met = [...homeOf.keys()].filter((item) => item.id in strengths);
    const items = unit ? unit.items : met.length ? met : course.units[0].items;
    const introduced = new Set(met);
    const session = startSession({ token, total: ROUND_LENGTH, back: "#/practice" });
    const missed = new Set();
    let asked = 0;
    let lastItem = null;
    let lastKind = null;
    // A mark is shown on a different consonant in every question.
    let carrier = MARK_CARRIERS[0];

    const strengthOf = (item) => strengths[item.id] ?? 0;
    const arabicOf = (item) => (isMark ? item.write(carrier[0]) : item.ar);
    const readingOf = (item) => (isMark ? item.read(carrier[1]) : item.translit);
    const meaningOf = (item) => (isMark ? `${item.name}: ${item.about}` : item.meaning);
    const wordsIn = (item) => item.ar.replace(/[؟.!،]/g, "").split(" ");
    const say = (item, options) => !isMark && speak(item.ar.replace(/[؟.!،]/g, ""), undefined, options);
    const arabic = (item, size = "") => h("span", { class: `${isPhrase ? "phrase-option" : "letter word-option"} ${size}`, lang: "ar", dir: "rtl" }, arabicOf(item));

    async function record(item, correct) {
      if (!correct) missed.add(item);
      try {
        const result = await api("/lessons/answer", { method: "POST", body: { course: course.id, item: item.id, correct } });
        strengths[item.id] = result.strength;
        onProgress(result.progress);
      } catch (err) {
        toast(err.message);
      }
    }

    // Wrong options: from the same unit first, then earlier units, and later
    // ones only when that leaves too few to choose between.
    function rivals(item, count = 3) {
      const at = course.units.indexOf(homeOf.get(item));
      const near = [...shuffled(homeOf.get(item).items), ...shuffled(course.units.slice(0, at).flatMap((u) => u.items))];
      const far = shuffled(course.units.slice(at + 1).flatMap((u) => u.items));
      const chosen = [];
      for (const other of near.length > 2 ? near : [...near, ...far]) {
        if (other !== item && meaningOf(other) !== meaningOf(item) && !chosen.some((c) => meaningOf(c) === meaningOf(other))) chosen.push(other);
        if (chosen.length === count) break;
      }
      return chosen;
    }

    // After any answer: show what it was, then move on (at once if it was right).
    function conclude(item, correct, card) {
      session.answer(correct);
      record(item, correct);
      afterChime(() => alive(token) && say(item, { quiet: true }));
      let moved = false;
      const forward = () => {
        if (moved) return;
        moved = true;
        next();
      };
      session.keys = { forward };
      card.append(
        h(
          "div",
          { class: "feedback" },
          h("p", { class: correct ? "ok" : "error" }, correct ? pick(PRAISE) : "Not quite. Here it is:"),
          !correct && h("p", { class: `lesson-answer${isPhrase ? " phrase" : ""}`, lang: "ar", dir: "rtl" }, arabicOf(item)),
          h("p", { class: "muted" }, h("strong", {}, readingOf(item)), ` · ${meaningOf(item)}`),
          h("button", { class: "primary", type: "button", onclick: forward }, "Continue", h("small", {}, " · space")),
        ),
      );
      if (correct) setTimeout(() => alive(token) && forward(), isPhrase ? 2200 : 1300);
    }

    function introQuestion(item) {
      const gotIt = () => {
        introduced.add(item);
        asked++;
        (isMark ? readQuestion : meaningQuestion)(item);
      };
      session.keys = { forward: gotIt };
      session.show(
        h(
          "div",
          { class: "card flashcard" },
          h("p", { class: "eyebrow" }, isMark ? "New mark" : isPhrase ? "New phrase" : "New word"),
          h(
            "div",
            { class: "panel-head" },
            h("span", { class: `big-ar${isPhrase ? "" : " huge"}`, lang: "ar", dir: "rtl" }, arabicOf(item)),
            !isMark && iconButton("Listen", () => say(item)),
          ),
          h("p", { class: "panel-translit" }, readingOf(item)),
          h("p", { class: "panel-meaning" }, meaningOf(item)),
          // The same mark on a few other letters.
          isMark &&
            h(
              "span",
              { class: "forms", dir: "rtl" },
              shuffled(MARK_CARRIERS.filter((c) => c !== carrier))
                .slice(0, 3)
                .map(([letter, latin]) => h("span", { class: "form" }, h("span", { class: "form-glyph", lang: "ar" }, item.write(letter)), h("small", { dir: "ltr" }, item.read(latin)))),
            ),
          h("button", { class: "primary", type: "button", onclick: gotIt }, "Got it", h("small", {}, " · space")),
        ),
      );
      say(item, { quiet: true });
    }

    // A question with up to four buttons to choose from.
    function ask(item, { title, prompt, options, correct = item, label, wide, onShown }) {
      const card = h("div", { class: "card flashcard" });
      const answers = choices({ options: shuffled(options), correct, label, wide, onPick: (right) => conclude(item, right, card) });
      session.keys = { choose: answers.choose };
      card.append(h("p", { class: "eyebrow" }, title), prompt, answers.element);
      session.show(card);
      onShown?.();
    }
    const replayButton = (item) =>
      h("button", { class: "listen-btn", type: "button", title: "Play again", "aria-label": "Play again", onclick: () => say(item) }, icon("speaker"));
    const shown = (item) => h("div", { class: "panel-head" }, h("span", { class: `big-ar${isPhrase ? "" : " huge"}`, lang: "ar", dir: "rtl" }, arabicOf(item)));

    // See it written, choose how it is read.
    function readQuestion(item) {
      if (isMark) {
        return ask(item, {
          title: "How is this read?",
          prompt: shown(item),
          options: [item, ...rivals(item)],
          label: (option) => [h("strong", {}, readingOf(option)), h("small", {}, option.name)],
        });
      }
      ask(item, {
        title: "How is this read? Look at the vowel marks.",
        prompt: shown(item),
        options: [item.translit, ...misreadings(item.translit)],
        correct: item.translit,
        label: (option) => h("strong", {}, option),
      });
    }

    // See how it is read, choose the one written that way.
    function spellingQuestion(item) {
      ask(item, {
        title: isMark ? "Which one is read like this?" : "Which word is read like this?",
        prompt: h("p", { class: "ask-sound" }, readingOf(item)),
        options: [item, ...rivals(item)],
        label: (option) => arabic(option),
      });
    }

    // See the Arabic, choose what it means.
    function meaningQuestion(item) {
      ask(item, {
        title: isPhrase ? "What does this mean?" : "What does this word mean?",
        prompt: shown(item),
        options: [item, ...rivals(item)],
        wide: true,
        label: (option) => h("span", {}, option.meaning),
      });
    }

    // See the meaning, choose the Arabic.
    function arabicQuestion(item) {
      ask(item, {
        title: isPhrase ? "How do you say this?" : "Which word means this?",
        prompt: h("p", { class: `ask-sound${isPhrase ? " long" : ""}` }, item.meaning),
        options: [item, ...rivals(item)],
        wide: isPhrase,
        label: (option) => arabic(option),
      });
    }

    // Hear it, choose what it means (or, for a word, which word it was).
    function listenQuestion(item) {
      const byMeaning = isPhrase || Math.random() < 0.5;
      ask(item, {
        title: byMeaning ? "Listen. What does it mean?" : "Listen. Which word did you hear?",
        prompt: replayButton(item),
        options: [item, ...rivals(item)],
        wide: byMeaning,
        label: (option) => (byMeaning ? h("span", {}, option.meaning) : arabic(option)),
        onShown: () => say(item, { quiet: true }),
      });
    }

    // See the meaning, spell the word from its letters.
    function buildQuestion(item) {
      const card = h("div", { class: "card flashcard" });
      const builder = tileBuilder({ target: Array.from(stripMarks(item.ar)), onDone: (correct) => conclude(item, correct, card) });
      session.keys = builder.keys;
      card.append(
        h("p", { class: "eyebrow" }, "Build the word, first letter first"),
        h("p", { class: "ask-sound" }, item.meaning, " ", iconButton("Listen to this word", () => say(item))),
        ...builder.elements,
      );
      session.show(card);
    }

    // Words of other phrases in the unit that could not be mistaken for one of this phrase's.
    function strangers(item) {
      const own = new Set(wordsIn(item).map(stripMarks));
      const others = homeOf.get(item).items.filter((other) => other !== item).flatMap(wordsIn);
      const unique = [];
      for (const word of shuffled(others)) {
        if (!own.has(stripMarks(word)) && !unique.some((u) => stripMarks(u) === stripMarks(word))) unique.push(word);
      }
      return unique;
    }

    // See the meaning, put the words of the sentence in order.
    function orderQuestion(item) {
      const card = h("div", { class: "card flashcard" });
      const builder = tileBuilder({
        target: wordsIn(item),
        extra: strangers(item).slice(0, 2),
        joiner: " ",
        onDone: (correct) => conclude(item, correct, card),
      });
      session.keys = builder.keys;
      card.append(
        h("p", { class: "eyebrow" }, `Put the words in order (${plural(wordsIn(item).length, "word")}; some tiles do not belong)`),
        h("p", { class: "ask-sound long" }, item.meaning),
        ...builder.elements,
      );
      session.show(card);
    }

    // See the sentence with one word taken out, choose the word that belongs there.
    function gapQuestion(item) {
      const parts = wordsIn(item);
      const at = Math.floor(Math.random() * parts.length);
      const gap = h("span", { class: "gap" }, " ");
      const card = h("div", { class: "card flashcard" });
      const answers = choices({
        options: shuffled([parts[at], ...strangers(item).slice(0, 3)]),
        correct: parts[at],
        label: (option) => h("span", { class: "letter word-option", lang: "ar", dir: "rtl" }, option),
        onPick: (correct) => {
          gap.textContent = parts[at];
          gap.classList.add(correct ? "right" : "wrong");
          conclude(item, correct, card);
        },
      });
      session.keys = { choose: answers.choose };
      card.append(
        h("p", { class: "eyebrow" }, "Which word is missing?"),
        h("p", { class: "context gapped", lang: "ar", dir: "rtl" }, parts.flatMap((word, i) => [i > 0 && " ", i === at ? gap : word]), item.ar.endsWith("؟") && "؟"),
        h("p", { class: "ask-sound long" }, item.meaning),
        answers.element,
      );
      session.show(card);
    }

    // Join up a few items with how they are read, or with what they mean.
    function boardQuestion(chosen) {
      matchBoard({
        session,
        token,
        title: isMark ? "Match each one to how it is read" : isPhrase ? "Match each phrase to its meaning" : "Match each word to its meaning",
        items: chosen,
        left: (item) => arabic(item, "small"),
        right: (item) => (isMark ? [h("strong", {}, readingOf(item)), h("small", {}, item.name)] : h("span", {}, item.meaning)),
        onLeft: (item) => say(item, { quiet: true }),
        record,
        next,
      });
    }

    function finish() {
      const accuracy = session.score.right / Math.max(1, session.score.right + session.score.wrong);
      const learned = items.filter((item) => strengthOf(item) >= KNOWN_AT).length;
      const following = unit && course.units[course.units.indexOf(unit) + 1];
      carrier = MARK_CARRIERS[0];
      session.results({
        title: accuracy === 1 ? "A perfect round" : accuracy >= 0.8 ? "Well done" : accuracy >= 0.5 ? "Good practice" : "Keep going",
        details: [
          h("p", { class: "note" }, `${unit ? unit.title : course.title}: ${learned} of ${items.length} learned.`),
          missed.size > 0 &&
            h(
              "div",
              { class: "muted" },
              "Worth another look:",
              h("ul", { class: "missed-items" }, [...missed].map((item) => h("li", {}, h("span", { lang: "ar", dir: "rtl" }, arabicOf(item)), ` ${readingOf(item)}${isMark ? "" : ` · ${item.meaning}`}`))),
            ),
        ],
        actions: [
          h("button", { class: "primary", type: "button", onclick: () => renderLesson(token, courseId, unitId) }, "Another round"),
          following && learned === items.length && h("a", { class: "button", href: `#/practice/${course.id}/${following.id}` }, `Next: ${following.title}`),
          h("a", { class: "button secondary", href: "#/practice" }, "All practice"),
        ],
      });
    }

    // Chooses what to ask next. Weak items come up more often, new ones are
    // introduced one at a time, and the kind of question keeps changing.
    function next() {
      if (asked >= ROUND_LENGTH) return finish();
      if (asked > 0) session.advance();
      carrier = pick(MARK_CARRIERS);
      const seen = items.filter((item) => introduced.has(item));
      const firstNew = items.find((item) => !introduced.has(item));

      // Every few questions, a matching board over the weakest items.
      if (seen.length >= 3 && asked % 5 === 3) {
        asked++;
        lastItem = lastKind = null;
        return boardQuestion(shuffled(seen).sort((a, b) => strengthOf(a) - strengthOf(b)).slice(0, 4));
      }

      let candidates = seen.map((item) => [item, 6 - strengthOf(item)]);
      if (firstNew) candidates.push([firstNew, seen.length === 0 ? 1 : 3]);
      if (candidates.length > 1) candidates = candidates.filter(([item]) => item !== lastItem);
      let roll = Math.random() * candidates.reduce((sum, [, weight]) => sum + weight, 0);
      const item = candidates.find(([, weight]) => (roll -= weight) < 0)?.[0] ?? candidates[0][0];
      lastItem = item;
      if (!introduced.has(item)) return introQuestion(item);

      asked++;
      let kinds;
      if (isMark) kinds = [readQuestion, spellingQuestion];
      else if (strengthOf(item) === 0) kinds = [meaningQuestion];
      else if (isPhrase) {
        kinds = [meaningQuestion, arabicQuestion, orderQuestion, orderQuestion, gapQuestion];
        if (canSpeak()) kinds.push(listenQuestion);
      } else {
        kinds = [meaningQuestion, arabicQuestion, readQuestion, spellingQuestion];
        if (canSpeak()) kinds.push(listenQuestion, listenQuestion);
        const letters = Array.from(stripMarks(item.ar)).length;
        if (letters >= 2 && letters <= 9) kinds.push(buildQuestion, buildQuestion);
      }
      // The same kind of question does not come twice running.
      if (kinds.length > 1) kinds = kinds.filter((kind) => kind !== lastKind);
      lastKind = pick(kinds);
      lastKind(item);
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
          h("p", { class: correct ? "ok" : "error" }, correct ? pick(PRAISE) : "Not quite. Here it is:"),
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
      const stageCard = frame(card);
      const builder = tileBuilder({ target: Array.from(bare(card)), onDone: (correct) => reveal(card, correct, stageCard) });
      session.keys = builder.keys;
      stageCard.append(
        h("p", { class: "eyebrow" }, "Build the word, first letter first"),
        h("p", { class: "ask-sound" }, card.meaning, " ", iconButton("Listen to this word", () => playCard(card))),
        ...builder.elements,
      );
      session.show(stageCard, modeSwitch);
    }

    // See the sentence with the word taken out, choose the word that belongs there.
    function gapQuestion(card) {
      const stageCard = frame(card);
      const sentence = card.sentence.replace(ayahMark, "");
      const at = sentence.indexOf(card.word);
      const gap = h("span", { class: "gap" }, "\u00a0");
      const answers = choices({
        options: shuffled([card, ...rivals(card).filter((other) => other.word !== card.word)]),
        correct: card,
        label: (option) => h("span", { class: "letter word-option", lang: "ar", dir: "rtl" }, option.word),
        onPick: (correct) => {
          gap.textContent = card.word;
          gap.classList.add(correct ? "right" : "wrong");
          reveal(card, correct, stageCard);
        },
      });
      session.keys = { choose: answers.choose };
      stageCard.append(
        h("p", { class: "eyebrow" }, "Which word is missing?"),
        h("p", { class: "context gapped", lang: "ar", dir: "rtl" }, sentence.slice(0, at), gap, sentence.slice(at + card.word.length)),
        h("p", { class: "translation" }, card.sentence_translation),
        answers.element,
      );
      session.show(stageCard, modeSwitch);
    }

    // Hear the word, choose which one it was.
    function hearQuestion(card) {
      const stageCard = frame(card);
      const answers = choices({
        options: shuffled([card, ...rivals(card)]),
        correct: card,
        label: (option) => h("span", { class: "letter word-option", lang: "ar", dir: "rtl" }, option.vowelled),
        onPick: (correct) => reveal(card, correct, stageCard),
      });
      session.keys = { choose: answers.choose };
      stageCard.append(
        h("p", { class: "eyebrow" }, "Listen. Which word did you hear?"),
        h("button", { class: "listen-btn", type: "button", title: "Play again", "aria-label": "Play again", onclick: () => playCard(card) }, icon("speaker")),
        answers.element,
      );
      session.show(stageCard, modeSwitch);
      playCard(card, { quiet: true });
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
      if (card.audio || canSpeak(card.mode)) kinds.push(listenQuestion, hearQuestion);
      const letters = Array.from(bare(card));
      if (letters.length >= 2 && letters.length <= 9 && !/\s/.test(bare(card))) kinds.push(buildQuestion, buildQuestion);
      // A gap needs a sentence around the word.
      const sentence = card.sentence.replace(ayahMark, "");
      if (sentence.includes(card.word) && sentence.trim() !== card.word) kinds.push(gapQuestion, gapQuestion);
      // A word seen for the first time starts with the gentlest question.
      (card.reps === 0 && !card.lapses ? meaningQuestion : pick(kinds))(card);
    }

    next();
  }

  return { renderAlphabetPractice, renderLesson, renderReview };
}
