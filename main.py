import json
import logging
import shortener

from google.appengine.api import urlfetch, memcache
from google.appengine.ext import deferred, ndb

from flask import Flask, redirect, abort, make_response
from apis.hn import topstories, item_async
from database import StoryPost
from helper import stop_non_defualt_versions

app = Flask(__name__)


@app.route('/s/<short_id>')
def story_redirect(short_id):
  """Redirect to story url"""
  try:
    story_id = str(shortener.decode(short_id))
  except:
    return abort(400)
  redirect_url = memcache.get(story_id)
  if not redirect_url:
    story = ndb.Key(StoryPost, story_id).get()
    if not story:
      return make_response('<h1>Service Unavailable</h1><p>Try again later</p>', 503, {'Retry-After': 5})
    story.add_memcache()
    redirect_url = story.url
  return redirect(redirect_url)


@app.route('/c/<short_id>')
def comments_redirect(short_id):
  """Redirect to comments url"""
  try:
    story_id = str(shortener.decode(short_id))
  except:
    return abort(400)
  hn_url = "https://news.ycombinator.com/item?id={}".format(story_id)
  return redirect(hn_url)


def task(stories):
  def check_story(rpc):
    try:
      result = rpc.get_result()
      story = json.loads(result.content)
      if story and story.get('score') >= 100:
        StoryPost.add(story)
      else:
        logging.info('STOP: {id} has low score ({score})'.format(**story))
    except urlfetch.DownloadError as ex:
      logging.exception(ex)
    except ValueError as ex:
      logging.info(result.content)
      logging.exception(ex)


  # stringify ids for use in memcache and convert to set for later
  ids = set(str(story_id) for story_id in stories)
  # get stories that we already posted to reduce the number of requests
  cached_stories = set(memcache.get_multi(ids).keys())
  logging.info('cached stories: {}'.format(cached_stories))
  # remove stories we know about from stories that we need to check
  stories_to_check = ids.difference(cached_stories)
  rpcs = map(lambda id: item_async(id, check_story), stories_to_check)
  for rpc in rpcs:
    rpc.wait()


def chunkify(lst, n):
  return [lst[i::n] for i in xrange(n)]


@app.route('/cron')
def cron():
  stop_non_defualt_versions()
  stories = topstories()
  chunks = chunkify(stories, 100)
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
