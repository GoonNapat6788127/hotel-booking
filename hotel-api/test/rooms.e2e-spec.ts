import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { user_role } from '@prisma/client';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// 1x1 transparent PNG, used for upload tests.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('Rooms (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let userToken: string;

  const runId = Date.now();
  const roomPrefix = `E2E Room ${runId}`;
  const emailPrefix = `e2e-rooms-${runId}`;
  const password = 'password123';
  let counter = 0;

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  // Fields below must match your CreateRoomDto.
  const roomData = (overrides: Record<string, unknown> = {}) => ({
    name: `${roomPrefix} ${counter++}`,
    capacity: 2,
    pricePerNight: 100,
    ...overrides,
  });

  // Insert a room directly so each test is independent of the POST endpoint.
  const seedRoom = (overrides: Record<string, unknown> = {}) =>
    prisma.room.create({ data: { ...roomData(), isActive: true, ...overrides } as any });

  const loginAs = async (email: string) => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.access_token as string;
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

    // Seed one ADMIN and one USER directly (register would create plain users).
    const passwordHash = await bcrypt.hash(password, 4);
    const adminEmail = `${emailPrefix}-admin@example.com`;
    const userEmail = `${emailPrefix}-user@example.com`;
    await prisma.user.create({
      data: { email: adminEmail, passwordHash, name: 'E2E Admin', role: user_role.ADMIN },
    });
    await prisma.user.create({
      data: { email: userEmail, passwordHash, name: 'E2E User', role: user_role.USER },
    });

    adminToken = await loginAs(adminEmail);
    userToken = await loginAs(userEmail);
  });

  afterAll(async () => {
    // Remove uploaded image files, then the rooms and users this run created.
    const rooms = await prisma.room.findMany({
      where: { name: { startsWith: roomPrefix } },
    });
    for (const r of rooms) {
      if (r.imageUrl?.startsWith('/uploads/rooms/')) {
        await unlink(join(process.cwd(), r.imageUrl)).catch(() => {});
      }
    }
    await prisma.room.deleteMany({ where: { name: { startsWith: roomPrefix } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } });
    await app.close();
    await prisma.$disconnect();
  });

  // --------------------------------------------------------------- POST /rooms
  describe('POST /rooms', () => {
    it('returns 401 without a token', async () => {
      await request(app.getHttpServer()).post('/rooms').send(roomData()).expect(401);
    });

    it('returns 403 for a regular user', async () => {
      await request(app.getHttpServer())
        .post('/rooms')
        .set(bearer(userToken))
        .send(roomData())
        .expect(403);
    });

    it('creates a room as ADMIN', async () => {
      const data = roomData();

      const res = await request(app.getHttpServer())
        .post('/rooms')
        .set(bearer(adminToken))
        .send(data)
        .expect(201);

      expect(res.body.message).toBe('Room created successfully');
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.name).toBe(data.name);

      const dbRoom = await prisma.room.findUnique({ where: { id: res.body.data.id } });
      expect(dbRoom).not.toBeNull();
    });

    it('returns 400 for an empty body', async () => {
      await request(app.getHttpServer())
        .post('/rooms')
        .set(bearer(adminToken))
        .send({})
        .expect(400);
    });

    it('creates a room with an uploaded image (multipart)', async () => {
      const data = roomData();

      const res = await request(app.getHttpServer())
        .post('/rooms')
        .set(bearer(adminToken))
        .field('name', data.name)
        .field('capacity', String(data.capacity))
        .field('pricePerNight', String(data.pricePerNight))
        .attach('file', PNG, { filename: 'room.png', contentType: 'image/png' })
        .expect(201);

      expect(res.body.data.imageUrl).toMatch(/^\/uploads\/rooms\/.+\.png$/);
    });

    it('rejects a non-image upload with 400', async () => {
      const data = roomData();

      await request(app.getHttpServer())
        .post('/rooms')
        .set(bearer(adminToken))
        .field('name', data.name)
        .field('capacity', String(data.capacity))
        .field('pricePerNight', String(data.pricePerNight))
        .attach('file', Buffer.from('not an image'), {
          filename: 'notes.txt',
          contentType: 'text/plain',
        })
        .expect(400);
    });
  });

  // ---------------------------------------------------------------- GET /rooms
  describe('GET /rooms', () => {
    it('returns 401 without a token', async () => {
      await request(app.getHttpServer()).get('/rooms').expect(401);
    });

    it('shows only active rooms to a regular user', async () => {
      const active = await seedRoom({ isActive: true });
      const inactive = await seedRoom({ isActive: false });

      const res = await request(app.getHttpServer())
        .get('/rooms')
        .set(bearer(userToken))
        .expect(200);

      const ids = res.body.map((r: any) => r.id);
      expect(ids).toContain(active.id);
      expect(ids).not.toContain(inactive.id);
    });

    it('shows active and inactive rooms to ADMIN', async () => {
      const active = await seedRoom({ isActive: true });
      const inactive = await seedRoom({ isActive: false });

      const res = await request(app.getHttpServer())
        .get('/rooms')
        .set(bearer(adminToken))
        .expect(200);

      const ids = res.body.map((r: any) => r.id);
      expect(ids).toContain(active.id);
      expect(ids).toContain(inactive.id);
    });
  });

  // ----------------------------------------------------------- GET /rooms/search
  describe('GET /rooms/search', () => {
    it('returns 401 without a token', async () => {
      await request(app.getHttpServer()).get('/rooms/search').expect(401);
    });

    it('filters by minimum capacity', async () => {
      const small = await seedRoom({ capacity: 3 });
      const large = await seedRoom({ capacity: 8 });

      const res = await request(app.getHttpServer())
        .get('/rooms/search?capacity=5')
        .set(bearer(userToken))
        .expect(200);

      const ids = res.body.data.map((r: any) => r.id);
      expect(ids).toContain(large.id);
      expect(ids).not.toContain(small.id);
      expect(res.body.count).toBe(res.body.data.length);
    });

    it('filters by max price and sorts by price ascending', async () => {
      const cheap = await seedRoom({ pricePerNight: 50 });
      const pricey = await seedRoom({ pricePerNight: 500 });

      const res = await request(app.getHttpServer())
        .get('/rooms/search?maxPrice=100')
        .set(bearer(userToken))
        .expect(200);

      const ids = res.body.data.map((r: any) => r.id);
      expect(ids).toContain(cheap.id);
      expect(ids).not.toContain(pricey.id);

      const prices = res.body.data.map((r: any) => Number(r.pricePerNight));
      expect(prices).toEqual([...prices].sort((a, b) => a - b));
    });

    it('does not return inactive rooms', async () => {
      const inactive = await seedRoom({ isActive: false });

      const res = await request(app.getHttpServer())
        .get('/rooms/search')
        .set(bearer(adminToken))
        .expect(200);

      expect(res.body.data.map((r: any) => r.id)).not.toContain(inactive.id);
    });

    it('returns 400 when only checkIn is provided', async () => {
      await request(app.getHttpServer())
        .get('/rooms/search?checkIn=2030-01-10')
        .set(bearer(userToken))
        .expect(400);
    });

    it('returns 400 when checkIn is not before checkOut', async () => {
      await request(app.getHttpServer())
        .get('/rooms/search?checkIn=2030-01-12&checkOut=2030-01-10')
        .set(bearer(userToken))
        .expect(400);
    });

    it('returns rooms for a valid date range', async () => {
      const room = await seedRoom();

      const res = await request(app.getHttpServer())
        .get('/rooms/search?checkIn=2030-01-10&checkOut=2030-01-12')
        .set(bearer(userToken))
        .expect(200);

      expect(res.body.data.map((r: any) => r.id)).toContain(room.id);
    });
  });

  // ------------------------------------------------------------ GET /rooms/:id
  describe('GET /rooms/:id', () => {
    it('returns 401 without a token', async () => {
      await request(app.getHttpServer()).get('/rooms/1').expect(401);
    });

    it('returns an active room to a regular user', async () => {
      const room = await seedRoom();

      const res = await request(app.getHttpServer())
        .get(`/rooms/${room.id}`)
        .set(bearer(userToken))
        .expect(200);

      expect(res.body.id).toBe(room.id);
      expect(res.body.name).toBe(room.name);
    });

    it('hides an inactive room from a regular user (404)', async () => {
      const room = await seedRoom({ isActive: false });

      await request(app.getHttpServer())
        .get(`/rooms/${room.id}`)
        .set(bearer(userToken))
        .expect(404);
    });

    it('shows an inactive room to ADMIN', async () => {
      const room = await seedRoom({ isActive: false });

      const res = await request(app.getHttpServer())
        .get(`/rooms/${room.id}`)
        .set(bearer(adminToken))
        .expect(200);

      expect(res.body.id).toBe(room.id);
    });

    it('returns 404 for an unknown id', async () => {
      await request(app.getHttpServer())
        .get('/rooms/999999999')
        .set(bearer(adminToken))
        .expect(404);
    });

    it('returns 400 for a non-numeric id', async () => {
      await request(app.getHttpServer())
        .get('/rooms/abc')
        .set(bearer(adminToken))
        .expect(400);
    });
  });

  // ---------------------------------------------------------- PATCH /rooms/:id
  describe('PATCH /rooms/:id', () => {
    it('returns 401 without a token', async () => {
      await request(app.getHttpServer()).patch('/rooms/1').send({ name: 'x' }).expect(401);
    });

    it('returns 403 for a regular user', async () => {
      const room = await seedRoom();

      await request(app.getHttpServer())
        .patch(`/rooms/${room.id}`)
        .set(bearer(userToken))
        .send({ name: 'Hacked' })
        .expect(403);
    });

    it('updates a room as ADMIN', async () => {
      const room = await seedRoom();
      const newName = `${roomPrefix} renamed ${counter++}`;

      const res = await request(app.getHttpServer())
        .patch(`/rooms/${room.id}`)
        .set(bearer(adminToken))
        .send({ name: newName })
        .expect(200);

      expect(res.body.message).toBe(`Room ${room.id} updated successfully`);
      expect(res.body.data.name).toBe(newName);

      const dbRoom = await prisma.room.findUnique({ where: { id: room.id } });
      expect(dbRoom!.name).toBe(newName);
    });

    it('returns 404 for an unknown id', async () => {
      await request(app.getHttpServer())
        .patch('/rooms/999999999')
        .set(bearer(adminToken))
        .send({ name: 'Nope' })
        .expect(404);
    });

    it('returns 400 for a non-numeric id', async () => {
      await request(app.getHttpServer())
        .patch('/rooms/abc')
        .set(bearer(adminToken))
        .send({ name: 'Nope' })
        .expect(400);
    });
  });

  // ------------------------------------------------------ PATCH /rooms/:id/image
  describe('PATCH /rooms/:id/image', () => {
    it('returns 403 for a regular user', async () => {
      const room = await seedRoom();

      await request(app.getHttpServer())
        .patch(`/rooms/${room.id}/image`)
        .set(bearer(userToken))
        .attach('file', PNG, { filename: 'room.png', contentType: 'image/png' })
        .expect(403);
    });

    it('returns 400 when no file is sent', async () => {
      const room = await seedRoom();

      await request(app.getHttpServer())
        .patch(`/rooms/${room.id}/image`)
        .set(bearer(adminToken))
        .expect(400);
    });

    it('sets the image as ADMIN', async () => {
      const room = await seedRoom();

      const res = await request(app.getHttpServer())
        .patch(`/rooms/${room.id}/image`)
        .set(bearer(adminToken))
        .attach('file', PNG, { filename: 'room.png', contentType: 'image/png' })
        .expect(200);

      expect(res.body.data.imageUrl).toMatch(/^\/uploads\/rooms\/.+\.png$/);

      const dbRoom = await prisma.room.findUnique({ where: { id: room.id } });
      expect(dbRoom!.imageUrl).toBe(res.body.data.imageUrl);
    });

    it('returns 404 for an unknown room', async () => {
      await request(app.getHttpServer())
        .patch('/rooms/999999999/image')
        .set(bearer(adminToken))
        .attach('file', PNG, { filename: 'room.png', contentType: 'image/png' })
        .expect(404);
    });
  });

  // ------------------------------------------------- PATCH disable / enable
  describe('PATCH /rooms/:id/disable and /enable', () => {
    it('returns 403 for a regular user', async () => {
      const room = await seedRoom();

      await request(app.getHttpServer())
        .patch(`/rooms/${room.id}/disable`)
        .set(bearer(userToken))
        .expect(403);
    });

    it('disables a room as ADMIN', async () => {
      const room = await seedRoom({ isActive: true });

      await request(app.getHttpServer())
        .patch(`/rooms/${room.id}/disable`)
        .set(bearer(adminToken))
        .expect(200);

      const dbRoom = await prisma.room.findUnique({ where: { id: room.id } });
      expect(dbRoom!.isActive).toBe(false);
    });

    it('enables a room as ADMIN', async () => {
      const room = await seedRoom({ isActive: false });

      await request(app.getHttpServer())
        .patch(`/rooms/${room.id}/enable`)
        .set(bearer(adminToken))
        .expect(200);

      const dbRoom = await prisma.room.findUnique({ where: { id: room.id } });
      expect(dbRoom!.isActive).toBe(true);
    });

    it('returns 404 for an unknown id', async () => {
      await request(app.getHttpServer())
        .patch('/rooms/999999999/disable')
        .set(bearer(adminToken))
        .expect(404);
      await request(app.getHttpServer())
        .patch('/rooms/999999999/enable')
        .set(bearer(adminToken))
        .expect(404);
    });
  });

  // -------------------------------------------------------- DELETE /rooms/:id
  describe('DELETE /rooms/:id', () => {
    it('returns 401 without a token', async () => {
      await request(app.getHttpServer()).delete('/rooms/1').expect(401);
    });

    it('returns 403 for a regular user', async () => {
      const room = await seedRoom();

      await request(app.getHttpServer())
        .delete(`/rooms/${room.id}`)
        .set(bearer(userToken))
        .expect(403);

      expect(await prisma.room.findUnique({ where: { id: room.id } })).not.toBeNull();
    });

    it('deletes a room as ADMIN', async () => {
      const room = await seedRoom();

      const res = await request(app.getHttpServer())
        .delete(`/rooms/${room.id}`)
        .set(bearer(adminToken))
        .expect(200);

      expect(res.body.message).toBe(`Room ${room.id} removed successfully`);
      expect(await prisma.room.findUnique({ where: { id: room.id } })).toBeNull();
    });

    it('returns 404 when deleting the same room twice', async () => {
      const room = await seedRoom();

      await request(app.getHttpServer())
        .delete(`/rooms/${room.id}`)
        .set(bearer(adminToken))
        .expect(200);
      await request(app.getHttpServer())
        .delete(`/rooms/${room.id}`)
        .set(bearer(adminToken))
        .expect(404);
    });
  });
});
