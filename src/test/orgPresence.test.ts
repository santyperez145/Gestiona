import { describe, expect, it } from 'vitest';
import { dedupeOnlineUsers, type OnlineUser } from '@/hooks/useOrgPresence';

const presence = (overrides: Partial<OnlineUser> = {}): OnlineUser => ({
  user_id: 'user-1',
  name: 'Ana',
  email: 'ana@gestiona.test',
  online_at: '2026-08-21T20:00:00.000Z',
  ...overrides,
});

describe('dedupeOnlineUsers', () => {
  it('representa una persona una sola vez aunque tenga varias metas de realtime', () => {
    expect(dedupeOnlineUsers([
      presence(),
      presence({ online_at: '2026-08-21T20:01:00.000Z' }),
    ])).toHaveLength(1);
  });

  it('conserva la presencia más reciente del mismo usuario', () => {
    const users = dedupeOnlineUsers([
      presence({ name: 'Nombre anterior' }),
      presence({ name: 'Ana actualizada', online_at: '2026-08-21T20:05:00.000Z' }),
    ]);
    expect(users[0].name).toBe('Ana actualizada');
    expect(users[0].online_at).toBe('2026-08-21T20:05:00.000Z');
  });

  it('mantiene usuarios diferentes y su orden de primera aparición', () => {
    const users = dedupeOnlineUsers([
      presence({ user_id: 'user-1' }),
      presence({ user_id: 'user-2', name: 'Bruno', email: 'bruno@gestiona.test' }),
      presence({ user_id: 'user-1', online_at: '2026-08-21T20:06:00.000Z' }),
    ]);
    expect(users.map(user => user.user_id)).toEqual(['user-1', 'user-2']);
  });

  it('descarta metas incompletas que no pueden renderizar una persona', () => {
    expect(dedupeOnlineUsers([
      null,
      { user_id: '' },
      { user_id: 'user-2', name: 'Sin fecha' },
      presence(),
    ])).toEqual([presence()]);
  });
});
