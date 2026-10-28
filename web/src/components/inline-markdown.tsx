import Markdown from "react-markdown";

const allowed = ["p", "code", "strong", "em", "del", "a"];

/** Renders model-written text with inline markdown only (code spans, emphasis). */
export function InlineMarkdown({ children }: { children: string }) {
  return (
    <Markdown
      allowedElements={allowed}
      unwrapDisallowed
      components={{
        p: ({ children }) => <>{children}</>,
        code: ({ children }) => (
          <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em]">
            {children}
          </code>
        ),
        a: ({ children }) => <span className="underline">{children}</span>,
      }}
    >
      {children}
    </Markdown>
  );
}
