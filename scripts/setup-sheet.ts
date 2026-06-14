/**
 * Run once to create the header row in your Google Sheet.
 * Usage: npx tsx scripts/setup-sheet.ts
 */

import "dotenv/config";
import { setupSheet } from "../src/sheets";

setupSheet()
  .then(() => console.log("Done. Sheet is ready."))
  .catch((err) => {
    console.error("Failed:", err.message);
    process.exit(1);
  });
