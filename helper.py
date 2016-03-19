import os


def development():
  return os.environ['SERVER_SOFTWARE'].startswith('Development')
