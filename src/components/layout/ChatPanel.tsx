"use client";
import { useState, useRef, useEffect, useCallback } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
  loading?: boolean;
}

interface ChatPanelProps {
  open: boolean;
  initialQuery: string;
  onClose: () => void;
}

export function ChatPanel({ open, initialQuery, onClose }: ChatPanelProps) {
  const [messages, setMessages]   = useState<Message[]>([]);
  const [input, setInput]         = useState("");
  const [streaming, setStreaming] = useState(false);
  const [noKey, setNoKey]         = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);
  const sentInitial = useRef(false);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || streaming) return;
    const userMsg: Message = { role: "user", content: text.trim() };
    const assistantMsg: Message = { role: "assistant", content: "", loading: true };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput("");
    setStreaming(true);

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text.trim(), history }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if ((err as any).error === "no_key") {
          setNoKey(true);
          setMessages(prev => prev.slice(0, -1).concat({ role: "assistant", content: "⚠️ You need to configure your Anthropic API key in **Settings** to use the chat." }));
        } else {
          setMessages(prev => prev.slice(0, -1).concat({ role: "assistant", content: "Error connecting to the AI. Please try again." }));
        }
        return;
      }

      // Stream response
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let full = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        full += chunk;
        setMessages(prev => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: full };
          return copy;
        });
      }
    } catch {
      setMessages(prev => prev.slice(0, -1).concat({ role: "assistant", content: "Connection error. Verify the server is running." }));
    } finally {
      setStreaming(false);
    }
  }, [messages, streaming]);

  // Send initial query when panel opens
  useEffect(() => {
    if (open && initialQuery && !sentInitial.current) {
      sentInitial.current = true;
      sendMessage(initialQuery);
    }
    if (!open) {
      sentInitial.current = false;
    }
  }, [open, initialQuery, sendMessage]);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
    if (e.key === "Escape") onClose();
  }

  function clearChat() {
    setMessages([]);
    setNoKey(false);
    sentInitial.current = false;
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-[480px] z-50 flex flex-col bg-paper border-l border-chalk shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-chalk shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-carbon flex items-center justify-center text-white text-[14px]">✦</div>
            <div>
              <div className="text-[14px] font-semibold text-carbon">PANDO AI</div>
              <div className="text-[10px] text-slate">Haiku · Full radar context</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button onClick={clearChat} className="text-[11px] text-slate hover:text-carbon px-2 py-1 rounded hover:bg-fog transition-colors">
                Clear
              </button>
            )}
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-[8px] hover:bg-fog text-slate hover:text-carbon transition-colors">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <line x1="2" y1="2" x2="12" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="12" y1="2" x2="2" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Empty state */}
          {messages.length === 0 && (
            <div className="text-center pt-10">
              <div className="text-4xl mb-3">✦</div>
              <div className="text-[14px] font-semibold text-carbon mb-2">PANDO AI</div>
              <div className="text-[12px] text-slate mb-6 leading-relaxed">
                Ask me anything about the companies on the radar, metrics, comparisons, or analysis.
              </div>
              {/* Suggested prompts */}
              <div className="space-y-2 text-left">
                {[
                  "Which companies have the highest growth?",
                  "Which company has the best EBITDA margin?",
                  "Compare Auronix and Simetrik",
                  "How many Software companies do I have on the radar?",
                  "Which company has the highest score?",
                ].map(q => (
                  <button key={q} onClick={() => sendMessage(q)}
                    className="w-full text-left text-[12px] text-graphite bg-fog border border-chalk rounded-[8px] px-3 py-2 hover:border-carbon hover:bg-chalk/40 transition-colors">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Chat messages */}
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && (
                <div className="w-6 h-6 rounded-full bg-carbon flex items-center justify-center text-white text-[10px] shrink-0 mt-0.5">✦</div>
              )}
              <div className={`max-w-[85%] rounded-[12px] px-4 py-2.5 text-[13px] leading-relaxed ${
                msg.role === "user"
                  ? "bg-carbon text-white rounded-br-[4px]"
                  : "bg-fog border border-chalk text-carbon rounded-bl-[4px]"
              }`}>
                {msg.loading ? (
                  <span className="flex items-center gap-1.5 text-slate text-[12px]">
                    <span className="flex gap-1">
                      {[0, 1, 2].map(i => (
                        <span key={i} className="w-1.5 h-1.5 bg-slate rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </span>
                    Thinking...
                  </span>
                ) : (
                  <MarkdownText text={msg.content} />
                )}
              </div>
              {msg.role === "user" && (
                <div className="w-6 h-6 rounded-full bg-graphite flex items-center justify-center text-white text-[9px] font-bold shrink-0 mt-0.5">
                  YOU
                </div>
              )}
            </div>
          ))}

          {/* API key warning */}
          {noKey && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-[10px] p-4 text-center">
              <div className="text-[12px] text-yellow-800 font-medium mb-2">API key not configured</div>
              <a href="/settings" onClick={onClose}
                className="text-[11px] font-semibold text-yellow-700 underline hover:text-yellow-900">
                Go to Settings →
              </a>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="shrink-0 px-4 py-4 border-t border-chalk bg-paper">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={streaming}
              placeholder="Type your question..."
              className="flex-1 bg-fog border border-chalk rounded-[8px] px-3 py-2.5 text-[13px] text-carbon placeholder:text-slate/50 focus:outline-none focus:border-carbon transition-colors disabled:opacity-50"
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || streaming}
              className="w-9 h-9 bg-carbon text-white rounded-[8px] flex items-center justify-center hover:bg-graphite disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              {streaming ? (
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeDashoffset="10"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M13 7L1 1l3 6-3 6 12-6z" fill="currentColor"/>
                </svg>
              )}
            </button>
          </div>
          <div className="text-[10px] text-slate/50 text-center mt-2">Enter to send · Esc to close</div>
        </div>
      </div>
    </>
  );
}

// Simple markdown renderer — handles **bold**, *italic*, bullet points, line breaks
function MarkdownText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1" />;

        // Bullet points
        const bulletMatch = line.match(/^[-•*]\s+(.+)/);
        if (bulletMatch) {
          return (
            <div key={i} className="flex gap-2">
              <span className="text-slate shrink-0 mt-0.5">•</span>
              <span dangerouslySetInnerHTML={{ __html: formatInline(bulletMatch[1]) }} />
            </div>
          );
        }

        // Numbered list
        const numMatch = line.match(/^(\d+)\.\s+(.+)/);
        if (numMatch) {
          return (
            <div key={i} className="flex gap-2">
              <span className="text-slate shrink-0 font-mono text-[11px] mt-0.5">{numMatch[1]}.</span>
              <span dangerouslySetInnerHTML={{ __html: formatInline(numMatch[2]) }} />
            </div>
          );
        }

        // Heading (##)
        if (line.startsWith("## ")) {
          return <div key={i} className="font-semibold text-carbon mt-1" dangerouslySetInnerHTML={{ __html: formatInline(line.slice(3)) }} />;
        }
        if (line.startsWith("# ")) {
          return <div key={i} className="font-bold text-carbon mt-1" dangerouslySetInnerHTML={{ __html: formatInline(line.slice(2)) }} />;
        }

        return <div key={i} dangerouslySetInnerHTML={{ __html: formatInline(line) }} />;
      })}
    </div>
  );
}

function formatInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, '<code class="bg-chalk px-1 rounded text-[11px] font-mono">$1</code>');
}
