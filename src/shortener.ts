// Persisted links depend on this exact alphabet and digit order; do not reorder it.
const alphabet = "23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";

export function encode(id: number): string {
  if (!Number.isSafeInteger(id) || id < 0) throw new Error("Invalid ID");
  let value = BigInt(id);
  let result = "";
  do {
    result = alphabet[Number(value % BigInt(alphabet.length))] + result;
    value /= BigInt(alphabet.length);
  } while (value);
  return result;
}

// Leading zero digits remain valid aliases for existing links; unsafe integers do not.
export function decode(shortId: string): number {
  if (!shortId) throw new Error("Invalid short ID");
  let value = 0n;
  for (const char of shortId) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new Error("Invalid short ID");
    value = value * BigInt(alphabet.length) + BigInt(digit);
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error("Invalid short ID");
  }
  return Number(value);
}
