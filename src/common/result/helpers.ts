import { Result } from "@praha/byethrow";

/** Extract the success value or fall back to a provided default. */
export const unwrapOr = <T, E = unknown>(r: Result.Result<T, E>, fallback: T): T =>
  Result.isSuccess(r) ? r.value : fallback;

/**
 * Pass a Result's failure to a reporter and return the success value (or `undefined`). Lets call
 * sites collapse `isFailure(r) && report(r.error)` into a single visible line.
 */
export const reportOnFail = <T, E>(
  r: Result.Result<T, E>,
  reporter: (e: E) => void,
): T | undefined => {
  if (Result.isSuccess(r)) return r.value;
  reporter(r.error);
  return undefined;
};
