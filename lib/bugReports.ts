import { api } from "@/lib/api";
import type { UploadFile } from "./profile";

export async function submitBugReport(message: string, attachments: UploadFile[] = []): Promise<void> {
  const form = new FormData();
  form.append("message", message);
  for (const a of attachments) form.append("attachments", a as unknown as Blob);
  await api.post("/bug-reports", form, { timeoutMs: 90_000 });
}
