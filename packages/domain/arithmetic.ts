// Deliberately tiny arithmetic grammar: no eval, identifiers, functions or code.
export function arithmetic(source: string): number | null {
  if (source.length > 200 || !/^[-+*/().\d\s]+$/.test(source)) return null;
  const tokens = source.match(/\d+(?:\.\d+)?|[-+*/()]/g) ?? [];
  let pos = 0,
    depth = 0;
  function atom(): number {
    if (++depth > 32) throw new Error();
    let value: number;
    if (tokens[pos] === "(") {
      pos++;
      value = expr();
      if (tokens[pos++] !== ")") throw new Error();
    } else if (tokens[pos] === "-") {
      pos++;
      value = -atom();
    } else if (tokens[pos] === "+") {
      pos++;
      value = atom();
    } else {
      value = Number(tokens[pos++]);
      if (!Number.isFinite(value)) throw new Error();
    }
    depth--;
    return value;
  }
  function term(): number {
    let value = atom();
    while (tokens[pos] === "*" || tokens[pos] === "/") {
      const op = tokens[pos++],
        other = atom();
      value = op === "*" ? value * other : value / other;
      if (!Number.isFinite(value)) throw new Error();
    }
    return value;
  }
  function expr(): number {
    let value = term();
    while (tokens[pos] === "+" || tokens[pos] === "-") {
      const op = tokens[pos++],
        other = term();
      value = op === "+" ? value + other : value - other;
    }
    return value;
  }
  try {
    const value = expr();
    return pos === tokens.length && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
