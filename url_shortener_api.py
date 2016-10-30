import os
import json
import urllib
import logging

from google.appengine.api import urlfetch
from google.appengine.api.urlfetch_errors import DeadlineExceededError

BASE_URL = 'https://www.googleapis.com/urlshortener/v1/{method}?key={api_key}'
TOKEN = os.environ['GOOGLE_API_TOKEN']


def call_method(method, data):
  data.update({'key': TOKEN})
  data = json.dumps(data)
  try:
    result = urlfetch.fetch(
        BASE_URL.format(method=method, api_key=TOKEN),
        payload=data,
        method=urlfetch.POST,
        deadline=10,
        headers={'Content-Type': 'application/json'})
  except DeadlineExceededError as e:
    logging.exception(e)
    return None
  if result.status_code == 200:
    return json.loads(result.content)
  else:
    logging.error(result.content)
    return None


def shorten_url(long_url):
  return call_method('url', {'longUrl': long_url})
