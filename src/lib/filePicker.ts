export interface FileDescriptor {
  name: string;
  type: string;
}

export function fileMatchesAccept(file: FileDescriptor, accept: string): boolean {
  const rules = accept
    .split(',')
    .map(rule => rule.trim().toLowerCase())
    .filter(Boolean);

  if (rules.length === 0) return true;

  const name = file.name.toLowerCase();
  const mime = file.type.toLowerCase();
  return rules.some(rule => {
    if (rule.startsWith('.')) return name.endsWith(rule);
    if (rule.endsWith('/*')) return mime.startsWith(rule.slice(0, -1));
    return mime === rule;
  });
}
