import { expect, test } from "bun:test";
import { formatPost } from "../src/story";
import { decode, encode } from "../src/shortener";

// Fixed compatibility expectations need no Python runtime, generated files, or network.
const story = { id: 21447853, title: "Café 🚀", score: 150, time: 1577836800 };
const base = "https://readhacker.news";

test("age wording matches the actual Python timeago call, including its reversed arguments", () => {
  for (const [elapsedSeconds, expected] of [
    [-63072000, "2 years ago"],
    [-31536000, "1 year ago"],
    [-2628000, "1 month ago"],
    [-604800, "1 week ago"],
    [-3600, "1 hour ago"],
    [-10, "10 seconds ago"],
    [-1, "just now"],
    [0, "just now"],
    [0.999, "just now"],
    [1, "a while"],
    [9, "a while"],
    [10, "in 10 seconds"],
    [59, "in 59 seconds"],
    [60, "in 1 minute"],
    [119, "in 1 minute"],
    [120, "in 2 minutes"],
    [3599, "in 59 minutes"],
    [3600, "in 1 hour"],
    [7200, "in 2 hours"],
    [86400, "in 1 day"],
    [172800, "in 2 days"],
    [604799, "in 6 days"],
    [604800, "in 1 week"],
    [1209600, "in 2 weeks"],
    [2627999, "in 4 weeks"],
    [2628000, "in 1 month"],
    [31535999, "in 11 months"],
    [31536000, "in 1 year"],
    [63072000, "in 2 years"],
  ] as const) {
    const post = formatPost(story, base, story.time * 1000 + elapsedSeconds * 1000);
    expect(post.message.split(")\n")[0]!.endsWith(`150+ ${expected}`)).toBe(true);
  }
});

test("fixed Python short IDs, including historical IDs and leading zero aliases", () => {
  for (const [id, encoded] of [
    [0, "2"],
    [1, "3"],
    [55, "Z"],
    [56, "32"],
    [57, "33"],
    [3135, "ZZ"],
    [3136, "322"],
    [3137, "323"],
    [21447853, "4c9fp"],
    [8863, "4Qh"],
    [9007199254740991, "3F9eXBXaEz"],
  ] as const) {
    expect(encode(id)).toBe(encoded);
    expect(decode(encoded)).toBe(id);
    expect(decode(`22${encoded}`)).toBe(id);
  }
  for (const invalid of ["", "0", "1", "l", "o", "I", "O", "!", "ZZZZZZZZZZZZZZZZZZ"])
    expect(() => decode(invalid)).toThrow();
  for (const invalid of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    expect(() => encode(invalid)).toThrow();
});

test("complete external and self posts preserve message layout and buttons", () => {
  const now = Date.UTC(2020, 0, 1, 4);
  const discussion = "https://news.ycombinator.com/item?id=21447853";
  const shortDiscussion = `${base}/c/4c9fp`;
  expect(formatPost({ ...story, url: "https://example.com", descendants: 12 }, base, now)).toEqual({
    id: story.id, title: story.title, score: story.score,
    text: null,
    message: "<b>Café 🚀</b> (🔥 Score: 150+ in 4 hours)\n\n<b>Link:</b> https://readhacker.news/s/4c9fp\n<b>Comments:</b> https://readhacker.news/c/4c9fp\n",
    buttons: [{ text: "Read", url: "https://example.com" }, { text: "12+ Comments", url: discussion }],
    url: "https://example.com",
    shortUrl: `${base}/s/4c9fp`,
    shortHnUrl: shortDiscussion,
  });
  const text = "hello<p>&#x27;world&#x27; &#x2F; <b>bold</b>";
  expect(formatPost({ ...story, text }, base, now)).toEqual({
    id: story.id, title: story.title, score: story.score, text,
    message: "<b>Café 🚀</b> (🔥 Score: 150+ in 4 hours)\n\n<b>Link:</b> https://readhacker.news/c/4c9fp\n\nhello\n'world' / <b>bold</b>\n",
    buttons: [{ text: "0+ Comments", url: discussion }],
    url: discussion, shortUrl: shortDiscussion, shortHnUrl: shortDiscussion,
  });
  expect(formatPost({ ...story, text: "" }, base, now).message).toBe(
    formatPost(story, base, now).message,
  );
});

test("intentional HTML safety differences: escape title, strip unsupported tags only", () => {
  const post = formatPost({ ...story, title: "A & B < C > D", text: '<div>x</div><p><i>yes</i> <a href="https://example.com">link</a></p>' }, base, story.time * 1000);
  expect(post.message).toBe('<b>A &amp; B &lt; C &gt; D</b> (🔥 Score: 150+ just now)\n\n<b>Link:</b> https://readhacker.news/c/4c9fp\n\nx\n<i>yes</i> <a href="https://example.com">link</a>\n');
});

test("title entities decode once before Telegram escaping, without changing stored source", () => {
  for (const [title, expected] of [
    ["Don&#x27;t panic – AT&amp;T", "Don't panic – AT&amp;T"],
    ["Don&#39;t &#X27; &#38; &#x26; &#128640; &#x1F680;", "Don't ' &amp; &amp; 🚀 🚀"],
    ["&quot;quoted&quot; &apos; &copy; &eacute; &mdash;", '"quoted" \' © é —'],
    ["&lt;b&gt;not bold&lt;/b&gt; &#60;i&#62;not italic&#60;/i&#62;", "&lt;b&gt;not bold&lt;/b&gt; &lt;i&gt;not italic&lt;/i&gt;"],
    ["&amp;lt;b&amp;gt; &amp;#x27; &amp;amp;", "&amp;lt;b&amp;gt; &amp;#x27; &amp;amp;"],
    ["&#x110000; &#xD800; &#0; &#xZZ; &unknown;", "� � � &amp;#xZZ; &amp;unknown;"],
    ["Don't panic – Café 🚀 AT&T <b>literal</b> >", "Don't panic – Café 🚀 AT&amp;T &lt;b&gt;literal&lt;/b&gt; &gt;"],
  ] as const) {
    const source = { ...story, title };
    const post = formatPost(source, base, story.time * 1000);
    expect(post.message).toBe(
      formatPost(story, base, story.time * 1000).message.replace(
        `<b>${story.title}</b>`, `<b>${expected}</b>`,
      ),
    );
    expect(post.title).toBe(title);
    expect(source.title).toBe(title);
  }
});

test("body anchors keep balanced href-only Telegram markup", () => {
  for (const [text, expected] of [
    ['<a href="https://example.com" rel="nofollow">example</a>', '<a href="https://example.com">example</a>'],
    ["<a rel='nofollow' href='https://example.com' target='_blank'><i>example</i></a>", '<a href="https://example.com"><i>example</i></a>'],
    ['<a title="not a href=\'https://wrong.example\'" href="https://example.com?a=1&amp;b=2">example</a>', '<a href="https://example.com?a=1&amp;b=2">example</a>'],
    ["<a href='https://example.com/&#x27;?q=\"quoted\"' rel='nofollow'>example</a>", '<a href="https://example.com/\'?q=&quot;quoted&quot;">example</a>'],
    ['<a name="bookmark">example</a>', 'example'],
    ['<A REL="nofollow" HREF="https://example.com?a=&quot;x&quot;&amp;b=2">one</A> <a href="https://other.example" rel="nofollow">two</a>', '<a href="https://example.com?a=&quot;x&quot;&amp;b=2">one</a> <a href="https://other.example">two</a>'],
    ['<a title="a > b" href="https://example.com/&lt;tag&gt;" rel="nofollow">example</a>', '<a href="https://example.com/&lt;tag&gt;">example</a>'],
  ]) {
    const post = formatPost({ ...story, text }, base, story.time * 1000);
    expect(post.message).toBe(`${formatPost(story, base, story.time * 1000).message}\n${expected}\n`);
    expect(post.text).toBe(text);
  }
});

test("legacy marker boundaries are inclusive at four hours and two days", () => {
  for (const [elapsed, marker] of [[4 * 3600_000 - 1, "🔥"], [4 * 3600_000, "🔥"], [4 * 3600_000 + 1, ""], [2 * 86400_000 - 1, ""], [2 * 86400_000, "❄️"], [2 * 86400_000 + 1, "❄️"]] as const) {
    const message = formatPost(story, base, story.time * 1000 + elapsed).message;
    expect(message.includes("🔥")).toBe(marker === "🔥");
    expect(message.includes("❄️")).toBe(marker === "❄️");
  }
});
