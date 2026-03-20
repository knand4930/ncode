export const MAX_PROMPT_TEMPLATE_CHARS = 8000;

export function validatePromptTemplateContent(content: string): string | null {
  if (content.length > MAX_PROMPT_TEMPLATE_CHARS) {
    return `Template content exceeds ${MAX_PROMPT_TEMPLATE_CHARS} characters.`;
  }
  return null;
}

