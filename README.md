# Arabic Reader

Read the Quran, hadith collections or any Arabic text you paste, word by word: vowel marks, pronunciation, meaning, root and a letter-by-letter breakdown for every word. Save words and review them with spaced repetition.

## Run it

1. `npm install` (first time only)
2. `npm run setup-voice` (first time only, optional but recommended): installs the app's own Arabic voice, about 260 MB, so read-aloud works in every browser. Needs Python 3.
3. `npm start`, then open http://localhost:3000

## Choose your own AI

Texts you paste and hadith are explained word by word by an AI. The app ships with none configured: open **Settings** (the sliders icon in the header) and choose one. It is then tested on a short sentence.

- **Claude Code on this computer**: uses the `claude` command, installed and logged in. Nothing to paste; it counts toward that Claude plan's usage limits.
- **Claude with your own API key**: pay-as-you-go, with a key from console.anthropic.com.
- **Another AI service**: anything with an OpenAI-style chat endpoint, such as OpenAI, Google Gemini, OpenRouter, Groq, or a model running locally with Ollama. You give the address, the model name and, if the service needs one, a key.

Keys are stored only in `data/app.db` on your computer. The Quran, the alphabet trainer and reviewing work without any AI.

## How it is built

- `server.js`: web server and API. Data lives in `data/app.db` (SQLite).
- `src/analyze.js`: asks the configured AI to analyse one sentence. Each sentence is analysed once and then cached.
- `src/library.js`: the built-in library. Quran text, translation and word-by-word meanings come from Quran.com; hadith text and translations from the open hadith-api project. Both are downloaded once and then kept locally.
- `src/voice.js` and `scripts/voice-worker.py`: the read-aloud voice ([Piper](https://github.com/OHF-Voice/piper1-gpl) with an Arabic voice model), running locally. Quran recitation is separate: real recordings streamed from EveryAyah and Quran.com.
- `src/text.js`: splits text into sentences and words.
- `src/srs.js`: review scheduling.
- `public/`: the interface (plain HTML, CSS and JavaScript, no build step).

`npm test` runs the tests for text splitting and scheduling.

## Credits

- Quran text, translation (Saheeh International) and word-by-word data: [Quran.com](https://quran.com). Verse recitations: [EveryAyah](https://everyayah.com).
- Hadith text and translations: [hadith-api](https://github.com/fawazahmed0/hadith-api).
- Letter name recordings: [arabic-alphabet-audio](https://github.com/razunatmohammed88-cyber/arabic-alphabet-audio) by razunatmohammed88-cyber, MIT licence.
- Voice: [Piper](https://github.com/OHF-Voice/piper1-gpl) with the `ar_JO-kareem` voice.
