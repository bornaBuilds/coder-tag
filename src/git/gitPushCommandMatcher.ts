/**
 * Pure predicate deciding whether a shell command line represents an invocation
 * of `git push`. Kept free of any VS Code dependency so it can be unit-tested
 * quickly and reused by the terminal detector.
 *
 * The input is the command line exactly as terminal shell integration reports
 * it, e.g. "git push", "git -c user.email=x push origin main", or a compound
 * command such as "npm run build && git push".
 */

/**
 * Git global options that consume the following token when written separately,
 * e.g. `git -c user.email=x push` or `git -C /path push`. The `--opt=value`
 * form is a single token and is handled by the generic option skip.
 */
const GIT_GLOBAL_OPTIONS_WITH_VALUE = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
]);

const GIT_INFORMATION_OPTIONS = new Set([
  "-h",
  "-v",
  "--help",
  "--version",
  "--html-path",
  "--man-path",
  "--info-path",
]);

export function isGitPushCommand(commandLine: string): boolean {
  if (!commandLine || commandLine.trim().length === 0) {
    return false;
  }

  for (const segment of splitCommandSegments(commandLine)) {
    if (segmentIsGitPush(segment)) {
      return true;
    }
  }

  return false;
}

/**
 * Splits a command line into independently-executed segments on `&&`, `;`, and
 * newlines. For a segment guarded by `||`, only the left-hand side is kept: a
 * push after `||` runs only when the earlier command failed, so an exit code of
 * 0 there does not reliably mean the push itself succeeded.
 */
function splitCommandSegments(commandLine: string): string[] {
  return commandLine
    .split(/&&|;|\n/)
    .map((segment) => segment.split("||")[0])
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function segmentIsGitPush(segment: string): boolean {
  // Only the head of a pipeline is considered; the reported exit code belongs to
  // the last stage, so a piped push is treated conservatively as an attempt.
  const head = segment.split("|")[0].trim();
  const tokens = head.split(/\s+/).filter((token) => token.length > 0);

  return isGitPushArgv(tokens);
}

/**
 * Array-based counterpart used when Git itself reports argv through Trace2.
 * Keeping this path token-aware avoids lossy shell quoting and escaping.
 */
export function isGitPushArgv(tokens: readonly string[]): boolean {
  if (tokens.length < 2) {
    return false;
  }

  if (!isGitInvocation(tokens[0])) {
    return false;
  }

  let index = 1;
  while (index < tokens.length) {
    const token = tokens[index];

    if (!token.startsWith("-")) {
      break;
    }

    if (GIT_INFORMATION_OPTIONS.has(token)) {
      return false;
    }

    if (GIT_GLOBAL_OPTIONS_WITH_VALUE.has(token)) {
      index += 2;
    } else {
      index += 1;
    }
  }

  if (tokens[index] !== "push") {
    return false;
  }

  // `git push --help` / `-h` opens help and exits 0 without pushing anything.
  const pushArgs = tokens.slice(index + 1);
  if (pushArgs.includes("--help") || pushArgs.includes("-h")) {
    return false;
  }

  return true;
}

function isGitInvocation(token: string): boolean {
  // Accept "git", "git.exe", and absolute paths ending in either, on POSIX or
  // Windows separators. Reject look-alikes like "gitpush" or "mygit".
  const basename = token.split(/[\\/]/).pop() ?? token;
  const normalized = basename.toLowerCase();
  return normalized === "git" || normalized === "git.exe";
}
