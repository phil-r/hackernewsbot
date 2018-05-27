import os
import json
import urllib
import logging

from google.appengine.api import urlfetch
from google.appengine.api.urlfetch_errors import DeadlineExceededError

BASE_URL = 'https://api.telegram.org/bot{token}/{method}'
TOKEN = os.environ['TELEGRAM_BOT_TOKEN']


def call_method(method, data):
  data = json.dumps(data)
  try:
    result = urlfetch.fetch(
        BASE_URL.format(token=TOKEN, method=method),
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


def send_message(chat_id, text, reply_markup=None, parse_mode='HTML',
                 disable_notification=True):
  message = {
    'chat_id': chat_id,
    'text': text,
    'parse_mode': parse_mode,
    'disable_notification': disable_notification
  }

  if reply_markup:
      message['reply_markup'] = reply_markup

  return call_method('sendMessage', message)
