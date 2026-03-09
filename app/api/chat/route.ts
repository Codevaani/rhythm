/**
 * POST /api/chat
 *
 * This route handler proxies requests to AgentRouter using the specified curl configuration.
 * It uses the deepseek-v3.2 model and maintains all required headers.
 */
export async function POST(req: Request) {
  try {
    const { messages } = await req.json()

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "Invalid request: messages array required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    }

    // Transform messages for the OpenAI-compatible AgentRouter API
    const transformedMessages = messages.map((m: any) => {
      let content = m.content
      
      // Handle multimodal content (images) if present
      if (m.imageData && m.imageData.startsWith("data:image/")) {
        content = [
          {
            type: "text",
            text: m.content || "Describe this image",
          },
          {
            type: "image_url",
            image_url: {
              url: m.imageData,
            },
          },
        ]
      }

      return {
        role: m.role,
        content: content,
      }
    })

    const systemMessage = {
      role: "system",
      content: `You are Rhythm Chat Bot, a helpful and friendly AI assistant created by Rhythm (Instagram: @rhythm.j_official). 
Your responses should be expert, engaging, and professional. 
Always acknowledge your identity as Rhythm Chat Bot when asked who you are.`
    }

    // Calling the API with the exact CURL configuration provided
    const response = await fetch("https://agentrouter.org/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "originator": "codex_cli_rs",
        "version": "0.0.0",
        "User-Agent": "codex_cli_rs/0.0.0 (Cloudflare Edge Proxy)",
        "Connection": "keep-alive",
        "Authorization": "Bearer sk-Hrf498X79ccfLbzB7D3E1EFb7FI8KOIzAcfdCX1xNYEddBy2",
      },
      body: JSON.stringify({
        model: "deepseek-v3.2",
        messages: [systemMessage, ...transformedMessages],
        stream: true, 
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("AgentRouter API Error:", errorText)
      return new Response(JSON.stringify({ error: `API Error: ${response.status}` }), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      })
    }

    // Process the SSE stream from AgentRouter and pipe it to the frontend
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()

    const transformStream = new TransformStream({
      transform(chunk, controller) {
        const text = decoder.decode(chunk)
        const lines = text.split("\n")

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed === "data: [DONE]") continue

          if (trimmed.startsWith("data: ")) {
            try {
              const data = JSON.parse(trimmed.slice(6))
              const content = data.choices?.[0]?.delta?.content
              if (content) {
                controller.enqueue(encoder.encode(content))
              }
            } catch (e) {
              // Silently handle partial JSON chunks
            }
          }
        }
      },
    })

    return new Response(response.body?.pipeThrough(transformStream), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    })
  } catch (error) {
    console.error("Chat API error:", error)

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "An unexpected error occurred",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }
}
