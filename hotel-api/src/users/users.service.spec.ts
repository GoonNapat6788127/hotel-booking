import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { Logger, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { SAFE_USER_SELECT } from './user.select';

// Loosely typed jest.fn() so mockResolvedValue(...) accepts any value.
const fn = () => jest.fn<(...args: any[]) => any>();

// Mock PrismaService: only the user methods UsersService calls.
const mockPrisma = {
  user: {
    findUnique: fn(),
    update: fn(),
  },
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Keep test output clean: the service logs on every profile update.
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // --------------------------------------------------------------- getProfile
  describe('getProfile', () => {
    it('should return the user using the safe select', async () => {
      const user = { id: 1, email: 'alice@example.com', name: 'Alice', role: 'USER' };
      mockPrisma.user.findUnique.mockResolvedValue(user);

      expect(await service.getProfile(1)).toBe(user);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        select: SAFE_USER_SELECT,
      });
    });

    it('should throw NotFoundException when the user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getProfile(999)).rejects.toThrow(NotFoundException);
      await expect(service.getProfile(999)).rejects.toThrow('User not found');
    });
  });

  // ------------------------------------------------------------ updateProfile
  describe('updateProfile', () => {
    const updatedUser = { id: 1, email: 'alice@example.com', name: 'New Name', role: 'USER' };

    beforeEach(() => {
      mockPrisma.user.update.mockResolvedValue(updatedUser);
    });

    it('should update only the name when no password is given', async () => {
      const result = await service.updateProfile(1, { name: 'New Name' } as any);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { name: 'New Name' },
        select: SAFE_USER_SELECT,
      });
      expect(result).toEqual({
        message: 'Profile updated successfully',
        data: updatedUser,
      });
    });

    it('should hash the password and never store it in plain text', async () => {
      await service.updateProfile(1, { password: 'newPassword456' } as any);

      const arg = mockPrisma.user.update.mock.calls[0][0] as any;
      expect(arg.data).not.toHaveProperty('name');
      expect(arg.data).not.toHaveProperty('password');
      expect(arg.data.passwordHash).not.toBe('newPassword456');
      expect(await bcrypt.compare('newPassword456', arg.data.passwordHash)).toBe(true);
    });

    it('should update name and password together', async () => {
      await service.updateProfile(1, { name: 'New Name', password: 'newPassword456' } as any);

      const arg = mockPrisma.user.update.mock.calls[0][0] as any;
      expect(arg.data.name).toBe('New Name');
      expect(await bcrypt.compare('newPassword456', arg.data.passwordHash)).toBe(true);
    });

    it('should send empty data when the DTO has no fields', async () => {
      await service.updateProfile(1, {} as any);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {},
        select: SAFE_USER_SELECT,
      });
    });

    it('should ignore fields other than name and password', async () => {
      await service.updateProfile(1, {
        name: 'New Name',
        role: 'ADMIN',
        email: 'hacker@example.com',
      } as any);

      const arg = mockPrisma.user.update.mock.calls[0][0] as any;
      expect(arg.data).toEqual({ name: 'New Name' });
    });

    it('should rethrow database errors unchanged', async () => {
      const error = Object.assign(new Error('Record to update not found.'), { code: 'P2025' });
      mockPrisma.user.update.mockRejectedValue(error);

      await expect(service.updateProfile(999, { name: 'x' } as any)).rejects.toBe(error);
    });

    it('should log the update on success', async () => {
      await service.updateProfile(1, { name: 'New Name' } as any);

      expect(Logger.prototype.log).toHaveBeenCalledWith('Profile updated id=1');
    });
  });
});