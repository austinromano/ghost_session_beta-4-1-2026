import { Hono } from 'hono';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/index.js';
import { users, authSessions, projects, projectMembers, tracks, versions, comments, invitations, files, chatMessages, notifications, trackLikes, samplePacks, samplePackItems } from '../db/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { hashPassword, verifyPassword, createSession, invalidateSession } from '../services/auth.js';
import { authMiddleware } from '../middleware/auth.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const auth = new Hono();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(50),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

auth.post('/register', async (c) => {
  const body = registerSchema.parse(await c.req.json());

  const existing = db.select().from(users).where(eq(users.email, body.email)).limit(1).all();
  if (existing.length > 0) {
    throw new HTTPException(409, { message: 'Email already registered' });
  }

  const id = crypto.randomUUID();
  db.insert(users).values({
    id,
    email: body.email,
    displayName: body.displayName,
    hashedPassword: hashPassword(body.password),
    createdAt: new Date().toISOString(),
  }).run();

  const token = createSession(id);

  return c.json({
    success: true,
    data: {
      token,
      user: { id, email: body.email, displayName: body.displayName, avatarUrl: null, createdAt: new Date().toISOString() },
    },
  });
});

auth.post('/login', async (c) => {
  const body = loginSchema.parse(await c.req.json());

  const results = db.select().from(users).where(eq(users.email, body.email)).limit(1).all();
  const user = results[0];
  if (!user || !verifyPassword(body.password, user.hashedPassword)) {
    throw new HTTPException(401, { message: 'Invalid email or password' });
  }

  const token = createSession(user.id);

  return c.json({
    success: true,
    data: {
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt,
      },
    },
  });
});

auth.post('/logout', authMiddleware, async (c) => {
  const token = c.get('token') as string;
  invalidateSession(token);
  return c.json({ success: true });
});

auth.get('/me', authMiddleware, async (c) => {
  const user = c.get('user');
  return c.json({ success: true, data: user });
});

const AVATARS_DIR = resolve(import.meta.dirname, '../../uploads/avatars');

auth.post('/avatar', authMiddleware, async (c) => {
  const user = c.get('user') as { id: string };
  const body = await c.req.parseBody();
  const file = body['file'];

  if (!(file instanceof File)) {
    throw new HTTPException(400, { message: 'No file provided' });
  }

  const ext = file.name.split('.').pop() || 'jpg';
  const fileName = `${user.id}.${ext}`;

  await mkdir(AVATARS_DIR, { recursive: true });
  const filePath = resolve(AVATARS_DIR, fileName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buffer);

  const avatarUrl = `/api/v1/auth/avatars/${fileName}`;
  db.update(users).set({ avatarUrl }).where(eq(users.id, user.id)).run();

  return c.json({ success: true, data: { avatarUrl } });
});

auth.get('/avatars/:fileName', async (c) => {
  const fileName = c.req.param('fileName');
  const filePath = resolve(AVATARS_DIR, fileName);
  try {
    const { readFile } = await import('node:fs/promises');
    const data = await readFile(filePath);
    const ext = fileName.split('.').pop() || 'jpg';
    const mimeMap: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
    return new Response(data, { headers: { 'Content-Type': mimeMap[ext] || 'image/jpeg', 'Cache-Control': 'public, max-age=86400' } });
  } catch {
    throw new HTTPException(404, { message: 'Avatar not found' });
  }
});

auth.delete('/account', authMiddleware, async (c) => {
  const user = c.get('user') as { id: string };

  // Get all projects owned by this user
  const ownedProjects = db.select({ id: projects.id }).from(projects).where(eq(projects.ownerId, user.id)).all();
  const ownedIds = ownedProjects.map((p) => p.id);

  if (ownedIds.length > 0) {
    // Delete all data within owned projects
    for (const pid of ownedIds) {
      db.delete(chatMessages).where(eq(chatMessages.projectId, pid)).run();
      db.delete(comments).where(eq(comments.projectId, pid)).run();
      db.delete(versions).where(eq(versions.projectId, pid)).run();
      db.delete(tracks).where(eq(tracks.projectId, pid)).run();
      db.delete(files).where(eq(files.projectId, pid)).run();
      db.delete(invitations).where(eq(invitations.projectId, pid)).run();
      db.delete(projectMembers).where(eq(projectMembers.projectId, pid)).run();
      db.delete(projects).where(eq(projects.id, pid)).run();
    }
  }

  // Delete user's memberships in other projects
  db.delete(projectMembers).where(eq(projectMembers.userId, user.id)).run();
  db.delete(notifications).where(eq(notifications.userId, user.id)).run();
  db.delete(samplePacks).where(eq(samplePacks.ownerId, user.id)).run();
  db.delete(authSessions).where(eq(authSessions.userId, user.id)).run();
  db.delete(users).where(eq(users.id, user.id)).run();

  return c.json({ success: true });
});

export default auth;
