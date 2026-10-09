// Streak arithmetic. `metDays` is the set of day numbers on which the daily
// goal was reached; `today` is today's day number.
export function streaks(metDays, today) {
  // A streak stays alive through today until midnight, even before today's
  // goal is reached.
  let day = metDays.has(today) ? today : today - 1;
  let streak = 0;
  while (metDays.has(day)) {
    streak++;
    day--;
  }

  let best = 0;
  let run = 0;
  let previous = null;
  for (const met of [...metDays].sort((a, b) => a - b)) {
    run = previous !== null && met === previous + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = met;
  }
  return { streak, best };
}
