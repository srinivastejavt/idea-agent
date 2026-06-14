/**
 * One-time script to get your Google OAuth2 refresh token.
 *
 * Run: npx tsx scripts/get-google-token.ts
 *
 * It will:
 *   1. Print an authorization URL — open it in your browser
 *   2. You approve access to Google Sheets
 *   3. Google redirects to localhost with a `code` param
 *   4. Paste that code here → script prints your refresh token
 *   5. Copy the refresh token into GOOGLE_REFRESH_TOKEN in .env
 *
 * You only need to do this once. The refresh token doesn't expire
 * unless you revoke it in your Google account settings.
 */

import "dotenv/config";
import { google } from "googleapis";
import * as readline from "readline";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

const client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID!,
  process.env.GOOGLE_CLIENT_SECRET!,
  "urn:ietf:wg:oauth:2.0:oob" // "out of band" — prints code in browser instead of redirecting
);

const authUrl = client.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
  prompt: "consent", // forces refresh_token to be returned
});

console.log("\n─────────────────────────────────────────────");
console.log("Step 1: Open this URL in your browser:\n");
console.log(authUrl);
console.log("\n─────────────────────────────────────────────\n");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question("Step 2: Paste the authorization code here: ", async (code) => {
  rl.close();
  try {
    const { tokens } = await client.getToken(code.trim());
    console.log("\n─────────────────────────────────────────────");
    console.log("✅ Success! Add this to your .env:\n");
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log("\n─────────────────────────────────────────────\n");
  } catch (err: any) {
    console.error("Failed to exchange code:", err.message);
    process.exit(1);
  }
});
