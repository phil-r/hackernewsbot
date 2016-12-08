import os
import json
import urllib
import logging

from google.appengine.api import urlfetch
from google.appengine.api.urlfetch_errors import DeadlineExceededError

BASE_URL = 'https://api-ssl.bitly.com/v3/{method}?{qs}'
TOKEN = os.environ['BITLY_API_TOKEN']


def call_method(method, data):
  data.update({'access_token': TOKEN})
  data = urllib.urlencode(data)
  try:
    result = urlfetch.fetch(
        BASE_URL.format(method=method, qs=data),
        method=urlfetch.GET,
        deadline=10)
  except DeadlineExceededError as e:
    logging.exception(e)
    return None
  if result.status_code == 200:
    return json.loads(result.content).get('data')
  else:
    logging.error(result.content)
    return None


def shorten_url(long_url):
  return call_method('shorten', {'longUrl': long_url})
