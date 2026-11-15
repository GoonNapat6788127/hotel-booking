import { Injectable, Logger } from '@nestjs/common';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) { }
  private readonly logger = new Logger(NotificationsService.name);

  create(createNotificationDto: CreateNotificationDto) {
    this.logger.log(`Creating notification type=${createNotificationDto.type} booking=${createNotificationDto.bookingId}`);
    return this.prisma.notification.create({
      data: {
        userId: createNotificationDto.userId,
        bookingId: createNotificationDto.bookingId,
        type: createNotificationDto.type,
        message: createNotificationDto.message,
      },
    });
  }

  findAll(userId: number) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }
}