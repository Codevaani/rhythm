import { ChatShell } from "@/components/chat/chat-shell"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Rhythm Chat Bot",
  description: "Chat with Rhythm Chat Bot - @rhythm.j_official",
}

export default function ChatPage() {
  return <ChatShell />
}
