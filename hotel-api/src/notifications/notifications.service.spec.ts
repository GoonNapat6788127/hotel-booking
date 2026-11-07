import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { notification_type } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

// Loosely typed jest.fn() so mockResolvedValue(...) accepts any value.
const fn = () => jest.fn<(...args: any[]) => any>();

// Mock PrismaService: only the notification methods the service calls.
const mockPrisma = {
  notification: {
    create: fn(),
    findMany: fn(),
  },
};

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ------------------------------------------------------------------ create
  describe('create', () => {
    const dto = {
      userId: 1,
      bookingId: 2,
      type: notification_type.BOOKING_CREATED,
      message: 'Your booking #2 was created.',
    } as any;

    it('should create a notification from the DTO and return it', async () => {
      const created = { id: 10, ...dto };
      mockPrisma.notification.create.mockResolvedValue(created);

      expect(await service.create(dto)).toBe(created);
      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 1,
          bookingId: 2,
          type: notification_type.BOOKING_CREATED,
          message: 'Your booking #2 was created.',
        },
      });
    });

    it('should only pass the four known fields to Prisma', async () => {
      mockPrisma.notification.create.mockResolvedValue({});

      await service.create({ ...dto, id: 999, createdAt: new Date(), extra: 'x' });

      const arg = mockPrisma.notification.create.mock.calls[0][0] as any;
      expect(Object.keys(arg.data).sort()).toEqual(['bookingId', 'message', 'type', 'userId']);
    });

    it('should propagate database errors', async () => {
      mockPrisma.notification.create.mockRejectedValue(new Error('FK violation'));

      await expect(service.create(dto)).rejects.toThrow('FK violation');
    });
  });

  // ----------------------------------------------------------------- findAll
  describe('findAll', () => {
    it("should return only the given user's notifications, newest first", async () => {
      const notifications = [{ id: 2 }, { id: 1 }];
      mockPrisma.notification.findMany.mockResolvedValue(notifications);

      expect(await service.findAll(5)).toBe(notifications);
      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith({
        where: { userId: 5 },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return an empty list when the user has no notifications', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);

      expect(await service.findAll(5)).toEqual([]);
    });
  });
});