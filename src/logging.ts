// Only fixed classifications and numeric metadata cross the logging boundary.
const systemCodes = new Set([
  "ECONNREFUSED", "ECONNRESET", "ECONNABORTED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN",
  "EHOSTUNREACH", "ENETUNREACH", "EPIPE", "EACCES", "EPERM", "ENOENT", "ENOTDIR",
  "EISDIR", "EEXIST", "ENOSPC", "EROFS", "EMFILE", "ENFILE", "EIO", "EBADF", "EINVAL",
  "ENAMETOOLONG", "ELOOP", "ENOTEMPTY", "ENOBUFS", "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT",
]);
const sqliteCodes = new Set<string>();
const sqliteExtensions: Record<string, string> = {
  ERROR: "MISSING_COLLSEQ RETRY SNAPSHOT", INTERNAL: "", PERM: "", ABORT: "ROLLBACK",
  BUSY: "RECOVERY SNAPSHOT TIMEOUT", LOCKED: "SHAREDCACHE VTAB", NOMEM: "",
  READONLY: "RECOVERY CANTLOCK ROLLBACK DBMOVED CANTINIT DIRECTORY", INTERRUPT: "",
  IOERR: "READ SHORT_READ WRITE FSYNC DIR_FSYNC TRUNCATE FSTAT UNLOCK RDLOCK DELETE BLOCKED NOMEM ACCESS CHECKRESERVEDLOCK LOCK CLOSE DIR_CLOSE SHMOPEN SHMSIZE SHMLOCK SHMMAP SEEK DELETE_NOENT MMAP GETTEMPPATH CONVPATH VNODE AUTH BEGIN_ATOMIC COMMIT_ATOMIC ROLLBACK_ATOMIC DATA CORRUPTFS IN_PAGE",
  CORRUPT: "VTAB SEQUENCE INDEX", NOTFOUND: "", FULL: "",
  CANTOPEN: "NOTEMPDIR ISDIR FULLPATH CONVPATH DIRTYWAL SYMLINK", PROTOCOL: "", EMPTY: "",
  SCHEMA: "", TOOBIG: "", CONSTRAINT: "CHECK COMMITHOOK FOREIGNKEY FUNCTION NOTNULL PRIMARYKEY TRIGGER UNIQUE VTAB ROWID PINNED DATATYPE",
  MISMATCH: "", MISUSE: "", NOLFS: "", AUTH: "USER", FORMAT: "", RANGE: "", NOTADB: "",
  NOTICE: "RECOVER_WAL RECOVER_ROLLBACK RBU", WARNING: "AUTOINDEX", ROW: "", DONE: "",
};
for (const [base, extensions] of Object.entries(sqliteExtensions)) {
  sqliteCodes.add(`SQLITE_${base}`);
  for (const extension of extensions.split(" ").filter(Boolean)) sqliteCodes.add(`SQLITE_${base}_${extension}`);
}
const appCodes = new Set([
  "CONFIG_TOKEN", "CONFIG_ORIGIN", "CONFIG_DATABASE", "DATABASE_FILE", "DATABASE_SCHEMA",
  "INVALID_TOP", "INVALID_STORY", "INVALID_JSON", "INVALID_RESPONSE", "TELEGRAM_REJECTED", "HTTP_ERROR",
  "MISSING_OR_CONFLICTING_INTENT", "UNCONFIRMED_INTENT", "MISMATCHED_INTENT", "STORY_FAILURES", "DIAGNOSTIC_MISSING",
]);
export class AppError extends Error {
  constructor(readonly code: string, message: string, readonly details: {
    http_status?: number; telegram_error_code?: number; retry_after?: number;
  } = {}) { super(message); }
}
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;

function errorMetadata(error: unknown): Record<string, unknown> {
  const value = (error !== null && typeof error === "object" ? error : {}) as any;
  let code = "UNKNOWN";
  if (typeof value.code === "string" && (systemCodes.has(value.code) || sqliteCodes.has(value.code))) {
    code = value.code;
  } else if (error instanceof AppError && appCodes.has(error.code)) {
    code = error.code;
  } else if (["TimeoutError", "AbortError", "SyntaxError", "TypeError"].includes(value.name)) {
    code = value.name;
  }
  const result: Record<string, unknown> = { code };
  if (integer(value.errno, -2147483648, 2147483647)) result.errno = value.errno;
  if (error instanceof AppError) {
    const { http_status, telegram_error_code, retry_after } = error.details;
    if (integer(http_status, 100, 599)) result.http_status = http_status;
    if (integer(telegram_error_code, 1, 999)) result.telegram_error_code = telegram_error_code;
    if (integer(retry_after, 0, 86400)) result.retry_after = retry_after;
  }
  return result;
}

export function safeError(error: unknown): Record<string, unknown> {
  const result = errorMetadata(error);
  const causes: Record<string, unknown>[] = [];
  let cause = error !== null && typeof error === "object" ? (error as any).cause : undefined;
  // Cycles and maliciously deep cause chains cannot grow a diagnostic indefinitely.
  for (let i = 0; cause != null && i < 3; i++) {
    causes.push(errorMetadata(cause));
    cause = typeof cause === "object" ? cause.cause : undefined;
  }
  if (causes.length) result.causes = causes;
  return result;
}
export type Stage = "config" | "db_open" | "hn_top" | "hn_item" | "validation" | "format" | "history" | "pending" | "claim" | "telegram_send" | "remember" | "finalize" | "diagnostic_update" | "db_close";
export function runLog() {
  const run_id = crypto.randomUUID();
  const started = performance.now();
  const counts = { sent: 0, quarantined: 0, skipped: 0, failures: 0 };
  function event(event: "run_start" | "run_end" | "failure" | "sent", stage: Stage, fields: Record<string, unknown> = {}) {
    const record = { event, stage, run_id, ...fields };
    console.error(JSON.stringify(record));
    return record;
  }
  event("run_start", "config");
  return {
    counts,
    sent: (story_id: number, message_id: number) =>
      event("sent", "telegram_send", { story_id, message_id }),
    failure: (stage: Stage, error: unknown, story_id?: number, message_id?: number) =>
      event("failure", stage, {
        ...safeError(error),
        ...(story_id === undefined ? {} : { story_id }),
        ...(message_id === undefined ? {} : { message_id }),
      }),
    end: (failed: boolean) => event("run_end", "db_close", {
      ...counts,
      failed,
      duration_ms: Math.max(0, Math.round(performance.now() - started)),
    }),
  };
}
export type RunLog = ReturnType<typeof runLog>;
