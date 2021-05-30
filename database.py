# coding: utf-8

import logging
import shortener
import timeago
import datetime

from google.appengine.ext import ndb
from google.appengine.api import memcache

from helper import development
from apis.telegram import send_message

FOUR_HOURS = datetime.timedelta(hours=4)
TWO_DAYS = datetime.timedelta(days=2)

class StoryPost(ndb.Model):
  title = ndb.StringProperty()
  text = ndb.TextProperty()
  message = ndb.TextProperty()
  url = ndb.TextProperty()
  short_url = ndb.TextProperty(indexed=False)
  short_hn_url = ndb.TextProperty(indexed=False)
  score = ndb.IntegerProperty(indexed=False)
  telegram_message_id = ndb.IntegerProperty()

  created = ndb.DateTimeProperty(auto_now_add=True)

  def add_memcache(self):
    memcache.set(self.key.id(), self.url)

  @classmethod
  def add(cls, story):
    story_id_int = story.get('id')
    story_id = str(story_id_int)
    short_id = shortener.encode(story_id_int)
    hn_url = "https://news.ycombinator.com/item?id={}".format(story_id)
    story_url = story.get('url')

    # Check memcache and databse, maybe this story was already sent
    if memcache.get(story_id):
      logging.info('STOP: {} in memcache'.format(story_id))
      return
    post = ndb.Key(cls, story_id).get()
    if post:
      logging.info('STOP: {} in DB'.format(story_id))
      post.add_memcache()
      return
    logging.info('SEND: {}'.format(story_id))

    story['title'] = story.get('title').encode('utf-8')
    comments_count = story.get('descendants', 0)
    buttons = []

    if development():
      short_hn_url = 'http://localhost:8080/c/{}'.format(short_id)
    else:
      short_hn_url = 'https://readhacker.news/c/{}'.format(short_id)

    if story_url:
      if development():
        short_url = 'http://localhost:8080/s/{}'.format(short_id)
      else:
        short_url = 'https://readhacker.news/s/{}'.format(short_id)
      buttons.append({
          'text': 'Read',
          'url': story_url
      })
    else:
      short_url = short_hn_url
      story['url'] = hn_url

    buttons.append({
        'text': '{}+ Comments'.format(comments_count),
        'url': hn_url
    })

    # Get the difference between published date and when 100+ score was reched
    now = datetime.datetime.now()
    published = datetime.datetime.fromtimestamp(story.get('time'))
    ago = timeago.format(now, published)

    # Add 🔥 emoji if story is hot and gained required score in less than 2 hours,
    # or add ❄️ if it took it more than 2 days
    status_emoji = ''
    delta = now - published
    if delta <= FOUR_HOURS:
      status_emoji = '🔥 '
    elif delta >= TWO_DAYS:
      status_emoji = '❄️ '

    # Add title
    message = '<b>{title}</b> ({status_emoji}Score: {score}+ {ago})\n\n'.format(
        ago=ago, status_emoji=status_emoji, **story)

    # Add link
    message += '<b>Link:</b> {}\n'.format(short_url)

    # Add comments Link(don't add it for `Ask HN`, etc)
    if story_url:
      message += '<b>Comments:</b> {}\n'.format(short_hn_url)

    # Add text
    text = story.get('text')
    if text:
      text = text.replace('<p>', '\n').replace('&#x27;', "'") \
                 .replace('&#x2F;', '/').encode('utf-8')
      message += "\n{}\n".format(text)

    # Send to the telegram channel
    if development():
      result = send_message('@hacker_news_feed_st', message,
                            {'inline_keyboard': [buttons]})
    else:
      result = send_message('@hacker_news_feed', message,
                            {'inline_keyboard': [buttons]})

    logging.info('Telegram response: {}'.format(result))

    telegram_message_id = None
    if result and result.get('ok'):
      telegram_message_id = result.get('result').get('message_id')
    post = cls(id=story_id, title=story.get('title'), url=story.get('url'),
               score=story.get('score'), text=story.get('text'),
               short_url=short_url, short_hn_url=short_hn_url,
               message=message, telegram_message_id=telegram_message_id)
    post.put()
    post.add_memcache()
