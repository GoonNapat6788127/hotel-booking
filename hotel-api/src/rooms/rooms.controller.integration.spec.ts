import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { user_role } from '@prisma/client';
import { RoomsService } from './rooms.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
// Type-only import: erased at compile time, so it does not load the real
// controller (or Redis) before the mock below is registered.
import type { RoomsController as RoomsControllerType } from './rooms.controller.js';

// Loosely typed jest.fn() so mockResolvedValue(...) accepts any value.
const fn = () => jest.fn<(...args: any[]) => any>();

// The controller calls invalidateKeys('rooms:*') after every write, which
// talks to Redis. In ESM mode jest.mock() is unavailable, so we register the
// mock with unstable_mockModule and import the controller AFTER that.
const mockInvalidateKeys = fn();
jest.unstable_mockModule('../redis-invalidate.js', () => ({
  invalidateKeys: mockInvalidateKeys,
}));

// Mock RoomsService: the controller talks to this instead of the real service/DB.
const mockRoomsService = {
  create: fn(),
  findAll: fn(),
  findOne: fn(),
  update: fn(),
  remove: fn(),
  enable: fn(),
  disable: fn(),
  setImage: fn(),
  search: fn(),
};

const admin = { id: 1, role: user_role.ADMIN } as any;
const user = { id: 2, role: user_role.USER } as any;
const file = { filename: 'abc.png' } as any;

// Declared once here, assigned in beforeAll (no top-level await needed).
let RoomsController: typeof RoomsControllerType;

describe('RoomsController Integration', () => {
  let controller: RoomsControllerType;

  // Load the controller only after the mock above is registered.
  beforeAll(async () => {
    ({ RoomsController } = await import('./rooms.controller.js'));
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockInvalidateKeys.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RoomsController],
      providers: [
        { provide: RoomsService, useValue: mockRoomsService },
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

    controller = module.get(RoomsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ----------------------------------------------------------------- reads
  describe('findAll', () => {
    it('should pass the current user role to the service', async () => {
      const rooms = [{ id: 1 }];
      mockRoomsService.findAll.mockResolvedValue(rooms);

      expect(await controller.findAll(user)).toBe(rooms);
      expect(mockRoomsService.findAll).toHaveBeenCalledWith(user_role.USER);
    });
  });

  describe('search', () => {
    it('should delegate the query to the service', async () => {
      const query = { capacity: 2 } as any;
      const result = { message: 'ok', count: 0, data: [] };
      mockRoomsService.search.mockResolvedValue(result);

      expect(await controller.search(query)).toBe(result);
      expect(mockRoomsService.search).toHaveBeenCalledWith(query);
    });

    it('should propagate BadRequestException from the service', async () => {
      mockRoomsService.search.mockRejectedValue(new BadRequestException());

      await expect(controller.search({} as any)).rejects.toThrow(BadRequestException);
    });
  });

  describe('findOne', () => {
    it('should call service.findOne with id and role', async () => {
      const room = { id: 1 };
      mockRoomsService.findOne.mockResolvedValue(room);

      expect(await controller.findOne(1, admin)).toBe(room);
      expect(mockRoomsService.findOne).toHaveBeenCalledWith(1, user_role.ADMIN);
    });

    it('should propagate NotFoundException from the service', async () => {
      mockRoomsService.findOne.mockRejectedValue(new NotFoundException());

      await expect(controller.findOne(999, user)).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------- create
  describe('create', () => {
    const dto = { name: 'Deluxe', capacity: 2, pricePerNight: 100 } as any;

    it('should build the imageUrl from the uploaded file and invalidate the cache', async () => {
      const result = { message: 'Room created successfully', data: { id: 1 } };
      mockRoomsService.create.mockResolvedValue(result);

      expect(await controller.create(dto, file)).toBe(result);
      expect(mockRoomsService.create).toHaveBeenCalledWith(dto, '/uploads/rooms/abc.png');
      expect(mockInvalidateKeys).toHaveBeenCalledWith('rooms:*');
    });

    it('should pass undefined imageUrl when no file is uploaded', async () => {
      mockRoomsService.create.mockResolvedValue({});

      await controller.create(dto);

      expect(mockRoomsService.create).toHaveBeenCalledWith(dto, undefined);
    });

    it('should not invalidate the cache when the service fails', async () => {
      mockRoomsService.create.mockRejectedValue(new BadRequestException());

      await expect(controller.create(dto)).rejects.toThrow(BadRequestException);
      expect(mockInvalidateKeys).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------- image
  describe('uploadImage', () => {
    it('should throw BadRequestException when no file is sent', async () => {
      await expect(controller.uploadImage(1, admin, undefined as any)).rejects.toThrow(
        'Image file is required',
      );
      expect(mockRoomsService.setImage).not.toHaveBeenCalled();
    });

    it('should call service.setImage and invalidate the cache', async () => {
      const result = { message: 'Room 1 image updated successfully' };
      mockRoomsService.setImage.mockResolvedValue(result);

      expect(await controller.uploadImage(1, admin, file)).toBe(result);
      expect(mockRoomsService.setImage).toHaveBeenCalledWith(
        1,
        user_role.ADMIN,
        '/uploads/rooms/abc.png',
      );
      expect(mockInvalidateKeys).toHaveBeenCalledWith('rooms:*');
    });

    it('should propagate NotFoundException from the service', async () => {
      mockRoomsService.setImage.mockRejectedValue(new NotFoundException());

      await expect(controller.uploadImage(999, admin, file)).rejects.toThrow(NotFoundException);
      expect(mockInvalidateKeys).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------- update
  describe('update', () => {
    const dto = { name: 'Renamed' } as any;

    it('should call service.update with the image url and invalidate the cache', async () => {
      const result = { message: 'Room 1 updated successfully' };
      mockRoomsService.update.mockResolvedValue(result);

      expect(await controller.update(1, dto, file)).toBe(result);
      expect(mockRoomsService.update).toHaveBeenCalledWith(1, dto, '/uploads/rooms/abc.png');
      expect(mockInvalidateKeys).toHaveBeenCalledWith('rooms:*');
    });

    it('should pass undefined imageUrl when no file is uploaded', async () => {
      mockRoomsService.update.mockResolvedValue({});

      await controller.update(1, dto);

      expect(mockRoomsService.update).toHaveBeenCalledWith(1, dto, undefined);
    });

    it('should propagate NotFoundException without invalidating the cache', async () => {
      mockRoomsService.update.mockRejectedValue(new NotFoundException());

      await expect(controller.update(999, dto)).rejects.toThrow(NotFoundException);
      expect(mockInvalidateKeys).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------ enable / disable / remove
  describe('disable', () => {
    it('should call service.disable and invalidate the cache', async () => {
      const result = { id: 1, isActive: false };
      mockRoomsService.disable.mockResolvedValue(result);

      expect(await controller.disable(1)).toBe(result);
      expect(mockRoomsService.disable).toHaveBeenCalledWith(1);
      expect(mockInvalidateKeys).toHaveBeenCalledWith('rooms:*');
    });
  });

  describe('enable', () => {
    it('should call service.enable and invalidate the cache', async () => {
      const result = { id: 1, isActive: true };
      mockRoomsService.enable.mockResolvedValue(result);

      expect(await controller.enable(1)).toBe(result);
      expect(mockRoomsService.enable).toHaveBeenCalledWith(1);
      expect(mockInvalidateKeys).toHaveBeenCalledWith('rooms:*');
    });
  });

  describe('remove', () => {
    it('should call service.remove and invalidate the cache', async () => {
      const result = { message: 'Room 1 removed successfully' };
      mockRoomsService.remove.mockResolvedValue(result);

      expect(await controller.remove(1)).toBe(result);
      expect(mockRoomsService.remove).toHaveBeenCalledWith(1);
      expect(mockInvalidateKeys).toHaveBeenCalledWith('rooms:*');
    });

    it('should propagate NotFoundException without invalidating the cache', async () => {
      mockRoomsService.remove.mockRejectedValue(new NotFoundException());

      await expect(controller.remove(999)).rejects.toThrow(NotFoundException);
      expect(mockInvalidateKeys).not.toHaveBeenCalled();
    });
  });
});