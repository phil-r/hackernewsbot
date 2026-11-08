# hackernewsbot

The [Read Hacker News](https://readhacker.news/) directory and the Telegram bot
behind [@hacker_news_feed](https://telegram.me/hacker_news_feed), built and served
from one Bun/TypeScript project.

You can [preview the directory](#read-hacker-news-directory) without bot credentials
or a database.

## Backend

Bun/TypeScript with SQLite, targeting a small
[Hetzner cloud](https://hetzner.cloud/?ref=gy7R6jM4nx5J) machine
shared with designernewsbot.

The [old Python version](https://github.com/phil-r/hackernewsbot/tree/old-python-version)
ran on Google App Engine.

## Hacker News API

Uses the [Hacker News API](https://github.com/HackerNews/API)
to check top stories every 10 minutes and post stories scoring **150 or more**.

## Telegram API

Uses the [Telegram Bot API](https://core.telegram.org/bots/api)
[sendMessage](https://core.telegram.org/bots/api#sendmessage) method.

## URL shortening

Uses an internal shortener at `readhacker.news`.
`/s/<id>` redirects to articles; `/c/<id>` redirects to Hacker News discussions.

## How to run your own `hackernewsbot`

- Install Bun 1.4.4, clone this project, and run
  `bun install --frozen-lockfile`.
- Register a bot with [BotFather](https://telegram.me/BotFather)
  and make it an administrator of your channel.
- Copy `.env.example` to `.env`. Set `TELEGRAM_BOT_TOKEN`,
  `TELEGRAM_CHAT_ID`, `DATABASE_URL`, and `BASE_URL`;
  adjust `PORT` as needed. External environment values override the
  project-root `.env`; local/mode env files are not loaded.
- For a new installation, run `bun run db:init` once.
  It refuses to overwrite an existing database.
- Run `bun run build:prod`, then `bun run start` for HTTP and schedule `bun run cron`
  every 10 minutes from the project root, using a non-overlap lock.
  There is no HTTP `/cron` endpoint.
- Keep this bot's database on persistent storage, shared by HTTP and cron
  but separate from designernewsbot. Use SQLite-aware backups and exclude
  databases and `.env` from deployment copies.
  Serve public traffic through an HTTPS reverse proxy.

## Local development

Use a separate database, `BASE_URL=http://localhost:8080`, and a test
channel such as `@hacker_news_feed_st`.

Run `bun run dev`, `bun run test` for offline tests, and
`bun run check` for typechecking.

## See also

- [awesome-hacker-news](https://github.com/phil-r/awesome-hacker-news)
- [designernewsbot](https://github.com/phil-r/designernewsbot)
- [asciifacesbot](https://github.com/phil-r/asciifacesbot)

## Read Hacker News directory

Site source lives in `app/` and builds into `static/`, served by the bot's HTTP server.

```sh
bun run site:dev    # preview on http://localhost:9000; rebuilds on edits
bun run build:prod  # build static/ before starting the HTTP server
```

For a different domain, set `SITE_ORIGIN` when building:
`SITE_ORIGIN=https://directory.example bun run build:prod`. It sets the site's
canonical URL and is separate from the bot's `BASE_URL`; builds do not read `.env`.
