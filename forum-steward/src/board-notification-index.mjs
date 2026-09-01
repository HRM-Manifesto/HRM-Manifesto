import { sendBoardModerationNotifications } from "./board-notification.mjs";

const result = await sendBoardModerationNotifications();
process.stdout.write(result.sent ? `Sent one moderation email for ${result.count} Board submission(s).\n` : "No new Board submissions.\n");
