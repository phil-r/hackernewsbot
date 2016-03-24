import json

from google.appengine.api import urlfetch

BASE_URL = "https://hacker-news.firebaseio.com/v0/{method}.json"


def call_method(method):
  result = urlfetch.fetch(BASE_URL.format(method=method), deadline=10)
  if result.status_code == 200:
    return json.loads(result.content)
  return None


# Use a helper function to define the scope of the callback.
def create_callback(rpc, callback):
  return lambda: callback(rpc)


def call_method_async(method, callback):
  rpc = urlfetch.create_rpc(deadline=10)
  rpc.callback = create_callback(rpc, callback)
  urlfetch.make_fetch_call(rpc, BASE_URL.format(method=method))
  return rpc


def topstories():
  return call_method("topstories")


def item_async(id, callback):
  return call_method_async("item/{}".format(id), callback)


def item(id):
  return call_method("item/{}".format(id))
