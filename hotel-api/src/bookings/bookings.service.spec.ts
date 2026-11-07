import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { booking_status, notification_type } from '@prisma/client';
import { BookingsService } from './bookings.service';
import { PrismaService } from '../prisma/prisma.service';
import { overlapWhere } from './booking-overlap';

// Loosely typed jest.fn() so mockResolvedValue(...) accepts any value.
const fn = () => jest.fn<(...args: any[]) => any>();

// Client used inside prisma.$transaction(async (tx) => ...)
const mockTx = {
  $queryRaw: fn(),
  room: { findFirst: fn() },
  booking: { findFirst: fn(), create: fn(), update: fn() },
  notification: { create: fn() },
};

const mockPrisma = {
  $transaction: fn(),
  booking: { findMany: fn(), findFirst: fn(), findUnique: fn() },
};

const checkIn = new Date('2030-01-10');
const checkOut = new Date('2030-01-12');

describe('BookingsService', () => {
  let service: BookingsService;

  beforeEach(async () => {
    // resetAllMocks also clears return values, so tests cannot leak into each other.
    jest.resetAllMocks();
    // Run the transaction callback against the mock transaction client.
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<BookingsService>(BookingsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ------------------------------------------------------------ validateDates
  describe('validateDates', () => {
    it('should accept a valid range', () => {
      expect(() => service.validateDates(checkIn, checkOut)).not.toThrow();
    });

    it('should reject an invalid checkIn', () => {
      expect(() => service.validateDates(new Date('nope'), checkOut)).toThrow(
        'checkIn is not a valid date',
      );
    });

    it('should reject an invalid checkOut', () => {
      expect(() => service.validateDates(checkIn, new Date('nope'))).toThrow(
        'checkOut is not a valid date',
      );
    });

    it('should reject a non-Date checkIn', () => {
      expect(() => service.validateDates('2030-01-10' as any, checkOut)).toThrow(
        BadRequestException,
      );
    });

    it('should reject checkIn equal to checkOut', () => {
      expect(() => service.validateDates(checkIn, checkIn)).toThrow(
        'Check-in must be before check-out',
      );
    });

    it('should reject checkIn after checkOut', () => {
      expect(() => service.validateDates(checkOut, checkIn)).toThrow(
        'Check-in must be before check-out',
      );
    });
  });

  // ------------------------------------------------------------------- create
  describe('create', () => {
    const dto = { roomId: 1, checkIn, checkOut } as any;
    const room = { id: 1, name: 'Deluxe 101', isActive: true };

    function arrangeAvailableRoom() {
      mockTx.$queryRaw.mockResolvedValue([{ id: 1 }]);
      mockTx.room.findFirst.mockResolvedValue(room);
      mockTx.booking.findFirst.mockResolvedValue(null);
      mockTx.booking.create.mockResolvedValue({
        id: 10,
        userId: 5,
        roomId: 1,
        status: booking_status.PENDING,
        room,
      });
      mockTx.notification.create.mockResolvedValue({});
    }

    it('should reject invalid dates before touching the database', async () => {
      await expect(
        service.create(5, { ...dto, checkIn: checkOut, checkOut: checkIn }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should create a PENDING booking and a BOOKING_CREATED notification', async () => {
      arrangeAvailableRoom();

      const result = await service.create(5, dto);

      expect(mockTx.room.findFirst).toHaveBeenCalledWith({
        where: { id: 1, isActive: true },
      });
      expect(mockTx.booking.create).toHaveBeenCalledWith({
        data: { userId: 5, roomId: 1, checkIn, checkOut },
        include: { room: true },
      });
      expect(mockTx.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 5,
          bookingId: 10,
          type: notification_type.BOOKING_CREATED,
          message: 'Your booking #10 for Deluxe 101 was created and is pending approval.',
        },
      });
      expect(result).toEqual({
        message: 'Booking created successfully',
        data: expect.objectContaining({ id: 10, status: booking_status.PENDING }),
      });
    });

    it('should check for overlapping bookings on the same room', async () => {
      arrangeAvailableRoom();

      await service.create(5, dto);

      expect(mockTx.booking.findFirst).toHaveBeenCalledWith({
        where: { roomId: 1, ...overlapWhere(checkIn, checkOut) },
        select: { id: true },
      });
    });

    it('should throw NotFoundException when the room does not exist', async () => {
      mockTx.$queryRaw.mockResolvedValue([]);

      await expect(service.create(5, dto)).rejects.toThrow(NotFoundException);
      expect(mockTx.room.findFirst).not.toHaveBeenCalled();
      expect(mockTx.booking.create).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when the room is inactive', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ id: 1 }]);
      mockTx.room.findFirst.mockResolvedValue(null);

      await expect(service.create(5, dto)).rejects.toThrow('Room 1 not found');
      expect(mockTx.booking.create).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when the dates overlap an existing booking', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ id: 1 }]);
      mockTx.room.findFirst.mockResolvedValue(room);
      mockTx.booking.findFirst.mockResolvedValue({ id: 99 });

      await expect(service.create(5, dto)).rejects.toThrow(ConflictException);
      expect(mockTx.booking.create).not.toHaveBeenCalled();
      expect(mockTx.notification.create).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------- user queries
  describe('findAllUser', () => {
    it("should return only the user's bookings, newest first", async () => {
      const bookings = [{ id: 2 }, { id: 1 }];
      mockPrisma.booking.findMany.mockResolvedValue(bookings);

      expect(await service.findAllUser(5)).toBe(bookings);
      expect(mockPrisma.booking.findMany).toHaveBeenCalledWith({
        where: { userId: 5 },
        include: { room: true },
        orderBy: { id: 'desc' },
      });
    });
  });

  describe('findOneUser', () => {
    it('should look the booking up by id AND owner', async () => {
      const booking = { id: 3, userId: 5 };
      mockPrisma.booking.findFirst.mockResolvedValue(booking);

      expect(await service.findOneUser(5, 3)).toBe(booking);
      expect(mockPrisma.booking.findFirst).toHaveBeenCalledWith({
        where: { id: 3, userId: 5 },
        include: { room: true },
      });
    });

    it('should throw NotFoundException when it is not found (or not owned)', async () => {
      mockPrisma.booking.findFirst.mockResolvedValue(null);

      await expect(service.findOneUser(5, 999)).rejects.toThrow('Booking 999 not found');
    });
  });

  // ------------------------------------------------------------ cancelBooking
  describe('cancelBooking', () => {
    it('should throw NotFoundException when the booking is not found or not owned', async () => {
      mockPrisma.booking.findFirst.mockResolvedValue(null);

      await expect(service.cancelBooking(5, 999)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.booking.findFirst).toHaveBeenCalledWith({
        where: { id: 999, userId: 5 },
      });
    });

    it.each([booking_status.PENDING, booking_status.APPROVED])(
      'should cancel a %s booking and create a BOOKING_CANCELLED notification',
      async (from) => {
        mockPrisma.booking.findFirst.mockResolvedValue({ id: 3, userId: 5, status: from });
        mockTx.booking.update.mockResolvedValue({ id: 3, status: booking_status.CANCELLED });
        mockTx.notification.create.mockResolvedValue({});

        const result = await service.cancelBooking(5, 3);

        expect(mockTx.booking.update).toHaveBeenCalledWith({
          where: { id: 3 },
          data: { status: booking_status.CANCELLED },
          include: { room: true },
        });
        expect(mockTx.notification.create).toHaveBeenCalledWith({
          data: {
            userId: 5,
            bookingId: 3,
            type: notification_type.BOOKING_CANCELLED,
            message: 'Your booking #3 was cancelled.',
          },
        });
        expect(result).toEqual({
          message: 'Booking cancelled successfully',
          data: { id: 3, status: booking_status.CANCELLED },
        });
      },
    );

    it.each([booking_status.PAID, booking_status.CANCELLED])(
      'should refuse to cancel a %s booking',
      async (from) => {
        mockPrisma.booking.findFirst.mockResolvedValue({ id: 3, userId: 5, status: from });

        await expect(service.cancelBooking(5, 3)).rejects.toThrow(
          `Cannot change booking status from ${from} to CANCELLED`,
        );
        expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      },
    );
  });

  // ---------------------------------------------------------- admin queries
  describe('findAll', () => {
    it('should return all bookings when no status filter is given', async () => {
      mockPrisma.booking.findMany.mockResolvedValue([]);

      await service.findAll();

      expect(mockPrisma.booking.findMany).toHaveBeenCalledWith({
        where: undefined,
        include: { room: true, user: { select: { id: true, name: true, email: true } } },
        orderBy: { id: 'desc' },
      });
    });

    it('should filter by status', async () => {
      mockPrisma.booking.findMany.mockResolvedValue([]);

      await service.findAll(booking_status.APPROVED);

      const arg = mockPrisma.booking.findMany.mock.calls[0][0] as any;
      expect(arg.where).toEqual({ status: booking_status.APPROVED });
    });
  });

  describe('findOne', () => {
    it('should return the booking with room and a safe user select', async () => {
      const booking = { id: 3 };
      mockPrisma.booking.findUnique.mockResolvedValue(booking);

      expect(await service.findOne(3)).toBe(booking);
      expect(mockPrisma.booking.findUnique).toHaveBeenCalledWith({
        where: { id: 3 },
        include: { room: true, user: { select: { id: true, name: true, email: true } } },
      });
    });

    it('should throw NotFoundException when it does not exist', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(null);

      await expect(service.findOne(999)).rejects.toThrow('Booking 999 not found');
    });
  });

  // ------------------------------------------------------------ updateStatus
  describe('updateStatus', () => {
    it('should throw NotFoundException when the booking does not exist', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(null);

      await expect(service.updateStatus(999, booking_status.APPROVED)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should not create a notification for non-cancel changes', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue({
        id: 3,
        userId: 5,
        status: booking_status.PENDING,
      });
      mockTx.booking.update.mockResolvedValue({ id: 3, status: booking_status.APPROVED });

      await service.updateStatus(3, booking_status.APPROVED);

      expect(mockTx.notification.create).not.toHaveBeenCalled();
    });

    it('should create a BOOKING_CANCELLED notification when an admin cancels', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue({
        id: 3,
        userId: 5,
        status: booking_status.APPROVED,
      });
      mockTx.booking.update.mockResolvedValue({ id: 3, status: booking_status.CANCELLED });
      mockTx.notification.create.mockResolvedValue({});

      await service.updateStatus(3, booking_status.CANCELLED);

      expect(mockTx.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 5,
          bookingId: 3,
          type: notification_type.BOOKING_CANCELLED,
        }),
      });
    });

    // Every from -> to combination. Allowed:
    //   PENDING -> APPROVED | CANCELLED,  APPROVED -> PAID | CANCELLED
    //   PAID and CANCELLED are final.
    describe('status transitions', () => {
      const all = [
        booking_status.PENDING,
        booking_status.APPROVED,
        booking_status.PAID,
        booking_status.CANCELLED,
      ];
      const allowed: Record<string, string[]> = {
        [booking_status.PENDING]: [booking_status.APPROVED, booking_status.CANCELLED],
        [booking_status.APPROVED]: [booking_status.PAID, booking_status.CANCELLED],
        [booking_status.PAID]: [],
        [booking_status.CANCELLED]: [],
      };

      for (const from of all) {
        for (const to of all) {
          if (allowed[from].includes(to)) {
            it(`allows ${from} -> ${to}`, async () => {
              mockPrisma.booking.findUnique.mockResolvedValue({ id: 1, userId: 2, status: from });
              mockTx.booking.update.mockResolvedValue({ id: 1, status: to });
              mockTx.notification.create.mockResolvedValue({});

              await expect(service.updateStatus(1, to)).resolves.toEqual({
                message: 'Booking status updated successfully',
                data: { id: 1, status: to },
              });
            });
          } else {
            it(`rejects ${from} -> ${to}`, async () => {
              mockPrisma.booking.findUnique.mockResolvedValue({ id: 1, userId: 2, status: from });

              await expect(service.updateStatus(1, to)).rejects.toThrow(
                `Cannot change booking status from ${from} to ${to}`,
              );
              expect(mockPrisma.$transaction).not.toHaveBeenCalled();
            });
          }
        }
      }
    });
  });
});