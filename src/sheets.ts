/**
 * Google Sheets Writer
 *
 * Appends every scraped post to a Google Sheet as a new row.
 * Columns: Date Scraped | Source | Subreddit | Title | URL | Description | Points | Comments | Virality Score | Published
 *
 * Setup (one-time):
 *   1. Go to console.cloud.google.com → New Project
 *   2. Enable "Google Sheets API"
 *   3. IAM & Admin → Service Accounts → Create → download JSON key
 *   4. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in .env
 *   5. Create a Google Sheet, copy the ID from the URL, set GOOGLE_SHEET_ID in .env
 *   6. Share the Sheet with the service account email (Editor access)
 *   7. Run: npx tsx scripts/setup-sheet.ts  ← adds the header row
 */

import { google } from "googleapis";
import type { TrendPost } from "./scraper";

const SHEET_NAME = "Trends"; // Fallback/setup tab — daily tabs are named YYYY-MM-DD
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

// ─── Auth (Service Account JWT) ───────────────────────────────────────────────
//
// Uses the downloaded service account JSON key.
// Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in .env,
// then share your Google Sheet with the service account email (Editor access).

function getAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!,
    key: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    scopes: SCOPES,
  });
}

// ─── Header row ───────────────────────────────────────────────────────────────

export const SHEET_HEADERS = [
  "Date Scraped",
  "Source",
  "Subreddit",
  "Title",
  "URL",
  "Description",
  "Points",
  "Comments",
  "Virality Score",
  "Published At",
];

// ─── Score helper (mirrors scraper logic, kept here to avoid circular import) ──

function viralityScore(post: TrendPost): number {
  const ageMs = Date.now() - new Date(post.createdAt).getTime();
  const ageHours = Math.max(ageMs / (1000 * 60 * 60), 0.1);
  const velocity = (post.points + post.comments * 1.5) / ageHours;
  const commentRatio = post.points > 0 ? post.comments / post.points : 0;
  const recencyBoost = ageHours < 6 ? 1.6 : ageHours < 12 ? 1.3 : 1.0;
  const base = velocity + commentRatio * 10 + post.points * 0.1;
  return Math.round(base * recencyBoost * 10) / 10;
}

// ─── Convert posts to rows ────────────────────────────────────────────────────

function toRow(post: TrendPost, dateScraped: string): string[] {
  return [
    dateScraped,
    post.source,
    post.subreddit ?? "",
    post.title,
    post.url,
    post.description ?? "",
    String(post.points),
    String(post.comments),
    String(viralityScore(post)),
    post.createdAt,
  ];
}

// ─── Append rows to sheet ─────────────────────────────────────────────────────

// ─── Get today's tab name ─────────────────────────────────────────────────────

function todayTabName(): string {
  return new Date().toISOString().slice(0, 10); // e.g. "2026-06-13"
}

// ─── Ensure a tab exists, create with headers if not ─────────────────────────

async function getOrCreateTab(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  tabName: string
): Promise<number> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets?.find(s => s.properties?.title === tabName);
  if (existing?.properties?.sheetId != null) {
    return existing.properties.sheetId;
  }

  // Create the tab
  const addRes = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: tabName } } }],
    },
  });
  const newSheetId = addRes.data.replies?.[0]?.addSheet?.properties?.sheetId!;

  // Write + bold + freeze header row
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [SHEET_HEADERS] },
  });
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId: newSheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: "userEnteredFormat.textFormat.bold",
          },
        },
        {
          updateSheetProperties: {
            properties: { sheetId: newSheetId, gridProperties: { frozenRowCount: 1 } },
            fields: "gridProperties.frozenRowCount",
          },
        },
      ],
    },
  });

  console.log(`[sheets] Created new tab "${tabName}"`);
  return newSheetId;
}

// ─── Delete tabs older than 7 days ───────────────────────────────────────────

export async function cleanupOldTabs(): Promise<void> {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);

  const toDelete = (meta.data.sheets ?? []).filter(s => {
    const title = s.properties?.title ?? "";
    // Only delete tabs that look like YYYY-MM-DD and are older than 7 days
    if (!/^\d{4}-\d{2}-\d{2}$/.test(title)) return false;
    return new Date(title) < cutoff;
  });

  if (toDelete.length === 0) {
    console.log("[sheets] No old tabs to clean up");
    return;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: toDelete.map(s => ({
        deleteSheet: { sheetId: s.properties!.sheetId! },
      })),
    },
  });

  console.log(`[sheets] Deleted ${toDelete.length} old tab(s): ${toDelete.map(s => s.properties?.title).join(", ")}`);
}

// ─── Append posts to today's tab (deduped by URL) ────────────────────────────

export async function appendTrendsToSheet(posts: TrendPost[]): Promise<void> {
  if (posts.length === 0) return;

  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
  const tabName = todayTabName();

  // Ensure today's tab exists
  await getOrCreateTab(sheets, spreadsheetId, tabName);

  // Fetch existing URLs in today's tab to deduplicate
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!E:E`,
  });
  const existingUrls = new Set(
    (existing.data.values ?? []).flat().filter(Boolean)
  );

  const dateScraped = new Date().toISOString().slice(0, 16).replace("T", " "); // YYYY-MM-DD HH:MM
  const newPosts = posts.filter(p => !existingUrls.has(p.url));

  if (newPosts.length === 0) {
    console.log(`[sheets] All ${posts.length} posts already in "${tabName}" — nothing to append`);
    return;
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: newPosts.map(p => toRow(p, dateScraped)) },
  });

  console.log(`[sheets] "${tabName}" +${newPosts.length} new posts (skipped ${posts.length - newPosts.length} dupes)`);
}

// ─── Setup: write header row (run once) ──────────────────────────────────────

export async function setupSheet(): Promise<void> {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;

  // Check if header row already exists
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A1:J1`,
  });

  if (existing.data.values?.[0]?.[0] === "Date Scraped") {
    console.log("[sheets] Header row already exists — skipping");
    return;
  }

  // Write headers
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [SHEET_HEADERS] },
  });

  // Bold + freeze the header row
  const sheetId = await getSheetId(sheets, spreadsheetId, SHEET_NAME);
  if (sheetId !== null) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
              cell: { userEnteredFormat: { textFormat: { bold: true } } },
              fields: "userEnteredFormat.textFormat.bold",
            },
          },
          {
            updateSheetProperties: {
              properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
              fields: "gridProperties.frozenRowCount",
            },
          },
        ],
      },
    });
  }

  console.log("[sheets] Sheet set up with headers");
}

async function getSheetId(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  name: string
): Promise<number | null> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets?.find((s) => s.properties?.title === name);
  return sheet?.properties?.sheetId ?? null;
}
