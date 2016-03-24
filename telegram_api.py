import os
import json
import urllib
import logging

from google.appengine.api import urlfetch
from google.appengine.api.urlfetch_errors import DeadlineExceededError

BASE_URL = 'https://api.telegram.org/bot{token}/{method}'
TOKEN = os.environ['TELEGRAM_BOT_TOKEN']


def call_method(method, data):
  form_data = urllib.urlencode(data)
  try:
    result = urlfetch.fetch(
        BASE_URL.format(token=TOKEN, method=method),
        payload=form_data,
        method=urlfetch.POST,
        deadline=10)
  except DeadlineExceededError as e:
    logging.exception(e)
    return None
  if result.status_code == 200:
    return json.loads(result.content)
  else:
    logging.error(result.content)
    return None


def send_message(chat_id, text, parse_mode='HTML'):
  return call_method('sendMessage', {
      'chat_id': chat_id,
      'text': text,
      'parse_mode': parse_mode
  })
