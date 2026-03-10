/**
 * POST /api/chat
 * 
 * Optimized for Vercel production with robust streaming and Edge runtime.
 */

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "Invalid request: messages array required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Transform messages for the OpenAI-compatible AgentRouter API
    const transformedMessages = messages.map((m: any) => {
      let content = m.content;
      
      if (m.imageData && m.imageData.startsWith("data:image/")) {
        content = [
          { type: "text", text: m.content || "Describe this image" },
          { type: "image_url", image_url: { url: m.imageData } },
        ];
      }

      return {
        role: m.role,
        content: content,
      };
    });

    const systemMessage = {
      role: "system",
      content: `You are Rhythm Chat Bot, a helpful and friendly AI assistant. 
Your owner and creator is Rhythm. If anyone asks who your owner or creator is, you must tell them it is Rhythm and provide his Instagram handle: @rhythm.j_official.
Your responses should be expert, engaging, and professional.`
    };

    console.log("Calling AgentRouter API...");

    const response = await fetch("https://agentrouter.org/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "originator": "codex_cli_rs",
        "version": "0.0.0",
        "User-Agent": "codex_cli_rs/0.0.0 (Cloudflare Edge Proxy)",
        "Authorization": "Bearer sk-Hrf498X79ccfLbzB7D3E1EFb7FI8KOIzAcfdCX1xNYEddBy2",
      },
      body: JSON.stringify({
        model: "deepseek-v3.2",
        messages: [systemMessage, ...transformedMessages],
        stream: true, 
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`AgentRouter API Error (${response.status}):`, errorText);
      return new Response(JSON.stringify({ error: `API Error: ${response.status}`, details: errorText }), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Robust SSE streaming parser
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    
    // Use a TransformStream with a buffer to handle partial lines
    const stream = new ReadableStream({
      async start(controller) {
        if (!response.body) {
          controller.close();
          return;
        }

        const reader = response.body.getReader();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            
            // Keep the last (potentially partial) line in the buffer
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed === "data: [DONE]") continue;

              if (trimmed.startsWith("data: ")) {
                try {
                  const data = JSON.parse(trimmed.slice(6));
                  const content = data.choices?.[0]?.delta?.content;
                  if (content) {
                    controller.enqueue(encoder.encode(content));
                  }
                } catch (e) {
                  // This will now only happen on truly malformed lines, not partials
                  console.warn("JSON Parse Error on line:", trimmed);
                }
              }
            }
          }
        } catch (error) {
          console.error("Stream read error:", error);
          controller.error(error);
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });

  } catch (error) {
    console.error("Chat API error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "An unexpected error occurred",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

