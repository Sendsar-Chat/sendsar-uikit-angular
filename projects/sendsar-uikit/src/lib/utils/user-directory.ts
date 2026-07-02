/** Maps chat user ids to display metadata for labels, avatars, and presence. */
export type UserDirectoryEntry = {
  id: string;
  displayName: string;
  avatarUrl?: string;
};

export function userDirectoryMap(
  users: readonly UserDirectoryEntry[],
): ReadonlyMap<string, UserDirectoryEntry> {
  return new Map(users.map((u) => [u.id, u]));
}

export function displayNameFor(
  userId: string,
  users: ReadonlyMap<string, UserDirectoryEntry>,
): string {
  return users.get(userId)?.displayName ?? userId;
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
