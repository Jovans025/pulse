// Warm "city light" hues (coral → amber → gold), stable per user.
export function dotColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return `hsl(${12 + (Math.abs(hash) % 40)}, 95%, 66%)`;
}
