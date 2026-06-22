/**
 * Media Recommendations
 * Fetches recent podcast episodes + YouTube videos via RSS — no extra packages.
 * AI picks 2-3 most relevant to today's trends, shown in the night brief only.
 */

export interface MediaItem {
  title:       string;
  url:         string;
  show:        string;
  type:        "podcast" | "youtube";
  publishedAt: string;
}

// ─── Feed sources ─────────────────────────────────────────────────────────────

const FEEDS: { name: string; url: string; type: "podcast" | "youtube" }[] = [
  // ── Venture / Tech Podcasts ───────────────────────────────────────────────
  { name: "20VC",                       url: "https://thetwentyminutevc.libsyn.com/rss",                                          type: "podcast" },
  { name: "Acquired",                   url: "https://feeds.simplecast.com/4T39_jAj",                                             type: "podcast" },
  { name: "Lenny's Podcast",            url: "https://api.substack.com/feed/podcast/10845.rss",                                   type: "podcast" },
  { name: "BG2 Pod",                    url: "https://anchor.fm/s/f06c2370/podcast/rss",                                          type: "podcast" },
  { name: "All-In",                     url: "https://allinchamathjason.libsyn.com/rss",                                          type: "podcast" },
  { name: "Invest Like the Best",       url: "https://feeds.megaphone.fm/investlikethebest",                                      type: "podcast" },
  { name: "The Logan Bartlett Show",    url: "https://rss2.flightcast.com/jlx9l0yn04wt3r710o051jtm.xml",                         type: "podcast" },
  // ── Crypto ───────────────────────────────────────────────────────────────
  { name: "Bankless",                   url: "https://feeds.flightcast.com/p83fuj0y0u58o82l41xei7zo.xml",                         type: "podcast" },
  // ── Science / Ideas ───────────────────────────────────────────────────────
  { name: "Dwarkesh Podcast",           url: "https://apple.dwarkesh-podcast.workers.dev/feed.rss",                               type: "podcast" },
  { name: "No Priors",                  url: "https://feeds.megaphone.fm/nopriors",                                               type: "podcast" },
  { name: "Lex Fridman",                url: "https://lexfridman.com/feed/podcast/",                                              type: "podcast" },
  { name: "Founders Podcast",           url: "https://feeds.megaphone.fm/DSLLC6297708582",                                        type: "podcast" },
  { name: "My First Million",           url: "https://feeds.megaphone.fm/HS2300184645",                                           type: "podcast" },
  { name: "The Tim Ferriss Show",       url: "https://rss.art19.com/tim-ferriss-show",                                            type: "podcast" },
  { name: "Sean Carroll's Mindscape",   url: "https://rss.art19.com/sean-carrolls-mindscape",                                     type: "podcast" },
  { name: "The Knowledge Project",      url: "https://feeds.megaphone.fm/FSMI7575968096",                                         type: "podcast" },
  { name: "EconTalk",                   url: "https://feeds.simplecast.com/wgl4xEgL",                                             type: "podcast" },
  { name: "80,000 Hours",               url: "https://feeds.transistor.fm/80000-hours-podcast",                                   type: "podcast" },
  { name: "Conversations with Tyler",   url: "https://feeds.simplecast.com/gCZGYrx9",                                             type: "podcast" },
  { name: "In Our Time",                url: "https://podcasts.files.bbci.co.uk/b006qykl.rss",                                    type: "podcast" },
  // ── YouTube (channel RSS — free, no API key needed) ───────────────────────
  { name: "Diary of a CEO",             url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCGq-a57w-aPwyi3pW7XLiHw",     type: "youtube" },
  { name: "Colin and Samir",            url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCmJPFjH0MIOO3H7NzK8bn8A",     type: "youtube" },
  { name: "Huberman Lab",               url: "https://www.youtube.com/feeds/videos.xml?channel_id=UC2D2CMWXMOVWx7giW1n3LIg",     type: "youtube" },
  { name: "PowerfulJRE",                url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCzWQYUVCpZqtN93H8RR44Qw",     type: "youtube" },
  { name: "Y Combinator",               url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCcefcZRL2oaA_uBNeo5UOWg",     type: "youtube" },
  { name: "Talks at Google",            url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCbmNph6atAoGfqLoCL_duAg",     type: "youtube" },
  { name: "a16z",                       url: "https://www.youtube.com/feeds/videos.xml?channel_id=UC9cn0TuPq4dnbTY-CBsm8XA",     type: "youtube" },
];

// ─── RSS parser (handles both RSS 2.0 and Atom/YouTube format) ───────────────

function extractTag(xml: string, tag: string): string {
  // Handles <tag>value</tag> and <tag attr="...">value</tag>
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() : "";
}

function extractAttr(xml: string, tag: string, attr: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["'][^>]*>`, "i"));
  return m ? m[1].trim() : "";
}

function parseRSS(xml: string, show: string, type: "podcast" | "youtube"): MediaItem[] {
  const items: MediaItem[] = [];
  const isAtom = xml.includes("<feed");

  // Split into individual items/entries
  const itemTag  = isAtom ? "entry" : "item";
  const segments = xml.split(new RegExp(`<${itemTag}[\\s>]`)).slice(1);

  for (const seg of segments.slice(0, 5)) { // max 5 per feed
    const title = extractTag(seg, "title");

    const http = (s: string) => (s.startsWith("http://") || s.startsWith("https://")) ? s : "";

    let url: string;
    if (isAtom) {
      // YouTube Atom: <link rel="alternate" href="..."/> or <yt:videoId>ID</yt:videoId>
      url = http(extractAttr(seg, "link", "href"));
      if (!url) {
        const videoId = extractTag(seg, "yt:videoId");
        if (videoId) url = `https://www.youtube.com/watch?v=${videoId}`;
      }
    } else {
      // RSS: try each candidate in order, skip anything that isn't an http/https URL
      // (<guid> often contains internal IDs like gid://art19-episode-... — must reject those)
      url = http(extractTag(seg, "link"))
         || http(extractAttr(seg, "link", "href"))
         || http(extractTag(seg, "guid"))
         || http(extractAttr(seg, "enclosure", "url"));
    }

    const date  = isAtom
      ? extractTag(seg, "published") || extractTag(seg, "updated")
      : extractTag(seg, "pubDate");

    if (!title || !url) {
      if (title) console.warn(`[media] ${show}: item "${title.slice(0, 60)}" has no URL — skipping`);
      continue;
    }
    console.log(`[media] ${show}: "${title.slice(0, 50)}" → ${url.slice(0, 80)}`);
    items.push({ title, url, show, type, publishedAt: date });
  }

  return items;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function fetchRecentMedia(): Promise<MediaItem[]> {
  const results = await Promise.allSettled(
    FEEDS.map(async ({ name, url, type }) => {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "IdeaAgent/1.0 (RSS reader)" },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const xml = await res.text();
        const items = parseRSS(xml, name, type);
        console.log(`[media] ${name}: ${items.length} items`);
        return items;
      } catch (err) {
        console.warn(`[media] ${name}: failed — ${(err as Error).message}`);
        return [] as MediaItem[];
      }
    })
  );

  const all = results.flatMap(r => r.status === "fulfilled" ? r.value : []);

  // YouTube: last 3 days (channels post frequently, avoid stale picks)
  // Podcasts: last 7 days (weekly release cadence)
  const recent = all.filter(item => {
    const d = new Date(item.publishedAt).getTime();
    if (isNaN(d)) return true; // keep if date unparseable
    const cutoffDays = item.type === "youtube" ? 3 : 7;
    return d > Date.now() - cutoffDays * 24 * 60 * 60 * 1000;
  });

  console.log(`[media] ${recent.length} items from last 7 days across ${FEEDS.length} feeds`);
  return recent;
}
