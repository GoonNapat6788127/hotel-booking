import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { user_role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';

describe('Users (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const runId = Date.now();
  const emailPrefix = `e2e-users-${runId}`;
  const password = 'password123';
  let counter = 0;

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  // Seed a user straight into the DB and log in through the real endpoint.
  const createUser = async (name = 'E2E User') => {
    const email = `${emailPrefix}-${counter++}@example.com`;
    const passwordHash = await bcrypt.hash(password, 4);
    const user = await prisma.user.create({
      data: { email, passwordHash, name, role: user_role.USER },
    });
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return { id: user.id, email, name, token: res.body.access_token as string };
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Keep in sync with main.ts so validation behaves like production.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } });
    await app.close();
    await prisma.$disconnect();
  });

  // ------------------------------------------------------------ GET /users/me
  describe('GET /users/me', () => {
    it('returns 401 without a token', async () => {
      await request(app.getHttpServer()).get('/users/me').expect(401);
    });

    it('returns 401 with a malformed token', async () => {
      await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', 'Bearer not.a.real-token')
        .expect(401);
    });

    it('returns the profile of the logged-in user', async () => {
      const me = await createUser('Alice');

      const res = await request(app.getHttpServer())
        .get('/users/me')
        .set(bearer(me.token))
        .expect(200);

      expect(res.body).toMatchObject({
        id: me.id,
        email: me.email,
        name: 'Alice',
        role: 'USER',
      });
    });

    it('never exposes the password or its hash', async () => {
      const me = await createUser();

      const res = await request(app.getHttpServer())
        .get('/users/me')
        .set(bearer(me.token))
        .expect(200);

      expect(res.body).not.toHaveProperty('passwordHash');
      expect(res.body).not.toHaveProperty('password');
      expect(JSON.stringify(res.body)).not.toContain(password);
    });

    it("returns each user their own profile (cache is per user)", async () => {
      const a = await createUser('User A');
      const b = await createUser('User B');

      const resA = await request(app.getHttpServer()).get('/users/me').set(bearer(a.token)).expect(200);
      const resB = await request(app.getHttpServer()).get('/users/me').set(bearer(b.token)).expect(200);

      expect(resA.body.id).toBe(a.id);
      expect(resB.body.id).toBe(b.id);
      expect(resA.body.id).not.toBe(resB.body.id);
    });
  });

  // ---------------------------------------------------------- PATCH /users/me
  describe('PATCH /users/me', () => {
    it('returns 401 without a token', async () => {
      await request(app.getHttpServer()).patch('/users/me').send({ name: 'x' }).expect(401);
    });

    it('updates the name', async () => {
      const me = await createUser('Old Name');

      const res = await request(app.getHttpServer())
        .patch('/users/me')
        .set(bearer(me.token))
        .send({ name: 'New Name' })
        .expect(200);

      expect(res.body.message).toBe('Profile updated successfully');
      expect(res.body.data.name).toBe('New Name');
      expect(res.body.data).not.toHaveProperty('passwordHash');

      const dbUser = await prisma.user.findUnique({ where: { id: me.id } });
      expect(dbUser!.name).toBe('New Name');
    });

    it('GET /users/me shows the new name right after an update (cache invalidated)', async () => {
      const me = await createUser('Before');

      // Warm the cache, then change the profile.
      const before = await request(app.getHttpServer()).get('/users/me').set(bearer(me.token)).expect(200);
      expect(before.body.name).toBe('Before');

      await request(app.getHttpServer())
        .patch('/users/me')
        .set(bearer(me.token))
        .send({ name: 'After' })
        .expect(200);

      const after = await request(app.getHttpServer()).get('/users/me').set(bearer(me.token)).expect(200);
      expect(after.body.name).toBe('After');
    });

    it('changes the password: new one logs in, old one stops working', async () => {
      const me = await createUser();
      const newPassword = 'newPassword456';

      await request(app.getHttpServer())
        .patch('/users/me')
        .set(bearer(me.token))
        .send({ password: newPassword })
        .expect(200);

      const dbUser = await prisma.user.findUnique({ where: { id: me.id } });
      expect(dbUser!.passwordHash).not.toBe(newPassword);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: me.email, password: newPassword })
        .expect(200);
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: me.email, password })
        .expect(401);
    });

    it('does nothing harmful with an empty body', async () => {
      const me = await createUser('Same Name');

      await request(app.getHttpServer())
        .patch('/users/me')
        .set(bearer(me.token))
        .send({})
        .expect(200);

      const dbUser = await prisma.user.findUnique({ where: { id: me.id } });
      expect(dbUser!.name).toBe('Same Name');
    });

    it('cannot be used to change role or email (no privilege escalation)', async () => {
      const me = await createUser('Regular');

      await request(app.getHttpServer())
        .patch('/users/me')
        .set(bearer(me.token))
        .send({ name: 'Regular', role: 'ADMIN', email: 'hijack@example.com' });

      const dbUser = await prisma.user.findUnique({ where: { id: me.id } });
      expect(dbUser!.role).toBe(user_role.USER);
      expect(dbUser!.email).toBe(me.email);
    });

    it("only changes the caller's own profile", async () => {
      const a = await createUser('User A');
      const b = await createUser('User B');

      await request(app.getHttpServer())
        .patch('/users/me')
        .set(bearer(a.token))
        .send({ name: 'A Renamed' })
        .expect(200);

      const dbB = await prisma.user.findUnique({ where: { id: b.id } });
      expect(dbB!.name).toBe('User B');
    });

    it('returns 400 for an invalid name', async () => {
      const me = await createUser();

      await request(app.getHttpServer())
        .patch('/users/me')
        .set(bearer(me.token))
        .send({ name: 12345 })
        .expect(400);
    });
  });
});