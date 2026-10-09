// Name and sound of each Arabic letter, shown when a word is spelled out.
export const LETTERS = {
  "ء": ["hamza", "ʾ (catch in the throat)"],
  "ا": ["alif", "ā"],
  "أ": ["alif + hamza", "ʾa / ʾu"],
  "إ": ["alif + hamza below", "ʾi"],
  "آ": ["alif madda", "ʾā"],
  "ٱ": ["alif wasla", "(silent link)"],
  "ب": ["bā", "b"],
  "ت": ["tā", "t"],
  "ث": ["thā", "th (think)"],
  "ج": ["jīm", "j"],
  "ح": ["ḥā", "ḥ (breathy h)"],
  "خ": ["khā", "kh (loch)"],
  "د": ["dāl", "d"],
  "ذ": ["dhāl", "dh (this)"],
  "ر": ["rā", "r (rolled)"],
  "ز": ["zāy", "z"],
  "س": ["sīn", "s"],
  "ش": ["shīn", "sh"],
  "ص": ["ṣād", "ṣ (heavy s)"],
  "ض": ["ḍād", "ḍ (heavy d)"],
  "ط": ["ṭā", "ṭ (heavy t)"],
  "ظ": ["ẓā", "ẓ (heavy dh)"],
  "ع": ["ʿayn", "ʿ (deep in the throat)"],
  "غ": ["ghayn", "gh (French r)"],
  "ف": ["fā", "f"],
  "ق": ["qāf", "q (deep k)"],
  "ك": ["kāf", "k"],
  "ل": ["lām", "l"],
  "م": ["mīm", "m"],
  "ن": ["nūn", "n"],
  "ه": ["hā", "h"],
  "و": ["wāw", "w / ū"],
  "ي": ["yā", "y / ī"],
  "ى": ["alif maqṣūra", "ā (end of word)"],
  "ة": ["tā marbūṭa", "a / at (end of word)"],
  "ؤ": ["hamza on wāw", "ʾ"],
  "ئ": ["hamza on yā", "ʾ"],
};

// The order the alphabet trainer teaches the letters in: small groups of
// letters that share a shape, so the differences (mostly dots) stand out.
export const ALPHABET_GROUPS = [
  { title: "The tall line and the boat", letters: ["ا", "ب", "ت", "ث"] },
  { title: "The hooks", letters: ["ج", "ح", "خ"] },
  { title: "Short strokes", letters: ["د", "ذ", "ر", "ز"] },
  { title: "Teeth and loops", letters: ["س", "ش", "ص", "ض"] },
  { title: "Heavy and throat letters", letters: ["ط", "ظ", "ع", "غ"] },
  { title: "Round heads", letters: ["ف", "ق", "ك", "ل"] },
  { title: "The last five", letters: ["م", "ن", "ه", "و", "ي"] },
  { title: "Extra signs", letters: ["ء", "ة", "ى"] },
];

export const TRAINER_LETTERS = ALPHABET_GROUPS.flatMap((group) => group.letters);

// Arabic letters change shape depending on where they sit in a word. A
// zero-width joiner makes the browser draw each shape on its own.
const JOINER = "\u200D";
const JOINS_BACKWARD_ONLY = new Set(["ا", "د", "ذ", "ر", "ز", "و", "ة", "ى"]);

export function letterForms(letter) {
  const forms = [{ where: "alone", text: letter }];
  if (letter === "ء") return forms;
  if (!JOINS_BACKWARD_ONLY.has(letter)) {
    forms.push({ where: "start", text: letter + JOINER }, { where: "middle", text: JOINER + letter + JOINER });
  }
  forms.push({ where: "end", text: JOINER + letter });
  return forms;
}

// A person saying each letter's name, in public/audio/letters/<file>.mp3.
// Recordings by razunatmohammed88-cyber (MIT licence, see LICENSE.txt there),
// trimmed and levelled for this app.
export const LETTER_AUDIO = {
  "ا": "alif", "ب": "ba", "ت": "ta", "ث": "tha", "ج": "jim", "ح": "hha", "خ": "kha",
  "د": "dal", "ذ": "dhal", "ر": "ra", "ز": "zay", "س": "sin", "ش": "shin", "ص": "sad",
  "ض": "dad", "ط": "tta", "ظ": "zza", "ع": "ayn", "غ": "ghayn", "ف": "fa", "ق": "qaf",
  "ك": "kaf", "ل": "lam", "م": "mim", "ن": "nun", "ه": "ha", "و": "waw", "ي": "ya",
  "ء": "hamza",
};

// The two signs without a recording are read by the voice, from their names
// written the way they are said.
export const LETTER_SPOKEN = {
  "ة": "تَاءْ مَرْبُوطَهْ",
  "ى": "أَلِفْ مَقْصُورَهْ",
};
