import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { user_role } from '@prisma/client';
import { mkdir, writeFile, access, rm } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { RoomsService } from './rooms.service';
import { PrismaService } from '../prisma/prisma.service';
import { overlapWhere } from '../bookings/booking-overlap';

// Loosely typed jest.fn() so mockResolvedValue(...) accepts any value.
const fn = () => jest.fn<(...args: any[]) => any>();

// Mock PrismaService: only the room methods RoomsService calls.
const mockPrisma = {
  room: {
    create: fn(),
    findMany: fn(),
    findUnique: fn(),
    update: fn(),
    delete: fn(),
  },
};

// ---- helpers for the image-cleanup behaviour -------------------------------
// RoomsService deletes local files with fs/promises. Instead of mocking fs
// (not practical in ESM mode) we create real temp files and check they vanish.
const createdFiles: string[] = [];

async function makeImage() {
  const dir = join(process.cwd(), 'uploads', 'rooms');
  await mkdir(dir, { recursive: true });
  const filename = `unit-test-${randomUUID()}.png`;
  const filePath = join(dir, filename);
  await writeFile(filePath, 'x');
  createdFiles.push(filePath);
  return { url: `/uploads/rooms/${filename}`, filePath };
}

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

describe('RoomsService', () => {
  let service: RoomsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<RoomsService>(RoomsService);
  });

  afterEach(async () => {
    await Promise.all(createdFiles.splice(0).map((p) => rm(p, { force: true })));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ------------------------------------------------------------------ create
  describe('create', () => {
    const dto = {
      name: 'Deluxe 101',
      description: 'Sea view',
      capacity: 2,
      pricePerNight: 120,
    } as any;

    it('should create a room and return a success message', async () => {
      const room = { id: 1, ...dto };
      mockPrisma.room.create.mockResolvedValue(room);

      const result = await service.create(dto);

      expect(mockPrisma.room.create).toHaveBeenCalledWith({ data: dto });
      expect(result).toEqual({ message: 'Room created successfully', data: room });
    });

    it('should store the imageUrl when an image was uploaded', async () => {
      mockPrisma.room.create.mockResolvedValue({ id: 1 });

      await service.create(dto, '/uploads/rooms/a.png');

      expect(mockPrisma.room.create).toHaveBeenCalledWith({
        data: { ...dto, imageUrl: '/uploads/rooms/a.png' },
      });
    });

    it('should not add imageUrl to the data when no image was uploaded', async () => {
      mockPrisma.room.create.mockResolvedValue({ id: 1 });

      await service.create(dto);

      const arg = mockPrisma.room.create.mock.calls[0][0] as any;
      expect(arg.data).not.toHaveProperty('imageUrl');
    });

    it('should throw BadRequestException and delete the uploaded file when creation fails', async () => {
      const img = await makeImage();
      mockPrisma.room.create.mockRejectedValue(new Error('db down'));

      await expect(service.create(dto, img.url)).rejects.toThrow(BadRequestException);
      expect(await exists(img.filePath)).toBe(false);
    });
  });

  // ----------------------------------------------------------------- findAll
  describe('findAll', () => {
    it('should return every room for ADMIN', async () => {
      const rooms = [{ id: 1 }, { id: 2 }];
      mockPrisma.room.findMany.mockResolvedValue(rooms);

      expect(await service.findAll(user_role.ADMIN)).toBe(rooms);
      expect(mockPrisma.room.findMany).toHaveBeenCalledWith({ where: {} });
    });

    it('should return only active rooms for USER', async () => {
      mockPrisma.room.findMany.mockResolvedValue([{ id: 1 }]);

      await service.findAll(user_role.USER);

      expect(mockPrisma.room.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
      });
    });
  });

  // ----------------------------------------------------------------- findOne
  describe('findOne', () => {
    it('should return the room for ADMIN without an isActive filter', async () => {
      const room = { id: 1, isActive: false };
      mockPrisma.room.findUnique.mockResolvedValue(room);

      expect(await service.findOne(1, user_role.ADMIN)).toBe(room);
      expect(mockPrisma.room.findUnique).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    it('should filter by isActive for USER', async () => {
      mockPrisma.room.findUnique.mockResolvedValue({ id: 1, isActive: true });

      await service.findOne(1, user_role.USER);

      expect(mockPrisma.room.findUnique).toHaveBeenCalledWith({
        where: { id: 1, isActive: true },
      });
    });

    it('should throw NotFoundException when the room does not exist', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(null);

      await expect(service.findOne(999, user_role.ADMIN)).rejects.toThrow(NotFoundException);
    });
  });

  // ------------------------------------------------------------------ update
  describe('update', () => {
    it('should update the room and return a success message', async () => {
      const updated = { id: 1, name: 'New name' };
      mockPrisma.room.findUnique.mockResolvedValue({ id: 1, imageUrl: null });
      mockPrisma.room.update.mockResolvedValue(updated);

      const result = await service.update(1, { name: 'New name' } as any);

      expect(mockPrisma.room.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { name: 'New name' },
      });
      expect(result).toEqual({ message: 'Room 1 updated successfully', data: updated });
    });

    it('should delete the previous image when a new one is uploaded', async () => {
      const oldImg = await makeImage();
      const newImg = await makeImage();
      mockPrisma.room.findUnique.mockResolvedValue({ id: 1, imageUrl: oldImg.url });
      mockPrisma.room.update.mockResolvedValue({ id: 1, imageUrl: newImg.url });

      await service.update(1, {} as any, newImg.url);

      expect(await exists(oldImg.filePath)).toBe(false);
      expect(await exists(newImg.filePath)).toBe(true);
    });

    it('should throw NotFoundException and delete the new file when the room does not exist', async () => {
      const newImg = await makeImage();
      mockPrisma.room.findUnique.mockResolvedValue(null);

      await expect(service.update(999, {} as any, newImg.url)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.room.update).not.toHaveBeenCalled();
      expect(await exists(newImg.filePath)).toBe(false);
    });

    it('should map Prisma P2025 to NotFoundException', async () => {
      mockPrisma.room.findUnique.mockResolvedValue({ id: 1 });
      mockPrisma.room.update.mockRejectedValue({ code: 'P2025' });

      await expect(service.update(1, {} as any)).rejects.toThrow(NotFoundException);
    });

    it('should wrap unexpected errors in BadRequestException', async () => {
      mockPrisma.room.findUnique.mockResolvedValue({ id: 1 });
      mockPrisma.room.update.mockRejectedValue(new Error('boom'));

      await expect(service.update(1, {} as any)).rejects.toThrow(BadRequestException);
    });
  });

  // ------------------------------------------------------------------ remove
  describe('remove', () => {
    it('should delete the room and its image file', async () => {
      const img = await makeImage();
      const deleted = { id: 1, imageUrl: img.url };
      mockPrisma.room.delete.mockResolvedValue(deleted);

      const result = await service.remove(1);

      expect(mockPrisma.room.delete).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(result).toEqual({ message: 'Room 1 removed successfully', data: deleted });
      expect(await exists(img.filePath)).toBe(false);
    });

    it('should map P2025 to NotFoundException', async () => {
      mockPrisma.room.delete.mockRejectedValue({ code: 'P2025' });

      await expect(service.remove(999)).rejects.toThrow(NotFoundException);
    });

    it('should map P2003 (related bookings) to BadRequestException', async () => {
      mockPrisma.room.delete.mockRejectedValue({ code: 'P2003' });

      await expect(service.remove(1)).rejects.toThrow(
        'Cannot delete this room because it has related bookings',
      );
    });

    it('should wrap unexpected errors in BadRequestException', async () => {
      mockPrisma.room.delete.mockRejectedValue(new Error('boom'));

      await expect(service.remove(1)).rejects.toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------- enable/disable
  describe('enable', () => {
    it('should set isActive to true', async () => {
      mockPrisma.room.update.mockResolvedValue({ id: 1, isActive: true });

      await service.enable(1);

      expect(mockPrisma.room.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { isActive: true },
      });
    });

    it('should throw NotFoundException on P2025', async () => {
      mockPrisma.room.update.mockRejectedValue({ code: 'P2025' });

      await expect(service.enable(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('disable', () => {
    it('should set isActive to false', async () => {
      mockPrisma.room.update.mockResolvedValue({ id: 1, isActive: false });

      await service.disable(1);

      expect(mockPrisma.room.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { isActive: false },
      });
    });

    it('should throw NotFoundException on P2025', async () => {
      mockPrisma.room.update.mockRejectedValue({ code: 'P2025' });

      await expect(service.disable(999)).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------- setImage
  describe('setImage', () => {
    it('should save the new image url and delete the old file', async () => {
      const oldImg = await makeImage();
      const newImg = await makeImage();
      mockPrisma.room.findUnique.mockResolvedValue({ id: 1, imageUrl: oldImg.url });
      mockPrisma.room.update.mockResolvedValue({ id: 1, imageUrl: newImg.url });

      const result = await service.setImage(1, user_role.ADMIN, newImg.url);

      expect(mockPrisma.room.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { imageUrl: newImg.url },
      });
      expect(result.message).toBe('Room 1 image updated successfully');
      expect(await exists(oldImg.filePath)).toBe(false);
      expect(await exists(newImg.filePath)).toBe(true);
    });

    it('should throw NotFoundException and delete the new file when the room is missing', async () => {
      const newImg = await makeImage();
      mockPrisma.room.findUnique.mockResolvedValue(null);

      await expect(service.setImage(999, user_role.ADMIN, newImg.url)).rejects.toThrow(
        NotFoundException,
      );
      expect(await exists(newImg.filePath)).toBe(false);
    });
  });

  // ------------------------------------------------------------------ search
  describe('search', () => {
    beforeEach(() => {
      mockPrisma.room.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    });

    it('should return active rooms ordered by price when no filters are given', async () => {
      const result = await service.search({} as any);

      expect(mockPrisma.room.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: { pricePerNight: 'asc' },
      });
      expect(result).toEqual({
        message: 'Rooms retrieved successfully',
        count: 2,
        data: [{ id: 1 }, { id: 2 }],
      });
    });

    it('should filter by minimum capacity', async () => {
      await service.search({ capacity: 4 } as any);

      const arg = mockPrisma.room.findMany.mock.calls[0][0] as any;
      expect(arg.where.capacity).toEqual({ gte: 4 });
    });

    it('should filter by max price, including a max price of 0', async () => {
      await service.search({ maxPrice: 0 } as any);

      const arg = mockPrisma.room.findMany.mock.calls[0][0] as any;
      expect(arg.where.pricePerNight).toEqual({ lte: 0 });
    });

    it('should exclude rooms with overlapping bookings for a date range', async () => {
      const checkIn = new Date('2030-01-10');
      const checkOut = new Date('2030-01-12');

      await service.search({ checkIn, checkOut } as any);

      const arg = mockPrisma.room.findMany.mock.calls[0][0] as any;
      expect(arg.where.booking).toEqual({ none: overlapWhere(checkIn, checkOut) });
    });

    it('should reject when only checkIn is provided', async () => {
      await expect(
        service.search({ checkIn: new Date('2030-01-10') } as any),
      ).rejects.toThrow('Provide both checkIn and checkOut');
    });

    it('should reject when only checkOut is provided', async () => {
      await expect(
        service.search({ checkOut: new Date('2030-01-12') } as any),
      ).rejects.toThrow('Provide both checkIn and checkOut');
    });

    it('should reject when checkIn is not before checkOut', async () => {
      const same = new Date('2030-01-10');

      await expect(
        service.search({ checkIn: same, checkOut: same } as any),
      ).rejects.toThrow('Check-in must be before check-out');
      expect(mockPrisma.room.findMany).not.toHaveBeenCalled();
    });
  });
});