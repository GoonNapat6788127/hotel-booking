import { BadRequestException } from '@nestjs/common';
import { RoomsService } from './rooms.service';

describe('RoomsService.search', () => {
  let service: RoomsService;
  const prisma = { room: { findMany: jest.fn().mockResolvedValue([]) } };

  beforeEach(() => {
    prisma.room.findMany.mockClear();
    service = new RoomsService(prisma as any);
  });

  it('rejects only one date', async () => {
    await expect(service.search({ checkIn: new Date() } as any)).rejects.toThrow(BadRequestException);
  });

  it('rejects checkIn after checkOut', async () => {
    await expect(
      service.search({ checkIn: new Date('2026-12-05'), checkOut: new Date('2026-12-01') } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('filters by capacity and excludes overlapping bookings', async () => {
    await service.search({
      capacity: 4,
      checkIn: new Date('2026-12-01'),
      checkOut: new Date('2026-12-03'),
    } as any);
    const arg = prisma.room.findMany.mock.calls[0][0];
    expect(arg.where.capacity).toEqual({ gte: 4 });
    expect(arg.where.booking.none).toBeDefined();
  });
});