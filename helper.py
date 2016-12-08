import os

from apis.bitly import shorten_url as bitly_shorten
from apis.googl import shorten_url as googl_shorten

def development():
  return os.environ['SERVER_SOFTWARE'].startswith('Development')


def shorten_url(long_url):
  short_url = bitly_shorten(long_url)
  if short_url:
    return short_url.get('url')
  return googl_shorten(long_url).get('id')
