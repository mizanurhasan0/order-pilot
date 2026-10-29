// A small in-memory fake of the @upstash/redis commands the stores use, with
// automaticDeserialization off (values come back as the strings that were stored).
export function createFakeRedis({ now = Date.now } = {}) {
  const strings = new Map(); // key -> { value, expiresAt }
  const zsets = new Map(); // key -> Map(member -> score)

  const live = (key) => {
    const entry = strings.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= now()) strings.delete(key);
    return strings.get(key) ?? null;
  };

  return {
    strings,
    async get(key) {
      return live(key)?.value ?? null;
    },
    async mget(...keys) {
      return keys.map((key) => live(key)?.value ?? null);
    },
    async set(key, value, { nx, xx, px } = {}) {
      const exists = live(key) !== null;
      if ((nx && exists) || (xx && !exists)) return null;
      strings.set(key, { value: String(value), expiresAt: px === undefined ? null : now() + px });
      return 'OK';
    },
    async del(...keys) {
      return keys.filter((key) => live(key) !== null && strings.delete(key)).length;
    },
    async incr(key) {
      const next = Number(live(key)?.value ?? 0) + 1;
      strings.set(key, { value: String(next), expiresAt: null });
      return next;
    },
    async zadd(key, { score, member }) {
      if (!zsets.has(key)) zsets.set(key, new Map());
      zsets.get(key).set(member, score);
      return 1;
    },
    async zrange(key, start, stop, { rev } = {}) {
      const members = [...(zsets.get(key) ?? new Map())].sort((a, b) => a[1] - b[1]).map(([member]) => member);
      if (rev) members.reverse();
      return members.slice(start, stop === -1 ? undefined : stop + 1);
    },
    async zcard(key) {
      return zsets.get(key)?.size ?? 0;
    },
  };
}
