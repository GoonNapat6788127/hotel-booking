import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

// Loosely typed jest.fn() so mockResolvedValue(...) accepts any value.
const fn = () => jest.fn<(...args: any[]) => any>();

// Mock NotificationsService: the controller talks to this instead of the real service/DB.
const mockNotificationsService = {
  findAll: fn(),
};

describe('NotificationsController Integration', () => {
  let controller: NotificationsController;

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    })
      // Skip real JWT validation: this isolates the controller logic.
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<NotificationsController>(NotificationsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('should fetch notifications for the id on req.user', async () => {
      const notifications = [{ id: 2 }, { id: 1 }];
      mockNotificationsService.findAll.mockResolvedValue(notifications);

      const result = await controller.findAll({ user: { id: 7, role: 'USER' } });

      expect(result).toBe(notifications);
      expect(mockNotificationsService.findAll).toHaveBeenCalledTimes(1);
      expect(mockNotificationsService.findAll).toHaveBeenCalledWith(7);
    });

    it('should return an empty list when the user has none', async () => {
      mockNotificationsService.findAll.mockResolvedValue([]);

      expect(await controller.findAll({ user: { id: 7 } })).toEqual([]);
    });

    it('should propagate errors from the service', async () => {
      mockNotificationsService.findAll.mockRejectedValue(new Error('db down'));

      await expect(controller.findAll({ user: { id: 7 } })).rejects.toThrow('db down');
    });
  });
});