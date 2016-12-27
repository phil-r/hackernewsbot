import logging

from google.appengine.ext import ndb
from google.appengine.api import memcache

from helper import development, shorten_url
from apis.telegram import send_message


class StoryPost(ndb.Model):
  title = ndb.StringProperty()
  text = ndb.TextProperty()
  url = ndb.TextProperty()
  short_url = ndb.TextProperty(indexed=False)
  short_hn_url = ndb.TextProperty(indexed=False)
  score = ndb.IntegerProperty(indexed=False)

  created = ndb.DateTimeProperty(auto_now_add=True)

  @classmethod
  def add(cls, story):
    story_id = str(story.get('id'))
    if memcache.get(story_id):
      logging.info('STOP: {} in memcache'.format(story_id))
      return
    if ndb.Key(cls, story_id).get():
      logging.info('STOP: {} in DB'.format(story_id))
      memcache.set(story_id, 1)
      return
    logging.info('SEND: {}'.format(story_id))
    story['title'] = story.get('title').encode('utf-8')

    hn_url = "https://news.ycombinator.com/item?id={}".format(story_id)
    short_hn_url = shorten_url(hn_url)
    buttons = []

    if story.get('url'):
      short_url = shorten_url(story.get('url'))
      buttons.append({
        'text': 'Read',
        'url': story.get('url')
      })
    else:
      short_url = short_hn_url
      story['url'] = hn_url

    buttons.append({
      'text': '{}+ Comments'.format(story.get('descendants', 0)),
      'url': hn_url
    })

    # Add title
    message = '<b>{title}</b> (Score: {score}+)\n\n'.format(**story)
    # Add link
    message += '<b>Link:</b> {}\n'.format(short_url)
    # Add text
    text = story.get('text')
    if text:
      text = text.replace('<p>', '\n').replace('&#x27;', "'") \
                 .replace('&#x2F;', '/').encode('utf-8')
      message += "\n{}\n".format(text)

    if development():
      result = send_message('@hacker_news_feed_st', message,
                            {'inline_keyboard': [buttons]})
    else:
      result = send_message('@hacker_news_feed', message,
                            {'inline_keyboard': [buttons]})
    if result:
      cls(id=story_id, title=story.get('title'), url=story.get('url'),
          score=story.get('score'), text=story.get('text'),
          short_url=short_url, short_hn_url=short_hn_url).put()
      memcache.set(story_id, 1)
