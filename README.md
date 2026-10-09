# Arabic Reader

Read the Quran, hadith collections, your own PDFs and documents, or any Arabic text you paste, word by word: vowel marks, pronunciation, meaning, root and a letter-by-letter breakdown for every word. Save words and review them with spaced repetition.

## Get it

Download the desktop app from the [Releases page](https://github.com/Ahmad1827/arabic/releases/latest). Nothing else needs installing.

- **Windows:** unzip `Arabic-Reader-Windows-x64.zip` into a normal Windows folder and double-click `Arabic Reader.exe`. Windows may warn that the app is from an unknown publisher (it is not signed): choose "More info", then "Run anyway".
- **Linux (64-bit):** unpack `Arabic-Reader-Linux-x64.tar.gz` and run `./install.sh` inside the folder. That installs it for your user only (no administrator rights) and adds it to the applications menu. `./install.sh --remove` takes it out again.

**From source (any system, runs in your browser):**

1. `npm install` (first time only; needs Node 24 or newer)
2. `npm start`, then open http://localhost:3000

`npm run desktop` opens the same thing as a desktop window, and `npm run package win32` (or `linux`, `darwin`) builds the desktop app into `dist/`.

The app's own Arabic voice is optional and installed from **Settings** (about 260 MB, needs Python 3.9+ on the computer). Without it, reading aloud uses whatever Arabic voice the system has.

## Choose your own AI

Texts you paste and hadith are explained word by word by an AI. The app ships with none configured: open **Settings** (the sliders icon in the header) and choose one. It is then tested on a short sentence.

- **Claude Code on this computer**: uses the `claude` command, installed and logged in. Nothing to paste; it counts toward that Claude plan's usage limits.
- **Claude with your own API key**: pay-as-you-go, with a key from console.anthropic.com.
- **Another AI service**: anything with an OpenAI-style chat endpoint, such as OpenAI, Google Gemini, OpenRouter, Groq, or a model running locally with Ollama. You give the address, the model name and, if the service needs one, a key.

Nothing is sent to the AI until you press "Translate and explain" under a sentence or "Translate this page" (automatic translation can be switched on in Settings). Keys are stored only in `data/app.db` on your computer. The Quran, the alphabet trainer and reviewing work without any AI.

## Translate a picture

The **Translate a picture** page takes a dropped, chosen or pasted picture (a sign, a book page, a screenshot), reads the Arabic in it and translates it. Reading is done by your AI, which is the accurate way, or by the built-in recogniser if you prefer to keep the picture on your computer. The picture is kept next to the text so you can compare.

## How it is built

- `desktop/main.js`: the desktop app (Electron). It starts the same server on a private port and shows it in its own window; data then lives in the user's application-data folder.
- `server.js`: web server and API. Data lives in `data/app.db` (SQLite).
- `src/analyze.js`: asks the configured AI to analyse one sentence. Each sentence is analysed once and then cached.
- `src/library.js`: the built-in library. Quran text, translation and word-by-word meanings come from Quran.com; hadith text and translations from the open hadith-api project. Both are downloaded once and then kept locally.
- `src/voice.js` and `scripts/voice-worker.py`: the read-aloud voice ([Piper](https://github.com/OHF-Voice/piper1-gpl) with an Arabic voice model), running locally. Quran recitation is separate: real recordings streamed from EveryAyah and Quran.com.
- `src/documents.js`: reads dropped files (PDF, Word .docx, plain text, pictures). PDF text is rebuilt from where each glyph sits on the page, since Arabic PDFs rarely store their text in reading order. Scanned PDFs and photos of pages have no text inside, so their text is recognised with [Tesseract](https://github.com/naptha/tesseract.js) on your computer (its Arabic data, about 2.5 MB, is downloaded on first use); expect some wrong letters.
- `src/text.js`: splits text into sentences and words.
- `src/srs.js`: review scheduling.
- `public/`: the interface (plain HTML, CSS and JavaScript, no build step). `practice.js` holds the exercise rounds for the alphabet and for reviewing saved words.

`npm test` runs the tests for text splitting and scheduling.

## Credits

- Quran text, translation (Saheeh International) and word-by-word data: [Quran.com](https://quran.com). Verse recitations: [EveryAyah](https://everyayah.com).
- Hadith text and translations: [hadith-api](https://github.com/fawazahmed0/hadith-api).
- Letter name recordings: [arabic-alphabet-audio](https://github.com/razunatmohammed88-cyber/arabic-alphabet-audio) by razunatmohammed88-cyber, MIT licence.
- Voice: [Piper](https://github.com/OHF-Voice/piper1-gpl) with the `ar_JO-kareem` voice.
