import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';

// Read the jti claim from a JWT without verifying it (used only for cleanup).
function decodeJti(token: string): string {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString()).jti;
}

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const runId = Date.now();
  const emailPrefix = `e2e-auth-${runId}`;
  const password = 'password123';
  const createdJtis: string[] = [];
  let counter = 0;

  const uniqueEmail = () => `${emailPrefix}-${counter++}@example.com`;

  const register = (email: string, pw = password) =>
    request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: pw, name: 'E2E User' });

  const login = async (email: string, pw = password) => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: pw });
    if (res.body?.access_token) {
      createdJtis.push(decodeJti(res.body.access_token));
    }
    return res;
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
    await prisma.revokedtoken.deleteMany({ where: { jti: { in: createdJtis } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } });
    await app.close();
  });

  // ---------------------------------------------------------------- register
  describe('POST /auth/register', () => {
    it('creates a user and does not leak the password', async () => {
      const email = uniqueEmail();

      const res = await register(email).expect(201);

      expect(res.body.message).toBe('User registered successfully');
      expect(res.body.user).toMatchObject({ email, name: 'E2E User', role: 'USER' });
      expect(res.body.user).toHaveProperty('id');
      expect(JSON.stringify(res.body)).not.toContain(password);
      expect(res.body.user).not.toHaveProperty('passwordHash');
    });

    it('stores a hashed password, not the plain text', async () => {
      const email = uniqueEmail();
      await register(email).expect(201);

      const dbUser = await prisma.user.findUnique({ where: { email } });

      expect(dbUser).not.toBeNull();
      expect(dbUser!.passwordHash).not.toBe(password);
    });

    it('returns 409 when the email is already registered', async () => {
      const email = uniqueEmail();
      await register(email).expect(201);

      await register(email).expect(409);
    });

    it('returns 400 for an invalid email', async () => {
      await register('not-an-email').expect(400);
    });

    it('returns 400 when the password is missing', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: uniqueEmail(), name: 'No Password' })
        .expect(400);
    });
  });

  // ------------------------------------------------------------------- login
  describe('POST /auth/login', () => {
    let email: string;

    beforeAll(async () => {
      email = uniqueEmail();
      await register(email).expect(201);
    });

    it('returns 200 and a JWT for valid credentials', async () => {
      const res = await login(email);

      expect(res.status).toBe(200);
      expect(typeof res.body.access_token).toBe('string');
      expect(res.body.access_token.split('.')).toHaveLength(3);
    });

    it('issues a different token on every login', async () => {
      const first = await login(email);
      const second = await login(email);

      expect(first.body.access_token).not.toBe(second.body.access_token);
    });

    it('returns 401 for a wrong password', async () => {
      const res = await login(email, 'wrong-password');

      expect(res.status).toBe(401);
      expect(res.body).not.toHaveProperty('access_token');
    });

    it('returns 401 for an unknown email', async () => {
      const res = await login('nobody-here@example.com');

      expect(res.status).toBe(401);
    });

    it('returns 400 when the body is empty', async () => {
      await request(app.getHttpServer()).post('/auth/login').send({}).expect(400);
    });
  });

  // ------------------------------------------------------------------ logout
  describe('POST /auth/logout', () => {
    let email: string;

    beforeAll(async () => {
      email = uniqueEmail();
      await register(email).expect(201);
    });

    it('returns 401 without a token', async () => {
      await request(app.getHttpServer()).post('/auth/logout').expect(401);
    });

    it('returns 401 with a malformed token', async () => {
      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', 'Bearer not.a.real-token')
        .expect(401);
    });

    it('logs out with a valid token and records it as revoked', async () => {
      const { body } = await login(email);
      const token = body.access_token;

      const res = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual({ message: 'Logged out successfully' });

      const revoked = await prisma.revokedtoken.findUnique({
        where: { jti: decodeJti(token) },
      });
      expect(revoked).not.toBeNull();
    });

    it('rejects a token that was already logged out', async () => {
      const { body } = await login(email);
      const token = body.access_token;

      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('does not revoke other sessions of the same user', async () => {
      const sessionA = (await login(email)).body.access_token;
      const sessionB = (await login(email)).body.access_token;

      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${sessionA}`)
        .expect(200);

      // Session B must still work.
      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${sessionB}`)
        .expect(200);
    });
  });
});