// Installs the app's own Arabic voice from the command line: npm run setup-voice
// (The same thing can be done from the Settings page.)
import { installation, installVoice, voiceAvailable } from "../src/voice.js";

if (voiceAvailable()) {
  console.log("The voice is already installed.");
} else {
  const report = setInterval(() => process.stdout.write(`\r${installation.step} ${installation.percent ? `${installation.percent}%` : ""}   `), 500);
  try {
    await installVoice();
    console.log("\nDone. Restart the app to use the voice.");
    process.exit(0); // the voice is now loaded and waiting, which would keep this script running
  } catch {
    console.error(`\n${installation.error}`);
    process.exitCode = 1;
  } finally {
    clearInterval(report);
  }
}
