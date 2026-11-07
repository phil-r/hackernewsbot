# hackernewsbot

Telegram bot that posts hot Hacker News stories to
[@hacker_news_feed](https://telegram.me/hacker_news_feed).

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
- Run `bun run start` for HTTP and schedule `bun run cron`
  every 10 minutes from the project root, using a non-overlap lock.
  There is no HTTP `/cron` endpoint.
- Keep this bot's database on persistent storage, shared by HTTP and cron
  but separate from designernewsbot. Use SQLite-aware backups and exclude
  databases and `.env` from deployment copies.
  Serve public traffic through an HTTPS reverse proxy.

## Local development

Use a separate database, `BASE_URL=http://localhost:8080`, and a test
channel such as `@hacker_news_feed_st`.

Run `bun run dev`, `bun test` for offline tests, and
`bun run check` for typechecking.

## See also

- [designernewsbot](https://github.com/phil-r/designernewsbot)
- [asciifacesbot](https://github.com/phil-r/asciifacesbot)
