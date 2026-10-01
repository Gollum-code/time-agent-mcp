/**
 * current_time —— 现在几点、几号、周几、时区。
 */
import { z } from "zod";
import { isValidTimezone, snapshotNow } from "../util/time.js";

export const currentTimeSchema = {
  timezone: z
    .string()
    .optional()
    .describe("IANA 时区名，如 Asia/Shanghai / America/New_York；缺省用系统时区"),
};

export async function currentTime(args: { timezone?: string }) {
  const tz = args.timezone;
  if (tz && !isValidTimezone(tz)) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: `无效时区: ${tz}` }) }],
      isError: true,
    };
  }
  const now = snapshotNow(tz);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ ok: true, ...now }, null, 2),
      },
    ],
  };
}
