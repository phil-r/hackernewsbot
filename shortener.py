ALPHABET = "23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ"

# from https://stackoverflow.com/questions/1119722/base-62-conversion

def encode(num, alphabet=ALPHABET):
  """Encode a positive number in Base X

  Arguments:
  - `num`: The number to encode
  - `alphabet`: The alphabet to use for encoding
  """
  if num == 0:
    return alphabet[0]
  arr = []
  base = len(alphabet)
  while num:
    num, rem = divmod(num, base)
    arr.append(alphabet[rem])
  arr.reverse()
  return ''.join(arr)

def decode(string, alphabet=ALPHABET):
  """Decode a Base X encoded string into the number

  Arguments:
  - `string`: The encoded string
  - `alphabet`: The alphabet to use for encoding
  """
  base = len(alphabet)
  strlen = len(string)
  num = 0

  idx = 0
  for char in string:
    power = (strlen - (idx + 1))
    num += alphabet.index(char) * (base ** power)
    idx += 1

  return num
