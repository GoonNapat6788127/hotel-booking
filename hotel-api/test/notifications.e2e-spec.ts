import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { notification_type, user_role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';

describe('Notifications (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const runId = Date.now();
  const emailPrefix = `e2e-notifications-${runId}`;
  const roomPrefix = `E2E Notification Room ${runId}`;
  const password = 'password123';
  let counter = 0;

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  // Seed a user straight into the DB and log in through the real endpoint.
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

  // Notifications reference a booking, so each test that seeds one needs a room + booking.
  // Fields must match your room model.
  const seedBooking = async (userId: number) => {
    const room = await prisma.room.create({
      data: {
        name: `${roomPrefix} ${counter++}`,
        capacity: 2,
        pricePerNight: 100,
        isActive: true,
      } as any,
    });
    const booking = await prisma.booking.create({
      data: {
        userId,
        roomId: room.id,
        checkIn: new Date('2031-05-10'),
        checkOut: new Date('2031-05-12'),
      },
    });
    return { room, booking };
  };

  const seedNotification = (
    userId: number,
    bookingId: number,
    message: string,
    createdAt?: Date,
    type: notification_type = notification_type.BOOKING_CREATED,
  ) =>
    prisma.notification.create({
      data: { userId, bookingId, type, message, ...(createdAt && { createdAt }) },
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

  describe('GET /notifications', () => {
    it('returns 401 without a token', async () => {
      await request(app.getHttpServer()).get('/notifications').expect(401);
    });

    it('returns 401 with a malformed token', async () => {
      await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', 'Bearer not.a.real-token')
        .expect(401);
    });

    it('returns an empty list for a user with no notifications', async () => {
      const me = await createUser();

      const res = await request(app.getHttpServer())
        .get('/notifications')
        .set(bearer(me.token))
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('returns the expected fields for each notification', async () => {
      const me = await createUser();
      const { booking } = await seedBooking(me.id);
      await seedNotification(me.id, booking.id, 'Hello');

      const res = await request(app.getHttpServer())
        .get('/notifications')
        .set(bearer(me.token))
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        userId: me.id,
        bookingId: booking.id,
        type: 'BOOKING_CREATED',
        message: 'Hello',
      });
      expect(res.body[0]).toHaveProperty('id');
      expect(res.body[0]).toHaveProperty('createdAt');
    });

    it('returns notifications newest first', async () => {
      const me = await createUser();
      const { booking } = await seedBooking(me.id);
      const oldest = await seedNotification(me.id, booking.id, 'oldest', new Date('2031-01-01T00:00:00Z'));
      const newest = await seedNotification(me.id, booking.id, 'newest', new Date('2031-01-03T00:00:00Z'));
      const middle = await seedNotification(me.id, booking.id, 'middle', new Date('2031-01-02T00:00:00Z'));

      const res = await request(app.getHttpServer())
        .get('/notifications')
        .set(bearer(me.token))
        .expect(200);

      expect(res.body.map((n: any) => n.id)).toEqual([newest.id, middle.id, oldest.id]);
    });

    it("never returns another user's notifications", async () => {
      const owner = await createUser();
      const stranger = await createUser();
      const { booking } = await seedBooking(owner.id);
      const secret = await seedNotification(owner.id, booking.id, 'private message');

      const res = await request(app.getHttpServer())
        .get('/notifications')
        .set(bearer(stranger.token))
        .expect(200);

      expect(res.body).toEqual([]);
      expect(res.body.map((n: any) => n.id)).not.toContain(secret.id);
    });

    it("does not show a user's notifications to ADMIN (admins only see their own)", async () => {
      const owner = await createUser();
      const freshAdmin = await createUser(user_role.ADMIN);
      const { booking } = await seedBooking(owner.id);
      const secret = await seedNotification(owner.id, booking.id, 'private message');

      const res = await request(app.getHttpServer())
        .get('/notifications')
        .set(bearer(freshAdmin.token))
        .expect(200);

      expect(res.body.map((n: any) => n.id)).not.toContain(secret.id);
    });
  });

  // End-to-end flow with the bookings module: notifications are created as a
  // side effect of booking actions and then show up in GET /notifications.
  describe('notifications created by booking actions', () => {
    it('receives BOOKING_CREATED after booking and BOOKING_CANCELLED after cancelling', async () => {
      const me = await createUser();
      const room = await prisma.room.create({
        data: {
          name: `${roomPrefix} ${counter++}`,
          capacity: 2,
          pricePerNight: 100,
          isActive: true,
        } as any,
      });

      const created = await request(app.getHttpServer())
        .post('/bookings')
        .set(bearer(me.token))
        .send({ roomId: room.id, checkIn: '2031-06-10', checkOut: '2031-06-12' })
        .expect(201);
      const bookingId = created.body.data.id;

      const afterCreate = await request(app.getHttpServer())
        .get('/notifications')
        .set(bearer(me.token))
        .expect(200);
      expect(afterCreate.body).toHaveLength(1);
      expect(afterCreate.body[0]).toMatchObject({
        bookingId,
        type: 'BOOKING_CREATED',
        userId: me.id,
      });
      expect(afterCreate.body[0].message).toContain(`#${bookingId}`);

      await request(app.getHttpServer())
        .patch(`/bookings/me/${bookingId}/cancel`)
        .set(bearer(me.token))
        .expect(200);

      const afterCancel = await request(app.getHttpServer())
        .get('/notifications')
        .set(bearer(me.token))
        .expect(200);
      expect(afterCancel.body).toHaveLength(2);
      expect(afterCancel.body.map((n: any) => n.type).sort()).toEqual([
        'BOOKING_CANCELLED',
        'BOOKING_CREATED',
      ]);
    });
  });
});