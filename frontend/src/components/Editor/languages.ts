/**
 * Shared language list for code-style blocks.
 *
 * Kept in sync with `SUPPORTED_LANGUAGES` in PageEditor.tsx (Shiki IDs). The
 * first column is the language id stored on the block; the second is the
 * display name shown in dropdowns.
 */
export const LANGUAGES: [string, string][] = [
  ['text', '纯文本'],
  ['bash', 'Bash'],
  ['c', 'C'],
  ['cpp', 'C++'],
  ['csharp', 'C#'],
  ['css', 'CSS'],
  ['dart', 'Dart'],
  ['diff', 'Diff'],
  ['docker', 'Dockerfile'],
  ['go', 'Go'],
  ['graphql', 'GraphQL'],
  ['html', 'HTML'],
  ['java', 'Java'],
  ['javascript', 'JavaScript'],
  ['json', 'JSON'],
  ['kotlin', 'Kotlin'],
  ['latex', 'LaTeX'],
  ['lua', 'Lua'],
  ['make', 'Makefile'],
  ['markdown', 'Markdown'],
  ['matlab', 'MATLAB'],
  ['objective-c', 'Objective-C'],
  ['perl', 'Perl'],
  ['php', 'PHP'],
  ['powershell', 'PowerShell'],
  ['python', 'Python'],
  ['r', 'R'],
  ['ruby', 'Ruby'],
  ['rust', 'Rust'],
  ['scala', 'Scala'],
  ['sql', 'SQL'],
  ['swift', 'Swift'],
  ['toml', 'TOML'],
  ['typescript', 'TypeScript'],
  ['xml', 'XML'],
  ['yaml', 'YAML'],
];

export function languageDisplayName(id: string): string {
  return LANGUAGES.find(([i]) => i === id)?.[1] ?? id;
}
