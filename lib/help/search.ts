export type HelpSearchable = {
  slug: string;
  title: string;
  description: string;
  keywords: string[];
  text: string;
};

export type HelpSearchHit = HelpSearchable & { score: number };

/**
 * Simple client-side intent search: title, description, keywords and body.
 * Multi-word queries match when every token appears somewhere in the article.
 */
export function searchHelpArticles(
  articles: HelpSearchable[],
  query: string,
  limit = 8
): HelpSearchHit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];

  const tokens = needle.split(/\s+/).filter((token) => token.length >= 2);
  const hits: HelpSearchHit[] = [];

  for (const article of articles) {
    const title = article.title.toLowerCase();
    const description = article.description.toLowerCase();
    const keywords = article.keywords.map((item) => item.toLowerCase());
    const haystack = article.text.toLowerCase();

    const phraseInTitle = title.includes(needle);
    const phraseInKeywords = keywords.some((item) => item.includes(needle));
    const phraseInBody = haystack.includes(needle);
    const tokensMatch =
      tokens.length > 0 &&
      tokens.every(
        (token) =>
          title.includes(token) ||
          description.includes(token) ||
          keywords.some((item) => item.includes(token)) ||
          haystack.includes(token)
      );

    if (!phraseInTitle && !phraseInKeywords && !phraseInBody && !tokensMatch) {
      continue;
    }

    let score = 0;
    if (phraseInTitle) score += 100;
    if (title.startsWith(needle)) score += 40;
    if (phraseInKeywords) score += 70;
    for (const token of tokens) {
      if (title.includes(token)) score += 25;
      if (keywords.some((item) => item.includes(token))) score += 20;
      if (description.includes(token)) score += 10;
      if (haystack.includes(token)) score += 5;
    }
    if (phraseInBody) score += 15;

    hits.push({ ...article, score });
  }

  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "es")).slice(0, limit);
}
