/**
 * POST /api/chat
 * 
 * Uses Node.js runtime (not Edge) to avoid Cloudflare blocking.
 * Supports both streaming and non-streaming responses from AgentRouter.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "Invalid request: messages array required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Filter out empty assistant messages from failed previous attempts
    const cleanMessages = messages.filter((m: any) => {
      if (m.role === "assistant" && (!m.content || m.content.trim() === "")) {
        return false;
      }
      return true;
    });

    // Transform messages for the OpenAI-compatible AgentRouter API
    const transformedMessages = cleanMessages.map((m: any) => {
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

    const apiKey = process.env.AGENTROUTER_API_KEY;
    if (!apiKey) {
      console.error("[RhythmBot] AGENTROUTER_API_KEY is not set!");
      return new Response(JSON.stringify({ error: "Server configuration error: API key not set" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log("[RhythmBot] Calling AgentRouter API...");

    const response = await fetch("https://agentrouter.org/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "originator": "codex_cli_rs",
        "version": "0.0.0",
        "User-Agent": "codex_cli_rs/0.0.0 (Cloudflare Edge Proxy)",
        "Connection": "keep-alive",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-v3.2",
        messages: [systemMessage, ...transformedMessages],
        stream: true,
      }),
    });

    console.log("[RhythmBot] API Status:", response.status);
    console.log("[RhythmBot] Content-Type:", response.headers.get("content-type"));

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[RhythmBot] API Error (${response.status}):`, errorText.substring(0, 300));
      return new Response(JSON.stringify({ 
        error: `API Error: ${response.status}`,
        details: errorText.substring(0, 200),
      }), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const contentType = response.headers.get("content-type") || "";
    
    // If response is HTML (Cloudflare challenge), return error
    if (contentType.includes("text/html")) {
      const htmlBody = await response.text();
      console.error("[RhythmBot] Got HTML response (Cloudflare block):", htmlBody.substring(0, 300));
      return new Response(JSON.stringify({ 
        error: "AI service temporarily unavailable (blocked by firewall)",
      }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Handle SSE streaming response
    if (contentType.includes("text/event-stream") || contentType.includes("application/octet-stream") || contentType.includes("text/plain")) {
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      
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
                  } catch {
                    // Skip malformed lines
                  }
                }
              }
            }
          } catch (error) {
            console.error("[RhythmBot] Stream error:", error);
          } finally {
            controller.close();
          }
        }
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    }

    // Handle JSON (non-streaming) response
    const responseText = await response.text();
    console.log("[RhythmBot] Response (first 300):", responseText.substring(0, 300));
    
    try {
      const data = JSON.parse(responseText);
      const aiContent = data.choices?.[0]?.message?.content || "";

      if (!aiContent) {
        return new Response(JSON.stringify({ error: "AI returned empty response" }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(aiContent, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    } catch {
      console.error("[RhythmBot] Cannot parse response:", responseText.substring(0, 200));
      return new Response(JSON.stringify({ error: "Failed to parse AI response" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

  } catch (error) {
    console.error("[RhythmBot] Chat API error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "An unexpected error occurred",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
