# Arabic Reader

Read the Quran, hadith collections or any Arabic text you paste, word by word: vowel marks, pronunciation, meaning, root and a letter-by-letter breakdown for every word. Save words and review them with spaced repetition.

## Run it

1. `npm install` (first time only)
2. `npm start`, then open http://localhost:3000

Word analysis runs through the Claude Code command line (`claude`), using the Claude subscription this computer is logged in to. There is no API key and no separate bill; it counts toward the subscription's usage limits.

## How it is built

- `server.js`: web server and API. Data lives in `data/app.db` (SQLite).
- `src/analyze.js`: asks Claude (via `claude -p`) to analyse one sentence. Each sentence is analysed once and then cached.
- `src/library.js`: the built-in library. Quran text, translation and word-by-word meanings come from Quran.com; hadith text and translations from the open hadith-api project. Both are downloaded once and then kept locally.
- `src/text.js`: splits text into sentences and words.
- `src/srs.js`: review scheduling.
- `public/`: the interface (plain HTML, CSS and JavaScript, no build step).

`npm test` runs the tests for text splitting and scheduling.
