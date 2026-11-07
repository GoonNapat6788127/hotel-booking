import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { booking_status } from '@prisma/client';
import { BookingsService } from './bookings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
// Type-only import: erased at compile time, so it does not load the real
// controller (or Redis) before the mock below is registered.
import type { BookingsController as BookingsControllerType } from './bookings.controller';

// Loosely typed jest.fn() so mockResolvedValue(...) accepts any value.
const fn = () => jest.fn<(...args: any[]) => any>();

// The controller calls invalidateKeys('bookings:*') after every write, which
// talks to Redis. In ESM mode jest.mock() is unavailable, so we register the
// mock with unstable_mockModule and import the controller AFTER that.
const mockInvalidateKeys = fn();
jest.unstable_mockModule('../redis-invalidate', () => ({
  invalidateKeys: mockInvalidateKeys,
}));

// Loaded in beforeAll, after the mock above is registered.
let BookingsController: typeof import('./bookings.controller.js').BookingsController;

// Mock BookingsService: the controller talks to this instead of the real service/DB.
const mockBookingsService = {
  create: fn(),
  findAllUser: fn(),
  findOneUser: fn(),
  cancelBooking: fn(),
  findAll: fn(),
  findOne: fn(),
  updateStatus: fn(),
};

const currentUser = { id: 7, role: 'USER' } as any;

describe('BookingsController Integration', () => {
  let controller: BookingsControllerType;

  beforeAll(async () => {
    ({ BookingsController } = await import('./bookings.controller.js'));
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockInvalidateKeys.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookingsController],
      providers: [
        { provide: BookingsService, useValue: mockBookingsService },
        // Needed by the controller and by its cache interceptor.
        {
          provide: CACHE_MANAGER,
          useValue: { get: fn(), set: fn(), del: fn() },
        },
      ],
    })
      // Skip real JWT / role checks: this isolates the controller logic.
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(BookingsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ---------------------------------------------------------------- create
  describe('create', () => {
    const dto = {
      roomId: 1,
      checkIn: new Date('2030-01-10'),
      checkOut: new Date('2030-01-12'),
    } as any;

    it('should call service.create with the user id and invalidate the cache', async () => {
      const result = { message: 'Booking created successfully', data: { id: 1 } };
      mockBookingsService.create.mockResolvedValue(result);

      expect(await controller.create(currentUser, dto)).toBe(result);
      expect(mockBookingsService.create).toHaveBeenCalledWith(7, dto);
      expect(mockInvalidateKeys).toHaveBeenCalledWith('bookings:*');
    });

    it('should not invalidate the cache when the room is already booked', async () => {
      mockBookingsService.create.mockRejectedValue(new ConflictException());

      await expect(controller.create(currentUser, dto)).rejects.toThrow(ConflictException);
      expect(mockInvalidateKeys).not.toHaveBeenCalled();
    });

    it('should propagate NotFoundException for an unknown room', async () => {
      mockBookingsService.create.mockRejectedValue(new NotFoundException());

      await expect(controller.create(currentUser, dto)).rejects.toThrow(NotFoundException);
      expect(mockInvalidateKeys).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------ user reads
  describe('findAllUser', () => {
    it("should return the current user's bookings", async () => {
      const bookings = [{ id: 1 }];
      mockBookingsService.findAllUser.mockResolvedValue(bookings);

      expect(await controller.findAllUser(currentUser)).toBe(bookings);
      expect(mockBookingsService.findAllUser).toHaveBeenCalledWith(7);
    });
  });

  describe('findOneUser', () => {
    it('should call service.findOneUser with user id and booking id', async () => {
      const booking = { id: 3 };
      mockBookingsService.findOneUser.mockResolvedValue(booking);

      expect(await controller.findOneUser(currentUser, 3)).toBe(booking);
      expect(mockBookingsService.findOneUser).toHaveBeenCalledWith(7, 3);
    });

    it('should propagate NotFoundException from the service', async () => {
      mockBookingsService.findOneUser.mockRejectedValue(new NotFoundException());

      await expect(controller.findOneUser(currentUser, 999)).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------- cancel
  describe('cancelBooking', () => {
    it('should call service.cancelBooking and invalidate the cache', async () => {
      const result = { message: 'Booking cancelled successfully' };
      mockBookingsService.cancelBooking.mockResolvedValue(result);

      expect(await controller.cancelBooking(currentUser, 3)).toBe(result);
      expect(mockBookingsService.cancelBooking).toHaveBeenCalledWith(7, 3);
      expect(mockInvalidateKeys).toHaveBeenCalledWith('bookings:*');
    });

    it('should not invalidate the cache when the status change is not allowed', async () => {
      mockBookingsService.cancelBooking.mockRejectedValue(new BadRequestException());

      await expect(controller.cancelBooking(currentUser, 3)).rejects.toThrow(BadRequestException);
      expect(mockInvalidateKeys).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------ admin reads
  describe('findAll', () => {
    it('should pass the status filter from the query', async () => {
      const bookings = [{ id: 1 }];
      mockBookingsService.findAll.mockResolvedValue(bookings);

      expect(await controller.findAll({ status: booking_status.PENDING } as any)).toBe(bookings);
      expect(mockBookingsService.findAll).toHaveBeenCalledWith(booking_status.PENDING);
    });

    it('should pass undefined when no status filter is given', async () => {
      mockBookingsService.findAll.mockResolvedValue([]);

      await controller.findAll({} as any);

      expect(mockBookingsService.findAll).toHaveBeenCalledWith(undefined);
    });
  });

  describe('findOne', () => {
    it('should call service.findOne with the booking id', async () => {
      const booking = { id: 3 };
      mockBookingsService.findOne.mockResolvedValue(booking);

      expect(await controller.findOne(3)).toBe(booking);
      expect(mockBookingsService.findOne).toHaveBeenCalledWith(3);
    });

    it('should propagate NotFoundException from the service', async () => {
      mockBookingsService.findOne.mockRejectedValue(new NotFoundException());

      await expect(controller.findOne(999)).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------- updateStatus
  describe('updateStatus', () => {
    const dto = { status: booking_status.APPROVED } as any;

    it('should call service.updateStatus with id and status, then invalidate the cache', async () => {
      const result = { message: 'Booking status updated successfully' };
      mockBookingsService.updateStatus.mockResolvedValue(result);

      expect(await controller.updateStatus(3, dto)).toBe(result);
      expect(mockBookingsService.updateStatus).toHaveBeenCalledWith(3, booking_status.APPROVED);
      expect(mockInvalidateKeys).toHaveBeenCalledWith('bookings:*');
    });

    it('should not invalidate the cache for an invalid transition', async () => {
      mockBookingsService.updateStatus.mockRejectedValue(new BadRequestException());

      await expect(controller.updateStatus(3, dto)).rejects.toThrow(BadRequestException);
      expect(mockInvalidateKeys).not.toHaveBeenCalled();
    });

    it('should propagate NotFoundException from the service', async () => {
      mockBookingsService.updateStatus.mockRejectedValue(new NotFoundException());

      await expect(controller.updateStatus(999, dto)).rejects.toThrow(NotFoundException);
      expect(mockInvalidateKeys).not.toHaveBeenCalled();
    });
  });
});