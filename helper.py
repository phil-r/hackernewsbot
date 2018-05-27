import os

from google.appengine.api.modules import modules

from apis.bitly import shorten_url as bitly_shorten
from apis.googl import shorten_url as googl_shorten

def development():
  return os.environ['SERVER_SOFTWARE'].startswith('Development')


def shorten_url(long_url):
  short_url = bitly_shorten(long_url)
  if short_url:
    return short_url.get('url')
  return googl_shorten(long_url).get('id')

# https://stackoverflow.com/questions/34499875/how-to-automatically-delete-old-google-app-engine-version-instances
def stop_non_defualt_versions():
  for module in modules.get_modules():
    default_version = modules.get_default_version(module)
    for version in modules.get_versions(module):
        if version != default_version: 
          modules.stop_version(module, version)
