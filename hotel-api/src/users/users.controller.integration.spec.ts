import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
// Type-only import: erased at compile time, so it does not load the real
// controller (or Redis) before the mock below is registered.
import type { UsersController as UsersControllerType } from './users.controller';

// Loosely typed jest.fn() so mockResolvedValue(...) accepts any value.
const fn = () => jest.fn<(...args: any[]) => any>();

// The controller calls invalidateKeys('users:<id>:*') after every update,
// which talks to Redis. In ESM mode jest.mock() is unavailable, so we register
// the mock with unstable_mockModule and import the controller AFTER that.
const mockInvalidateKeys = fn();
jest.unstable_mockModule('../redis-invalidate', () => ({
  invalidateKeys: mockInvalidateKeys,
}));

// Loaded in beforeAll, after the mock above is registered.
let UsersController: typeof import('./users.controller.js').UsersController;

// Mock UsersService: the controller talks to this instead of the real service/DB.
const mockUsersService = {
  getProfile: fn(),
  updateProfile: fn(),
};

const currentUser = { id: 7, role: 'USER' } as any;

describe('UsersController Integration', () => {
  let controller: UsersControllerType;

  beforeAll(async () => {
    ({ UsersController } = await import('./users.controller.js'));
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockInvalidateKeys.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: mockUsersService },
        // Needed by the controller and by its cache interceptor.
        {
          provide: CACHE_MANAGER,
          useValue: { get: fn(), set: fn(), del: fn() },
        },
      ],
    })
      // Skip real JWT validation: this isolates the controller logic.
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ---------------------------------------------------------------- GET /me
  describe('me', () => {
    it('should call service.getProfile with the current user id', async () => {
      const profile = { id: 7, email: 'alice@example.com', name: 'Alice', role: 'USER' };
      mockUsersService.getProfile.mockResolvedValue(profile);

      expect(await controller.me(currentUser)).toBe(profile);
      expect(mockUsersService.getProfile).toHaveBeenCalledWith(7);
    });

    it('should propagate NotFoundException from the service', async () => {
      mockUsersService.getProfile.mockRejectedValue(new NotFoundException());

      await expect(controller.me(currentUser)).rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------------------------------------------- PATCH /me
  describe('update', () => {
    const dto = { name: 'New Name' } as any;

    it('should call service.updateProfile and return its result', async () => {
      const result = { message: 'Profile updated successfully', data: { id: 7 } };
      mockUsersService.updateProfile.mockResolvedValue(result);

      expect(await controller.update(currentUser, dto)).toBe(result);
      expect(mockUsersService.updateProfile).toHaveBeenCalledWith(7, dto);
    });

    it("should invalidate only this user's cached entries", async () => {
      mockUsersService.updateProfile.mockResolvedValue({});

      await controller.update(currentUser, dto);

      expect(mockInvalidateKeys).toHaveBeenCalledTimes(1);
      expect(mockInvalidateKeys).toHaveBeenCalledWith('users:7:*');
    });

    it('should not invalidate the cache when the service fails', async () => {
      mockUsersService.updateProfile.mockRejectedValue(new Error('db down'));

      await expect(controller.update(currentUser, dto)).rejects.toThrow('db down');
      expect(mockInvalidateKeys).not.toHaveBeenCalled();
    });
  });
});