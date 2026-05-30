import { Result } from "@praha/byethrow";

/** Extract the success value or fall back to a provided default. */
export const unwrapOr = <T, E>(r: Result.Result<T, E>, fallback: T): T =>
  Result.isSuccess(r) ? r.value : fallback;
