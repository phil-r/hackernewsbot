import json
import logging

from google.appengine.api import urlfetch
from google.appengine.ext import deferred

from flask import Flask
from apis.hn import topstories, item_async
from database import StoryPost

app = Flask(__name__)


@app.route('/')
def hello():
  """Return a friendly HTTP greeting."""
  return "Hello!"


def task(stories):
  def check_story(rpc):
    try:
      result = rpc.get_result()
      story = json.loads(result.content)
      if story and story.get('score') >= 100:
        StoryPost.add(story)
    except urlfetch.DownloadError as ex:
      logging.exception(ex)
  #  TODO: don't fetch already loaded (>=150 score) stories
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
