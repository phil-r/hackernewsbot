# hackernewsbot
Telegram bot that posts new hot stories from Hacker News to [telegram channel](https://telegram.me/hacker_news_feed)

## Backend
Bot runs on [Google App Engine](https://cloud.google.com/appengine/)

## Hacker News API
Bot uses [Hacker News API](https://github.com/HackerNews/API)

It loads [top stories](https://hacker-news.firebaseio.com/v0/topstories.json) every 10 minutes and posts any story that reached *100+* score([adjusted for inflation](https://instruments.digital/inflation-adjusted-hn/))

## Telegram API
Bot uses [Telegram Bot API](https://core.telegram.org/bots/api) to post messages to the [telegram channel](https://telegram.me/hacker_news_feed) with [sendMessage](https://core.telegram.org/bots/api#sendmessage) request

## URL shortening
Bot used [bit.ly](https://dev.bitly.com/) and [goo.gl](https://developers.google.com/url-shortener/v1/getting_started) for url shortening, but now it uses internal shortener

## How to run your own `hackernewsbot`
- Clone this project
- Run `pip install -r requirements.txt -t lib/` to install dependencies
- Download and install [Google Cloud SDK](https://cloud.google.com/appengine/docs/standard/python/download)
- Register your app in [Google Cloud console](https://console.cloud.google.com)
- Register your bot via [BotFather](https://telegram.me/BotFather)
- Rename `sample_app.yaml` to `app.yaml` and
  - replace `yourappid` with your App engine app id
  - replace `YOUR_TELEGRAM_BOT_TOKEN` with your bot token
- Possibly you'll want to create your own channel and your bot as an admin. Also change `@hacker_news_feed` in `database.py` to your channel id
- Run `gcloud app deploy app.yaml --project [YOUR_PROJECT_NAME]` in the project folder
- Run `gcloud app deploy cron.yaml --project [YOUR_PROJECT_NAME]` in the project folder

## Local development
To run server locally you can use [`dev_appserver.py`](https://cloud.google.com/appengine/docs/standard/python/tools/using-local-server):

```
dev_appserver.py .
```


## See also
- [designernewsbot](https://github.com/phil-r/designernewsbot)
- [asciifacesbot](https://github.com/phil-r/asciifacesbot)
