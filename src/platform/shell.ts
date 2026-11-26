/** One piece of a shell line between ; && || | & and newlines, as words with quotes taken off. */
export interface ShellSegment { words: string[]; text: string }

export interface ShellLine {
  segments: ShellSegment[];
  /** One command with no redirection, no pipe and no $(...) or `...`: nothing else runs on this machine. */
  simple: boolean;
}

/** Split a shell line into commands and words. Quotes are respected; anything unusual makes it not simple.
 * Configured checks use cmd.exe on Windows, where backslashes are path separators, not shell escapes. */
export function splitShell(text: string, windowsPaths = false): ShellLine {
  const segments: ShellSegment[] = [];
  let words: string[] = [];
  let current = "";
  let started = false;
  let quote: string | undefined;
  let simple = true;
  let segmentStart = 0;
  const endWord = () => { if (started) words.push(current); current = ""; started = false; };
  const endSegment = (index: number) => {
    endWord();
    if (words.length) segments.push({ words, text: text.slice(segmentStart, index).trim() });
    words = [];
    segmentStart = index + 1;
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quote) {
      if (char === quote) quote = undefined;
      else if (quote === "\"" && (char === "`" || (char === "$" && text[index + 1] === "("))) { simple = false; current += char; }
      // As bash reads it: inside double quotes a backslash escapes only $ ` " \ and a newline, and stays otherwise
      // ("..\.ssh" stays ..\.ssh, which Git Bash on Windows reads as a path).
      else if (!windowsPaths && char === "\\" && quote === "\"" && index + 1 < text.length && "$`\"\\\n".includes(text[index + 1]!)) { index++; if (text[index] !== "\n") current += text[index]; }
      else current += char;
      continue;
    }
    if (char === "'" || char === "\"") { quote = char; started = true; continue; }
    if (!windowsPaths && char === "\\" && index + 1 < text.length) {
      if (text[index + 1] === "\n") { index++; continue; }
      current += text[++index]; started = true; continue;
    }
    // Redirection operators (>|, >&, <&, &>) are not pipes or background jobs.
    if ((char === "|" && text[index - 1] === ">")
      || (char === "&" && (text[index - 1] === ">" || text[index - 1] === "<" || text[index + 1] === ">"))) {
      current += char; started = true; continue;
    }
    if (char === "\n" || char === ";" || char === "|" || char === "&") {
      simple = false;
      endSegment(index);
      if ((char === "|" || char === "&") && text[index + 1] === char) { index++; segmentStart = index + 1; }
      continue;
    }
    // ( ) `...` and $(...) start or end a command of their own: `(ssh host id)`, `echo $(ssh host id)`.
    if (char === "`" || char === "(" || char === ")" || (char === "$" && text[index + 1] === "(")) {
      simple = false;
      if (char === "$") index++;
      endSegment(index);
      continue;
    }
    if (char === "<" || char === ">") simple = false;
    if (/\s/.test(char)) { endWord(); continue; }
    current += char; started = true;
  }
  endSegment(text.length);
  if (quote) simple = false;
  return { segments, simple: simple && segments.length === 1 };
}
