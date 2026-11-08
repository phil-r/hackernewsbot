# Read Hacker News

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Hacker News readers looking for their preferred way to follow the news: web and mobile readers, RSS feeds, newsletters, Telegram channels, or command-line clients.

## Product Purpose

Help visitors discover ways to read and follow Hacker News through a categorized directory at readhacker.news. The directory is the primary design surface; the Telegram bot is supporting product context.

Success means visitors can find a relevant option and follow its link. No specific conversion or traffic target has been established.

## Operating Context

- Visitors browse categories and follow links to third-party tools and services. Entries can include author attribution and source-code links.
- Directory entries come from the `awesome-hacker-news` package. Contributions go to https://github.com/phil-r/awesome-hacker-news.
- This repository also runs the Telegram bot behind `@hacker_news_feed`. It checks Hacker News top stories every 10 minutes and posts stories scoring 150 or more.
- The bot uses internal `/s/<id>` article redirects and `/c/<id>` Hacker News discussion redirects on readhacker.news.

## Capabilities and Constraints

- Preserve the directory's category browsing, entry links, author attribution, source-code links, and contribution links.
- Keep the directory lightweight and easy to preview without setting up the Telegram bot.
- Preserve dataset licensing and asset attribution when reusing their content.
- No new feature scope, differentiated market claim, or product-specific accessibility standard has been confirmed.

## Brand Commitments

- The public directory is named **Read Hacker News** and lives at https://readhacker.news/.
- Existing copy introduces it as a directory of Hacker News readers, apps, RSS feeds, newsletters, and command-line clients.
- Preserve the creator attribution to Phil Rukin and the directory contribution and website-source links.
- Existing SVG assets are available; setup does not establish a new visual direction.

## Evidence on Hand

- `README.md`: product overview, bot behavior, build and preview instructions.
- `app/render.ts`: current public content, categories, entry rendering, attribution, and contribution links.
- `app/seo.ts`: page title, description, and canonical URL rules.
- `app/images/logo.svg` and `app/images/github.svg`: existing visual assets.
- `awesome-hacker-news`: the directory dataset and its license, included in generated HTML.
- No testimonials, adoption metrics, or comparative product claims were established during setup; do not invent them.

## Product Principles

1. Help visitors find a suitable way to follow Hacker News without adding steps between discovery and the destination.
2. Keep directory content grounded in the maintained dataset, with useful attribution and clear contribution paths.
3. Preserve a lightweight public directory that can be previewed independently of bot operations.
4. Keep product claims factual; distinguish the directory from the supporting Telegram bot.
