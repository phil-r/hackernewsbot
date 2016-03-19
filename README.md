# hackernewsbot
Telegram bot that posts new hot stories from Hacker News to [telegram channel](https://telegram.me/hacker_news_feed)

## Backend
Bot runs on [Google App Engine](https://cloud.google.com/appengine/)

## Telegram API
Bot replies to every incoming webhook and doesn't send requests to the API directly

## How to run your own `hackernewsbot`
- Clone this project
- Run `pip install -r requirements.txt -t lib/` to install dependencies
- Download and install [App Engine SDK](https://cloud.google.com/appengine/downloads)
- Register your app in [Google Cloud console](https://console.cloud.google.com)
- Register your bot via [BotFather](https://telegram.me/BotFather)
- Rename `sample_app.yaml` to `app.yaml` and replace `yourappid` with your App engine app id and `YOUR_TELEGRAM_BOT_TOKEN` with your bot token 
- Possibly you'll want to create your own channel and your bot as an admin. Also change `@hacker_news_feed` in `database.py` to your channel id
- Run `appcfg.py update .` in the project folder

## See also 
- [asciifacesbot](https://github.com/phil-r/asciifacesbot)
