import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: true });

interface Props {
  text: string;
  streaming?: boolean;
}

export default function Markdown({ text, streaming }: Props) {
  const html = useMemo(() => {
    try {
      const raw = marked.parse(text, { async: false }) as string;
      return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
    } catch {
      return DOMPurify.sanitize(text);
    }
  }, [text]);

  return (
    <div className="markdown">
      <div dangerouslySetInnerHTML={{ __html: html }} />
      {streaming ? <span className="caret" /> : null}
    </div>
  );
}
