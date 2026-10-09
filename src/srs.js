// Spaced repetition scheduling (a small SM-2 variant). Pure functions: the
// caller stores the result.

const MINUTE = 60_000;
const DAY = 86_400_000;

export const GRADES = ["again", "hard", "good", "easy"];

export const newCardState = (now = Date.now()) => ({
  interval: 0, // days
  ease: 2.5,
  reps: 0,
  lapses: 0,
  due: now,
});

export function schedule(card, grade, now = Date.now()) {
  if (!GRADES.includes(grade)) throw new Error(`Unknown grade: ${grade}`);
  const { interval, ease, reps, lapses } = card;

  if (grade === "again") {
    return {
      interval: 0,
      ease: Math.max(1.3, ease - 0.2),
      reps: 0,
      lapses: lapses + 1,
      due: now + 10 * MINUTE,
    };
  }

  let nextInterval;
  let nextEase = ease;
  if (reps === 0) {
    nextInterval = { hard: 1, good: 2, easy: 4 }[grade];
  } else if (grade === "hard") {
    nextInterval = interval * 1.2;
    nextEase = Math.max(1.3, ease - 0.15);
  } else if (grade === "good") {
    nextInterval = interval * ease;
  } else {
    nextInterval = interval * ease * 1.3;
    nextEase = ease + 0.15;
  }
  // Always move forward by at least a day so a card never stalls.
  nextInterval = Math.max(Math.round(nextInterval), interval + 1);

  return {
    interval: nextInterval,
    ease: nextEase,
    reps: reps + 1,
    lapses,
    due: now + nextInterval * DAY,
  };
}
