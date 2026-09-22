import { unfilledPlaceholders } from "@/lib/outreach";

export interface MessageTemplate {
  subject: string | null;
  body: string;
}

export function selectMessageTemplate(
  templates: { ig_dm: MessageTemplate | null; email: MessageTemplate | null },
  channel: "ig_dm" | "email",
  kind: "initial" | "follow_up",
): MessageTemplate | null {
  if (kind === "initial") return templates[channel];
  return {
    subject: channel === "email" ? "Following up" : null,
    body: "Hi {{name}}, following up on my last message. Have you had a chance to take a look? Happy to answer any questions.",
  };
}

export function validateMessageDraft(subject: string | null, message: string): string | null {
  if (!message.trim()) return "Write the message before copying or logging it.";
  const missing = unfilledPlaceholders(`${subject ?? ""}\n${message}`);
  return missing.length ? `Fill in ${missing.map((item) => `[${item}]`).join(", ")} before copying or logging.` : null;
}
