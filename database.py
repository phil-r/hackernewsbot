import logging

from google.appengine.ext import ndb
from google.appengine.api import memcache

from helper import development
from telegram_api import send_message


class StoryPost(ndb.Model):
  title = ndb.StringProperty()
  text = ndb.TextProperty()
  url = ndb.TextProperty()
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
    # Add title
    if story.get('url'):
      message = '[{title}]({url})\n'.format(**story)
    else:
      story['url'] = hn_url
      message = '[{title}]({url})\n'.format(**story)
    # Add current score
    message += "*Score:* {}+\n".format(story.get('score'))
    # Add comments Link
    message += "[Comments:]({}) {}+\n".format(hn_url,
                                              story.get('descendants', 0))
    # Add text
    text = story.get('text')
    if text:
      text = text.replace('<p>', '\n').replace('&#x27;', "'") \
                 .replace('&#x2F;', '/').encode('utf-8')
      message += "\n{}\n".format(text)

    if development():
      result = send_message('@hacker_news_feed_st', message)
    else:
      result = send_message('@hacker_news_feed', message)
    if result:
      cls(id=story_id, title=story.get('title'), url=story.get('url'),
          score=story.get('score'), text=story.get('text')).put()
      memcache.set(story_id, 1)
