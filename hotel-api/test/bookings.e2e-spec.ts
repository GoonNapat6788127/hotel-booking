import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { booking_status, notification_type, user_role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';

describe('Bookings (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: { id: number; token: string };
  let user: { id: number; token: string };

  const runId = Date.now();
  const emailPrefix = `e2e-bookings-${runId}`;
  const roomPrefix = `E2E Booking Room ${runId}`;
  const password = 'password123';
  let counter = 0;

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  // Seed a user straight into the DB and log in through the real endpoint.
  // GET responses are cached per user id + URL for 30 s, so tests that read
  // lists use a FRESH user to avoid stale cached results.
  const createUser = async (role: user_role = user_role.USER) => {
    const email = `${emailPrefix}-${counter++}@example.com`;
    const passwordHash = await bcrypt.hash(password, 4);
    const created = await prisma.user.create({
      data: { email, passwordHash, name: 'E2E User', role },
    });
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return { id: created.id, token: res.body.access_token as string };
  };

  // Every test gets its own room, so date ranges never collide across tests.
  // Fields must match your room model.
  const seedRoom = (overrides: Record<string, unknown> = {}) =>
    prisma.room.create({
      data: {
        name: `${roomPrefix} ${counter++}`,
        capacity: 2,
        pricePerNight: 100,
        isActive: true,
        ...overrides,
      } as any,
    });

  const seedBooking = (
    userId: number,
    roomId: number,
    status: booking_status = booking_status.PENDING,
    checkIn = '2031-03-10',
    checkOut = '2031-03-12',
  ) =>
    prisma.booking.create({
      data: { userId, roomId, status, checkIn: new Date(checkIn), checkOut: new Date(checkOut) },
    });

  const bookingBody = (roomId: number, checkIn = '2031-03-10', checkOut = '2031-03-12') => ({
    roomId,
    checkIn,
    checkOut,
  });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Keep in sync with main.ts so validation behaves like production.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
    admin = await createUser(user_role.ADMIN);
    user = await createUser();
  });

  afterAll(async () => {
    // Children first: notifications -> bookings -> rooms -> users.
    const users = await prisma.user.findMany({
      where: { email: { startsWith: emailPrefix } },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.booking.deleteMany({ where: { userId: { in: ids } } });
    await prisma.room.deleteMany({ where: { name: { startsWith: roomPrefix } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await app.close();
    await prisma.$disconnect();
  });

  // ------------------------------------------------------------ POST /bookings
  describe('POST /bookings', () => {
    it('returns 401 without a token', async () => {
      const room = await seedRoom();
      await request(app.getHttpServer()).post('/bookings').send(bookingBody(room.id)).expect(401);
    });

    it('returns 400 for an empty body', async () => {
      await request(app.getHttpServer())
        .post('/bookings')
        .set(bearer(user.token))
        .send({})
        .expect(400);
    });

    it('returns 400 when check-out is before check-in', async () => {
      const room = await seedRoom();

      await request(app.getHttpServer())
        .post('/bookings')
        .set(bearer(user.token))
        .send(bookingBody(room.id, '2031-03-12', '2031-03-10'))
        .expect(400);
    });

    it('returns 400 for an invalid date', async () => {
      const room = await seedRoom();

      await request(app.getHttpServer())
        .post('/bookings')
        .set(bearer(user.token))
        .send(bookingBody(room.id, 'not-a-date', '2031-03-12'))
        .expect(400);
    });

    it('returns 404 for an unknown room', async () => {
      await request(app.getHttpServer())
        .post('/bookings')
        .set(bearer(user.token))
        .send(bookingBody(999999999))
        .expect(404);
    });

    it('returns 404 for an inactive room', async () => {
      const room = await seedRoom({ isActive: false });

      await request(app.getHttpServer())
        .post('/bookings')
        .set(bearer(user.token))
        .send(bookingBody(room.id))
        .expect(404);
    });

    it('creates a PENDING booking for the logged-in user', async () => {
      const room = await seedRoom();

      const res = await request(app.getHttpServer())
        .post('/bookings')
        .set(bearer(user.token))
        .send(bookingBody(room.id))
        .expect(201);

      expect(res.body.message).toBe('Booking created successfully');
      expect(res.body.data).toMatchObject({
        userId: user.id,
        roomId: room.id,
        status: 'PENDING',
      });
      expect(res.body.data.room.id).toBe(room.id);

      const dbBooking = await prisma.booking.findUnique({ where: { id: res.body.data.id } });
      expect(dbBooking).not.toBeNull();
    });

    it('creates a BOOKING_CREATED notification for the user', async () => {
      const room = await seedRoom();

      const res = await request(app.getHttpServer())
        .post('/bookings')
        .set(bearer(user.token))
        .send(bookingBody(room.id))
        .expect(201);

      const notification = await prisma.notification.findFirst({
        where: { bookingId: res.body.data.id, type: notification_type.BOOKING_CREATED },
      });
      expect(notification).not.toBeNull();
      expect(notification!.userId).toBe(user.id);
    });

    it('returns 409 when the dates overlap an existing booking', async () => {
      const room = await seedRoom();
      const other = await createUser();
      await seedBooking(other.id, room.id, booking_status.PENDING, '2031-03-10', '2031-03-12');

      await request(app.getHttpServer())
        .post('/bookings')
        .set(bearer(user.token))
        .send(bookingBody(room.id, '2031-03-11', '2031-03-13'))
        .expect(409);
    });

    it('allows a back-to-back stay (check-in on the previous check-out day)', async () => {
      const room = await seedRoom();
      const other = await createUser();
      await seedBooking(other.id, room.id, booking_status.PENDING, '2031-03-10', '2031-03-12');

      await request(app.getHttpServer())
        .post('/bookings')
        .set(bearer(user.token))
        .send(bookingBody(room.id, '2031-03-12', '2031-03-14'))
        .expect(201);
    });

    it('lets only one of two simultaneous requests for the same dates succeed', async () => {
      const room = await seedRoom();
      const other = await createUser();

      const results = await Promise.all([
        request(app.getHttpServer())
          .post('/bookings')
          .set(bearer(user.token))
          .send(bookingBody(room.id)),
        request(app.getHttpServer())
          .post('/bookings')
          .set(bearer(other.token))
          .send(bookingBody(room.id)),
      ]);

      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409]);
      expect(await prisma.booking.count({ where: { roomId: room.id } })).toBe(1);
    });
  });

  // -------------------------------------------------------- GET /bookings/me
  describe('GET /bookings/me', () => {
    it('returns 401 without a token', async () => {
      await request(app.getHttpServer()).get('/bookings/me').expect(401);
    });

    it('returns only the logged-in user\'s bookings, newest first', async () => {
      const me = await createUser();
      const someoneElse = await createUser();
      const room1 = await seedRoom();
      const room2 = await seedRoom();
      const first = await seedBooking(me.id, room1.id);
      const second = await seedBooking(me.id, room2.id);
      const foreign = await seedBooking(someoneElse.id, room1.id, booking_status.PENDING, '2031-04-01', '2031-04-03');

      const res = await request(app.getHttpServer())
        .get('/bookings/me')
        .set(bearer(me.token))
        .expect(200);

      const ids = res.body.map((b: any) => b.id);
      expect(ids).toEqual([second.id, first.id]);
      expect(ids).not.toContain(foreign.id);
      expect(res.body[0].room).toBeDefined();
    });

    it('shows a new booking right after it is created (cache invalidated)', async () => {
      const me = await createUser();
      const room = await seedRoom();

      // Warm the cache with the empty list.
      const before = await request(app.getHttpServer())
        .get('/bookings/me')
        .set(bearer(me.token))
        .expect(200);
      expect(before.body).toEqual([]);

      const created = await request(app.getHttpServer())
        .post('/bookings')
        .set(bearer(me.token))
        .send(bookingBody(room.id))
        .expect(201);

      const after = await request(app.getHttpServer())
        .get('/bookings/me')
        .set(bearer(me.token))
        .expect(200);
      expect(after.body.map((b: any) => b.id)).toContain(created.body.data.id);
    });
  });

  // ---------------------------------------------------- GET /bookings/me/:id
  describe('GET /bookings/me/:id', () => {
    it('returns 401 without a token', async () => {
      await request(app.getHttpServer()).get('/bookings/me/1').expect(401);
    });

    it('returns the booking with its room for the owner', async () => {
      const room = await seedRoom();
      const booking = await seedBooking(user.id, room.id);

      const res = await request(app.getHttpServer())
        .get(`/bookings/me/${booking.id}`)
        .set(bearer(user.token))
        .expect(200);

      expect(res.body.id).toBe(booking.id);
      expect(res.body.room.id).toBe(room.id);
    });

    it("returns 404 for another user's booking", async () => {
      const room = await seedRoom();
      const other = await createUser();
      const booking = await seedBooking(other.id, room.id);

      await request(app.getHttpServer())
        .get(`/bookings/me/${booking.id}`)
        .set(bearer(user.token))
        .expect(404);
    });

    it('returns 404 for an unknown id', async () => {
      await request(app.getHttpServer())
        .get('/bookings/me/999999999')
        .set(bearer(user.token))
        .expect(404);
    });

    it('returns 400 for a non-numeric id', async () => {
      await request(app.getHttpServer())
        .get('/bookings/me/abc')
        .set(bearer(user.token))
        .expect(400);
    });
  });

  // --------------------------------------------- PATCH /bookings/me/:id/cancel
  describe('PATCH /bookings/me/:id/cancel', () => {
    it('returns 401 without a token', async () => {
      await request(app.getHttpServer()).patch('/bookings/me/1/cancel').expect(401);
    });

    it('cancels a PENDING booking and creates a BOOKING_CANCELLED notification', async () => {
      const room = await seedRoom();
      const booking = await seedBooking(user.id, room.id, booking_status.PENDING);

      const res = await request(app.getHttpServer())
        .patch(`/bookings/me/${booking.id}/cancel`)
        .set(bearer(user.token))
        .expect(200);

      expect(res.body.message).toBe('Booking cancelled successfully');
      expect(res.body.data.status).toBe('CANCELLED');

      const dbBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(dbBooking!.status).toBe(booking_status.CANCELLED);

      const notification = await prisma.notification.findFirst({
        where: { bookingId: booking.id, type: notification_type.BOOKING_CANCELLED },
      });
      expect(notification).not.toBeNull();
      expect(notification!.userId).toBe(user.id);
    });

    it('cancels an APPROVED booking', async () => {
      const room = await seedRoom();
      const booking = await seedBooking(user.id, room.id, booking_status.APPROVED);

      await request(app.getHttpServer())
        .patch(`/bookings/me/${booking.id}/cancel`)
        .set(bearer(user.token))
        .expect(200);
    });

    it('returns 400 when the booking is already PAID', async () => {
      const room = await seedRoom();
      const booking = await seedBooking(user.id, room.id, booking_status.PAID);

      await request(app.getHttpServer())
        .patch(`/bookings/me/${booking.id}/cancel`)
        .set(bearer(user.token))
        .expect(400);

      const dbBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(dbBooking!.status).toBe(booking_status.PAID);
    });

    it('returns 400 when the booking is already CANCELLED', async () => {
      const room = await seedRoom();
      const booking = await seedBooking(user.id, room.id, booking_status.CANCELLED);

      await request(app.getHttpServer())
        .patch(`/bookings/me/${booking.id}/cancel`)
        .set(bearer(user.token))
        .expect(400);
    });

    it("returns 404 and leaves another user's booking untouched", async () => {
      const room = await seedRoom();
      const other = await createUser();
      const booking = await seedBooking(other.id, room.id);

      await request(app.getHttpServer())
        .patch(`/bookings/me/${booking.id}/cancel`)
        .set(bearer(user.token))
        .expect(404);

      const dbBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(dbBooking!.status).toBe(booking_status.PENDING);
    });

    it('returns 404 for an unknown id', async () => {
      await request(app.getHttpServer())
        .patch('/bookings/me/999999999/cancel')
        .set(bearer(user.token))
        .expect(404);
    });
  });

  // ------------------------------------------------------------ GET /bookings
  describe('GET /bookings (admin)', () => {
    it('returns 401 without a token', async () => {
      await request(app.getHttpServer()).get('/bookings').expect(401);
    });

    it('returns 403 for a regular user', async () => {
      await request(app.getHttpServer()).get('/bookings').set(bearer(user.token)).expect(403);
    });

    it('lets ADMIN see all bookings with a safe user object', async () => {
      const freshAdmin = await createUser(user_role.ADMIN);
      const room = await seedRoom();
      const booking = await seedBooking(user.id, room.id);

      const res = await request(app.getHttpServer())
        .get('/bookings')
        .set(bearer(freshAdmin.token))
        .expect(200);

      const found = res.body.find((b: any) => b.id === booking.id);
      expect(found).toBeDefined();
      expect(found.room.id).toBe(room.id);
      expect(Object.keys(found.user).sort()).toEqual(['email', 'id', 'name']);
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    });

    it('filters by status', async () => {
      const freshAdmin = await createUser(user_role.ADMIN);
      const room1 = await seedRoom();
      const room2 = await seedRoom();
      const approved = await seedBooking(user.id, room1.id, booking_status.APPROVED);
      const pending = await seedBooking(user.id, room2.id, booking_status.PENDING);

      const res = await request(app.getHttpServer())
        .get('/bookings?status=APPROVED')
        .set(bearer(freshAdmin.token))
        .expect(200);

      const ids = res.body.map((b: any) => b.id);
      expect(ids).toContain(approved.id);
      expect(ids).not.toContain(pending.id);
      expect(res.body.every((b: any) => b.status === 'APPROVED')).toBe(true);
    });

    it('returns 400 for an unknown status filter', async () => {
      const freshAdmin = await createUser(user_role.ADMIN);

      await request(app.getHttpServer())
        .get('/bookings?status=NOT_A_STATUS')
        .set(bearer(freshAdmin.token))
        .expect(400);
    });
  });

  // -------------------------------------------------------- GET /bookings/:id
  describe('GET /bookings/:id (admin)', () => {
    it('returns 403 for a regular user', async () => {
      const room = await seedRoom();
      const booking = await seedBooking(user.id, room.id);

      await request(app.getHttpServer())
        .get(`/bookings/${booking.id}`)
        .set(bearer(user.token))
        .expect(403);
    });

    it('returns any booking with room and user to ADMIN', async () => {
      const room = await seedRoom();
      const booking = await seedBooking(user.id, room.id);

      const res = await request(app.getHttpServer())
        .get(`/bookings/${booking.id}`)
        .set(bearer(admin.token))
        .expect(200);

      expect(res.body.id).toBe(booking.id);
      expect(res.body.room.id).toBe(room.id);
      expect(res.body.user.id).toBe(user.id);
      expect(res.body.user).not.toHaveProperty('passwordHash');
    });

    it('returns 404 for an unknown id', async () => {
      await request(app.getHttpServer())
        .get('/bookings/999999999')
        .set(bearer(admin.token))
        .expect(404);
    });

    it('returns 400 for a non-numeric id', async () => {
      await request(app.getHttpServer())
        .get('/bookings/abc')
        .set(bearer(admin.token))
        .expect(400);
    });
  });

  // ------------------------------------------------- PATCH /bookings/:id/status
  describe('PATCH /bookings/:id/status (admin)', () => {
    const setStatus = (token: string, id: number, status: string) =>
      request(app.getHttpServer())
        .patch(`/bookings/${id}/status`)
        .set(bearer(token))
        .send({ status });

    it('returns 401 without a token', async () => {
      await request(app.getHttpServer())
        .patch('/bookings/1/status')
        .send({ status: 'APPROVED' })
        .expect(401);
    });

    it('returns 403 for a regular user', async () => {
      const room = await seedRoom();
      const booking = await seedBooking(user.id, room.id);

      await setStatus(user.token, booking.id, 'APPROVED').expect(403);

      const dbBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(dbBooking!.status).toBe(booking_status.PENDING);
    });

    it('approves a PENDING booking', async () => {
      const room = await seedRoom();
      const booking = await seedBooking(user.id, room.id, booking_status.PENDING);

      const res = await setStatus(admin.token, booking.id, 'APPROVED').expect(200);

      expect(res.body.message).toBe('Booking status updated successfully');
      expect(res.body.data.status).toBe('APPROVED');
      const dbBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(dbBooking!.status).toBe(booking_status.APPROVED);
    });

    it('marks an APPROVED booking as PAID', async () => {
      const room = await seedRoom();
      const booking = await seedBooking(user.id, room.id, booking_status.APPROVED);

      await setStatus(admin.token, booking.id, 'PAID').expect(200);

      const dbBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(dbBooking!.status).toBe(booking_status.PAID);
    });

    it('notifies the booking owner when ADMIN cancels', async () => {
      const room = await seedRoom();
      const booking = await seedBooking(user.id, room.id, booking_status.APPROVED);

      await setStatus(admin.token, booking.id, 'CANCELLED').expect(200);

      const notification = await prisma.notification.findFirst({
        where: { bookingId: booking.id, type: notification_type.BOOKING_CANCELLED },
      });
      expect(notification).not.toBeNull();
      expect(notification!.userId).toBe(user.id);
    });

    it('rejects PENDING -> PAID and keeps the status', async () => {
      const room = await seedRoom();
      const booking = await seedBooking(user.id, room.id, booking_status.PENDING);

      await setStatus(admin.token, booking.id, 'PAID').expect(400);

      const dbBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(dbBooking!.status).toBe(booking_status.PENDING);
    });

    it.each([
      [booking_status.PAID, 'CANCELLED'],
      [booking_status.CANCELLED, 'APPROVED'],
    ])('rejects a change from final status %s to %s', async (from, to) => {
      const room = await seedRoom();
      const booking = await seedBooking(user.id, room.id, from);

      await setStatus(admin.token, booking.id, to).expect(400);

      const dbBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(dbBooking!.status).toBe(from);
    });

    it('returns 400 for an invalid status value', async () => {
      const room = await seedRoom();
      const booking = await seedBooking(user.id, room.id);

      await setStatus(admin.token, booking.id, 'NOT_A_STATUS').expect(400);
    });

    it('returns 400 when the status is missing', async () => {
      const room = await seedRoom();
      const booking = await seedBooking(user.id, room.id);

      await request(app.getHttpServer())
        .patch(`/bookings/${booking.id}/status`)
        .set(bearer(admin.token))
        .send({})
        .expect(400);
    });

    it('returns 404 for an unknown id', async () => {
      await setStatus(admin.token, 999999999, 'APPROVED').expect(404);
    });
  });
});