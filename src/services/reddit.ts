import axios from "axios";
import type { RawRedditPost } from "../types";

const BASE = "https://www.reddit.com";

const FINANCE_SUBREDDITS = [
  "investing",
  "stocks",
  "wallstreetbets",
  "economics",
  "finance",
  "cryptocurrency",
  "bitcoin",
  "options",
  "SecurityAnalysis",
];

const HEADERS = {
  "User-Agent": process.env.REDDIT_USER_AGENT || "Nostrad/1.0",
};

// Holt Top-Posts aus einem Subreddit
async function fetchSubreddit(
  subreddit: string,
  sort: "hot" | "new" | "top" = "hot",
  limit = 15
): Promise<RawRedditPost[]> {
  try {
    const { data } = await axios.get(
      `${BASE}/r/${subreddit}/${sort}.json`,
      {
        params: { limit },
        headers: HEADERS,
        timeout: 8000,
      }
    );

    return data.data.children
      .map((child: any) => child.data)
      .filter((post: any) => !post.stickied && post.score > 10)
      .map((post: any): RawRedditPost => ({
        title: post.title,
        selftext: post.selftext?.slice(0, 500) || "",
        url: `https://reddit.com${post.permalink}`,
        subreddit: post.subreddit,
        score: post.score,
        num_comments: post.num_comments,
        created_utc: post.created_utc,
      }));
  } catch (err) {
    console.warn(`Reddit r/${subreddit} nicht erreichbar:`, (err as Error).message);
    return [];
  }
}

// Alle Finanz-Subreddits abrufen
export async function fetchFinanceReddit(): Promise<RawRedditPost[]> {
  const results = await Promise.allSettled(
    FINANCE_SUBREDDITS.map((sub) => fetchSubreddit(sub, "hot", 10))
  );

  const posts = results
    .filter((r): r is PromiseFulfilledResult<RawRedditPost[]> => r.status === "fulfilled")
    .flatMap((r) => r.value);

  // Deduplizieren per URL
  const seen = new Set<string>();
  return posts.filter((p) => {
    if (seen.has(p.url)) return false;
    seen.add(p.url);
    return true;
  });
}

// Subreddit-Suche nach Keyword
export async function searchReddit(keyword: string): Promise<RawRedditPost[]> {
  try {
    const { data } = await axios.get(`${BASE}/search.json`, {
      params: { q: keyword, sort: "relevance", limit: 25, type: "link" },
      headers: HEADERS,
      timeout: 8000,
    });

    return data.data.children
      .map((child: any) => child.data)
      .map((post: any): RawRedditPost => ({
        title: post.title,
        selftext: post.selftext?.slice(0, 500) || "",
        url: `https://reddit.com${post.permalink}`,
        subreddit: post.subreddit,
        score: post.score,
        num_comments: post.num_comments,
        created_utc: post.created_utc,
      }));
  } catch {
    return [];
  }
}
