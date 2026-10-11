// A small JSON parser that remembers where each value is, so onboarding
// config errors can name the line and column. Same grammar as JSON.parse;
// a key repeated in one object is an error instead of last-one-wins.

export type Pos = { line: number; col: number };

export type Parsed = {
  value: unknown;
  /** Position of each value by path: "", "slug", "sources[0].public_key", ... */
  positions: Map<string, Pos>;
};

export class JsonSyntaxError extends Error {
  constructor(message: string, readonly pos: Pos) {
    super(message);
    this.name = "JsonSyntaxError";
  }
}

export function childPath(parent: string, key: string | number): string {
  if (typeof key === "number") return `${parent}[${key}]`;
  return parent ? `${parent}.${key}` : key;
}

export function parseJsonWithPositions(text: string): Parsed {
  const positions = new Map<string, Pos>();
  let i = 0;

  const posAt = (index: number): Pos => {
    let line = 1;
    let col = 1;
    for (let k = 0; k < index && k < text.length; k++) {
      if (text[k] === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
    }
    return { line, col };
  };
  const fail = (message: string, at = i): never => {
    throw new JsonSyntaxError(message, posAt(at));
  };
  const skipWs = () => {
    while (i < text.length && " \t\n\r".includes(text[i])) i++;
  };
  const describe = () => (i >= text.length ? "end of file" : JSON.stringify(text[i]));

  const parseString = (): string => {
    const start = i;
    i++; // opening quote
    while (i < text.length && text[i] !== '"') {
      if (text[i] === "\\") i++;
      else if (text.charCodeAt(i) < 0x20) fail("Unescaped control character in string");
      i++;
    }
    if (i >= text.length) fail("Unterminated string", start);
    i++; // closing quote
    try {
      return JSON.parse(text.slice(start, i));
    } catch {
      return fail("Invalid escape in string", start);
    }
  };

  const parseValue = (path: string): unknown => {
    skipWs();
    positions.set(path, posAt(i));
    const c = text[i];
    if (c === "{") return parseObject(path);
    if (c === "[") return parseArray(path);
    if (c === '"') return parseString();
    for (const [word, value] of [["true", true], ["false", false], ["null", null]] as const) {
      if (text.startsWith(word, i)) {
        i += word.length;
        return value;
      }
    }
    const num = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
    if (num) {
      i += num[0].length;
      return Number(num[0]);
    }
    return fail(`Unexpected ${describe()}, expected a value`);
  };

  const parseObject = (path: string): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    i++; // {
    skipWs();
    if (text[i] === "}") {
      i++;
      return out;
    }
    for (;;) {
      skipWs();
      if (text[i] !== '"') fail(`Unexpected ${describe()}, expected a "quoted" key`);
      const keyAt = i;
      const key = parseString();
      if (Object.hasOwn(out, key)) fail(`Duplicate key ${JSON.stringify(key)}`, keyAt);
      skipWs();
      if (text[i] !== ":") fail(`Unexpected ${describe()}, expected ":"`);
      i++;
      out[key] = parseValue(childPath(path, key));
      skipWs();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "}") {
        i++;
        return out;
      }
      fail(`Unexpected ${describe()}, expected "," or "}"`);
    }
  };

  const parseArray = (path: string): unknown[] => {
    const out: unknown[] = [];
    i++; // [
    skipWs();
    if (text[i] === "]") {
      i++;
      return out;
    }
    for (;;) {
      out.push(parseValue(childPath(path, out.length)));
      skipWs();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "]") {
        i++;
        return out;
      }
      fail(`Unexpected ${describe()}, expected "," or "]"`);
    }
  };

  const value = parseValue("");
  skipWs();
  if (i < text.length) fail(`Unexpected ${describe()} after the end of the JSON value`);
  return { value, positions };
}
