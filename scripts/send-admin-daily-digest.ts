import { sendAdminDailyDigest } from "@/backend/notifications/adminDailyDigest";

async function main() {
  const result = await sendAdminDailyDigest();
  console.log(
    `Admin daily digest sent to ${result.sentCount} recipient(s): ${result.recipients.join(", ") || "(none)"}`
  );
}

main().catch((error) => {
  console.error("Failed to send admin daily digest:", error);
  process.exitCode = 1;
});
