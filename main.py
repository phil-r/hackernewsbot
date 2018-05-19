import json
import logging
import shortener

from google.appengine.api import urlfetch, memcache
from google.appengine.ext import deferred, ndb

from flask import Flask, redirect
from apis.hn import topstories, item_async
from database import StoryPost

app = Flask(__name__)


@app.route('/')
def hello():
  """Return a friendly HTTP greeting."""
  return "Hello!"

@app.route('/s/<short_id>')
def story_redirect(short_id):
  """Redirect to story url"""
  story_id = str(shortener.decode(short_id))
  redirect_url = memcache.get(story_id)
  if not redirect_url:
    story = ndb.Key(StoryPost, story_id).get()
    redirect_url = story.url
  return redirect(redirect_url)

@app.route('/c/<short_id>')
def comments_redirect(short_id):
  """Redirect to comments url"""
  story_id = str(shortener.decode(short_id))
  hn_url = "https://news.ycombinator.com/item?id={}".format(story_id)
  return redirect(hn_url)

def task(stories):
  def check_story(rpc):
    try:
      result = rpc.get_result()
      story = json.loads(result.content)
      if story and story.get('score') >= 100:
        StoryPost.add(story)
    except urlfetch.DownloadError as ex:
      logging.exception(ex)
  rpcs = map(lambda id: item_async(id, check_story), stories)
  for rpc in rpcs:
    rpc.wait()


def chunkify(lst, n):
  return [lst[i::n] for i in xrange(n)]


@app.route('/cron')
def cron():
  stories = topstories()
  chunks = chunkify(stories, 50)
  for chunk in chunks:
    deferred.defer(task, chunk)
  return 'OK'


@app.errorhandler(404)
def page_not_found(e):
  """Return a custom 404 error."""
  return 'Sorry, Nothing at this URL.', 404


@app.errorhandler(500)
def application_error(e):
  """Return a custom 500 error."""
  return 'Sorry, unexpected error: {}'.format(e), 500
