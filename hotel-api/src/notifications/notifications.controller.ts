import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('notifications')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Unauthorized - missing, invalid or revoked token' })
@ApiResponse({ status: 429, description: 'Too Many Requests' })
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) { }

  @ApiOperation({ summary: 'List my notifications', description: 'Booking created / cancelled events of the logged-in user, newest first.' })
  @ApiResponse({ status: 200, description: 'Notifications of the current user', schema: { type: 'array', items: { example: { id: 1, userId: 1, bookingId: 12, type: 'BOOKING_CREATED', message: 'Your booking #12 for Deluxe Sea View was created and is pending approval.', isRead: false, createdAt: '2026-11-09T08:30:00.000Z' } } } })
  @Get()
  findAll(@Req() req: any) {
    return this.notificationsService.findAll(req.user.id);
  }
}