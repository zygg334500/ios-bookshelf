type TrieNode = {
  children: Map<string, TrieNode>;
  value?: string;
};

function node(): TrieNode {
  return { children: new Map() };
}

function insert(root: TrieNode, key: string, value: string) {
  if (!key || !value) return;
  let current = root;
  for (const ch of key) {
    let next = current.children.get(ch);
    if (!next) {
      next = node();
      current.children.set(ch, next);
    }
    current = next;
  }
  current.value = value;
}

function firstChoice(raw: string): string {
  const choice = raw.trim().split(/\s+/)[0];
  return choice ?? '';
}

/** Parse OpenCC STCharacters / STPhrases text (tab-separated, first candidate wins). */
export function buildConverter(characters: string, phrases: string): (text: string) => string {
  const root = node();
  const load = (source: string) => {
    for (const line of source.split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue;
      const tab = line.indexOf('\t');
      if (tab <= 0) continue;
      const key = line.slice(0, tab);
      const value = firstChoice(line.slice(tab + 1));
      insert(root, key, value);
    }
  };
  load(characters);
  load(phrases);

  return function convert(text: string): string {
    let out = '';
    let i = 0;
    while (i < text.length) {
      let current: TrieNode | undefined = root;
      let lastValue: string | undefined;
      let lastLength = 0;
      let j = i;
      while (current && j < text.length) {
        current = current.children.get(text[j]);
        if (!current) break;
        j += 1;
        if (current.value) {
          lastValue = current.value;
          lastLength = j - i;
        }
      }
      if (lastValue && lastLength > 0) {
        out += lastValue;
        i += lastLength;
      } else {
        out += text[i];
        i += 1;
      }
    }
    return out;
  };
}

/** Convert visible text nodes. Tags and attributes stay untouched. */
export function convertHtmlText(html: string, convert: (text: string) => string): string {
  let out = '';
  let i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      if (end < 0) {
        out += html.slice(i);
        break;
      }
      out += html.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    const next = html.indexOf('<', i);
    const text = next < 0 ? html.slice(i) : html.slice(i, next);
    out += convert(text);
    if (next < 0) break;
    i = next;
  }
  return out;
}
